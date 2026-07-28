/**
 * 导出「订单构件未完整进入 order_component」的订单清单（含完整订单名称）。
 *
 * 用法：
 *   node scripts/export-orders-missing-order-component.js
 *   node scripts/export-orders-missing-order-component.js --partial-only
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const config = require('../config/default.json');

const partialOnly = process.argv.includes('--partial-only');

const REASON_LABELS = {
    db_missing: '生产库无匹配构件',
    db_ambiguous: '同项目同GUID多条生产构件',
    field_mismatch_component_no: '构件编号不一致',
    field_mismatch_spec: '规格不一致',
    missing_guid: '缺少GUID',
    artifact_count_mismatch: 'API构件数与订单头不一致',
    artifacts_api_failed: '订单构件API失败',
    order_sync_exception: '订单同步异常'
};

(async () => {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database
    });

    const res = await pool.query(
        `
            SELECT
                so.order_id,
                so.cloud_project_id,
                so.project_name,
                so.order_name,
                so.order_code,
                so.artifacts_count,
                so.sync_note,
                count(oc.order_component_id)::int AS order_component_count
            FROM sales_order so
            LEFT JOIN order_component oc ON oc.order_id = so.order_id
            WHERE so.cloud_project_id NOT IN (1, 16, 18)
            GROUP BY so.order_id, so.cloud_project_id, so.project_name,
                     so.order_name, so.order_code, so.artifacts_count, so.sync_note
            HAVING so.artifacts_count > count(oc.order_component_id)
               ${partialOnly ? 'AND count(oc.order_component_id) > 0' : ''}
            ORDER BY (so.artifacts_count - count(oc.order_component_id)) DESC,
                     so.project_name, so.order_name
        `
    );

    const rows = res.rows.map(r => {
        const api = Number(r.artifacts_count) || 0;
        const db = Number(r.order_component_count) || 0;
        const gap = api - db;
        let mainReason = '';
        if (r.sync_note && String(r.sync_note).includes('partial')) {
            if (db === 0) mainReason = '整单未写入(order_component=0)';
            else mainReason = '部分未写入';
        } else if (r.sync_note) {
            mainReason = r.sync_note;
        }
        return {
            order_id: Number(r.order_id),
            cloud_project_id: r.cloud_project_id != null ? Number(r.cloud_project_id) : null,
            project_name: r.project_name || '',
            order_name: r.order_name || '',
            order_code: r.order_code || '',
            api_artifacts_count: api,
            order_component_count: db,
            missing_count: gap,
            order_sync_note: r.sync_note || '',
            summary: mainReason
        };
    });

    const outDir = path.join(__dirname, '../downloads');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const namePrefix = partialOnly ? '部分未写入订单清单' : '订单构件未完整入库清单';
    const xlsxPath = path.join(outDir, `${namePrefix}_${stamp}.xlsx`);
    const txtPath = path.join(
        outDir,
        partialOnly ? `部分未写入订单名称_${stamp}.txt` : `订单构件未完整入库_订单名称_${stamp}.txt`
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('订单清单');
    ws.columns = [
        { header: '订单ID', key: 'order_id', width: 10 },
        { header: '订单名称', key: 'order_name', width: 48 },
        { header: '项目名称', key: 'project_name', width: 32 },
        { header: '订单编号', key: 'order_code', width: 14 },
        { header: '云项目ID', key: 'cloud_project_id', width: 10 },
        { header: 'API构件数', key: 'api_artifacts_count', width: 10 },
        { header: '已入库构件数', key: 'order_component_count', width: 12 },
        { header: '缺口数量', key: 'missing_count', width: 10 },
        { header: '订单同步备注', key: 'order_sync_note', width: 28 },
        { header: '概况', key: 'summary', width: 22 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of rows) ws.addRow(row);

    const sum = wb.addWorksheet('汇总');
    sum.addRow(['指标', '数值']);
    sum.getRow(1).font = { bold: true };
    sum.addRow(['订单数', rows.length]);
    sum.addRow(['缺口构件合计', rows.reduce((s, r) => s + r.missing_count, 0)]);
    sum.addRow(['整单未写入订单数', rows.filter(r => r.order_component_count === 0).length]);
    sum.addRow(['部分未写入订单数', rows.filter(r => r.order_component_count > 0).length]);
    sum.addRow(['说明', partialOnly ? '仅含部分未写入（已有 order_component 但未写满）' : '缺口指 API 订单构件数 - order_component 表实际条数']);

    await wb.xlsx.writeFile(xlsxPath);

    const lines = rows.map(r => {
        const proj = r.project_name ? `[${r.project_name}] ` : '';
        return `${r.order_id}\t${proj}${r.order_name}`;
    });
    fs.writeFileSync(txtPath, `${lines.join('\n')}\n`, 'utf8');

    console.log(JSON.stringify({
        xlsxPath,
        txtPath,
        orderCount: rows.length,
        totalMissingArtifacts: rows.reduce((s, r) => s + r.missing_count, 0)
    }, null, 2));

    await pool.end();
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
