const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const { query } = require('./query/sql-runner');

function text(value) {
    return String(value == null ? '' : value).trim();
}

function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function round3(value) {
    return Number(number(value).toFixed(3));
}

function normalizeDateParts(yearValue, monthValue, dayValue) {
    const year = Number(yearValue);
    const month = Number(monthValue);
    const day = Number(dayValue);
    const candidate = new Date(Date.UTC(year, month - 1, day));

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day
    ) {
        return null;
    }

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDateTokens(content) {
    const tokens = [];
    const pattern = /(20\d{2})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?/g;
    let match;

    while ((match = pattern.exec(content)) !== null) {
        tokens.push({
            raw: match[0],
            value: normalizeDateParts(match[1], match[2], match[3])
        });
    }

    return tokens;
}

function parseShippingRangeCommand(input) {
    const content = text(input).replace(/\s+/g, ' ');
    if (!content || !content.includes('发货')) return null;
    if (/(?:未发货|没发货|发货对齐)/.test(content)) return null;

    const dates = extractDateTokens(content);
    const hasReportKeyword = /(?:明细|信息|报表|查询)/.test(content);
    if (!hasReportKeyword && dates.length < 2) return null;

    if (dates.length !== 2) {
        return {
            ok: false,
            error: '请提供一个完整的起止日期范围，例如：发货明细 2026-07-01 至 2026-08-10'
        };
    }

    if (dates.some(item => !item.value)) {
        return {
            ok: false,
            error: '日期无效，请使用真实日期，例如：2026-07-01'
        };
    }

    const [start, end] = dates.map(item => item.value);
    if (start > end) {
        return {
            ok: false,
            error: '起始日期不能晚于结束日期。'
        };
    }

    return {
        ok: true,
        raw: content,
        start,
        end
    };
}

async function fetchShippingRows(options = {}) {
    const start = text(options.start);
    const end = text(options.end);
    const queryFn = options.queryFn || query;

    const sql = `
        SELECT
            to_char(timezone('Asia/Shanghai', e.event_at), 'YYYY-MM') AS shipping_month,
            to_char(timezone('Asia/Shanghai', e.event_at), 'YYYY-MM-DD HH24:MI:SS') AS shipping_at,
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'project_name'), ''), p.project_name) AS project_name,
            COALESCE(NULLIF(trim(pp.plan_name), ''), '') AS plan_name,
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'component_no'), ''), NULLIF(trim(c.component_no), ''), '') AS component_no,
            COALESCE(NULLIF(trim(c.component_guid), ''), '') AS component_guid,
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'spec'), ''), NULLIF(trim(c.spec), ''), '') AS spec,
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'location'), ''), NULLIF(trim(c.location), ''), '') AS location,
            COALESCE(NULLIF(shipping_snapshot.data->>'quantity', '')::numeric, c.quantity, 1)::numeric(18,3) AS quantity,
            CASE
                WHEN shipping_snapshot.data IS NOT NULL
                    THEN COALESCE(NULLIF(shipping_snapshot.data->>'weight_kg', '')::numeric, 0)
                WHEN COALESCE(NULLIF(trim(c.component_guid), ''), '') ~ '^D9-2MB-2-fxc-251225-(0[1-9]|1[0-6])$'
                    THEN COALESCE(c.weight, 0)
                ELSE COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)
            END AS shipping_weight_kg,
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'complete_time_text'), ''), '') AS completed_at,
            COALESCE(
                NULLIF(trim(shipping_snapshot.data->>'delivery_username'), ''),
                NULLIF(trim(e.operator_name), ''),
                ''
            ) AS operator_name,
            e.event_id
        FROM component_status_event e
        JOIN component c ON c.component_id = e.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        LEFT JOIN LATERAL (
            SELECT CASE
                WHEN e.raw_value LIKE 'SHIPPING_API_JSON:%'
                    THEN substring(e.raw_value FROM 19)::jsonb
                ELSE NULL::jsonb
            END AS data
        ) shipping_snapshot ON true
        WHERE e.status_type = 'shipping'
          AND e.is_completed = TRUE
          AND e.event_at IS NOT NULL
          AND timezone('Asia/Shanghai', e.event_at)::date >= $1::date
          AND timezone('Asia/Shanghai', e.event_at)::date <= $2::date
        ORDER BY e.event_at ASC, p.project_name ASC, pp.plan_name ASC, c.component_guid ASC, e.event_id ASC
    `;

    const result = await queryFn(sql, [start, end]);
    return (result.rows || []).map(row => ({
        shippingMonth: text(row.shipping_month),
        shippingAt: text(row.shipping_at),
        projectName: text(row.project_name),
        planName: text(row.plan_name),
        componentNo: text(row.component_no),
        componentGuid: text(row.component_guid),
        spec: text(row.spec),
        location: text(row.location),
        quantity: number(row.quantity),
        shippingWeightKg: number(row.shipping_weight_kg),
        completedAt: text(row.completed_at),
        operatorName: text(row.operator_name),
        eventId: number(row.event_id)
    }));
}

