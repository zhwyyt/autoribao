const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const DEFAULT_SOURCE_PATH = 'G:\\网页下载\\项目构件详情.xlsx';
const DEFAULT_SHEET_NAME = 'ag-grid';
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../downloads/project-component-details');

let cachedWorkbook = null;

function normalizeText(value) {
    return String(value == null ? '' : value)
        .replace(/\r/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
}

function normalizeKey(value) {
    return normalizeText(value).replace(/\s+/g, '').toLowerCase();
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getSourcePath() {
    return process.env.PROJECT_COMPONENT_DETAILS_XLSX || DEFAULT_SOURCE_PATH;
}

function getWorkbookData() {
    const sourcePath = getSourcePath();
    const stat = fs.statSync(sourcePath);
    if (
        cachedWorkbook &&
        cachedWorkbook.sourcePath === sourcePath &&
        cachedWorkbook.mtimeMs === stat.mtimeMs
    ) {
        return cachedWorkbook;
    }

    const workbook = XLSX.readFile(sourcePath, { cellDates: false });
    const sheetName = workbook.SheetNames.includes(DEFAULT_SHEET_NAME)
        ? DEFAULT_SHEET_NAME
        : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: ''
    });

    if (!rows || rows.length === 0) {
        throw new Error(`项目构件详情文件没有可读取数据：${sourcePath}`);
    }

    const headerRow = rows[0].map(normalizeText);
    const columnIndex = new Map();
    headerRow.forEach((name, index) => {
        const key = normalizeKey(name);
        if (!key) return;
        columnIndex.set(key, index);
    });

    const dataRows = rows.slice(1).map((row, index) => ({
        rowNumber: index + 2,
        raw: row,
        projectName: normalizeText(row[columnIndex.get(normalizeKey('项目名称'))]),
        location: normalizeText(row[columnIndex.get(normalizeKey('区域部位/所在楼层'))]),
        componentNo: normalizeText(row[columnIndex.get(normalizeKey('构件编号'))]),
        spec: normalizeText(row[columnIndex.get(normalizeKey('规格/型号'))]),
        length: normalizeText(row[columnIndex.get(normalizeKey('长度'))]),
        quantity: normalizeText(row[columnIndex.get(normalizeKey('数量'))]),
        weight: normalizeText(row[columnIndex.get(normalizeKey('重量'))]),
        qcCompletedAt: normalizeText(row[columnIndex.get(normalizeKey('质检完成日期'))]),
        fitupTeam: normalizeText(row[columnIndex.get(normalizeKey('装焊班组'))]),
        inboundAt: normalizeText(row[columnIndex.get(normalizeKey('入库日期'))]),
        inboundOperator: normalizeText(row[columnIndex.get(normalizeKey('入库扫码'))]),
        outboundAt: normalizeText(row[columnIndex.get(normalizeKey('出库日期'))]),
        stockQty: normalizeText(row[columnIndex.get(normalizeKey('结存数量'))])
    }));

    cachedWorkbook = {
        sourcePath,
        mtimeMs: stat.mtimeMs,
        sheetName,
        headerRow,
        dataRows
    };
    return cachedWorkbook;
}

function parseCommandText(text) {
    const content = normalizeText(text);
    if (!content.startsWith('项目构件详情')) {
        return null;
    }

    const rest = content.slice('项目构件详情'.length).trim();
    if (!rest) {
        return {
            intent: 'help',
            raw: content
        };
    }

    const query = {
        raw: content,
        projectName: '',
        componentNo: '',
        fitupTeam: '',
        inboundOnly: false,
        stockOnly: false
    };

    const componentMatch = rest.match(/构件编号\s*[:：=]?\s*([A-Za-z0-9][A-Za-z0-9_-]*)/i);
    if (componentMatch) {
        query.componentNo = normalizeText(componentMatch[1]);
    }

    const projectMatch = rest.match(/项目名称\s*[:：=]?\s*(.+?)(?=\s+(?:构件编号|装焊班组|仅入库|仅结存)\b|$)/i);
    if (projectMatch) {
        query.projectName = normalizeText(projectMatch[1]);
    }

    const teamMatch = rest.match(/装焊班组\s*[:：=]?\s*(.+?)(?=\s+(?:项目名称|构件编号|仅入库|仅结存)\b|$)/i);
    if (teamMatch) {
        query.fitupTeam = normalizeText(teamMatch[1]);
    }

    query.inboundOnly = /仅入库|只看入库|已入库/.test(rest);
    query.stockOnly = /仅结存|只看结存|有结存/.test(rest);

    if (!query.projectName && !query.componentNo && !query.fitupTeam) {
        const compact = rest.replace(/[：:=]/g, ' ').trim();
        if (compact) {
            query.componentNo = compact.split(/\s+/)[0];
        }
    }

    if (!query.projectName && !query.componentNo && !query.fitupTeam) {
        return {
            intent: 'help',
            raw: content
        };
    }

    return {
        intent: 'query',
        ...query
    };
}

