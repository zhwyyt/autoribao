/**
 * 导出桥接同步跳过记录：missing_order_row / missing_plan_mapping
 *
 * 用法：
 *   node scripts/export-bridge-skips-to-excel.js
 *   node scripts/export-bridge-skips-to-excel.js --no-rescan-order-row
 *   node scripts/export-bridge-skips-to-excel.js logs/project_bridge_skipped_20260521030600.jsonl
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const config = require('../config/default.json');
const BrowserAutomation = require('../src/browser-automation');
const {
    fetchProjectBridgeBundle,
    mapArtifactRow
} = require('../src/project-list-component-api');

const IGNORE_CLOUD_PROJECT_IDS = new Set([1, 16, 18]);
const REASON_LABELS = {
    missing_order_row: '订单库无对应构件行(order_component)',
    missing_plan_mapping: 'scheduling_id 无法映射到生产计划 plan_id'
};

function parseArgs(argv) {
    const out = { rescanOrderRow: true, onlyOrderRow: false, jsonlPaths: [] };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--no-rescan-order-row') out.rescanOrderRow = false;
        else if (a === '--only-order-row') {
            out.onlyOrderRow = true;
            out.rescanOrderRow = true;
        } else if (!a.startsWith('--')) out.jsonlPaths.push(path.resolve(a));
    }
    return out;
}

function dedupeKey(row) {
    return [
        row.reason,
        row.order_id,
        row.dwyun_artifact_id,
        row.scheduling_id
    ].join('|');
}

async function readJsonlRows(paths) {
    const map = new Map();
    for (const filePath of paths) {
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath, 'utf8'),
            crlfDelay: true
        });
        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const row = JSON.parse(line);
                if (row.scope !== 'artifact') continue;
                if (row.reason !== 'missing_plan_mapping' && row.reason !== 'missing_order_row') continue;
                const key = dedupeKey(row);
                if (!map.has(key)) map.set(key, row);
            } catch {}
        }
    }
    return map;
}

function listJsonlFiles(explicitPaths) {
    if (explicitPaths.length) return explicitPaths;
    const logDir = path.join(__dirname, '../logs');
    return fs.readdirSync(logDir)
        .filter(name => name.startsWith('project_bridge_skipped_') && name.endsWith('.jsonl'))
        .map(name => path.join(logDir, name))
        .sort();
}

async function loadOrderMeta(pool) {
    const res = await pool.query(
        `SELECT order_id, project_name, order_name, cloud_project_id FROM sales_order`
    );
    const map = new Map();
    for (const row of res.rows) {
        map.set(String(row.order_id), row);
    }
    return map;
}

async function orderRowExists(pool, mapped) {
    const byArtifact = await pool.query(
        `SELECT 1 FROM order_component WHERE order_id = $1 AND dwyun_artifact_id = $2 LIMIT 1`,
        [mapped.order_id, mapped.dwyun_artifact_id]
    );
    if (byArtifact.rows.length) return true;
    if (!mapped.component_guid) return false;
    const byGuid = await pool.query(
        `SELECT 1 FROM order_component WHERE order_id = $1 AND component_guid = $2 LIMIT 1`,
        [mapped.order_id, mapped.component_guid]
    );
    return byGuid.rows.length > 0;
}

async function rescanMissingOrderRows(pool, page, token, cloudProjectIds) {
    const rows = [];
    for (const cloudProjectId of cloudProjectIds) {
        if (IGNORE_CLOUD_PROJECT_IDS.has(cloudProjectId)) continue;
        console.log(`核对 missing_order_row：云项目 ${cloudProjectId}`);
        let bundle;
        try {
            bundle = await fetchProjectBridgeBundle(page, token, cloudProjectId, {
                perOrderSleepMs: 200
            });
        } catch (err) {
            console.warn(`  跳过 ${cloudProjectId}：${err.message}`);
            continue;
        }
        if (!bundle.orders.ok || !bundle.artifacts.ok) continue;
        for (const raw of bundle.artifacts.list) {
            const mapped = mapArtifactRow(raw);
            if (!mapped) continue;
            const exists = await orderRowExists(pool, mapped);
            if (!exists) {
                rows.push({
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
    }
    const map = new Map();
    for (const row of rows) {
        map.set(dedupeKey(row), row);
    }
    return [...map.values()];
}

function enrichRow(row, orderMeta) {
    const meta = orderMeta.get(String(row.order_id)) || {};
    return {
        cloud_project_id: row.cloud_project_id,
        project_name: meta.project_name || '',
        order_id: row.order_id,
        order_name: row.order_name || meta.order_name || '',
        dwyun_artifact_id: row.dwyun_artifact_id,
        component_guid: row.component_guid || '',
        component_no: row.component_no || '',
        component_name: row.component_name || '',
        scheduling_id: row.scheduling_id,
        scheduling_name: row.scheduling_name || '',
        reason: row.reason,
        reason_label: REASON_LABELS[row.reason] || row.reason
    };
}

async function writeSheet(ws, rows) {
    ws.columns = [
        { header: '云项目ID', key: 'cloud_project_id', width: 10 },
        { header: '项目名称', key: 'project_name', width: 32 },
        { header: '订单ID', key: 'order_id', width: 10 },
        { header: '订单名称', key: 'order_name', width: 40 },
        { header: '云上构件ID', key: 'dwyun_artifact_id', width: 14 },
        { header: '构件GUID', key: 'component_guid', width: 30 },
        { header: '构件编号', key: 'component_no', width: 16 },
        { header: '构件名称', key: 'component_name', width: 24 },
        { header: '排产ID(scheduling_id)', key: 'scheduling_id', width: 14 },
        { header: '排产名称', key: 'scheduling_name', width: 40 },
        { header: '失败原因', key: 'reason_label', width: 36 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of rows) {
        ws.addRow(row);
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const jsonlPaths = listJsonlFiles(args.jsonlPaths);
    if (!jsonlPaths.length) {
        throw new Error('未找到 project_bridge_skipped_*.jsonl 日志');
    }

    console.log(`读取 ${jsonlPaths.length} 个跳过日志...`);
    const allRows = await readJsonlRows(jsonlPaths);
    let planRows = args.onlyOrderRow
        ? []
        : [...allRows.values()].filter(r => r.reason === 'missing_plan_mapping');
    let orderRows = [...allRows.values()].filter(r => r.reason === 'missing_order_row');

    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 5
    });

    try {
        const orderMeta = await loadOrderMeta(pool);

        if (args.rescanOrderRow) {
            console.log('日志中 missing_order_row 较少，正在按 API 重新核对未入库构件...');
            const res = await pool.query(
                `
                    SELECT DISTINCT cloud_project_id
                    FROM sales_order
                    WHERE cloud_project_id IS NOT NULL
                    ORDER BY cloud_project_id
                `
            );
            const cloudIds = res.rows.map(r => Number(r.cloud_project_id)).filter(n => Number.isFinite(n));

            const browser = new BrowserAutomation({
                ...config,
                browser: { ...(config.browser || {}), headless: true }
            });
            await browser.launchBrowser();
            await browser.login();
            let token = '';
            browser.page.on('request', req => {
                const t = req.headers().token || req.headers().Token;
                if (t) token = t;
            });
            await browser.page.goto('https://dwyunsc.ddwjzkj.com:22222/project/index');
            await browser.page.waitForTimeout(2000);
            if (!token) {
                token = await browser.page.evaluate(() =>
                    localStorage.getItem('Token') || localStorage.getItem('token') || ''
                );
            }

            orderRows = await rescanMissingOrderRows(pool, browser.page, token, cloudIds);
            await browser.closeBrowser();
        }

        const enrichedPlan = planRows.map(r => enrichRow(r, orderMeta));
        const enrichedOrder = orderRows.map(r => enrichRow(r, orderMeta));

        const outDir = path.join(__dirname, '../downloads');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const planPath = path.join(outDir, `桥接同步_missing_plan_mapping_${stamp}.xlsx`);
        const orderPath = path.join(outDir, `桥接同步_missing_order_row_${stamp}.xlsx`);

        if (!args.onlyOrderRow) {
            const wbPlan = new ExcelJS.Workbook();
            await writeSheet(wbPlan.addWorksheet('明细'), enrichedPlan);
            const sumPlan = wbPlan.addWorksheet('汇总');
            sumPlan.addRow(['数量', enrichedPlan.length]);
            sumPlan.addRow(['说明', REASON_LABELS.missing_plan_mapping]);
            await wbPlan.xlsx.writeFile(planPath);
        }

        const wbOrder = new ExcelJS.Workbook();
        await writeSheet(wbOrder.addWorksheet('明细'), enrichedOrder);
        const sumOrder = wbOrder.addWorksheet('汇总');
        sumOrder.addRow(['数量', enrichedOrder.length]);
        sumOrder.addRow(['说明', REASON_LABELS.missing_order_row]);
        sumOrder.addRow(['忽略云项目', '1,16,18（已删除项目）']);
        await wbOrder.xlsx.writeFile(orderPath);

        console.log(JSON.stringify({
            planMappingPath: args.onlyOrderRow ? null : planPath,
            missingOrderRowPath: orderPath,
            jsonlFiles: jsonlPaths.length,
            missing_plan_mapping: enrichedPlan.length,
            missing_order_row: enrichedOrder.length,
            rescanOrderRow: args.rescanOrderRow
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