function normalizeReportRow(row) {
    const shippingAt = text(row.shippingAt || row.shipping_at);
    return {
        shippingMonth: text(row.shippingMonth || row.shipping_month) || shippingAt.slice(0, 7),
        shippingAt,
        projectName: text(row.projectName || row.project_name) || '未命名项目',
        planName: text(row.planName || row.plan_name),
        componentNo: text(row.componentNo || row.component_no),
        componentGuid: text(row.componentGuid || row.component_guid),
        spec: text(row.spec),
        location: text(row.location),
        quantity: number(row.quantity),
        shippingWeightKg: number(row.shippingWeightKg ?? row.shipping_weight_kg),
        completedAt: text(row.completedAt || row.completed_at),
        operatorName: text(row.operatorName || row.operator_name),
        eventId: number(row.eventId ?? row.event_id)
    };
}

function buildMonthlySummaryRows(inputRows) {
    const rows = (inputRows || []).map(normalizeReportRow);
    const projectMap = new Map();
    const monthMap = new Map();
    const overall = { detailLines: 0, quantity: 0, weightKg: 0 };

    for (const row of rows) {
        const month = row.shippingMonth || '未知月份';
        const projectKey = `${month}\u0000${row.projectName}`;
        if (!projectMap.has(projectKey)) {
            projectMap.set(projectKey, {
                kind: 'project',
                month,
                projectName: row.projectName,
                detailLines: 0,
                quantity: 0,
                weightKg: 0
            });
        }
        if (!monthMap.has(month)) {
            monthMap.set(month, {
                kind: 'monthTotal',
                month,
                projectName: '月度合计',
                detailLines: 0,
                quantity: 0,
                weightKg: 0
            });
        }

        for (const target of [projectMap.get(projectKey), monthMap.get(month), overall]) {
            target.detailLines += 1;
            target.quantity += row.quantity;
            target.weightKg += row.shippingWeightKg;
        }
    }

    const output = [];
    const months = Array.from(monthMap.keys()).sort();
    for (const month of months) {
        const projectRows = Array.from(projectMap.values())
            .filter(item => item.month === month)
            .sort((a, b) => a.projectName.localeCompare(b.projectName, 'zh-CN'));
        output.push(...projectRows, monthMap.get(month));
    }

    if (rows.length > 0) {
        output.push({
            kind: 'overallTotal',
            month: '全部',
            projectName: '区间合计',
            ...overall
        });
    }

    return output.map(item => ({
        ...item,
        quantity: Number(item.quantity.toFixed(3)),
        weightKg: Number(item.weightKg.toFixed(12)),
        weightTon: round3(item.weightKg / 1000)
    }));
}

function applyHeaderStyle(row) {
    row.height = 24;
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function applyWorksheetDefaults(worksheet) {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columnCount }
    };
    worksheet.pageSetup = {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0
    };
    applyHeaderStyle(worksheet.getRow(1));
}

