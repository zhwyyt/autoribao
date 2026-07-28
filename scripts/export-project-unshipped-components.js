/**
 * Export all unshipped components for one exact production project.
 *
 * Usage:
 *   node scripts/export-project-unshipped-components.js "上海东站T2酒店"
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const config = require('../config/default.json');

const projectName = String(process.argv[2] || '').trim();
if (!projectName) {
    throw new Error('请提供完整项目名称，例如：node scripts/export-project-unshipped-components.js "上海东站T2酒店"');
}

function sanitizeFileName(value) {
    return String(value).replace(/[\\/:*?"<>|]/g, '_').trim();
}

function formatShanghaiTime(value) {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(value).replace(/\//g, '-');
}

function styleTableSheet(sheet, lastColumn) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 24;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: `${lastColumn}1` };
}

async function main() {
    const pool = new Pool({
        ...config.db,
        max: 3,
        application_name: 'export-project-unshipped-components'
    });

    try {
        const projectResult = await pool.query(
            `
                SELECT project_id, project_name, project_status
                FROM project
                WHERE project_name = $1
                ORDER BY project_id
            `,
            [projectName]
        );

        if (projectResult.rows.length === 0) {
            throw new Error(`未找到项目：${projectName}`);
        }
        if (projectResult.rows.length > 1) {
            throw new Error(`项目名称不唯一：${projectName}（匹配 ${projectResult.rows.length} 条）`);
        }

        const project = projectResult.rows[0];
        const detailResult = await pool.query(
            `
                WITH latest_shipping AS (
                    SELECT DISTINCT ON (e.component_id)
                        e.component_id,
                        e.event_id,
                        e.is_completed,
                        e.raw_value,
                        COALESCE(e.event_at, e.updated_at, e.created_at) AS shipping_at
                    FROM component_status_event e
                    JOIN component target_component ON target_component.component_id = e.component_id
                    JOIN production_plan target_plan ON target_plan.plan_id = target_component.plan_id
                    WHERE target_plan.project_id = $1
                      AND e.status_type = 'shipping'
                    ORDER BY e.component_id,
                        COALESCE(e.event_at, e.updated_at, e.created_at) DESC NULLS LAST,
                        e.updated_at DESC NULLS LAST,
                        e.event_id DESC
                )
                SELECT
                    pp.plan_id,
                    pp.plan_name,
                    pp.plan_status,
                    c.component_id,
                    c.component_no,
                    c.component_guid,
                    c.model_id,
                    c.spec,
                    c.component_type_code,
                    c.quantity,
                    c.weight,
                    (COALESCE(c.weight, 0) * c.quantity)::numeric(18,3) AS total_weight_kg,
                    c.length,
                    c.production_feature,
                    c.location,
                    c.axis_range,
                    CASE WHEN ls.event_id IS NULL THEN '无发货记录' ELSE '最新发货状态未完成' END AS unshipped_reason,
                    ls.raw_value AS latest_shipping_value,
                    ls.shipping_at AS latest_shipping_at
                FROM production_plan pp
                JOIN component c ON c.plan_id = pp.plan_id
                LEFT JOIN latest_shipping ls ON ls.component_id = c.component_id
                WHERE pp.project_id = $1
                  AND (pp.plan_status IS NULL OR pp.plan_status <> 'archived')
                  AND COALESCE(ls.is_completed, false) = false
                ORDER BY pp.plan_name, pp.plan_id, c.component_no NULLS LAST, c.component_id
            `,
            [project.project_id]
        );

        const rows = detailResult.rows;
        const byPlan = new Map();
        let totalQuantity = 0;
        let totalWeightKg = 0;
        let noShippingEventCount = 0;

        for (const row of rows) {
            const quantity = Number(row.quantity) || 0;
            const weightKg = Number(row.total_weight_kg) || 0;
            totalQuantity += quantity;
            totalWeightKg += weightKg;
            if (row.unshipped_reason === '无发货记录') noShippingEventCount += 1;

            const key = String(row.plan_id);
            if (!byPlan.has(key)) {
                byPlan.set(key, {
                    plan_id: Number(row.plan_id),
                    plan_name: row.plan_name || '',
                    plan_status: row.plan_status || '',
                    component_count: 0,
                    quantity: 0,
                    total_weight_kg: 0
                });
            }
            const summary = byPlan.get(key);
            summary.component_count += 1;
            summary.quantity += quantity;
            summary.total_weight_kg += weightKg;
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'autoribao';
        workbook.created = new Date();

        const summarySheet = workbook.addWorksheet('汇总');
        summarySheet.columns = [
            { header: '指标', key: 'metric', width: 30 },
            { header: '数值', key: 'value', width: 48 }
        ];
        styleTableSheet(summarySheet, 'B');
        const generatedAt = new Date();
        const metrics = [
            ['项目名称', project.project_name],
            ['生产库项目ID', Number(project.project_id)],
            ['项目状态', project.project_status],
            ['含未发货构件的计划数', byPlan.size],
            ['未发货构件记录数', rows.length],
            ['未发货件数', totalQuantity],
            ['未发货重量(kg)', Number(totalWeightKg.toFixed(3))],
            ['未发货重量(吨)', Number((totalWeightKg / 1000).toFixed(3))],
            ['无发货记录', noShippingEventCount],
            ['最新发货状态未完成', rows.length - noShippingEventCount],
            ['导出时间(北京时间)', formatShanghaiTime(generatedAt)],
            ['统计口径', '有效计划内，构件最新 shipping 事件 is_completed=false，或不存在 shipping 事件'],
            ['重量口径', '数据库 weight 按 kg；总重量=单重 x 数量，吨数按 kg/1000 换算']
        ];
        metrics.forEach(([metric, value]) => summarySheet.addRow({ metric, value }));
        summarySheet.getColumn('B').numFmt = '#,##0.000';

        const planSheet = workbook.addWorksheet('计划汇总');
        planSheet.columns = [
            { header: '计划ID', key: 'plan_id', width: 12 },
            { header: '计划名称', key: 'plan_name', width: 72 },
            { header: '计划状态', key: 'plan_status', width: 14 },
            { header: '未发货构件记录数', key: 'component_count', width: 18 },
            { header: '未发货件数', key: 'quantity', width: 14 },
            { header: '未发货重量(kg)', key: 'total_weight_kg', width: 18 },
            { header: '未发货重量(吨)', key: 'total_weight_ton', width: 18 }
        ];
        styleTableSheet(planSheet, 'G');
        for (const plan of [...byPlan.values()].sort((a, b) => a.plan_name.localeCompare(b.plan_name, 'zh-CN'))) {
            planSheet.addRow({ ...plan, total_weight_ton: plan.total_weight_kg / 1000 });
        }
        planSheet.getColumn('F').numFmt = '#,##0.000';
        planSheet.getColumn('G').numFmt = '#,##0.000';

        const detailSheet = workbook.addWorksheet('未发货构件');
        detailSheet.columns = [
            { header: '序号', key: 'seq', width: 9 },
            { header: '计划ID', key: 'plan_id', width: 12 },
            { header: '计划名称', key: 'plan_name', width: 64 },
            { header: '计划状态', key: 'plan_status', width: 14 },
            { header: '构件内部ID', key: 'component_id', width: 14 },
            { header: '构件编号', key: 'component_no', width: 20 },
            { header: '构件GUID', key: 'component_guid', width: 38 },
            { header: '模型ID', key: 'model_id', width: 20 },
            { header: '规格/型号', key: 'spec', width: 24 },
            { header: '构件类型编码', key: 'component_type_code', width: 18 },
            { header: '数量', key: 'quantity', width: 10 },
            { header: '单重(kg)', key: 'weight', width: 14 },
            { header: '总重(kg)', key: 'total_weight_kg', width: 14 },
            { header: '总重(吨)', key: 'total_weight_ton', width: 14 },
            { header: '长度', key: 'length', width: 14 },
            { header: '生产特征', key: 'production_feature', width: 24 },
            { header: '区域部位/所在楼层', key: 'location', width: 28 },
            { header: '轴线范围', key: 'axis_range', width: 24 },
            { header: '未发货判定', key: 'unshipped_reason', width: 22 },
            { header: '最新发货原值', key: 'latest_shipping_value', width: 28 },
            { header: '最新发货状态时间', key: 'latest_shipping_at', width: 22 }
        ];
        styleTableSheet(detailSheet, 'U');
        rows.forEach((row, index) => detailSheet.addRow({
            seq: index + 1,
            ...row,
            plan_id: Number(row.plan_id),
            component_id: Number(row.component_id),
            quantity: Number(row.quantity) || 0,
            weight: row.weight == null ? null : Number(row.weight),
            total_weight_kg: Number(row.total_weight_kg) || 0,
            total_weight_ton: (Number(row.total_weight_kg) || 0) / 1000
        }));
        ['L', 'M', 'N', 'O'].forEach((column) => {
            detailSheet.getColumn(column).numFmt = '#,##0.000';
        });
        detailSheet.getColumn('U').numFmt = 'yyyy-mm-dd hh:mm:ss';

        const outputDir = path.join(__dirname, '..', 'downloads');
        fs.mkdirSync(outputDir, { recursive: true });
        const dateStamp = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(generatedAt).replace(/-/g, '');
        const outputPath = path.join(outputDir, `${sanitizeFileName(project.project_name)}_未发货构件清单_${dateStamp}.xlsx`);
        await workbook.xlsx.writeFile(outputPath);

        console.log(JSON.stringify({
            ok: true,
            outputPath,
            projectId: Number(project.project_id),
            projectName: project.project_name,
            planCount: byPlan.size,
            unshippedComponents: rows.length,
            unshippedQuantity: totalQuantity,
            totalWeightKg: Number(totalWeightKg.toFixed(3)),
            totalWeightTon: Number((totalWeightKg / 1000).toFixed(3)),
            noShippingEventCount,
            latestIncompleteCount: rows.length - noShippingEventCount
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
