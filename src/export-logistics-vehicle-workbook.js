const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const PLATE_RE = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{5,6}/;

const OUTPUT_ROOT = path.join(__dirname, '..', 'downloads', 'weekly-yard-exports');
const SOURCE = process.env.LOGISTICS_SOURCE || path.join(OUTPUT_ROOT, '智能物流数据 -截止260628已发上海胡姬港湾.xlsx');
const OUTPUT_NAME = '上海胡姬港湾_物流车辆及装车构件.xlsx';
const STATE_PATH = path.join(OUTPUT_ROOT, 'logistics-export-state.json');
const BACKFILL_AFTER = '2026-07-31';

function repairMojibake(value) {
    const input = String(value == null ? '' : value);
    if (!/[ÃÅÈËÊÎÁÏµº¼¹¾]/.test(input)) return input;
    try {
        const repaired = Buffer.from(input, 'latin1').toString('gbk');
        return repaired.includes('�') ? input : repaired;
    } catch {
        return input;
    }
}
function text(value) { return repairMojibake(value).trim(); }
function dateKey(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const input = text(value);
    const ymd = input.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
    if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`;
    const mdy = input.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2})(?:\D|$)/);
    return mdy ? `20${mdy[3]}-${String(mdy[1]).padStart(2, '0')}-${String(mdy[2]).padStart(2, '0')}` : '';
}
function safeSheetName(value, used) {
    let name = text(value).replace(/[\\/:*?"<>|\[\]]/g, '_') || '未命名发货单';
    name = name.slice(0, 31);
    const base = name; let i = 2;
    while (used.has(name)) name = `${base.slice(0, 31 - String(i).length - 1)}_${i++}`;
    used.add(name); return name;
}
function loadExportState(statePath = STATE_PATH) {
    if (!fs.existsSync(statePath)) return { version: 1, project: '上海胡姬港湾', exportedDeliveries: {} };
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state || state.version !== 1 || !state.exportedDeliveries || typeof state.exportedDeliveries !== 'object') {
        throw new Error(`物流导出状态文件格式无效: ${statePath}`);
    }
    return state;
}
function saveExportState(state, deliveries, outputPath, statePath = STATE_PATH) {
    const exportedAt = new Date().toISOString();
    for (const delivery of deliveries) {
        state.exportedDeliveries[text(delivery.code)] = {
            deliveryId: delivery.id,
            exportedAt,
            output: path.relative(OUTPUT_ROOT, outputPath).replace(/\\/g, '/')
        };
    }
    state.updatedAt = exportedAt;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tempPath = `${statePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, statePath);
}
function pad2(value) {
    return String(value).padStart(2, '0');
}
function formatLocalDateTime(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}
function parseLocalDateTime(value) {
    const input = text(value);
    const match = input.match(/(20\d{2})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}
function fridayOnOrAfter(value) {
    const key = dateKey(value);
    const parts = key.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
    if (!parts) return '';
    const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7));
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function groupDeliveriesByFriday(deliveries) {
    const grouped = new Map();
    for (const delivery of deliveries) {
        const friday = fridayOnOrAfter(delivery.create_time);
        if (!friday) continue;
        if (!grouped.has(friday)) grouped.set(friday, []);
        grouped.get(friday).push(delivery);
    }
    return grouped;
}
function fillDeliveryTimes(delivery, random = Math.random) {
    const current = delivery.logistics && typeof delivery.logistics === 'object' ? delivery.logistics : {};
    const shipped = parseLocalDateTime(delivery.create_time);
    if (!shipped) {
        delivery.logistics = { ...current, depart: text(delivery.create_time) };
        return;
    }
    const arrive = new Date(shipped.getTime() + (2.5 + Number(random()) * 0.5) * 3600000);
    delivery.logistics = { ...current, depart: formatLocalDateTime(shipped), arrive: formatLocalDateTime(arrive) };
}

