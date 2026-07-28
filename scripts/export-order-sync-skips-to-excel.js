/**
 * 将订单同步跳过记录导出为 Excel。
 *
 * 用法：
 *   node scripts/export-order-sync-skips-to-excel.js
 *   node scripts/export-order-sync-skips-to-excel.js logs/order_sync_skipped_20260520081836.jsonl
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const config = require('../config/default.json');

const REASON_LABELS = {
    db_missing: '生产库无匹配构件',
    db_ambiguous: '同项目同GUID对应多条生产构件',
    field_mismatch_component_no: '构件编号与生产库不一致',
    field_mismatch_spec: '规格与生产库不一致',
    missing_guid: '缺少构件GUID',
    missing_dwyun_artifact_id: '缺少云上构件ID',
    order_sync_exception: '订单API拉取失败',
    artifact_count_mismatch: '订单构件数量与API不一致',
    artifacts_api_failed: '订单构件API失败'
};

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

async function readSkippedRows(filePath) {
    const rows = [];
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, 'utf8'),
        crlfDelay: true
    });
    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const row = JSON.parse(line);
            if (row.scope === 'artifact' || row.scope === 'order') {
                rows.push(row);
            }
        } catch {}
    }
    return rows;
}

async function loadPlanNameIndex(pool) {
    const res = await pool.query(
        `
            SELECT
                c.component_guid::text AS component_guid,
                p.project_name,
                pp.plan_name
            FROM component c
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE coalesce(trim(c.component_guid::text), '') <> ''
        `
    );
    const index = new Map();
    for (const row of res.rows || []) {
        const key = makeMatchKey(row.project_name, row.component_guid);
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(String(row.plan_name || '').trim());
    }
    return index;
}

async function loadOrderNames(pool) {
    const res = await pool.query(
        `SELECT order_id, project_name, order_name FROM sales_order`
    );
    const map = new Map();
    for (const row of res.rows || []) {
        map.set(String(row.order_id), {
            project_name: row.project_name || '',
            order_name: row.order_name || ''
        });
    }
    return map;
}

function resolvePlanNames(planIndex, projectName, guid, reason) {
    if (!guid) return '';
    const names = planIndex.get(makeMatchKey(projectName, guid));
    if (!names || names.size === 0) {
        return reason === 'db_ambiguous' ? '（生产库存在跨项目重复GUID，需人工核对）' : '';
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(' | ');
}

function reasonLabel(reason) {
    return REASON_LABELS[reason] || reason || '未知原因';
}

async function main() {
    const inputPath = process.argv[2]
        ? path.resolve(process.argv[2])
        : path.join(__dirname, '../logs/order_sync_skipped_20260520081836.jsonl');

    if (!fs.existsSync(inputPath)) {
        throw new Error(`跳过日志不存在：${inputPath}`);
    }

    console.log(`读取跳过日志：${inputPath}`);
    const skippedRows = await readSkippedRows(inputPath);
    const artifactRows = skippedRows.filter(r => r.scope === 'artifact');
    const orderRows = skippedRows.filter(r => r.scope === 'order');

    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 5,
        application_name: 'export-order-sync-skips'
    });

    try {
        console.log('加载订单名称与生产计划索引...');
        const [orderMap, planIndex] = await Promise.all([
            loadOrderNames(pool),
            loadPlanNameIndex(pool)
        ]);

        const outDir = path.join(__dirname, '../downloads');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const outPath = path.join(outDir, `订单同步问题明细_${stamp}.xlsx`);

        const wb = new ExcelJS.Workbook();
        wb.creator = 'autoribao';
        const ws = wb.addWorksheet('构件跳过明细');
        ws.columns = [
            { header: '项目名称', key: 'project_name', width: 36 },
            { header: '订单名称', key: 'order_name', width: 42 },
            { header: '计划名称', key: 'plan_name', width: 42 },
            { header: '失败原因', key: 'reason_label', width: 28 },
            { header: '订单ID', key: 'order_id', width: 10 },
            { header: '构件GUID', key: 'guid', width: 28 },
            { header: '构件编号', key: 'component_no', width: 16 },
            { header: '规格', key: 'spec', width: 18 },
            { header: '云上构件ID', key: 'dwyun_artifact_id', width: 14 }
        ];
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];

        for (const row of artifactRows) {
            const orderMeta = orderMap.get(String(row.order_id)) || {};
            const projectName = row.project_name || orderMeta.project_name || '';
            const orderName = orderMeta.order_name || '';
            const guid = row.guid || '';
            ws.addRow({
                project_name: projectName,
                order_name: orderName,
                plan_name: resolvePlanNames(planIndex, projectName, guid, row.reason),
                reason_label: reasonLabel(row.reason),
                order_id: row.order_id,
                guid,
                component_no: row.component_no || '',
                spec: row.spec || '',
                dwyun_artifact_id: row.dwyun_artifact_id || ''
            });
        }

        if (orderRows.length > 0) {
            const wsOrder = wb.addWorksheet('订单级问题');
            wsOrder.columns = [
                { header: '项目名称', key: 'project_name', width: 36 },
                { header: '订单名称', key: 'order_name', width: 42 },
                { header: '计划名称', key: 'plan_name', width: 20 },
                { header: '失败原因', key: 'reason_label', width: 32 },
                { header: '订单ID', key: 'order_id', width: 10 },
                { header: '备注', key: 'note', width: 40 }
            ];
            wsOrder.getRow(1).font = { bold: true };
            for (const row of orderRows) {
                const orderMeta = orderMap.get(String(row.order_id)) || {};
                wsOrder.addRow({
                    project_name: row.project_name || orderMeta.project_name || '',
                    order_name: orderMeta.order_name || '',
                    plan_name: '',
                    reason_label: reasonLabel(row.reason),
                    order_id: row.order_id,
                    note: row.error || row.msg || ''
                });
            }
        }

        const summary = wb.addWorksheet('汇总');
        const reasonCount = {};
        for (const row of artifactRows) {
            const key = row.reason || 'unknown';
            reasonCount[key] = (reasonCount[key] || 0) + 1;
        }
        summary.addRow(['类型', '数量', '说明']);
        summary.getRow(1).font = { bold: true };
        for (const [reason, count] of Object.entries(reasonCount).sort((a, b) => b[1] - a[1])) {
            summary.addRow(['构件跳过', count, reasonLabel(reason)]);
        }
        summary.addRow(['订单级跳过', orderRows.length, '整单未完整写入构件']);

        await wb.xlsx.writeFile(outPath);
        console.log(JSON.stringify({
            inputPath,
            outputPath: outPath,
            artifactRows: artifactRows.length,
            orderRows: orderRows.length,
            reasonCount
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
