/**
 * 全量同步订单列表 + 订单构件，并关联生产库 component。
 * 不一致项跳过，仅记录，等待人工确认后再处理。
 *
 * 用法：
 *   node src/extract-order-sync.js
 *   node src/extract-order-sync.js --dry-run
 *   node src/extract-order-sync.js --max-orders 20
 *   node src/extract-order-sync.js --page-size 50 --sleep-ms 300
 *   node src/extract-order-sync.js --reset-order-data
 *   node src/extract-order-sync.js --incremental          # 仅同步 sales_order 中不存在的订单（日增）
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');
const {
    pickGuid,
    pickSchedulingId,
    pickComponentNo,
    pickSpec,
    pickLocation,
    loadPlanToSchedulingFromDb,
    loadComponentMatchIndex,
    resolveComponentMatch
} = require('./order-component-match');

const API_ORIGIN = 'https://dwyunsc.ddwjzkj.com:10086';
const API_GET_LIST = `${API_ORIGIN}/v1.order/getList`;
const API_GET_ORDER_ARTIFACTS = `${API_ORIGIN}/v1.order/getOrderArtifacts`;

const WEBSITE_ORIGIN = (() => {
    try {
        return new URL(config.website.loginUrl).origin;
    } catch {
        return 'https://dwyunsc.ddwjzkj.com:22222';
    }
})();

const SCHEMA_PATH = path.join(__dirname, '../db/order_sync_schema.sql');
const LOG_DIR = path.join(__dirname, '../logs');
const {
    ensureCloudProjectDeletedSchema,
    loadExcludedCloudProjectIds,
    isExcludedCloudProject
} = require('./cloud-project-deleted');

let capturedToken = '';

function parseArgs(argv) {
    const out = {
        dryRun: false,
        pageSize: 50,
        sleepMs: 300,
        maxOrders: null,
        resetOrderData: false,
        incremental: false
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') {
            out.dryRun = true;
        } else if (a === '--incremental') {
            out.incremental = true;
        } else if (a === '--reset-order-data') {
            out.resetOrderData = true;
        } else if (a === '--page-size' && argv[i + 1]) {
            out.pageSize = Math.max(1, Number(argv[i + 1]) || 50);
            i++;
        } else if (a === '--sleep-ms' && argv[i + 1]) {
            out.sleepMs = Math.max(0, Number(argv[i + 1]) || 0);
            i++;
        } else if (a === '--max-orders' && argv[i + 1]) {
            out.maxOrders = Math.max(1, Number(argv[i + 1]) || 1);
            i++;
        }
    }
    return out;
}

function normalizeText(value) {
    return String(value == null ? '' : value)
        .trim()
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .replace(/\s+/g, '');
}

function toTimestamp(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value < 1e12 ? value * 1000 : value;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
        const n = Number(text);
        const ms = n < 1e12 ? n * 1000 : n;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rememberToken(headers) {
    if (!headers) return;
    const token = headers.token || headers.Token || headers.TOKEN;
    if (token && String(token).trim()) capturedToken = String(token).trim();
}

function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function appendJsonl(filePath, row) {
    fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

async function gotoPage(browserAutomation, url) {
    const page = browserAutomation.page;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    if (page.url().includes('/login')) {
        const ok = await browserAutomation.login();
        if (!ok) throw new Error(`登录失败：${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle').catch(() => {});
    }
}

async function bootstrapToken(browserAutomation) {
    const page = browserAutomation.page;
    page.on('request', req => {
        try {
            const url = String(req.url() || '');
            if (url.includes('/v1.order/') || url.includes('/v1.production/')) {
                rememberToken(req.headers());
            }
        } catch {}
    });
    await gotoPage(browserAutomation, `${WEBSITE_ORIGIN}/order/index`);
    await page.waitForTimeout(2500);
    if (!capturedToken) {
        await gotoPage(browserAutomation, `${WEBSITE_ORIGIN}/production/plan`);
        await page.waitForTimeout(2500);
    }
    if (!capturedToken) throw new Error('无法获取 Token');
}

async function postApi(page, url, payload) {
    const res = await page.request.post(url, {
        data: payload,
        headers: {
            Token: capturedToken,
            'Content-Type': 'application/json;charset=utf-8'
        },
        timeout: 120000
    });
    return res.json();
}

function createPool() {
    const db = config.db || {};
    if (!db.host || !db.user || !db.database) {
        throw new Error('缺少数据库配置');
    }
    return new Pool({
        host: db.host,
        port: db.port || 5432,
        user: db.user,
        password: db.password || '',
        database: db.database,
        max: 5,
        application_name: 'extract-order-sync'
    });
}

async function ensureSchema(pool) {
    const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const statements = sql
        .split(';')
        .map(s => s.replace(/^\s*\\.*$/gm, '').trim())
        .filter(s => s && !s.startsWith('--') && s.toUpperCase() !== 'BEGIN' && s.toUpperCase() !== 'COMMIT');
    for (const statement of statements) {
        await pool.query(statement);
    }
}


function mapOrderRow(order) {
    return {
        order_id: Number(order.id),
        project_id: null,
        project_name: String(order.project_name || '').trim(),
        order_name: String(order.name || '').trim(),
        order_code: String(order.code || '').trim() || null,
        order_status: Number.isFinite(Number(order.order_status)) ? Number(order.order_status) : null,
        order_status_name: String(order.order_status_name || '').trim() || null,
        artifacts_count: Number(order.artifacts_count) || 0,
        cloud_project_id: Number.isFinite(Number(order.project_id)) ? Number(order.project_id) : null,
        start_time: toTimestamp(order.start_time),
        end_time: toTimestamp(order.end_time),
        create_time: toTimestamp(order.create_time),
        update_time: toTimestamp(order.update_time)
    };
}

function extractArtifacts(body) {
    if (!body || body.code !== 0) {
        return { ok: false, msg: body && body.msg, artifacts: [] };
    }
    const data = body.data;
    const artifacts = Array.isArray(data)
        ? data
        : data && Array.isArray(data.list)
            ? data.list
            : [];
    return { ok: true, msg: body.msg, artifacts };
}

async function upsertSalesOrder(pool, row, syncNote, dryRun) {
    const sql = `
        INSERT INTO sales_order (
            order_id, project_id, project_name, order_name, order_code,
            order_status, order_status_name, artifacts_count, cloud_project_id,
            start_time, end_time, create_time, update_time, synced_at, sync_note
        )
        VALUES (
            $1, NULL, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, $11, $12, now(), $13
        )
        ON CONFLICT (order_id) DO UPDATE
          SET project_name = EXCLUDED.project_name,
              order_name = EXCLUDED.order_name,
              order_code = EXCLUDED.order_code,
              order_status = EXCLUDED.order_status,
              order_status_name = EXCLUDED.order_status_name,
              artifacts_count = EXCLUDED.artifacts_count,
              cloud_project_id = EXCLUDED.cloud_project_id,
              start_time = EXCLUDED.start_time,
              end_time = EXCLUDED.end_time,
              create_time = EXCLUDED.create_time,
              update_time = EXCLUDED.update_time,
              synced_at = now(),
              sync_note = EXCLUDED.sync_note
    `;
    const params = [
        row.order_id,
        row.project_name,
        row.order_name,
        row.order_code,
        row.order_status,
        row.order_status_name,
        row.artifacts_count,
        row.cloud_project_id,
        row.start_time,
        row.end_time,
        row.create_time,
        row.update_time,
        syncNote
    ];
    if (dryRun) return { dryRun: true };
    await pool.query(sql, params);
    return { dryRun: false };
}

async function loadExistingOrderIds(pool) {
    const res = await pool.query(`SELECT order_id FROM sales_order`);
    return new Set((res.rows || []).map(r => Number(r.order_id)));
}

async function upsertOrderComponent(pool, payload, dryRun) {
    const sql = `
        INSERT INTO order_component (
            order_id, dwyun_artifact_id, component_guid, component_no, spec, location,
            component_id, project_name, scheduling_id, plan_id, match_method, synced_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        ON CONFLICT (order_id, dwyun_artifact_id) DO UPDATE
          SET component_guid = EXCLUDED.component_guid,
              component_no = EXCLUDED.component_no,
              spec = EXCLUDED.spec,
              location = EXCLUDED.location,
              component_id = EXCLUDED.component_id,
              project_name = EXCLUDED.project_name,
              scheduling_id = COALESCE(EXCLUDED.scheduling_id, order_component.scheduling_id),
              plan_id = COALESCE(EXCLUDED.plan_id, order_component.plan_id),
              match_method = EXCLUDED.match_method,
              synced_at = now()
    `;
    const matchMethod =
        payload.scheduling_id != null ? 'project_scheduling_guid' : 'project_guid';
    if (dryRun) return;
    await pool.query(sql, [
        payload.order_id,
        payload.dwyun_artifact_id,
        payload.component_guid,
        payload.component_no,
        payload.spec,
        payload.location,
        payload.component_id,
        payload.project_name,
        payload.scheduling_id || null,
        payload.plan_id || null,
        matchMethod
    ]);
}

async function main() {
    const args = parseArgs(process.argv);
    capturedToken = '';
    ensureLogDir();

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const skippedPath = path.join(LOG_DIR, `order_sync_skipped_${stamp}.jsonl`);
    const reportPath = path.join(LOG_DIR, `order_sync_report_${stamp}.json`);

    const report = {
        startedAt: new Date().toISOString(),
        dryRun: args.dryRun,
        pageSize: args.pageSize,
        sleepMs: args.sleepMs,
        maxOrders: args.maxOrders,
        incremental: args.incremental,
        summary: {
            ordersListed: 0,
            ordersNew: 0,
            ordersSeen: 0,
            ordersSynced: 0,
            ordersSkipped: 0,
            ordersSkippedExisting: 0,
            ordersSkippedExcluded: 0,
            artifactsSeen: 0,
            artifactsWritten: 0,
            artifactsSkipped: 0,
            skipReasons: {}
        },
        orderIssues: [],
        finishedAt: null
    };

    function bumpSkip(reason) {
        report.summary.artifactsSkipped += 1;
        report.summary.skipReasons[reason] = (report.summary.skipReasons[reason] || 0) + 1;
    }

    const pool = createPool();
    const browserAutomation = new BrowserAutomation({
        ...config,
        browser: { ...(config.browser || {}), headless: true }
    });

    try {
        logger.info(`订单同步开始（dryRun=${args.dryRun} incremental=${args.incremental}）`);
        await ensureSchema(pool);
        await ensureCloudProjectDeletedSchema(pool);
        const excludedCloudProjects = await loadExcludedCloudProjectIds(pool);
        logger.info(`订单表结构已就绪；已登记删除云项目 ${excludedCloudProjects.length} 个`);

        if (args.resetOrderData && !args.dryRun) {
            await pool.query('TRUNCATE TABLE order_component, sales_order RESTART IDENTITY');
            logger.info('已清空 sales_order / order_component（--reset-order-data）');
        }

        const existingOrderIds = args.incremental ? await loadExistingOrderIds(pool) : null;
        if (args.incremental) {
            logger.info(`增量模式：库内已有订单 ${existingOrderIds.size} 个，仅处理新增订单`);
        }

        const planToScheduling = await loadPlanToSchedulingFromDb(pool);
        const matchIndexes = await loadComponentMatchIndex(pool, planToScheduling);
        logger.info(
            `已加载 component 匹配索引：project+guid=${matchIndexes.index2.size}，project+scheduling+guid=${matchIndexes.index3.size}`
        );

        const started = await browserAutomation.launchBrowser();
        if (!started) throw new Error('浏览器启动失败');
        const ok = await browserAutomation.login();
        if (!ok) throw new Error('登录失败');

        const page = browserAutomation.page;
        await bootstrapToken(browserAutomation);
        await pool.query(`SET app.sync_source = 'extract-order-sync'`);

        const firstPage = await postApi(page, API_GET_LIST, {
            proj_id: 0,
            keyword: '',
            code: '',
            page: 1,
            size: args.pageSize
        });
        if (!firstPage || firstPage.code !== 0) {
            throw new Error(`getList 首页失败：${firstPage && firstPage.msg}`);
        }
        const totalCount = Number(firstPage.data && firstPage.data.count) || 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / args.pageSize));
        logger.info(`订单总数 ${totalCount}，分页 ${totalPages}（size=${args.pageSize}）`);

        let processedOrders = 0;

        for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
            const listBody = pageNo === 1
                ? firstPage
                : await postApi(page, API_GET_LIST, {
                    proj_id: 0,
                    keyword: '',
                    code: '',
                    page: pageNo,
                    size: args.pageSize
                });

            if (!listBody || listBody.code !== 0) {
                const issue = { scope: 'getList', page: pageNo, msg: listBody && listBody.msg };
                report.orderIssues.push(issue);
                appendJsonl(skippedPath, issue);
                continue;
            }

            const orders = (listBody.data && listBody.data.list) || [];
            for (const order of orders) {
                if (args.maxOrders != null && processedOrders >= args.maxOrders) break;

                report.summary.ordersListed += 1;

                const mapped = mapOrderRow(order);
                if (!mapped.order_id) {
                    report.summary.ordersSkipped += 1;
                    appendJsonl(skippedPath, {
                        scope: 'order',
                        reason: 'missing_order_id',
                        order
                    });
                    continue;
                }

                if (args.incremental) {
                    if (isExcludedCloudProject(mapped.cloud_project_id, excludedCloudProjects)) {
                        report.summary.ordersSkippedExcluded += 1;
                        continue;
                    }
                    if (existingOrderIds.has(mapped.order_id)) {
                        report.summary.ordersSkippedExisting += 1;
                        continue;
                    }
                }

                processedOrders += 1;
                report.summary.ordersNew += 1;
                report.summary.ordersSeen += 1;

                let orderSyncNote = null;
                let orderSkipped = false;

                try {
                    // 必须先写入订单头，否则 order_component 外键会失败。
                    await upsertSalesOrder(pool, mapped, null, args.dryRun);

                    const detailBody = await postApi(page, API_GET_ORDER_ARTIFACTS, { id: mapped.order_id });
                    const detail = extractArtifacts(detailBody);
                    if (!detail.ok) {
                        orderSkipped = true;
                        orderSyncNote = `artifacts_api_failed:${detail.msg || 'unknown'}`;
                        await upsertSalesOrder(pool, mapped, orderSyncNote, args.dryRun);
                        report.summary.ordersSkipped += 1;
                        appendJsonl(skippedPath, {
                            scope: 'order',
                            reason: 'artifacts_api_failed',
                            order_id: mapped.order_id,
                            project_name: mapped.project_name,
                            msg: detail.msg
                        });
                    } else {
                        const artifacts = detail.artifacts || [];
                        report.summary.artifactsSeen += artifacts.length;

                        if (mapped.artifacts_count !== artifacts.length) {
                            orderSkipped = true;
                            orderSyncNote = `artifact_count_mismatch:expected=${mapped.artifacts_count},actual=${artifacts.length}`;
                            await upsertSalesOrder(pool, mapped, orderSyncNote, args.dryRun);
                            report.summary.ordersSkipped += 1;
                            appendJsonl(skippedPath, {
                                scope: 'order',
                                reason: 'artifact_count_mismatch',
                                order_id: mapped.order_id,
                                project_name: mapped.project_name,
                                order_name: mapped.order_name,
                                expected: mapped.artifacts_count,
                                actual: artifacts.length
                            });
                            if (report.orderIssues.length < 50) {
                                report.orderIssues.push({
                                    order_id: mapped.order_id,
                                    project_name: mapped.project_name,
                                    reason: 'artifact_count_mismatch',
                                    expected: mapped.artifacts_count,
                                    actual: artifacts.length
                                });
                            }
                        } else {
                            let written = 0;
                            for (const artifact of artifacts) {
                                const dwyunArtifactId = Number(artifact.id);
                                if (!Number.isFinite(dwyunArtifactId)) {
                                    bumpSkip('missing_dwyun_artifact_id');
                                    appendJsonl(skippedPath, {
                                        scope: 'artifact',
                                        reason: 'missing_dwyun_artifact_id',
                                        order_id: mapped.order_id,
                                        project_name: mapped.project_name,
                                        artifact
                                    });
                                    continue;
                                }

                                const match = resolveComponentMatch(matchIndexes, mapped.project_name, artifact);
                                if (!match.ok) {
                                    bumpSkip(match.reason);
                                    appendJsonl(skippedPath, {
                                        scope: 'artifact',
                                        reason: match.reason,
                                        order_id: mapped.order_id,
                                        project_name: mapped.project_name,
                                        dwyun_artifact_id: dwyunArtifactId,
                                        guid: match.guid,
                                        component_no: pickComponentNo(artifact),
                                        spec: pickSpec(artifact),
                                        db_match_count: match.matches.length
                                    });
                                    continue;
                                }

                                await upsertOrderComponent(pool, {
                                    order_id: mapped.order_id,
                                    dwyun_artifact_id: dwyunArtifactId,
                                    component_guid: match.guid,
                                    component_no: pickComponentNo(artifact) || null,
                                    spec: pickSpec(artifact) || null,
                                    location: pickLocation(artifact) || null,
                                    component_id: match.matches[0].component_id,
                                    project_name: mapped.project_name,
                                    scheduling_id: pickSchedulingId(artifact),
                                    plan_id: match.matches[0].plan_id || null
                                }, args.dryRun);
                                written += 1;
                                report.summary.artifactsWritten += 1;
                            }

                            if (written === artifacts.length) {
                                orderSyncNote = 'artifacts_synced';
                            } else {
                                orderSyncNote = `artifacts_partial:${written}/${artifacts.length}`;
                            }
                            await upsertSalesOrder(pool, mapped, orderSyncNote, args.dryRun);
                        }
                    }

                    if (!orderSkipped) report.summary.ordersSynced += 1;
                } catch (err) {
                    report.summary.ordersSkipped += 1;
                    appendJsonl(skippedPath, {
                        scope: 'order',
                        reason: 'order_sync_exception',
                        order_id: mapped.order_id,
                        project_name: mapped.project_name,
                        error: err && err.message ? err.message : String(err)
                    });
                }

                if (args.sleepMs > 0) await page.waitForTimeout(args.sleepMs);
            }

            logger.info(
                `完成订单列表第 ${pageNo}/${totalPages} 页（本批新增处理 ${processedOrders}，跳过已有 ${report.summary.ordersSkippedExisting}）`
            );
            if (args.maxOrders != null && processedOrders >= args.maxOrders) break;
        }

        report.finishedAt = new Date().toISOString();
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

        logger.info('订单同步结束');
        console.log(JSON.stringify({
            reportPath,
            skippedPath,
            summary: report.summary,
            dryRun: args.dryRun
        }, null, 2));
    } finally {
        await pool.end().catch(() => {});
        await browserAutomation.closeBrowser().catch(() => {});
    }
}

main().catch(err => {
    logger.error(`订单同步失败：${err && err.message ? err.message : err}`);
    process.exitCode = 1;
});