function parseSourceRows(source = SOURCE) {
    if (!fs.existsSync(source)) return [];
    const workbook = XLSX.readFile(source, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss' });
    const groups = []; let current = null;
    for (const raw of rows.slice(1)) {
        const component = text(raw[9]);
        if (!component && !raw.slice(0, 9).some(v => text(v))) continue;
        if (text(raw[0])) {
            current = { plate: text(raw[0]), driver: text(raw[1]), driverPhone: text(raw[2]), logisticsCompany: text(raw[3]), receiver: text(raw[4]), receiverContact: text(raw[5]), address: text(raw[6]), depart: raw[7], arrive: raw[8], components: [] };
            groups.push(current);
        }
        if (!current) continue;
        if (component) current.components.push(component);
    }
    return groups;
}
function parseProjectIntroduction(value) {
    const input = text(value).replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    const capture = pattern => text(input.match(pattern)?.[1]);
    return {
        plate: capture(/(?:车牌号|运输车辆|车辆信息|司机信息)\s*[：:]\s*([^\s，,]+)/),
        driver: capture(/司机\s*[：:]\s*([^\s，,]+)/),
        driverPhone: capture(/司机[^\n]*?(?:联系电话|司机电话|电话)\s*[：:]\s*([\d\s-]{7,})/).replace(/\s+/g, ''),
        logisticsCompany: capture(/物流(?:公司|单位|信息)?\s*[：:]\s*(.*?)\s+(?:车牌号|运输车辆|车辆信息|司机信息)/),
        receiver: capture(/(?:收货人|收货联系人|联系人)\s*[：:]\s*([^\s，,：:]+)/),
        receiverContact: capture(/(?:收货人|收货联系人|联系人)\s*[：:][^1]*?(1\d{10})/),
        address: capture(/(?:收货地址|地址)\s*[：:]\s*(.*?)\s+(?:收货人|收货联系人|联系人)/),
        depart: '',
        arrive: ''
    };
}
function firstPlate(value) {
    const match = text(value).match(PLATE_RE);
    return match ? match[0] : '';
}
function parseDeliveryPdfText(raw) {
    const input = String(raw == null ? '' : raw);
    const introMatch = input.match(/项目介绍\s*[：:]\s*([\s\S]*?)(?=\n\s*\d+\s*\/\s*\d+|\n\s*附表|$)/);
    const intro = parseProjectIntroduction(introMatch ? introMatch[1] : input);
    const truck = firstPlate((input.match(/运输车号\s*[：:]\s*([^\n]*)/) || [])[1]);
    const ship = firstPlate((input.match(/发货信息\s*[：:]\s*([^\n]*)/) || [])[1]);
    return { ...intro, plate: truck || ship || firstPlate(intro.plate) };
}
function extractPdfText(buffer) {
    const tmp = path.join(os.tmpdir(), `delivery-pdf-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
    fs.writeFileSync(tmp, buffer);
    try {
        const script = 'from pypdf import PdfReader; import sys; sys.stdout.reconfigure(encoding="utf-8"); r=PdfReader(sys.argv[1]); print("\\n".join((p.extract_text() or "") for p in r.pages))';
        const result = spawnSync('python', ['-c', script, tmp], {
            encoding: 'utf8',
            windowsHide: true,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });
        if (result.status !== 0) throw new Error(text(result.stderr) || '发货单 PDF 文本提取失败');
        return result.stdout || '';
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}
function nonEmptyLogistics(source) {
    if (!source || typeof source !== 'object') return {};
    const result = {};
    for (const key of ['plate', 'driver', 'driverPhone', 'logisticsCompany', 'receiver', 'receiverContact', 'address', 'depart', 'arrive']) {
        if (text(source[key])) result[key] = source[key];
    }
    return result;
}
function matchLogistics(groups, deliveries, random = Math.random) {
    const sourceByDate = new Map();
    for (const group of groups) {
        const key = dateKey(group.depart);
        if (!sourceByDate.has(key)) sourceByDate.set(key, []);
        sourceByDate.get(key).push(group);
    }
    const deliveriesByDate = new Map();
    for (const delivery of deliveries) {
        const key = dateKey(delivery.create_time);
        if (!deliveriesByDate.has(key)) deliveriesByDate.set(key, []);
        deliveriesByDate.get(key).push(delivery);
    }
    for (const [key, sameDay] of deliveriesByDate) {
        sameDay.sort((a, b) => text(a.create_time).localeCompare(text(b.create_time)));
        const source = sourceByDate.get(key) || [];
        sameDay.forEach((delivery, index) => {
            delivery.logistics = {
                ...nonEmptyLogistics(delivery.projectLogistics),
                ...nonEmptyLogistics(source[index]),
                ...nonEmptyLogistics(delivery.pdfLogistics)
            };
        });
    }
    for (const delivery of deliveries) fillDeliveryTimes(delivery, random);
    return deliveries;
}
function appendDeliveries(wb, deliveries) {
    const used = new Set(wb.worksheets.map(sheet => sheet.name));
    for (const delivery of deliveries) {
        const group = delivery.logistics || {};
        const deliveryCode = text(delivery.code) || `发货单_${delivery.id || used.size + 1}`;
        const sheet = wb.addWorksheet(safeSheetName(deliveryCode, used));
        sheet.columns = [
            { header: '车牌号', key: 'plate', width: 14 }, { header: '司机', key: 'driver', width: 12 }, { header: '司机电话', key: 'driverPhone', width: 16 },
            { header: '物流公司', key: 'logisticsCompany', width: 18 }, { header: '收货人', key: 'receiver', width: 14 }, { header: '收货人联系方式', key: 'receiverContact', width: 18 },
            { header: '收货地址', key: 'address', width: 48 }, { header: '出发时间', key: 'depart', width: 20 }, { header: '到达时间', key: 'arrive', width: 20 }, { header: '装车构件', key: 'component', width: 24 }
        ];
        sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }];
        const components = delivery.components && delivery.components.length ? delivery.components : [''];
        components.forEach((component, i) => sheet.addRow({ plate: i === 0 ? group.plate || '' : '', driver: i === 0 ? group.driver || '' : '', driverPhone: i === 0 ? group.driverPhone || '' : '', logisticsCompany: i === 0 ? group.logisticsCompany || '' : '', receiver: i === 0 ? group.receiver || '' : '', receiverContact: i === 0 ? group.receiverContact || '' : '', address: i === 0 ? group.address || '' : '', depart: i === 0 ? group.depart || '' : '', arrive: i === 0 ? group.arrive || '' : '', component: text(component.code || component.name || component) }));
        for (let r = 2; r <= sheet.rowCount; r++) sheet.getRow(r).alignment = { vertical: 'top', wrapText: true };
    }
    return wb;
}
function createWorkbook(deliveries) {
    return appendDeliveries(new ExcelJS.Workbook(), deliveries);
}
async function fetchPlatformData(exportedCodes = new Set()) {
    const config = require('../config/default.json');
    const BrowserAutomation = require('./browser-automation');
    const browser = new BrowserAutomation({ ...config, browser: { ...(config.browser || {}), headless: true } });
    if (!await browser.launchBrowser()) throw new Error('浏览器启动失败');
    try {
        if (!await browser.login()) throw new Error('平台登录失败');
        const page = browser.page; let token = '';
        page.on('request', request => {
            if (!request.url().includes('/v1.order/')) return;
            const headers = request.headers(); token = headers.token || headers.Token || token;
        });
        await page.goto('https://dwyunsc.ddwjzkj.com:22222/order/delivery');
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        if (!token) throw new Error('未获取到平台 Token');
        const post = async (apiPath, data) => {
            const response = await page.request.post(`https://dwyunsc.ddwjzkj.com:10086${apiPath}`, { data, headers: { Token: token, 'Content-Type': 'application/json;charset=utf-8' } });
            const body = await response.json();
            if (!response.ok() || body.code !== 0) throw new Error(`${apiPath}: ${body.msg || response.status()}`);
            return body.data;
        };
        const deliveryData = await post('/v1.order/getDeliverys', { proj_id: 163, keyword: '', code: '', page: 1, size: 100 });
        const deliveries = (deliveryData.list || []).filter(item =>
            text(item.project_name) === '上海胡姬港湾' && !exportedCodes.has(text(item.code))
        );
        if (!deliveries.length) return [];
        const packageData = await post('/v1.order/getPackageList', { proj_id: 163, keyword: '', code: '', page: 1, size: 100 });
        const project = await post('/v1.project/getInfo', { id: 163 });
        const projectLogistics = parseProjectIntroduction(project.introduce);
        const packagesByDelivery = new Map();
        for (const pkg of packageData.list || []) {
            if (!pkg.delivery_id) continue;
            if (!packagesByDelivery.has(String(pkg.delivery_id))) packagesByDelivery.set(String(pkg.delivery_id), []);
            packagesByDelivery.get(String(pkg.delivery_id)).push(pkg);
        }
        for (const delivery of deliveries) {
            delivery.projectLogistics = projectLogistics;
            delivery.components = [];
            delivery.pdfLogistics = {};
            try {
                const pdfResponse = await page.request.get(`https://dwyunsc.ddwjzkj.com:10086/delivery/info?id=${delivery.id}`, {
                    headers: { Token: token },
                    timeout: 60000
                });
                const pdfBuffer = Buffer.from(await pdfResponse.body());
                if (pdfBuffer.subarray(0, 4).toString('ascii') === '%PDF') {
                    delivery.pdfLogistics = parseDeliveryPdfText(extractPdfText(pdfBuffer));
                }
            } catch (error) {
                delivery.pdfError = error && error.message ? error.message : String(error);
            }
            for (const pkg of packagesByDelivery.get(String(delivery.id)) || []) {
                const artifacts = await post('/v1.order/getPackageArtifacts', { id: pkg.id });
                if (Array.isArray(artifacts)) delivery.components.push(...artifacts);
            }
        }
        return deliveries;
    } finally {
        await browser.closeBrowser();
    }
}
function summarizeDeliveries(deliveries) {
    return {
        logisticsMatched: deliveries.filter(d => d.logistics).length,
        pdfPlates: deliveries.filter(d => d.pdfLogistics && String(d.pdfLogistics.plate || '').trim()).length,
        departFilled: deliveries.filter(d => d.logistics && String(d.logistics.depart || '').trim()).length,
        arriveFilled: deliveries.filter(d => d.logistics && String(d.logistics.arrive || '').trim()).length,
        componentCount: deliveries.reduce((n, d) => n + ((d.components && d.components.length) || 0), 0)
    };
}
async function writeWorkbook(deliveries, output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const workbook = createWorkbook(deliveries);
    await workbook.xlsx.writeFile(output);
    return workbook;
}
async function main() {
    const backfillMissing = process.argv.includes('--backfill-missing');
    const state = loadExportState();
    const exportedCodes = new Set(Object.keys(state.exportedDeliveries));
    const fetched = await fetchPlatformData(backfillMissing ? new Set() : exportedCodes);
    const deliveries = backfillMissing
        ? fetched.filter(item => dateKey(item.create_time) > BACKFILL_AFTER)
        : fetched;
    if (!deliveries.length) {
        console.log(JSON.stringify({ ok: true, skipped: true, reason: '没有未导出的发货单', exportedDeliveryCount: exportedCodes.size }));
        return;
    }
    const groups = parseSourceRows();
    matchLogistics(groups, deliveries);
    if (backfillMissing) {
        const files = [];
        for (const [friday, weekDeliveries] of groupDeliveriesByFriday(deliveries)) {
            const [year, month, day] = friday.split('-');
            const output = path.join(OUTPUT_ROOT, year, month, day, OUTPUT_NAME);
            const workbook = await writeWorkbook(weekDeliveries, output);
            saveExportState(state, weekDeliveries, output);
            files.push({ friday, output, newDeliveryCount: weekDeliveries.length, sheetCount: workbook.worksheets.length, ...summarizeDeliveries(weekDeliveries) });
        }
        console.log(JSON.stringify({ ok: true, skipped: false, backfill: true, source: SOURCE, sourceMissing: !fs.existsSync(SOURCE), files }));
        return;
    }
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
    const output = path.join(OUTPUT_ROOT, parts.year, parts.month, parts.day, OUTPUT_NAME);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(output)) await workbook.xlsx.readFile(output);
    await appendDeliveries(workbook, deliveries).xlsx.writeFile(output);
    saveExportState(state, deliveries, output);
    console.log(JSON.stringify({
        ok: true,
        skipped: false,
        source: SOURCE,
        sourceMissing: !fs.existsSync(SOURCE),
        output,
        newDeliveryCount: deliveries.length,
        sheetCount: workbook.worksheets.length,
        ...summarizeDeliveries(deliveries)
    }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { SOURCE, OUTPUT_ROOT, BACKFILL_AFTER, parseSourceRows, parseProjectIntroduction, parseDeliveryPdfText, extractPdfText, loadExportState, saveExportState, appendDeliveries, createWorkbook, matchLogistics, fillDeliveryTimes, fridayOnOrAfter, groupDeliveriesByFriday, safeSheetName, dateKey, repairMojibake };
