/**
 * 对部分未写入 order_component 的订单，用「项目 + scheduling_id + GUID」补关联 component。
 * 整单未写入（order_component=0）不处理。
 *
 * 用法：
 *   node src/retry-partial-order-sync-scheduling.js
 *   node src/retry-partial-order-sync-scheduling.js --dry-run
 *   node src/retry-partial-order-sync-scheduling.js --max-orders 10
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');
const {
    fetchProjectArtifacts,
    fetchProductionPlans,
    mapArtifactRow
} = require('./project-list-component-api');
const {
    loadPlanToSchedulingFromDb,
    mergePlanToSchedulingFromPlans,
    loadComponentMatchIndex,
    resolveComponentMatch,
    pickGuid,
    pickComponentNo,
    pickSpec,
    pickLocation,
    pickSchedulingId
} = require('./order-component-match');

const WEBSITE_ORIGIN = (() => {
    try {
        return new URL(config.website.loginUrl).origin;
    } catch {
        return 'https://dwyunsc.ddwjzkj.com:22222';
    }
})();

const LOG_DIR = path.join(__dirname, '../logs');
const {
    ensureCloudProjectDeletedSchema,
    loadExcludedCloudProjectIds
} = require('./cloud-project-deleted');

let capturedToken = '';

function parseArgs(argv) {
    const out = { dryRun: false, sleepMs: 400, maxOrders: null, orderIds: [] };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') out.dryRun = true;
        else if (a === '--sleep-ms' && argv[i + 1]) {
            out.sleepMs = Math.max(0, Number(argv[i + 1]) || 0);
            i++;
        } else if (a === '--max-orders' && argv[i + 1]) {
            out.maxOrders = Math.max(1, Number(argv[i + 1]) || 1);
            i++;
        } else if (a === '--order-ids' && argv[i + 1]) {
            out.orderIds = argv[i + 1].split(',').map(s => Number(s.trim())).filter(Number.isFinite);
            i++;
        }
    }
    return out;
}

function rememberToken(headers) {
    const token = headers && (headers.token || headers.Token || headers.TOKEN);
    if (token && String(token).trim()) capturedToken = String(token).trim();
}

async function bootstrapToken(page) {
    page.on('request', req => {
        try {
            const url = String(req.url() || '');
            if (url.includes('/v1.')) rememberToken(req.headers());
        } catch {}
    });
    await page.goto(`${WEBSITE_ORIGIN}/project/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (!capturedToken) {
        await page.goto(`${WEBSITE_ORIGIN}/production/plan`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);
    }
    if (!capturedToken) throw new Error('无法获取 Token');
}

async function loadPartialOrders(pool, orderIds, excludedCloudProjects) {
    const params = [excludedCloudProjects];
    let extra = '';
    if (orderIds.length > 0) {
        params.push(orderIds);
        extra = ` AND so.order_id = ANY($2::bigint[])`;
    }
    const res = await pool.query(
        `
            SELECT
                so.order_id,
                so.cloud_project_id,
                so.project_name,
                so.order_name,
                so.artifacts_count,
                count(oc.order_component_id)::int AS order_component_count
            FROM sales_order so
            LEFT JOIN order_component oc ON oc.order_id = so.order_id
            WHERE so.cloud_project_id IS NOT NULL
              AND NOT (so.cloud_project_id = ANY($1::bigint[]))
              ${extra}
            GROUP BY so.order_id, so.cloud_project_id, so.project_name,
                     so.order_name, so.artifacts_count
            HAVING count(oc.order_component_id) > 0
               AND so.artifacts_count > count(oc.order_component_id)
            ORDER BY (so.artifacts_count - count(oc.order_component_id)) DESC,
                     so.order_id DESC
        `,
        params
    );
    return res.rows;
}

async function loadExistingByOrder(pool, orderId) {
    const res = await pool.query(
        `
            SELECT dwyun_artifact_id, component_id, component_guid
            FROM order_component
            WHERE order_id = $1
        `,
        [orderId]
    );
    const byArtifact = new Map();
    const byGuid = new Map();
    for (const row of res.rows || []) {
        byArtifact.set(String(row.dwyun_artifact_id), row);
        const g = String(row.component_guid || '').trim();
        if (g) byGuid.set(g, row);
    }
    return { byArtifact, byGuid };
}

async function upsertMatchedRow(pool, payload, dryRun) {
    const matchMethod = payload.scheduling_id != null ? 'project_scheduling_guid' : 'project_guid';
    const sql = `
        INSERT INTO order_component (
            order_id, dwyun_artifact_id, component_guid, component_no, spec, location,
            component_id, project_name, scheduling_id, plan_id, match_method, synced_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        ON CONFLICT (order_id, dwyun_artifact_id) DO UPDATE
          SET component_guid = EXCLUDED.component_guid,
              component_no = COALESCE(EXCLUDED.component_no, order_component.component_no),
              spec = COALESCE(EXCLUDED.spec, order_component.spec),
              location = COALESCE(EXCLUDED.location, order_component.location),
              component_id = EXCLUDED.component_id,
              project_name = EXCLUDED.project_name,
              scheduling_id = COALESCE(EXCLUDED.scheduling_id, order_component.scheduling_id),
              plan_id = COALESCE(EXCLUDED.plan_id, order_component.plan_id),
              match_method = EXCLUDED.match_method,
              synced_at = now()
    `;
    const params = [
        payload.order_id,
        payload.dwyun_artifact_id,
        payload.component_guid,
        payload.component_no,
        payload.spec,
        payload.location,
        payload.component_id,
        payload.project_name,
        payload.scheduling_id,
        payload.plan_id,
        matchMethod
    ];
    if (dryRun) return;
    await pool.query(sql, params);
}

async function updateSalesOrderNote(pool, orderId, note, dryRun) {
    if (dryRun) return;
    await pool.query(
        `UPDATE sales_order SET sync_note = $2, synced_at = now() WHERE order_id = $1`,
        [orderId, note]
    );
}

async function main() {
    const args = parseArgs(process.argv);
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const skippedPath = path.join(LOG_DIR, `partial_order_sched_retry_skipped_${stamp}.jsonl`);
    const reportPath = path.join(LOG_DIR, `partial_order_sched_retry_report_${stamp}.json`);

    const pool = new Pool({ ...config.db, max: 4, application_name: 'retry-partial-order-scheduling' });
    const report = {
        startedAt: new Date().toISOString(),
        dryRun: args.dryRun,
        summary: { ordersSeen: 0, ordersImproved: 0, written: 0, skipped: 0, alreadyLinked: 0 },
        results: []
    };

    const browserAutomation = new BrowserAutomation({
        ...config,
        browser: { ...(config.browser || {}), headless: true }
    });

    try {
        await ensureCloudProjectDeletedSchema(pool);
        const excludedCloudProjects = await loadExcludedCloudProjectIds(pool);

        let orders = await loadPartialOrders(pool, args.orderIds, excludedCloudProjects);
        if (args.maxOrders != null) orders = orders.slice(0, args.maxOrders);
        report.summary.ordersSeen = orders.length;
        if (orders.length === 0) {
            logger.info('无部分未写入订单需要处理');
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
            console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2));
            return;
        }

        const byProject = new Map();
        for (const row of orders) {
            const pid = Number(row.cloud_project_id);
            if (!byProject.has(pid)) byProject.set(pid, []);
            byProject.get(pid).push(row);
        }

        await browserAutomation.launchBrowser();
        if (!(await browserAutomation.login())) throw new Error('登录失败');
        const page = browserAutomation.page;
        capturedToken = '';
        await bootstrapToken(page);

        for (const [cloudProjectId, projectOrders] of byProject.entries()) {
            const planToScheduling = await loadPlanToSchedulingFromDb(pool);
            const plans = await fetchProductionPlans(page, capturedToken, cloudProjectId, {
                size: 200,
                maxAttempts: 3,
                retryDelayMs: 4000
            });
            if (plans.ok) mergePlanToSchedulingFromPlans(planToScheduling, plans.list);

            const indexes = await loadComponentMatchIndex(pool, planToScheduling);
            logger.info(
                `云项目 ${cloudProjectId}：部分订单 ${projectOrders.length} 个，plan→scheduling ${planToScheduling.size}，index3=${indexes.index3.size}`
            );

            for (const orderRow of projectOrders) {
                const item = {
                    order_id: Number(orderRow.order_id),
                    project_name: orderRow.project_name,
                    written: 0,
                    skipped: 0,
                    alreadyLinked: 0,
                    before: Number(orderRow.order_component_count),
                    apiCount: Number(orderRow.artifacts_count)
                };

                try {
                    const existing = await loadExistingByOrder(pool, item.order_id);
                    const part = await fetchProjectArtifacts(page, capturedToken, {
                        cloudProjectId,
                        orderId: item.order_id,
                        timeoutMs: 180000,
                        maxAttempts: 3,
                        retryDelayMs: 3000
                    });
                    if (!part.ok) {
                        item.error = part.msg || 'getProjectArtifacts failed';
                        report.results.push(item);
                        continue;
                    }

                    for (const raw of part.list) {
                        const mapped = mapArtifactRow(raw);
                        if (!mapped) {
                            item.skipped += 1;
                            continue;
                        }

                        const ex = existing.byArtifact.get(String(mapped.dwyun_artifact_id));
                        if (ex && ex.component_id != null) {
                            item.alreadyLinked += 1;
                            continue;
                        }

                        const match = resolveComponentMatch(indexes, orderRow.project_name, {
                            guid: mapped.component_guid,
                            scheduling_id: mapped.scheduling_id,
                            code: mapped.component_no,
                            spec: mapped.spec,
                            location: mapped.location
                        });

                        if (!match.ok) {
                            item.skipped += 1;
                            fs.appendFileSync(
                                skippedPath,
                                `${JSON.stringify({
                                    order_id: item.order_id,
                                    dwyun_artifact_id: mapped.dwyun_artifact_id,
                                    scheduling_id: mapped.scheduling_id,
                                    guid: pickGuid(mapped),
                                    reason: match.reason
                                })}\n`
                            );
                            continue;
                        }

                        const planId = match.matches[0].plan_id;
                        await upsertMatchedRow(
                            pool,
                            {
                                order_id: item.order_id,
                                dwyun_artifact_id: mapped.dwyun_artifact_id,
                                component_guid: match.guid,
                                component_no: pickComponentNo(mapped) || null,
                                spec: pickSpec(mapped) || null,
                                location: pickLocation(mapped) || null,
                                component_id: match.matches[0].component_id,
                                project_name: orderRow.project_name,
                                scheduling_id: pickSchedulingId(mapped),
                                plan_id: Number.isFinite(planId) ? planId : null
                            },
                            args.dryRun
                        );
                        item.written += 1;
                    }

                    const afterRes = await pool.query(
                        `SELECT count(*)::int AS n FROM order_component WHERE order_id = $1`,
                        [item.order_id]
                    );
                    item.after = afterRes.rows[0].n;
                    if (item.written > 0) {
                        report.summary.ordersImproved += 1;
                        const note =
                            item.after >= item.apiCount
                                ? 'artifacts_synced'
                                : `artifacts_partial:${item.after}/${item.apiCount}`;
                        await updateSalesOrderNote(pool, item.order_id, note, args.dryRun);
                    }

                    report.summary.written += item.written;
                    report.summary.skipped += item.skipped;
                    report.summary.alreadyLinked += item.alreadyLinked;
                    report.results.push(item);
                    logger.info(
                        `order_id=${item.order_id} +${item.written} skip=${item.skipped} linked=${item.alreadyLinked} ${item.before}→${item.after}/${item.apiCount}`
                    );
                } catch (err) {
                    item.error = err.message || String(err);
                    report.results.push(item);
                }

                if (args.sleepMs > 0) await page.waitForTimeout(args.sleepMs);
            }
        }

        report.finishedAt = new Date().toISOString();
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(JSON.stringify({ reportPath, skippedPath, summary: report.summary }, null, 2));
    } finally {
        await pool.end().catch(() => {});
        await browserAutomation.closeBrowser().catch(() => {});
    }
}

main().catch(err => {
    logger.error(err.message || err);
    process.exitCode = 1;
});
