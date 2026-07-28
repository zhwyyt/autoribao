/**
 * 单云项目全量同步：生产计划+构件 → 订单构件 → 排产桥接
 *
 * 用法：
 *   node src/sync-cloud-project.js --cloud-project-id 52
 *   node src/sync-cloud-project.js --project-name 质安项目
 *   node src/sync-cloud-project.js --cloud-project-id 52 --skip-plans
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');

const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');
const { fetchProjectOrders, fetchProjectArtifacts } = require('./project-list-component-api');
const {
    ensureCloudProjectDeletedSchema,
    loadExcludedCloudProjectIds,
    isExcludedCloudProject
} = require('./cloud-project-deleted');
const {
    loadPlanToSchedulingFromDb,
    loadComponentMatchIndex,
    resolveComponentMatch,
    pickGuid,
    pickSchedulingId,
    pickComponentNo,
    pickSpec,
    pickLocation
} = require('./order-component-match');

const WEBSITE_ORIGIN = new URL(config.website.loginUrl).origin;
const SCHEMA_PATH = path.join(__dirname, '../db/order_sync_schema.sql');

let capturedToken = '';
function parseArgs(argv) {
    const out = {
        cloudProjectId: null,
        projectName: null,
        sleepMs: 300,
        skipPlans: false,
        skipBridge: false,
        skipOrders: false
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--skip-plans') out.skipPlans = true;
        else if (a === '--skip-bridge') out.skipBridge = true;
        else if (a === '--skip-orders') out.skipOrders = true;
        else if (a === '--sleep-ms' && argv[i + 1]) {
            out.sleepMs = Math.max(0, Number(argv[i + 1]) || 0);
            i++;
        } else if (a === '--cloud-project-id' && argv[i + 1]) {
            out.cloudProjectId = Number(argv[i + 1]);
            i++;
        } else if (a === '--project-name' && argv[i + 1]) {
            out.projectName = String(argv[i + 1]).trim();
            i++;
        }
    }
    return out;
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
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapOrderRow(order) {
    return {
        order_id: Number(order.id),
        project_name: String(order.project_name || order.name || '').trim(),
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
    const artifacts = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : []);
    return { ok: true, artifacts };
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

async function resolveProject(pool, args) {
    if (args.cloudProjectId) {
        const r = await pool.query(
            `SELECT project_id, project_name FROM project WHERE project_id = $1`,
            [args.cloudProjectId]
        );
        return {
            cloud_project_id: args.cloudProjectId,
            project_name: r.rows[0] ? r.rows[0].project_name : args.projectName || ''
        };
    }
    if (args.projectName) {
        const r = await pool.query(
            `SELECT project_id, project_name FROM project WHERE project_name = $1 LIMIT 1`,
            [args.projectName]
        );
        if (!r.rows.length) throw new Error(`未找到项目：${args.projectName}`);
        return {
            cloud_project_id: Number(r.rows[0].project_id),
            project_name: r.rows[0].project_name
        };
    }
    throw new Error('请指定 --cloud-project-id 或 --project-name');
}

function runNodeScript(relPath, scriptArgs) {
    const script = path.join(__dirname, relPath);
    logger.info(`执行：node ${relPath} ${scriptArgs.join(' ')}`);
    const r = spawnSync(process.execPath, [script, ...scriptArgs], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: process.env
    });
    if (r.status !== 0) throw new Error(`${relPath} 退出码 ${r.status}`);
}

async function upsertSalesOrder(pool, row, syncNote) {
    await pool.query(
        `
            INSERT INTO sales_order (
                order_id, project_id, project_name, order_name, order_code,
                order_status, order_status_name, artifacts_count, cloud_project_id,
                start_time, end_time, create_time, update_time, synced_at, sync_note
            )
            VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13)
            ON CONFLICT (order_id) DO UPDATE
              SET project_name = EXCLUDED.project_name,
                  order_name = EXCLUDED.order_name,
                  order_code = EXCLUDED.order_code,
                  order_status = EXCLUDED.order_status,
                  order_status_name = EXCLUDED.order_status_name,
                  artifacts_count = EXCLUDED.artifacts_count,
                  cloud_project_id = EXCLUDED.cloud_project_id,
                  synced_at = now(),
                  sync_note = EXCLUDED.sync_note
        `,
        [
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
        ]
    );
}

async function upsertOrderComponent(pool, payload) {
    const matchMethod = payload.scheduling_id != null ? 'project_scheduling_guid' : 'project_guid';
    await pool.query(
        `
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
        `,
        [
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
        ]
    );
}

async function syncProjectOrders(page, pool, project, matchIndexes, sleepMs) {
    const orders = await fetchProjectOrders(page, capturedToken, project.cloud_project_id);
    if (!orders.ok) throw new Error(`getAllOrder 失败：${orders.msg}`);

    const summary = { orders: orders.list.length, synced: 0, partial: 0, failed: 0, written: 0, skipped: 0 };

    for (const raw of orders.list) {
        const mapped = mapOrderRow(raw);
        if (!mapped.order_id) continue;
        mapped.project_name = project.project_name || mapped.project_name;

        try {
            await upsertSalesOrder(pool, mapped, null);
            const part = await fetchProjectArtifacts(page, capturedToken, {
                cloudProjectId: project.cloud_project_id,
                orderId: mapped.order_id,
                timeoutMs: 180000,
                maxAttempts: 3,
                retryDelayMs: 3000
            });
            if (!part.ok) {
                summary.failed += 1;
                await upsertSalesOrder(pool, mapped, `artifacts_api_failed:${part.msg}`);
                continue;
            }

            const artifacts = part.list || [];
            let written = 0;
            for (const artifact of artifacts) {
                const dwyunId = Number(artifact.id);
                if (!Number.isFinite(dwyunId)) {
                    summary.skipped += 1;
                    continue;
                }
                const match = resolveComponentMatch(matchIndexes, mapped.project_name, artifact);
                if (!match.ok) {
                    summary.skipped += 1;
                    continue;
                }
                await upsertOrderComponent(pool, {
                    order_id: mapped.order_id,
                    dwyun_artifact_id: dwyunId,
                    component_guid: match.guid,
                    component_no: pickComponentNo(artifact) || null,
                    spec: pickSpec(artifact) || null,
                    location: pickLocation(artifact) || null,
                    component_id: match.matches[0].component_id,
                    project_name: mapped.project_name,
                    scheduling_id: pickSchedulingId(artifact),
                    plan_id: match.matches[0].plan_id || null
                });
                written += 1;
                summary.written += 1;
            }

            const note =
                written === artifacts.length && artifacts.length > 0
                    ? 'artifacts_synced'
                    : `artifacts_partial:${written}/${artifacts.length}`;
            await upsertSalesOrder(pool, mapped, note);
            if (written === artifacts.length && artifacts.length > 0) summary.synced += 1;
            else summary.partial += 1;
            logger.info(`order_id=${mapped.order_id} ${note}`);
        } catch (err) {
            summary.failed += 1;
            logger.warn(`order_id=${mapped.order_id} 失败：${err.message}`);
        }
        if (sleepMs > 0) await page.waitForTimeout(sleepMs);
    }
    return summary;
}

async function main() {
    const args = parseArgs(process.argv);
    const pool = new Pool({ ...config.db, max: 5, application_name: 'sync-cloud-project' });

    try {
        await ensureSchema(pool);
        await ensureCloudProjectDeletedSchema(pool);
        const excluded = await loadExcludedCloudProjectIds(pool);
        const project = await resolveProject(pool, args);

        if (isExcludedCloudProject(project.cloud_project_id, excluded)) {
            throw new Error(`云项目 ${project.cloud_project_id} 在 cloud_project_deleted 中，已跳过`);
        }

        logger.info(`单项目同步：${project.project_name}（cloud_project_id=${project.cloud_project_id}）`);

        if (!args.skipPlans) {
            runNodeScript('extract-production-plan.js', [
                '--api',
                '--by-project',
                '--project-name',
                project.project_name,
                '--include-closed',
                '--components'
            ]);
        }

        const browserAutomation = new BrowserAutomation({
            ...config,
            browser: { ...(config.browser || {}), headless: true }
        });
        if (!(await browserAutomation.launchBrowser())) throw new Error('浏览器启动失败');
        if (!(await browserAutomation.login())) throw new Error('登录失败');
        const page = browserAutomation.page;
        page.on('request', req => {
            try {
                if (String(req.url() || '').includes('/v1.')) {
                    const h = req.headers();
                    const t = h && (h.token || h.Token || h.TOKEN);
                    if (t) capturedToken = String(t).trim();
                }
            } catch {}
        });
        await page.goto(`${WEBSITE_ORIGIN}/project/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);

        const planToScheduling = await loadPlanToSchedulingFromDb(pool);
        const matchIndexes = await loadComponentMatchIndex(pool, planToScheduling);

        let orderSummary = null;
        if (!args.skipOrders) {
            orderSummary = await syncProjectOrders(page, pool, project, matchIndexes, args.sleepMs);
            logger.info(`订单同步：${JSON.stringify(orderSummary)}`);
        }

        await browserAutomation.closeBrowser();

        if (!args.skipBridge) {
            runNodeScript('extract-project-order-bridge.js', [
                '--cloud-project-id',
                String(project.cloud_project_id)
            ]);
        }

        const result = { project_name: project.project_name, cloud_project_id: project.cloud_project_id };
        if (!args.skipOrders) result.orderSummary = orderSummary;
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await pool.end().catch(() => {});
    }
}

main().catch(err => {
    logger.error(err.message || err);
    process.exitCode = 1;
});