function buildWorkbook(inputRows, options = {}) {
    const rows = (inputRows || []).map(normalizeReportRow);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'autoribao QQbot';
    workbook.created = new Date();
    workbook.subject = `${text(options.start)} 至 ${text(options.end)} 发货信息`;
    workbook.views = [{
        x: 0,
        y: 0,
        width: 12000,
        height: 20000,
        firstSheet: 0,
        activeTab: 0,
        visibility: 'visible'
    }];

    const summaryRows = buildMonthlySummaryRows(rows);
    const summarySheet = workbook.addWorksheet('月度汇总');
    const detailSheet = workbook.addWorksheet('发货明细');
    detailSheet.columns = [
        { header: '序号', key: 'sequence', width: 8 },
        { header: '发货月份', key: 'shippingMonth', width: 12 },
        { header: '发货时间', key: 'shippingAt', width: 21 },
        { header: '项目名称', key: 'projectName', width: 38 },
        { header: '生产计划', key: 'planName', width: 28 },
        { header: '构件编号', key: 'componentNo', width: 20 },
        { header: '构件GUID', key: 'componentGuid', width: 38 },
        { header: '规格/型号', key: 'spec', width: 22 },
        { header: '区域部位/所在楼层', key: 'location', width: 24 },
        { header: '发货数量', key: 'quantity', width: 12 },
        { header: '发货重量(kg)', key: 'shippingWeightKg', width: 18 },
        { header: '发货重量(吨)', key: 'shippingWeightTon', width: 18 },
        { header: '装焊完成时间', key: 'completedAt', width: 21 },
        { header: '发货操作人', key: 'operatorName', width: 16 }
    ];
    detailSheet.addRows(rows.map((row, index) => ({
        ...row,
        sequence: index + 1,
        shippingWeightTon: row.shippingWeightKg / 1000
    })));
    applyWorksheetDefaults(detailSheet);
    detailSheet.getColumn('quantity').numFmt = '0.###';
    detailSheet.getColumn('shippingWeightKg').numFmt = '0.###############';
    detailSheet.getColumn('shippingWeightTon').numFmt = '0.###############';
    for (let rowNumber = 2; rowNumber <= detailSheet.rowCount; rowNumber += 1) {
        detailSheet.getRow(rowNumber).alignment = { vertical: 'top', wrapText: true };
    }

    summarySheet.columns = [
        { header: '月份', key: 'month', width: 14 },
        { header: '项目名称', key: 'projectName', width: 42 },
        { header: '发货明细行数', key: 'detailLines', width: 16 },
        { header: '发货数量', key: 'quantity', width: 14 },
        { header: '发货重量(kg)', key: 'weightKg', width: 18 },
        { header: '发货重量(吨)', key: 'weightTon', width: 18 }
    ];
    summarySheet.addRows(summaryRows);
    applyWorksheetDefaults(summarySheet);
    summarySheet.getColumn('detailLines').numFmt = '0';
    summarySheet.getColumn('quantity').numFmt = '0.###';
    summarySheet.getColumn('weightKg').numFmt = '0.###############';
    summarySheet.getColumn('weightTon').numFmt = '0.000';
    summaryRows.forEach((item, index) => {
        if (item.kind === 'project') return;
        const row = summarySheet.getRow(index + 2);
        row.font = { bold: true };
        row.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: item.kind === 'overallTotal' ? 'FFD9EAD3' : 'FFD9EAF7' }
        };
    });

    return { workbook, rows, summaryRows };
}

function resolveDefaultOutputDir(end) {
    const [year, month, day] = text(end).split('-');
    return path.join(__dirname, '..', 'downloads', year, month, day);
}

function resolveUniqueOutputPath(outputDir, fileName) {
    const parsed = path.parse(path.join(outputDir, fileName));
    let candidate = path.join(outputDir, fileName);
    let index = 1;
    while (fs.existsSync(candidate)) {
        candidate = path.join(parsed.dir, `${parsed.name}__dup${index}${parsed.ext}`);
        index += 1;
    }
    return candidate;
}

async function generateShippingRangeReport(options = {}) {
    const start = text(options.start);
    const end = text(options.end);
    if (!normalizeDateParts(...start.split('-')) || !normalizeDateParts(...end.split('-'))) {
        throw new Error('发货报表日期无效');
    }
    if (start > end) {
        throw new Error('发货报表起始日期不能晚于结束日期');
    }

    const rows = Array.isArray(options.rows)
        ? options.rows.map(normalizeReportRow)
        : await fetchShippingRows({ start, end, queryFn: options.queryFn });
    const outputDir = options.outputDir || resolveDefaultOutputDir(end);
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = options.fileName || `发货信息_${start.replace(/-/g, '')}至${end.replace(/-/g, '')}.xlsx`;
    const outputPath = resolveUniqueOutputPath(outputDir, fileName);
    const result = buildWorkbook(rows, { start, end });
    await result.workbook.xlsx.writeFile(outputPath);

    return {
        outputPath,
        start,
        end,
        detailCount: result.rows.length,
        monthCount: new Set(result.rows.map(row => row.shippingMonth).filter(Boolean)).size,
        projectCount: new Set(result.rows.map(row => row.projectName).filter(Boolean)).size
    };
}

module.exports = {
    parseShippingRangeCommand,
    fetchShippingRows,
    buildMonthlySummaryRows,
    buildWorkbook,
    generateShippingRangeReport
};
