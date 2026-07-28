/**
 * 按 order_id 补同步订单构件（API 失败订单重试）。
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');

const API_GET_ORDER_ARTIFACTS = 'https://dwyunsc.ddwjzkj.com:10086/v1.order/getOrderArtifacts';
const WEBSITE_ORIGIN = new URL(config.website.loginUrl).origin;
const LOG_DIR = path.join(__dirname, '../logs');

let capturedToken = '';

const DEFAULT_ORDER_IDS = [6728, 5200, 4701, 2322, 2315, 1803, 1802, 1781, 1773];

function parseArgs(argv) {
    const out = { orderIds: [...DEFAULT_ORDER_IDS], sleepMs: 800, retries: 5 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--order-ids' && argv[i + 1]) {
            out.orderIds = argv[i + 1].split(',').map(s => Number(s.trim())).filter(Number.isFinite);
            i++;
        } else if (a === '--sleep-ms' && argv[i + 1]) {
            out.sleepMs = Math.max(0, Number(argv[i + 1]) || 0);
            i++;
        } else if (a === '--retries' && argv[i + 1]) {
            out.retries = Math.max(1, Number(argv[i + 1]) || 5);
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

function makeMatchKey(projectName, guid) {
    return `${normalizeText(projectName)}|${normalizeText(guid)}`;
}

function pickGuid(item) {
    return normalizeText(item.guid || item['构件GUID'] || '');
}

function pickComponentNo(item) {
    return normalizeText(item['构件编号'] || item.code || item.dode || '');
}

function pickSpec(item) {
    return normalizeText(item['规格/型号'] || item.spec || '');
}

function pickLocation(item) {
    return normalizeText(item['区域部位/所在楼层'] || item.location || '');
}

function extractArtifacts(body) {
    if (!body || body.code !== 0) {
        return { ok: false, msg: body && body.msg, artifacts: [] };
    }
    const data = body.data;
    const artifacts = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : []);
    return { ok: true, msg: body.msg, artifacts };
}

function mapOrderRowFromDb(row) {
    return {
        order_id: Number(row.order_id),
        project_name: String(row.project_name || '').trim(),
        order_name: String(row.order_name || '').trim(),
        artifacts_count: Number(row.artifacts_count) || 0
    };
}

async function loadComponentMatchIndex(pool) {
    const res = await pool.query(
        `
            SELECT c.component_id, c.component_guid::text AS component_guid,
                   c.component_no, c.spec, p.project_name
            FROM component c
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE coalesce(trim(c.component_guid::text), '') <> ''
        `
    );
    const index = new Map();
    for (const row of res.rows || []) {
        const key = makeMatchKey(row.project_name, row.component_guid);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({
            component_id: Number(row.component_id),
            component_no: normalizeText(row.component_no),
            spec: normalizeText(row.spec)
        });
    }
    return index;
}

function resolveComponentMatch(index, orderProjectName, artifact) {
    const guid = pickGuid(artifact);
    if (!guid) return { ok: false, reason: 'missing_guid', guid: '', matches: [] };
    const matches = index.get(makeMatchKey(orderProjectName, guid)) || [];
    if (matches.length === 0) return { ok: false, reason: 'db_missing', guid, matches: [] };
    if (matches.length > 1) return { ok: false, reason: 'db_ambiguous', guid, matches };
    const match = matches[0];
    if (pickComponentNo(artifact) && match.component_no && pickComponentNo(artifact) !== match.component_no) {
        return { ok: false, reason: 'field_mismatch_component_no', guid, matches: [match] };
    }
    if (pickSpec(artifact) && match.spec && pickSpec(artifact) !== match.spec) {
        return { ok: false, reason: 'field_mismatch_spec', guid, matches: [match] };
    }
    return { ok: true, guid, matches: [match] };
}

function rememberToken(headers) {
    const token = headers && (headers.token || headers.Token || headers.TOKEN);
    if (token && String(token).trim()) capturedToken = String(token).trim();
}

async function bootstrapToken(page) {
    page.on('request', req => {
        try {
            if (String(req.url() || '').includes('/v1.')) rememberToken(req.headers());
        } catch {}
    });
    await page.goto(`${WEBSITE_ORIGIN}/order/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (!capturedToken) {
        await page.goto(`${WEBSITE_ORIGIN}/production/plan`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);
    }
    if (!capturedToken) throw new Error('无法获取 Token');
}

async function postApiWithRetry(page, orderId, retries) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await page.request.post(API_GET_ORDER_ARTIFACTS, {
                data: { id: orderId },
                headers: { Token: capturedToken, 'Content-Type': 'application/json;charset=utf-8' },
                timeout: 120000
            });
            const text = await res.text();
            if (String(text).trim().startsWith('<')) {
                throw new Error(`响应为 HTML（status=${res.status()}）`);
            }
            const body = JSON.parse(text);
            if (body && body.code !== 0) throw new Error(body.msg || `API code=${body.code}`);
            return body;
        } catch (err) {
            lastError = err;
            logger.warn(`getOrderArtifacts 第 ${attempt}/${retries} 次失败 order_id=${orderId}：${err.message}`);
            if (attempt < retries) await page.waitForTimeout(2000 * attempt);
        }
    }
    throw lastError;
}

async function upsertSalesOrderNote(pool, orderId, syncNote) {
    await pool.query(
        `UPDATE sales_order SET sync_note = $2, synced_at = now() WHERE order_id = $1`,
        [orderId, syncNote]
    );
}

async function upsertOrderComponent(pool, payload) {
    await pool.query(
        `
            INSERT INTO order_component (
                order_id, dwyun_artifact_id, component_guid, component_no, spec, location,
                component_id, project_name, match_method, synced_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'project_guid', now())
            ON CONFLICT (order_id, dwyun_artifact_id) DO UPDATE
              SET component_guid = EXCLUDED.component_guid,
                  component_no = EXCLUDED.component_no,
                  spec = EXCLUDED.spec,
                  location = EXCLUDED.location,
                  component_id = EXCLUDED.component_id,
                  project_name = EXCLUDED.project_name,
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
            payload.project_name
        ]
    );
}

async function main() {
    const args = parseArgs(process.argv);
    capturedToken = '';
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const skippedPath = path.join(LOG_DIR, `order_sync_retry_skipped_${stamp}.jsonl`);
    const reportPath = path.join(LOG_DIR, `order_sync_retry_report_${stamp}.json`);

    const pool = new Pool({
        ...config.db,
        max: 3,
        application_name: 'retry-order-sync-by-ids'
    });

    const report = { orderIds: args.orderIds, results: [], summary: { written: 0, skipped: 0, failedOrders: 0 } };
    const browserAutomation = new BrowserAutomation({
        ...config,
        browser: { ...(config.browser || {}), headless: true }
    });

    try {
        const rows = await pool.query(
            `SELECT order_id, project_name, order_name, artifacts_count
             FROM sales_order WHERE order_id = ANY($1::bigint[]) ORDER BY order_id DESC`,
            [args.orderIds]
        );
        const found = new Set(rows.rows.map(r => String(r.order_id)));
        for (const id of args.orderIds) {
            if (!found.has(String(id))) {
                report.results.push({ order_id: id, ok: false, error: 'sales_order 中无此订单' });
                report.summary.failedOrders += 1;
            }
        }

        const matchIndex = await loadComponentMatchIndex(pool);
        await browserAutomation.launchBrowser();
        if (!(await browserAutomation.login())) throw new Error('登录失败');
        const page = browserAutomation.page;
        await bootstrapToken(page);

        for (const row of rows.rows) {
            const mapped = mapOrderRowFromDb(row);
            const item = {
                order_id: mapped.order_id,
                project_name: mapped.project_name,
                order_name: mapped.order_name,
                written: 0,
                skipped: 0,
                expected: mapped.artifacts_count,
                actual: 0,
                skipReasons: {}
            };

            try {
                const body = await postApiWithRetry(page, mapped.order_id, args.retries);
                const artifacts = extractArtifacts(body).artifacts || [];
                item.actual = artifacts.length;

                if (mapped.artifacts_count !== artifacts.length) {
                    item.ok = false;
                    item.error = `count_mismatch expected=${mapped.artifacts_count} actual=${artifacts.length}`;
                    await upsertSalesOrderNote(pool, mapped.order_id, item.error);
                    report.summary.failedOrders += 1;
                    report.results.push(item);
                    continue;
                }

                for (const artifact of artifacts) {
                    const dwyunId = Number(artifact.id);
                    if (!Number.isFinite(dwyunId)) {
                        item.skipped += 1;
                        item.skipReasons.missing_dwyun_artifact_id = (item.skipReasons.missing_dwyun_artifact_id || 0) + 1;
                        continue;
                    }
                    const match = resolveComponentMatch(matchIndex, mapped.project_name, artifact);
                    if (!match.ok) {
                        item.skipped += 1;
                        item.skipReasons[match.reason] = (item.skipReasons[match.reason] || 0) + 1;
                        fs.appendFileSync(skippedPath, `${JSON.stringify({
                            order_id: mapped.order_id,
                            reason: match.reason,
                            dwyun_artifact_id: dwyunId,
                            guid: match.guid
                        })}\n`);
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
                        project_name: mapped.project_name
                    });
                    item.written += 1;
                }

                item.ok = item.written === artifacts.length && item.written > 0;
                await upsertSalesOrderNote(
                    pool,
                    mapped.order_id,
                    item.written === artifacts.length ? 'artifacts_synced' : `artifacts_partial:${item.written}/${artifacts.length}`
                );
                report.summary.written += item.written;
                report.summary.skipped += item.skipped;
                if (!item.ok) report.summary.failedOrders += 1;
            } catch (err) {
                item.ok = false;
                item.error = err.message || String(err);
                await upsertSalesOrderNote(pool, mapped.order_id, `retry_failed:${item.error.slice(0, 200)}`);
                report.summary.failedOrders += 1;
            }

            report.results.push(item);
            logger.info(`order_id=${mapped.order_id} written=${item.written} skipped=${item.skipped}`);
            if (args.sleepMs > 0) await page.waitForTimeout(args.sleepMs);
        }

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(JSON.stringify({ reportPath, skippedPath, summary: report.summary, results: report.results }, null, 2));
    } finally {
        await pool.end().catch(() => {});
        await browserAutomation.closeBrowser().catch(() => {});
    }
}

main().catch(err => {
    logger.error(err.message || err);
    process.exitCode = 1;
});
