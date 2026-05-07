const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const logger = require('../logger');
const { getQueryConfig } = require('./config');

const SHEET_DEFS = {
    workshopTasks: {
        name: '车间任务情况',
        headers: ['车间', '项目名称', '工程区域', '已完构件数量', '已完构件重量', '未完构件数量', '未完构件重量', '计划完成日期'],
        totalHeaders: ['已完构件数量', '已完构件重量', '未完构件数量', '未完构件重量']
    },
    teamTasks: {
        name: '班组任务情况',
        headers: ['车间', '项目名称', '工程区域', '装焊班组', '已完构件数量', '已完构件重量', '未完构件数量', '未完构件重量', '计划完成日期'],
        totalHeaders: ['已完构件数量', '已完构件重量', '未完构件数量', '未完构件重量']
    },
    dailyTeamSummary: {
        name: '每日班组完成汇总',
        headers: ['车间', '项目名称', '工程区域', '今日已完构件数量', '今日已完构件重量'],
        totalHeaders: ['今日已完构件数量', '今日已完构件重量']
    },
    dailyTeamDetails: {
        name: '每日班组完成详情',
        headers: ['车间', '项目名称', '工程区域', '构件编号', '数量', '重量'],
        totalHeaders: ['数量', '重量']
    },
    unfinishedDetails: {
        name: '未完构件详情',
        headers: ['车间', '项目名称', '工程区域', '装焊班组', '构件编号', '数量', '重量', '计划完成日期'],
        totalHeaders: ['数量', '重量']
    }
};

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function getFeedbackConfig() {
    const queryConfig = getQueryConfig();
    return queryConfig.feedbackTemplate || {
        excelPath: '',
        outputDir: './downloads/query-feedback'
    };
}

function formatDateValue(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function normalizeSheetRows(def, rows) {
    return (rows || []).map(item => {
        if (Array.isArray(item)) return item;
        return def.headers.map(header => {
            const value = item[header];
            if (header.includes('日期')) return formatDateValue(value);
            return value == null ? '' : value;
        });
    });
}

function formatTotalValue(header, value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    if (header.includes('重量')) {
        return Number(numeric.toFixed(3));
    }
    return Math.trunc(numeric);
}

function appendTotalRow(def, rows) {
    const normalizedRows = Array.isArray(rows) ? rows.slice() : [];
    const totalRow = new Array(def.headers.length).fill('');
    totalRow[0] = '合计';

    for (const header of def.totalHeaders || []) {
        const index = def.headers.indexOf(header);
        if (index < 0) continue;
        const total = normalizedRows.reduce((sum, row) => sum + Number(row[index] || 0), 0);
        totalRow[index] = formatTotalValue(header, total);
    }

    normalizedRows.push(totalRow);
    return normalizedRows;
}

function rewriteSheetRows(sheet, rows) {
    const deleteCount = Math.max(0, sheet.rowCount - 1);
    if (rows.length > 0) {
        sheet.spliceRows(2, deleteCount, ...rows);
    } else if (deleteCount > 0) {
        sheet.spliceRows(2, deleteCount);
    }
}

async function generateFeedbackWorkbook(payload = {}) {
    const config = getFeedbackConfig();
    if (!config.excelPath) {
        throw new Error('未配置 feedbackTemplate.excelPath');
    }
    if (!fs.existsSync(config.excelPath)) {
        throw new Error(`反馈表模板不存在：${config.excelPath}`);
    }

    const projectRoot = path.join(__dirname, '..', '..');
    const outputDir = path.isAbsolute(config.outputDir)
        ? config.outputDir
        : path.join(projectRoot, config.outputDir);
    ensureDir(outputDir);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(config.excelPath);

    for (const [key, def] of Object.entries(SHEET_DEFS)) {
        const sheet = workbook.getWorksheet(def.name);
        if (!sheet) {
            throw new Error(`模板缺少工作表：${def.name}`);
        }
        const rows = appendTotalRow(def, normalizeSheetRows(def, payload[key]));
        rewriteSheetRows(sheet, rows);
    }

    const fileName = payload.outputFileName || `反馈表_${Date.now()}.xlsx`;
    const outputPath = path.join(outputDir, fileName);
    await workbook.xlsx.writeFile(outputPath);
    logger.info(`已生成反馈表：${outputPath}`);
    return outputPath;
}

module.exports = {
    SHEET_DEFS,
    generateFeedbackWorkbook
};