function filterRows(dataRows, query) {
    return dataRows.filter((row) => {
        if (query.projectName && !row.projectName.includes(query.projectName)) {
            return false;
        }
        if (query.componentNo && row.componentNo.toLowerCase() !== query.componentNo.toLowerCase()) {
            return false;
        }
        if (query.fitupTeam && !row.fitupTeam.includes(query.fitupTeam)) {
            return false;
        }
        if (query.inboundOnly && !row.inboundAt) {
            return false;
        }
        if (query.stockOnly && Number(row.stockQty || 0) <= 0) {
            return false;
        }
        return true;
    });
}

function buildReplyText(query, rows, sourcePath) {
    if (!rows || rows.length === 0) {
        return `未在项目构件详情中查到结果。\n来源文件：${sourcePath}`;
    }

    const lines = [];
    lines.push(`已查询到 ${rows.length} 条项目构件详情记录。`);
    if (query.projectName) lines.push(`项目名称：${query.projectName}`);
    if (query.componentNo) lines.push(`构件编号：${query.componentNo}`);
    if (query.fitupTeam) lines.push(`装焊班组：${query.fitupTeam}`);
    if (query.inboundOnly) lines.push('附加条件：仅入库');
    if (query.stockOnly) lines.push('附加条件：仅结存');

    const preview = rows.slice(0, 5);
    for (const row of preview) {
        lines.push([
            `构件编号=${row.componentNo || '-'}`,
            `项目=${row.projectName || '-'}`,
            `规格=${row.spec || '-'}`,
            `重量=${row.weight || '-'}`,
            `班组=${row.fitupTeam || '-'}`,
            `入库日期=${row.inboundAt || '-'}`,
            `出库日期=${row.outboundAt || '-'}`,
            `结存=${row.stockQty || '-'}`
        ].join(' | '));
    }

    if (rows.length > preview.length) {
        lines.push(`其余 ${rows.length - preview.length} 条已导出为明细文件。`);
    }

    return lines.join('\n');
}

async function exportRowsToWorkbook(rows, outputPath) {
    ensureDir(path.dirname(outputPath));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('项目构件详情');
    sheet.columns = [
        { header: '项目名称', key: 'projectName', width: 28 },
        { header: '区域部位/所在楼层', key: 'location', width: 22 },
        { header: '构件编号', key: 'componentNo', width: 20 },
        { header: '规格/型号', key: 'spec', width: 22 },
        { header: '长度', key: 'length', width: 12 },
        { header: '数量', key: 'quantity', width: 10 },
        { header: '重量', key: 'weight', width: 12 },
        { header: '质检完成日期', key: 'qcCompletedAt', width: 22 },
        { header: '装焊班组', key: 'fitupTeam', width: 22 },
        { header: '入库日期', key: 'inboundAt', width: 22 },
        { header: '入库扫码', key: 'inboundOperator', width: 14 },
        { header: '出库日期', key: 'outboundAt', width: 22 },
        { header: '结存数量', key: 'stockQty', width: 12 }
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
        from: 'A1',
        to: 'M1'
    };
    rows.forEach((row) => sheet.addRow(row));
    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
}

function buildOutputPath(query) {
    ensureDir(DEFAULT_OUTPUT_DIR);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const parts = ['项目构件详情'];
    if (query.projectName) parts.push(query.projectName.slice(0, 20));
    if (query.componentNo) parts.push(query.componentNo);
    if (query.fitupTeam) parts.push(query.fitupTeam.slice(0, 20));
    if (query.inboundOnly) parts.push('仅入库');
    if (query.stockOnly) parts.push('仅结存');
    const safeName = parts.join('_').replace(/[\\/:*?"<>|]/g, '_');
    return path.join(DEFAULT_OUTPUT_DIR, `${safeName}_${stamp}.xlsx`);
}

function buildHelpText() {
    return [
        '项目构件详情标准语句：',
        '1. 项目构件详情 构件编号=T2-8ZCL-1',
        '2. 项目构件详情 项目名称=杭钢玉环汽摩配智施智造中心及产业集成项目 构件编号=T2-8ZCL-1',
        '3. 项目构件详情 装焊班组=装焊一车间（卢海浪） 仅结存',
        '4. 项目构件详情 项目名称=杭钢玉环汽摩配智施智造中心及产业集成项目 仅入库',
        `数据源：${getSourcePath()}`
    ].join('\n');
}

async function queryProjectComponentDetails(text) {
    const parsed = parseCommandText(text);
    if (!parsed || parsed.intent !== 'query') {
        return {
            handled: Boolean(parsed),
            ok: true,
            replyText: buildHelpText(),
            files: []
        };
    }

    const workbookData = getWorkbookData();
    const rows = filterRows(workbookData.dataRows, parsed);
    const replyText = buildReplyText(parsed, rows, workbookData.sourcePath);
    const files = [];

    if (rows.length > 5) {
        const outputPath = buildOutputPath(parsed);
        await exportRowsToWorkbook(rows, outputPath);
        files.push({
            path: outputPath,
            kind: 'file',
            name: path.basename(outputPath)
        });
    }

    return {
        handled: true,
        ok: true,
        replyText,
        files,
        count: rows.length
    };
}

module.exports = {
    parseCommandText,
    queryProjectComponentDetails,
    buildHelpText
};
