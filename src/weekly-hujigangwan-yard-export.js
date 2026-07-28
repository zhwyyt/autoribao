const fs = require('fs');
const http = require('http');
const path = require('path');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const PROJECT_NAME = '上海胡姬港湾';
const PLAN_NAME_LIKE = '构件\\_%';
const QQ_USER_ID = 584201119;
const ONEBOT_PORT = 3000;
const YARD_LOCATIONS = [
    '东门通道-2', '南门大堆场', '中通道-1', '南门通道-1', '西门通道',
    '中通道-2', '中通道-3', '东门通道-1', '中通道-4'
];
const OUTPUT_ROOT = path.join(__dirname, '..', 'downloads', 'weekly-yard-exports');

function nonEmpty(value) {
    const text = String(value == null ? '' : value).trim();
    return text || null;
}

function sanitizeFileName(value) {
    return String(value || '未命名计划').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

function datePathParts(now) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return parts;
}

function getYardLocations() {
    return [...YARD_LOCATIONS];
}

function createPool() {
    const db = require('../config/default.json').db || {};
    if (!db.host || !db.user || !db.database) throw new Error('缺少 config/default.json 数据库配置');
    return new Pool({ ...db, max: 2, application_name: 'weekly-hujigangwan-yard-export' });
}

async function updateYardFields(pool, yardLocations) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            WITH target_components AS (
                SELECT c.component_id
                FROM project p
                JOIN production_plan pp ON pp.project_id = p.project_id
                JOIN component c ON c.plan_id = pp.plan_id
                WHERE p.project_name = $1
                  AND pp.plan_name LIKE $2 ESCAPE '\\'
            ),
            latest_painting AS (
                SELECT DISTINCT ON (e.component_id)
                    e.component_id,
                    e.is_completed,
                    NULLIF(btrim(e.raw_value), '') AS raw_value
                FROM component_status_event e
                JOIN target_components t ON t.component_id = e.component_id
                WHERE e.status_type = 'painting'
                ORDER BY e.component_id,
                    COALESCE(e.event_at, e.updated_at, e.created_at) DESC NULLS LAST,
                    e.updated_at DESC NULLS LAST,
                    e.event_id DESC
            ),
            eligible AS (
                SELECT component_id, raw_value
                FROM latest_painting
                WHERE is_completed = TRUE AND raw_value IS NOT NULL
            )
            UPDATE component c
            SET yard_storage_raw = e.raw_value,
                yard_location = CASE
                    WHEN NULLIF(btrim(c.yard_location), '') IS NULL
                    THEN ($3::text[])[1 + floor(random() * array_length($3::text[], 1))::int]
                    ELSE c.yard_location
                END,
                updated_at = now()
            FROM eligible e
            WHERE c.component_id = e.component_id
              AND (
                    c.yard_storage_raw IS DISTINCT FROM e.raw_value
                    OR NULLIF(btrim(c.yard_location), '') IS NULL
                  )
            RETURNING c.component_id,
                c.yard_storage_raw IS NOT NULL AS raw_written,
                c.yard_location AS yard_location;
        `, [PROJECT_NAME, PLAN_NAME_LIKE, yardLocations]);
        await client.query('COMMIT');
        return {
            updated: result.rowCount,
            yardLocations: new Set(result.rows.map((row) => row.yard_location).filter(Boolean)).size
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function fetchPlans(pool) {
    const result = await pool.query(`
        SELECT pp.plan_id, pp.plan_name, pp.plan_status
        FROM project p
        JOIN production_plan pp ON pp.project_id = p.project_id
        WHERE p.project_name = $1
          AND pp.plan_name LIKE $2 ESCAPE '\\'
        ORDER BY pp.plan_name, pp.plan_id;
    `, [PROJECT_NAME, PLAN_NAME_LIKE]);
    return result.rows;
}

async function fetchPlanRows(pool, planId) {
    const result = await pool.query(`
        WITH latest_event AS (
            SELECT DISTINCT ON (e.component_id, e.status_type)
                e.component_id,
                e.status_type,
                e.is_completed,
                e.raw_value
            FROM component_status_event e
            JOIN component target_component ON target_component.component_id = e.component_id
            WHERE e.status_type IN ('steel_production_start', 'fitup_weld_report', 'fitup_weld_ndi', 'fitup_weld_qc', 'painting', 'shipping')
              AND target_component.plan_id = $1
            ORDER BY e.component_id, e.status_type,
                COALESCE(e.event_at, e.updated_at, e.created_at) DESC NULLS LAST,
                e.updated_at DESC NULLS LAST,
                e.event_id DESC
        )
        SELECT
            c.component_no AS component_name,
            c.component_no,
            c.component_guid,
            c.model_id,
            c.spec,
            c.quantity,
            c.weight,
            c.length,
            c.production_feature,
            c.location,
            c.yard_location,
            c.yard_storage_raw,
            start.raw_value AS steel_production_start,
            report.raw_value AS fitup_weld_report,
            ndi.raw_value AS fitup_weld_ndi,
            qc.raw_value AS fitup_weld_qc,
            paint.raw_value AS painting,
            CASE
                WHEN ship.is_completed = TRUE AND NULLIF(btrim(ship.raw_value), '') IS NOT NULL THEN ship.raw_value
                ELSE '未发货'
            END AS shipping
        FROM component c
        LEFT JOIN latest_event start ON start.component_id = c.component_id AND start.status_type = 'steel_production_start'
        LEFT JOIN latest_event report ON report.component_id = c.component_id AND report.status_type = 'fitup_weld_report'
        LEFT JOIN latest_event ndi ON ndi.component_id = c.component_id AND ndi.status_type = 'fitup_weld_ndi'
        LEFT JOIN latest_event qc ON qc.component_id = c.component_id AND qc.status_type = 'fitup_weld_qc'
        LEFT JOIN latest_event paint ON paint.component_id = c.component_id AND paint.status_type = 'painting'
        LEFT JOIN latest_event ship ON ship.component_id = c.component_id AND ship.status_type = 'shipping'
        WHERE c.plan_id = $1
        ORDER BY c.component_no NULLS LAST, c.component_id;
    `, [planId]);
    return result.rows;
}

async function exportPlan(plan, rows, outputDir) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('ag-grid');
    sheet.columns = [
        { header: '#', key: 'seq', width: 11 },
        { header: '', key: 'blank', width: 10 },
        { header: '构件名称', key: 'component_name', width: 28 },
        { header: '构件编号', key: 'component_no', width: 28 },
        { header: '构件GUID', key: 'component_guid', width: 28 },
        { header: '模型ID', key: 'model_id', width: 28 },
        { header: '规格/型号', key: 'spec', width: 28 },
        { header: '数量', key: 'quantity', width: 28 },
        { header: '重量', key: 'weight', width: 28 },
        { header: '体积', key: 'volume', width: 28 },
        { header: '长度', key: 'length', width: 28 },
        { header: '生产特征', key: 'production_feature', width: 28 },
        { header: '区域部位/所在楼层', key: 'location', width: 28 },
        { header: '堆场位置', key: 'yard_location', width: 28 },
        { header: '堆场入库', key: 'yard_storage_raw', width: 44.25 },
        { header: '所属布置图', key: 'layout', width: 28 },
        { header: '是否发货', key: 'shipping', width: 28 },
        { header: '钢构生产开始', key: 'steel_production_start', width: 28 },
        { header: '装焊报检', key: 'fitup_weld_report', width: 28 },
        { header: '装焊探伤', key: 'fitup_weld_ndi', width: 28 },
        { header: '装焊质检', key: 'fitup_weld_qc', width: 28 },
        { header: '涂装', key: 'painting', width: 28 }
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'V1' };
    rows.forEach((row, index) => sheet.addRow({ seq: index + 1, volume: 0, ...row }));
    ['G', 'I', 'J', 'K'].forEach((column) => { sheet.getColumn(column).numFmt = '0.###'; });
    sheet.getColumn('H').numFmt = '0';
    const outputPath = path.join(outputDir, `${String(plan.plan_id)}_${sanitizeFileName(plan.plan_name)}.xlsx`);
    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
}

function sendPrivateMessage(message) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ user_id: QQ_USER_ID, message });
        const request = http.request({
            hostname: '127.0.0.1', port: ONEBOT_PORT, path: '/send_private_msg', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (response) => {
            let text = '';
            response.on('data', (chunk) => { text += chunk; });
            response.on('end', () => {
                try {
                    const parsed = JSON.parse(text);
                    if (parsed.status === 'failed') throw new Error(parsed.message || 'NapCat 发送失败');
                    resolve(parsed.data);
                } catch (error) { reject(error); }
            });
        });
        request.setTimeout(30000, () => request.destroy(new Error('NapCat 发送超时')));
        request.on('error', reject);
        request.end(body);
    });
}

async function sendFiles(files) {
    await sendPrivateMessage(`上海胡姬港湾周度堆场导出完成，共 ${files.length} 个计划文件，正在发送。`);
    for (const filePath of files) {
        const uri = `file:///${filePath.replace(/\\/g, '/')}`;
        await sendPrivateMessage(`[CQ:file,file=${uri},name=${path.basename(filePath)}]`);
    }
}

async function main() {
    const send = process.argv.includes('--send');
    const yardLocations = getYardLocations();
    const now = new Date();
    const date = datePathParts(now);
    const outputDir = path.join(OUTPUT_ROOT, date.year, date.month, date.day);
    fs.mkdirSync(outputDir, { recursive: true });
    const pool = createPool();
    try {
        const updateResult = await updateYardFields(pool, yardLocations);
        const plans = await fetchPlans(pool);
        const files = [];
        for (const plan of plans) {
            const rows = await fetchPlanRows(pool, plan.plan_id);
            files.push(await exportPlan(plan, rows, outputDir));
        }
        if (send) await sendFiles(files);
        console.log(JSON.stringify({
            ok: true, project: PROJECT_NAME, planCount: plans.length, exportFiles: files,
            yardLocations, updatedComponents: updateResult.updated, qqSent: send
        }));
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.stack || error.message || error);
        process.exitCode = 1;
    });
}

module.exports = { getYardLocations, sanitizeFileName, fetchPlans, fetchPlanRows, updateYardFields, exportPlan };
