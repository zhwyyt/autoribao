/**
 * 同步「项目列表 → 点击【构件】」接口数据到 order_component（订单/排产对应关系）。
 *
 * API 组合：
 *   POST /v1.order/getAllOrder               { project_id }        — 项目下订单列表
 *   POST /v1.project/getProjectArtifacts     { proj_id, order_id } — 按订单逐个拉构件（不用 order_id=0）
 *   POST /v1.production/getPlans             { proj_id }           — 补 plan_id（scheduling_id 映射）
 *
 * 用法：
 *   node src/extract-project-order-bridge.js
 *   node src/extract-project-order-bridge.js --cloud-project-id 163
 *   node src/extract-project-order-bridge.js --dry-run --max-projects 5
 *   node src/extract-project-order-bridge.js --incremental   # 仅桥接近期新同步订单涉及的项目
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');
const {
    fetchProjectBridgeBundle,
    mapArtifactRow,
    mapOrderRow
} = require('./project-list-component-api');

const SCHEMA_ALTER_PATH = path.join(__dirname, '../db/alter_order_component_bridge.sql');
const LOG_DIR = path.join(__dirname, '../logs');
const INCREMENTAL_BRIDGE_HOURS = 24;
const {
    ensureCloudProjectDeletedSchema,
    loadExcludedCloudProjectIds
} = require('./cloud-project-deleted');

const WEBSITE_ORIGIN = (() => {
    try {
        return new URL(config.website.loginUrl).origin;
    } catch {
        return 'https://dwyunsc.ddwjzkj.com:22222';
    }
})();

let capturedToken = '';

function parseArgs(argv) {
    const out = {
        dryRun: false,
        sleepMs: 100,
        maxProjects: null,
        cloudProjectIds: [],
        allCloudProjects: false,
        incremental: false
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') out.dryRun = true;
        else if (a === '--incremental') out.incremental = true;
        else if (a === '--all-cloud-projects') out.allCloudProjects = true;
        else if (a === '--sleep-ms' && argv[i + 1]) {
            out.sleepMs = Math.max(0, Number(argv[i + 1]) || 0);
            i++;
        } else if (a === '--max-projects' && argv[i + 1]) {
            out.maxProjects = Math.max(1, Number(argv[i + 1]) || 1);
            i++;
        } else if ((a === '--cloud-project-id' || a === '--cloud-project-ids') && argv[i + 1]) {
            out.cloudProjectIds.push(
                ...String(argv[i + 1])
                    .split(',')
                    .map(x => Number(x.trim()))
                    .filter(n => Number.isFinite(n) && n > 0)
            );
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
            if (url.includes('/v1.order/') || url.includes('/v1.project/') || url.includes('/v1.production/')) {
                rememberToken(req.headers());
            }
        } catch {}
    });
    await gotoPage(browserAutomation, `${WEBSITE_ORIGIN}/project/index`);
    await page.waitForTimeout(2500);
    if (!capturedToken) {
        capturedToken = await page.evaluate(() =>
            localStorage.getItem('Token') || localStorage.getItem('token') || ''
        );
    }
    if (!capturedToken) throw new Error('无法获取 Token');
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
        application_name: 'extract-project-order-bridge'
    });
}

async function ensureBridgeSchema(pool) {
    const sql = fs.readFileSync(SCHEMA_ALTER_PATH, 'utf8');
    const statements = sql
        .split(';')
        .map(s => s.replace(/^\s*\\.*$/gm, '').trim())
        .filter(s => s && !s.startsWith('--') && s.toUpperCase() !== 'BEGIN' && s.toUpperCase() !== 'COMMIT');
    for (const statement of statements) {
        await pool.query(statement);
    }
}

async function loadCloudProjectIds(pool, options) {
    const excluded = options.excludedCloudProjectIds || [];
    if (options.cloudProjectIds.length) {
        return options.cloudProjectIds.map(id => ({ cloud_project_id: id, project_name: null }));
    }
    if (options.allCloudProjects) return null;
    if (options.incremental) {
        const res = await pool.query(
            `
                SELECT cloud_project_id, MAX(project_name) AS project_name
                FROM sales_order
                WHERE cloud_project_id IS NOT NULL
                  AND NOT (cloud_project_id = ANY($2::bigint[]))
                  AND synced_at >= now() - ($1::text || ' hours')::interval
                GROUP BY cloud_project_id
                ORDER BY cloud_project_id
            `,
            [String(INCREMENTAL_BRIDGE_HOURS), excluded]
        );
        return res.rows.map(r => ({
            cloud_project_id: Number(r.cloud_project_id),
            project_name: r.project_name
        }));
    }
    const res = await pool.query(
        `
            SELECT cloud_project_id, MAX(project_name) AS project_name
            FROM sales_order
            WHERE cloud_project_id IS NOT NULL
              AND NOT (cloud_project_id = ANY($1::bigint[]))
            GROUP BY cloud_project_id
            ORDER BY cloud_project_id
        `,
        [excluded]
    );
    return res.rows.map(r => ({
        cloud_project_id: Number(r.cloud_project_id),
        project_name: r.project_name
    }));
}

async function fetchAllCloudProjectsFromApi(page, token) {
    const API = 'https://dwyunsc.ddwjzkj.com:10086/v1.project/getList';
    const size = 200;
    const first = await page.request.post(API, {
        data: { keyword: '', code: '', page: 1, size },
        headers: { Token: token, 'Content-Type': 'application/json;charset=utf-8' }
    }).then(r => r.json());
    if (!first || first.code !== 0) throw new Error(`project/getList 失败`);
    const data0 = first.data || {};
    const total = Number(data0.count);
    const pageSize = Number(data0.size) || size;
    const totalPages = Number.isFinite(total) && total > 0
        ? Math.max(1, Math.ceil(total / pageSize))
        : 1;
    const all = [...(data0.list || [])];
    for (let p = 2; p <= totalPages; p++) {
        const json = await page.request.post(API, {
            data: { keyword: '', code: '', page: p, size },
            headers: { Token: token, 'Content-Type': 'application/json;charset=utf-8' }
        }).then(r => r.json());
        all.push(...((json.data && json.data.list) || []));
    }
    return all.map(item => ({
        cloud_project_id: Number(item.id),
        project_name: String(item.name || item.engineer_name || '').trim()
    })).filter(x => Number.isFinite(x.cloud_project_id) && x.cloud_project_id > 0);
}

async function upsertOrderHeader(pool, orderRow, projectName, dryRun) {
    if (!orderRow || dryRun) return;
    await pool.query(
        `
            INSERT INTO sales_order (order_id, project_name, order_name, order_code, cloud_project_id, synced_at, sync_note)
            VALUES ($1, $2, $3, $4, $5, now(), 'from_getAllOrder')
            ON CONFLICT (order_id) DO UPDATE
              SET order_name = COALESCE(NULLIF(EXCLUDED.order_name, ''), sales_order.order_name),
                  order_code = COALESCE(NULLIF(EXCLUDED.order_code, ''), sales_order.order_code),
                  cloud_project_id = COALESCE(EXCLUDED.cloud_project_id, sales_order.cloud_project_id),
                  synced_at = now()
        `,
        [orderRow.order_id, projectName || '', orderRow.order_name, orderRow.order_code, orderRow.cloud_project_id]
    );
}

async function updateBridgeRow(pool, row, dryRun) {
    const params = [
        row.order_id,
        row.dwyun_artifact_id,
        row.scheduling_id,
        row.plan_id
    ];
    const sql = `
        UPDATE order_component
           SET scheduling_id = $3,
               plan_id = $4,
               bridge_synced_at = now()
         WHERE order_id = $1
           AND dwyun_artifact_id = $2
    `;
    if (dryRun) {
        const check = await pool.query(
            `SELECT order_component_id FROM order_component WHERE order_id = $1 AND dwyun_artifact_id = $2`,
            [row.order_id, row.dwyun_artifact_id]
        );
        return check.rows.length ? { status: 'updated' } : { status: 'missing_order_row' };
    }
    const res = await pool.query(sql, params);
    if (res.rowCount > 0) return { status: 'updated' };

    const guid = normalizeText(row.component_guid);
    if (guid) {
        const byGuid = await pool.query(
            `
                UPDATE order_component
                   SET scheduling_id = $3,
                       plan_id = $4,
                       dwyun_artifact_id = $2,
                       bridge_synced_at = now()
                 WHERE order_id = $1
                   AND component_guid = $5
            `,
            [row.order_id, row.dwyun_artifact_id, row.scheduling_id, row.plan_id, guid]
        );
        if (byGuid.rowCount > 0) return { status: 'updated_by_guid' };
    }
    return { status: 'missing_order_row' };
}

async function main() {
    const args = parseArgs(process.argv);
    ensureLogDir();
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const skippedPath = path.join(LOG_DIR, `project_bridge_skipped_${stamp}.jsonl`);
    const reportPath = path.join(LOG_DIR, `project_bridge_report_${stamp}.json`);

    const report = {
        startedAt: new Date().toISOString(),
        api: {
            getAllOrder: '/v1.order/getAllOrder',
            getProjectArtifacts: '/v1.project/getProjectArtifacts',
            getPlans: '/v1.production/getPlans'
        },
        args,
        summary: {
            cloudProjectsSeen: 0,
            ordersSeen: 0,
            artifactsSeen: 0,
            bridgeUpdated: 0,
            bridgeUpdatedByGuid: 0,
            missingOrderRow: 0,
            missingPlanMapping: 0,
            plansSeen: 0,
            skipUnmapped: 0,
            apiFailed: 0
        },
        finishedAt: null
    };

    const bump = (key, n = 1) => {
        report.summary[key] = (report.summary[key] || 0) + n;
    };

    const pool = createPool();
    const browserAutomation = new BrowserAutomation({
        ...config,
        browser: { ...(config.browser || {}), headless: true }
    });

    try {
        await ensureBridgeSchema(pool);
        await ensureCloudProjectDeletedSchema(pool);
        const excludedCloudProjects = await loadExcludedCloudProjectIds(pool);
        logger.info(
            `桥接同步：getAllOrder → 按订单 getProjectArtifacts → getPlans（incremental=${args.incremental}）`
        );

        const started = await browserAutomation.launchBrowser();
        if (!started) throw new Error('浏览器启动失败');
        if (!(await browserAutomation.login())) throw new Error('登录失败');

        const page = browserAutomation.page;
        await bootstrapToken(browserAutomation);
        await pool.query(`SET app.sync_source = 'extract-project-order-bridge'`);

        let projects = await loadCloudProjectIds(pool, {
            ...args,
            excludedCloudProjectIds: excludedCloudProjects
        });
        if (projects === null) {
            projects = await fetchAllCloudProjectsFromApi(page, capturedToken);
            logger.info(`从 project/getList 加载云项目 ${projects.length} 个`);
        } else {
            logger.info(
                args.incremental
                    ? `增量：近 ${INCREMENTAL_BRIDGE_HOURS} 小时新同步订单涉及云项目 ${projects.length} 个`
                    : `从 sales_order 加载云项目 ${projects.length} 个`
            );
        }
        if (projects.length === 0) {
            logger.info('无待桥接项目，结束');
            report.finishedAt = new Date().toISOString();
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
            console.log(JSON.stringify({ reportPath, summary: report.summary, message: 'no_projects' }, null, 2));
            return;
        }
        if (args.maxProjects != null) projects = projects.slice(0, args.maxProjects);

        for (const proj of projects) {
            const cloudProjectId = proj.cloud_project_id;
            report.summary.cloudProjectsSeen += 1;
            logger.info(`项目 ${cloudProjectId}${proj.project_name ? ` ${proj.project_name}` : ''}`);

            let bundle;
            try {
                bundle = await fetchProjectBridgeBundle(page, capturedToken, cloudProjectId, {
                    artifactTimeoutMs: 180000,
                    artifactMaxAttempts: 2,
                    artifactRetryDelayMs: 3000,
                    perOrderSleepMs: 300
                });
            } catch (err) {
                bump('apiFailed');
                appendJsonl(skippedPath, {
                    scope: 'project',
                    cloud_project_id: cloudProjectId,
                    reason: 'api_bundle_failed',
                    error: err.message
                });
                continue;
            }

            if (!bundle.orders.ok || !bundle.artifacts.ok || !bundle.plans.ok) {
                bump('apiFailed');
                appendJsonl(skippedPath, {
                    scope: 'project',
                    cloud_project_id: cloudProjectId,
                    reason: 'api_code_not_ok',
                    ordersMsg: bundle.orders.msg,
                    artifactsMsg: bundle.artifacts.msg,
                    plansMsg: bundle.plans.msg
                });
                continue;
            }

            report.summary.plansSeen += bundle.plans.list.length;
            const schedMap = bundle.schedulingToPlan;
            logger.info(`  getPlans ${bundle.plans.list.length} 条，scheduling→plan 映射 ${schedMap.size} 条；构件按 ${bundle.orders.list.length} 个订单分批拉取`);

            report.summary.ordersSeen += bundle.orders.list.length;
            for (const rawOrder of bundle.orders.list) {
                const orderRow = mapOrderRow(rawOrder);
                if (orderRow) await upsertOrderHeader(pool, orderRow, proj.project_name, args.dryRun);
            }

            report.summary.artifactsSeen += bundle.artifacts.list.length;
            for (const raw of bundle.artifacts.list) {
                const mapped = mapArtifactRow(raw);
                if (!mapped) {
                    bump('skipUnmapped');
                    continue;
                }
                const planInfo = mapped.scheduling_id != null
                    ? schedMap.get(mapped.scheduling_id)
                    : null;
                if (!planInfo) {
                    bump('missingPlanMapping');
                    appendJsonl(skippedPath, {
                        scope: 'artifact',
                        cloud_project_id: cloudProjectId,
                        reason: 'missing_plan_mapping',
                        order_id: mapped.order_id,
                        dwyun_artifact_id: mapped.dwyun_artifact_id,
                        scheduling_id: mapped.scheduling_id,
                        scheduling_name: mapped.scheduling_name,
                        component_guid: mapped.component_guid,
                        component_no: mapped.component_no,
                        order_name: mapped.order_name
                    });
                    continue;
                }
                mapped.plan_id = planInfo.plan_id;
                const result = await updateBridgeRow(pool, mapped, args.dryRun);
                if (result.status === 'updated') bump('bridgeUpdated');
                else if (result.status === 'updated_by_guid') bump('bridgeUpdatedByGuid');
                else if (result.status === 'missing_order_row') {
                    bump('missingOrderRow');
                    appendJsonl(skippedPath, {
                        scope: 'artifact',
                        cloud_project_id: cloudProjectId,
                        reason: 'missing_order_row',
                        order_id: mapped.order_id,
                        dwyun_artifact_id: mapped.dwyun_artifact_id,
                        scheduling_id: mapped.scheduling_id,
                        scheduling_name: mapped.scheduling_name,
                        component_guid: mapped.component_guid,
                        component_no: mapped.component_no,
                        component_name: mapped.component_name,
                        order_name: mapped.order_name
                    });
                }
            }

            logger.info(
                `  订单 ${bundle.orders.list.length}，构件 ${bundle.artifacts.list.length}，` +
                `已更新 ${report.summary.bridgeUpdated + report.summary.bridgeUpdatedByGuid}`
            );

            if (args.sleepMs > 0) await page.waitForTimeout(args.sleepMs);
        }

        report.finishedAt = new Date().toISOString();
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

        const counts = await pool.query(
            `
                SELECT
                    count(*)::int AS total,
                    count(*) FILTER (WHERE scheduling_id IS NOT NULL)::int AS with_scheduling,
                    count(*) FILTER (WHERE plan_id IS NOT NULL)::int AS with_plan
                FROM order_component
            `
        );

        logger.info('项目构件桥接同步结束');
        console.log(JSON.stringify({
            reportPath,
            skippedPath,
            summary: report.summary,
            db: counts.rows[0],
            dryRun: args.dryRun
        }, null, 2));
    } finally {
        await pool.end();
        await browserAutomation.closeBrowser();
    }
}

main().catch(err => {
    logger.error(err && err.message ? err.message : err);
    process.exitCode = 1;
});
