const fs = require('fs');
const path = require('path');

const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');
const { query } = require('./query/sql-runner');
const { loadTeamDirectory } = require('./query/team-directory-loader');
const { buildLatestFitupEventCte } = require('./query/latest-fitup-query');
const { buildEffectiveProjectFilter, buildEffectivePlanFilter } = require('./query/effective-plan-filter');

const ACTIVE_PROJECT_FILTER = buildEffectiveProjectFilter('p');
const ACTIVE_PLAN_FILTER = buildEffectivePlanFilter('pp');

const API_ORIGIN = 'https://dwyunsc.ddwjzkj.com:10086';
const API_GET_STATISTICAL_DAYS = `${API_ORIGIN}/v1.statistical/getStatisticalDays`;
const API_GET_DELIVERY_HISTORY = `${API_ORIGIN}/v1.order/getDeliveryHistory`;

function ensureDirectories() {
    const dir = resolveDownloadDir();
    ensureDir(dir);
}

function ensureDir(dir) {
    if (!dir) return;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`创建目录: ${dir}`);
    }
}

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (!a) continue;
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i++;
        } else {
            out[key] = true;
        }
    }
    return out;
}

function ensureLogsDir() {
    const dir = path.join(__dirname, '../logs');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

async function saveDebugScreenshot(page, name) {
    const logsDir = ensureLogsDir();
    const filePath = path.join(logsDir, `${name}_${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    logger.info(`已保存截图: ${filePath}`);
    return filePath;
}

function resolveDownloadDir() {
    const configured = (config.files && config.files.downloadFolder) ? config.files.downloadFolder : './downloads';
    return path.isAbsolute(configured) ? configured : path.join(__dirname, '..', configured);
}

function getDailyArchiveDir(endYmd) {
    // endYmd: YYYY-MM-DD
    if (!endYmd || typeof endYmd !== 'string' || endYmd.length < 10) {
        return resolveDownloadDir();
    }
    const year = endYmd.slice(0, 4);
    const month = endYmd.slice(5, 7);
    const day = endYmd.slice(8, 10);
    return path.join(resolveDownloadDir(), year, month, day);
}

function addMonths(ymd, deltaMonths) {
    // ymd: YYYY-MM-DD
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const dt = new Date(y, mo, d);
    if (!Number.isFinite(dt.getTime())) return null;
    dt.setMonth(dt.getMonth() + (deltaMonths || 0));
    const yy = String(dt.getFullYear());
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function findLatestShoufacunXlsx(dir) {
    try {
        if (!dir || !fs.existsSync(dir)) return null;
        const files = fs.readdirSync(dir);
        const candidates = files
            .filter(f => !f.startsWith('~$') && /收发存.*\.xlsx$/i.test(f) && !/模板\.xlsx$/i.test(f))
            .map(f => {
                const full = path.join(dir, f);
                let st = null;
                try { st = fs.statSync(full); } catch { st = null; }
                return { full, mtimeMs: st ? st.mtimeMs : 0 };
            })
            .filter(x => x.mtimeMs > 0)
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
        return candidates.length > 0 ? candidates[0].full : null;
    } catch {
        return null;
    }
}

function toYearMonth(ymd) {
    // ymd: YYYY-MM-DD
    if (!ymd || typeof ymd !== 'string' || ymd.length < 7) {
        return null;
    }
    return ymd.slice(0, 7);
}

function makeUniquePath(dir, baseName) {
    const ext = path.extname(baseName) || '.csv';
    const stem = path.basename(baseName, ext);
    let candidate = path.join(dir, `${stem}${ext}`);
    let i = 1;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${stem}_${i}${ext}`);
        i++;
    }
    return candidate;
}

function buildExportCsvName(options = {}) {
    if (options.fileName && typeof options.fileName === 'string') {
        return options.fileName;
    }
    const yearMonth = toYearMonth(options.endYmd);
    const label = options.label || '装焊入库';
    return yearMonth ? `${yearMonth}_${label}.csv` : `export_${Date.now()}_${label}.csv`;
}

function csvEscape(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}

async function writeApiListCsv({ outPath, headerNames, rows }) {
    const lines = [headerNames.map(csvEscape).join(',')];
    for (const row of rows) {
        lines.push(row.map(csvEscape).join(','));
    }
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    return outPath;
}

function buildShoufacunSegments({ start, end }) {
    const month = end.slice(0, 7);
    return [
        { start, end: `${month}-05` },
        { start: `${month}-06`, end: `${month}-15` },
        { start: `${month}-16`, end }
    ];
}

function mergeApiTables(tables) {
    const headerNames = tables[0].headerNames;
    const rows = [];
    for (const table of tables) {
        if (JSON.stringify(table.headerNames) !== JSON.stringify(headerNames)) {
            throw new Error('API 分段表头不一致，已停止生成收发存报表');
        }
        for (const row of table.rows) {
            rows.push([rows.length + 1, ...row.slice(1)]);
        }
    }
    return { headerNames, rows };
}

async function exportShoufacunApiCsvs(browserAutomation, range, outDir) {
    const inboundTables = [];
    const outboundTables = [];
    for (const segment of buildShoufacunSegments(range)) {
        const label = `${segment.start} 至 ${segment.end}`;
        logger.info(`收发存 API 分段取数：${label}`);
        try {
            const inbound = await fetchSubworkStatisticsTable(browserAutomation, { range: segment });
            const outbound = await fetchOrderHistoryTable(browserAutomation, { range: segment });
            inboundTables.push(inbound);
            outboundTables.push(outbound);
            logger.info(`收发存 API 分段完成：${label}，入库 ${inbound.rows.length} 行，出库 ${outbound.rows.length} 行`);
        } catch (error) {
            throw new Error(`收发存 API 分段 ${label} 失败，已停止生成：${error.message}`);
        }
    }

    // 六次取数及两套表头校验全部完成后才保存月度明细，防止半份数据覆盖旧文件。
    const inbound = mergeApiTables(inboundTables);
    const outbound = mergeApiTables(outboundTables);
    const month = range.end.slice(0, 7);
    const inboundCsv = path.join(outDir, `${month}_装焊入库_API.csv`);
    const outboundCsv = path.join(outDir, `${month}_构件出库_API.csv`);
    await writeApiListCsv({ outPath: inboundCsv, ...inbound });
    await writeApiListCsv({ outPath: outboundCsv, ...outbound });
    logger.info(`收发存 API 合并完成：入库 ${inbound.rows.length} 行，出库 ${outbound.rows.length} 行`);
    return { inboundCsv, outboundCsv };
}

async function captureApiRequest(page, urlPart, trigger, timeout = 60000) {
    let captured = null;
    const handler = req => {
        try {
            const url = String(req.url() || '');
            if (!url.includes(urlPart)) return;
            const headers = req.headers ? req.headers() : {};
            captured = {
                url,
                headers,
                postData: req.postData ? req.postData() : ''
            };
        } catch {
            // ignore
        }
    };

    page.on('request', handler);
    try {
        await trigger();
        const startedAt = Date.now();
        while (!captured && Date.now() - startedAt < timeout) {
            await page.waitForTimeout(250);
        }
    } finally {
        page.off('request', handler);
    }

    if (!captured) {
        throw new Error(`未捕获到 API 请求：${urlPart}`);
    }
    return captured;
}

async function replayCapturedApiRequest(page, captured) {
    const cookies = await page.context().cookies();
    const cookieStr = cookies.map(item => `${item.name}=${item.value}`).join('; ');
    const headers = captured && captured.headers ? captured.headers : {};
    const token = headers.token || headers.Token || headers.TOKEN;
    if (!token) {
        throw new Error('重放 API 请求失败：未捕获到 Token');
    }

    const res = await page.request.post(captured.url, {
        data: captured.postData ? JSON.parse(captured.postData) : {},
        headers: {
            Token: token,
            'Content-Type': 'application/json;charset=utf-8',
            ...(cookieStr ? { Cookie: cookieStr } : {})
        },
        timeout: 60000
    });
    if (!res.ok()) throw new Error(`API 请求失败：HTTP ${res.status()}`);
    const body = await res.json();
    if (!body || body.code !== 0) {
        throw new Error(`API 返回失败：code=${body && body.code}`);
    }
    return body;
}

async function fetchSubworkStatisticsTable(browserAutomation, options = {}) {
    const page = browserAutomation.page;
    const url = config.website.subworkStatisticsUrl;
    if (!url) throw new Error('subworkStatisticsUrl 为空，请在 config/default.json 填写统计页面URL');

    logger.info(`导航到生产统计页面: ${url}`);
    await gotoWithRelogin(browserAutomation, url);
    logger.debug(`当前URL: ${page.url()}`);

    logger.info('统计部门勾选“钢结构厂”（精确匹配）...');
    await clickFormControlByLabel(page, '统计部门');
    await selectCascaderCheckboxByText(page, '钢结构厂', { exact: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    logger.info('工序选择“装焊报检”...');
    await clickFormControlByLabel(page, '工序');
    await selectDropdownOption(page, '装焊报检');

    const range = options.range || getLastMonth26ToThisMonth25(new Date());
    const start = range.start;
    const end = range.end;
    logger.info(`时间范围选择: ${start} 至 ${end}`);
    await setDateRangeByLabel(page, '时间范围', start, end);

    const queryBtn = page.locator('button:has-text("查询")').first();
    await queryBtn.waitFor({ state: 'visible', timeout: 15000 });

    logger.info('收发存入库：捕获装焊统计 API 请求...');
    const captured = await captureApiRequest(
        page,
        '/v1.statistical/getStatisticalDays',
        async () => {
            await queryBtn.click();
        }
    );
    const body = await replayCapturedApiRequest(page, captured);

    const packet = Array.isArray(body && body.data) ? body.data[0] : null;
    const headers = Array.isArray(packet && packet.headers) ? packet.headers : [];
    if (headers.length === 0) {
        throw new Error('装焊统计 API 返回缺少 headers');
    }
    if (!Array.isArray(packet.list)) {
        throw new Error('装焊统计 API 返回缺少 list');
    }
    const list = packet.list;

    const headerNames = ['#', ...headers.map(item => String(item && item.headerName || '').trim()).filter(Boolean)];
    const rows = list.map((item, index) => {
        const values = [index + 1];
        for (const col of headers) {
            const field = String(col && col.field || '').trim();
            values.push(field ? (item && Object.prototype.hasOwnProperty.call(item, field) ? item[field] : '') : '');
        }
        return values;
    });

    return { headerNames, rows };
}

async function exportSubworkStatisticsCsvViaApi(browserAutomation, options = {}) {
    const range = options.range || getLastMonth26ToThisMonth25(new Date());
    const { start, end } = range;
    const { headerNames, rows } = await fetchSubworkStatisticsTable(browserAutomation, { ...options, range });
    const desiredName = options.exportFileName || buildExportCsvName({ endYmd: end, label: '装焊入库' });
    const outDir = options.outDir
        ? (path.isAbsolute(options.outDir) ? options.outDir : path.join(__dirname, '..', options.outDir))
        : resolveDownloadDir();
    ensureDir(outDir);
    const savePath = options.exportOverwrite ? path.join(outDir, desiredName) : makeUniquePath(outDir, desiredName);
    await writeApiListCsv({ outPath: savePath, headerNames, rows });
    logger.success(`装焊统计 API CSV 已导出: ${savePath}`);
    return { start, end, savePath };
}

async function fetchOrderHistoryTable(browserAutomation, options = {}) {
    const page = browserAutomation.page;
    const url = config.website.orderHistoryUrl;
    if (!url) throw new Error('orderHistoryUrl 为空，请在 config/default.json 填写出入库记录页面URL');

    logger.info(`导航到出入库记录页面: ${url}`);
    await gotoWithRelogin(browserAutomation, url);
    logger.debug(`当前URL: ${page.url()}`);

    logger.info('构件状态选择“已出库”...');
    await clickFormControlByLabel(page, '构件状态');
    await selectDropdownOption(page, '已出库');

    const range = options.range || getLastMonth26ToThisMonth25(new Date());
    const { start, end } = range;
    logger.info(`日期范围选择: ${start} 至 ${end}`);
    await setDateRangeByLabel(page, '日期范围', start, end);

    const queryBtn = page.locator('button:has-text("查询")').first();
    await queryBtn.waitFor({ state: 'visible', timeout: 15000 });

    logger.info('收发存出库：捕获发货历史 API 请求...');
    const captured = await captureApiRequest(
        page,
        '/v1.order/getDeliveryHistory',
        async () => {
            await queryBtn.click();
        }
    );
    const body = await replayCapturedApiRequest(page, captured);

    const data = body && body.data;
    if (!Array.isArray(data && data.list)) {
        throw new Error('发货历史 API 返回缺少 list');
    }
    const list = data.list;
    const columns = [
        { headerName: '项目名称', field: 'project_name' },
        { headerName: '构件名称', field: '构件名称' },
        { headerName: '构件编号', field: '构件编号' },
        { headerName: '构件GUID', field: '构件GUID' },
        { headerName: '模型ID', field: '模型ID' },
        { headerName: '规格/型号', field: '规格/型号' },
        { headerName: '数量', field: '数量' },
        { headerName: '重量', field: '重量' },
        { headerName: '体积', field: '体积' },
        { headerName: '长度', field: '长度' },
        { headerName: '生产特征', field: '生产特征' },
        { headerName: '区域部位/所在楼层', field: '区域部位/所在楼层' },
        { headerName: '轴线范围', field: '轴线范围' },
        { headerName: '构件类型编码', field: '构件类型编码' },
        { headerName: '所属布置图', field: '所属布置图' },
        { headerName: '入库时间', field: 'complete_time_text' },
        { headerName: '出库时间', field: 'delivery_time_text' },
        { headerName: '操作人', field: 'delivery_username' }
    ];

    const headerNames = ['#', ''].concat(columns.map(item => item.headerName));
    const rows = list.map((item, index) => {
        const values = [index + 1, ''];
        for (const col of columns) {
            const field = String(col && col.field || '').trim();
            values.push(field ? (item && Object.prototype.hasOwnProperty.call(item, field) ? item[field] : '') : '');
        }
        return values;
    });

    return { headerNames, rows };
}

async function exportOrderHistoryCsvViaApi(browserAutomation, options = {}) {
    const range = options.range || getLastMonth26ToThisMonth25(new Date());
    const { headerNames, rows } = await fetchOrderHistoryTable(browserAutomation, { ...options, range });
    const desiredName = options.exportFileName || buildExportCsvName({ endYmd: range.end, label: '构件出库' });
    const outDir = options.outDir
        ? (path.isAbsolute(options.outDir) ? options.outDir : path.join(__dirname, '..', options.outDir))
        : resolveDownloadDir();
    ensureDir(outDir);
    const savePath = options.exportOverwrite ? path.join(outDir, desiredName) : makeUniquePath(outDir, desiredName);
    await writeApiListCsv({ outPath: savePath, headerNames, rows });
    logger.success(`发货历史 API CSV 已导出: ${savePath}`);
    return savePath;
}

async function gotoWithRelogin(browserAutomation, url) {
    const page = browserAutomation.page;
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    if (page.url().includes('/login')) {
        logger.warn(`访问 ${url} 时检测到登录态失效，准备自动重新登录...`);
        const ok = await browserAutomation.login();
        if (!ok) {
            throw new Error(`重新登录失败，无法继续访问：${url}`);
        }
        await page.goto(url);
        await page.waitForLoadState('networkidle');
    }
}

function formatWorkshopLabel(member) {
    if (!member) return '';
    const workshop = String(member.fitupWorkshopName || '').trim();
    const director = String(member.workshopDirectorName || member.workshopOwnerNameRaw || '').trim();
    if (workshop && director) return `${workshop}（${director}）`;
    return workshop || '';
}

async function exportDailyFitupCsvFromDb(options = {}) {
    const start = String(options.start || '').trim();
    const end = String(options.end || '').trim();
    const outPath = String(options.outPath || '').trim();
    if (!start || !end || !outPath) {
        throw new Error('exportDailyFitupCsvFromDb 缺少必要参数：start/end/outPath');
    }

    const sql = `
        ${buildLatestFitupEventCte({
            cteName: 'latest_fitup',
            currentStateBeforeSql: `($2::date + interval '1 day')`
        })}
        SELECT
            to_char(timezone('Asia/Shanghai', latest_fitup.event_at)::date, 'YYYY-MM-DD') AS report_date,
            COALESCE(NULLIF(trim(latest_fitup.team_name), ''), '未标记班组') AS team_name,
            COALESCE(sum(COALESCE(c.weight, 0) * c.quantity), 0)::numeric(18,3) AS total_weight
        FROM latest_fitup
        JOIN component c ON c.component_id = latest_fitup.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE latest_fitup.is_completed = true
          AND latest_fitup.event_at IS NOT NULL
          AND timezone('Asia/Shanghai', latest_fitup.event_at)::date >= $1::date
          AND timezone('Asia/Shanghai', latest_fitup.event_at)::date <= $2::date
          AND ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
        GROUP BY 1, 2
        ORDER BY report_date ASC, team_name ASC
    `;
    const res = await query(sql, [start, end]);

    const directory = await loadTeamDirectory();
    const workshopByTeam = new Map();
    for (const member of directory.members || []) {
        const teamName = String(member.fitupTeamName || '').trim();
        if (!teamName || workshopByTeam.has(teamName)) continue;
        const label = formatWorkshopLabel(member);
        if (label) workshopByTeam.set(teamName, label);
    }

    const lines = ['日期,车间,班组,重量'];
    for (const row of res.rows || []) {
        const dateStr = String(row.report_date || '').slice(0, 10);
        const teamName = String(row.team_name || '').trim() || '未标记班组';
        const workshopName = workshopByTeam.get(teamName) || '未标记车间';
        const weight = Number(row.total_weight || 0);
        lines.push([
            csvEscape(dateStr),
            csvEscape(workshopName),
            csvEscape(teamName),
            csvEscape(weight.toFixed(3))
        ].join(','));
    }

    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    logger.info(`数据库导出日报 CSV 完成：${outPath}（${res.rows.length} 行）`);
    return outPath;
}

async function exportGridCsv(page, options = {}) {
    const downloadDir = options.outDir
        ? (path.isAbsolute(options.outDir) ? options.outDir : path.join(__dirname, '..', options.outDir))
        : resolveDownloadDir();
    ensureDir(downloadDir);

    logger.info('准备导出 CSV：右键表格 -> 导出 -> CSV 导出');

    // 优先识别 ag-Grid（你提供的 DOM 截图显示为 ag-root/ag-grid）
    const agRoot = page.locator('.ag-root, .ag-root-wrapper, .ag-theme-alpine').first();
    const isAgGrid = await agRoot.count().then(c => c > 0).catch(() => false);

    if (isAgGrid) {
        logger.info('检测到 ag-Grid 表格，使用 ag-Grid 右键菜单导出...');
        await agRoot.waitFor({ state: 'visible', timeout: 20000 });

        const agBodyViewport = page.locator('.ag-body-viewport').first();
        const agRow = page.locator('.ag-center-cols-container .ag-row, .ag-body-viewport .ag-row').first();
        const agCell = page.locator('.ag-center-cols-container .ag-cell, .ag-body-viewport .ag-cell').first();
        const noRowsOverlay = page.locator('.ag-overlay-no-rows-center').first();
        const loadingOverlay = page.locator('.ag-overlay-loading-center').first();
        const requestOverlay = page.locator('text=正在处理请求').first();

        const waitForLoadingDone = async (timeout = 25000) => {
            try {
                await loadingOverlay.waitFor({ state: 'hidden', timeout });
            } catch {
                // ignore and let downstream checks decide whether rows/no-data are present
            }
            try {
                await requestOverlay.waitFor({ state: 'hidden', timeout });
            } catch {
                // ignore and let downstream checks decide whether rows/no-data are present
            }
        };

        const waitForGridReady = async () => {
            await waitForLoadingDone();
            // Prefer rows, since cells may not be immediately visible if virtualization hasn't kicked in.
            try {
                await agRow.waitFor({ state: 'visible', timeout: 25000 });
                return;
            } catch {
                // If there are no rows, overlay may appear. In that case we still allow export.
                try {
                    await noRowsOverlay.waitFor({ state: 'visible', timeout: 5000 });
                    return;
                } catch {
                    // fallthrough
                }
                // As a last resort, wait for any cell.
                await agCell.waitFor({ state: 'visible', timeout: 25000 });
            }
        };

        const isNoData = async () => {
            try {
                if (await noRowsOverlay.isVisible().catch(() => false)) return true;
            } catch {
                // ignore
            }
            try {
                if (await loadingOverlay.isVisible().catch(() => false)) return false;
            } catch {
                // ignore
            }
            try {
                if (await requestOverlay.isVisible().catch(() => false)) return false;
            } catch {
                // ignore
            }
            const noDataText = page.locator('text=没有相关数据, text=暂无数据, text=无数据').first();
            try {
                return await noDataText.isVisible().catch(() => false);
            } catch {
                return false;
            }
        };

        const writeEmptyCsv = async () => {
            const desiredName = buildExportCsvName(options);
            const overwrite = Boolean(options.overwrite);
            const savePath = overwrite ? path.join(downloadDir, desiredName) : makeUniquePath(downloadDir, desiredName);
            const header = '项目名称,重量\n';
            if (overwrite && fs.existsSync(savePath)) {
                try {
                    fs.unlinkSync(savePath);
                } catch {
                    // ignore
                }
            }
            fs.writeFileSync(savePath, header, 'utf8');
            logger.warn(`查询结果为空，已生成空 CSV: ${savePath}`);
            return savePath;
        };

        try {
            await waitForGridReady();
        } catch (e) {
            // Retry once: sometimes the query finishes but grid virtual rows render late.
            logger.warn(`ag-Grid 渲染等待超时，尝试重试一次查询后导出... (${e.message})`);
            const queryBtn = page.locator('button:has-text("查询")').first();
            try {
                await queryBtn.waitFor({ state: 'visible', timeout: 15000 });
                await queryBtn.click();
            } catch {
                // ignore
            }
            await page.waitForLoadState('networkidle');
            await waitForGridReady();
        }

        // If query result is empty, don't wait for cells / context menu; just write an empty CSV.
        await waitForLoadingDone();
        if (await isNoData()) {
            return await writeEmptyCsv();
        }

        // Trigger virtualization render by focusing/scrolling the grid body.
        try {
            await agBodyViewport.scrollIntoViewIfNeeded();
            await page.mouse.wheel(0, 200);
            await page.mouse.wheel(0, -200);
        } catch {
            // ignore
        }

        await agCell.waitFor({ state: 'visible', timeout: 25000 });
        await agCell.click({ button: 'right' });

        const exportItem = page.locator('.ag-menu-option-text:has-text("导出"), .ag-menu-option-text:has-text("Export")').first();
        await exportItem.waitFor({ state: 'visible', timeout: 15000 });
        await exportItem.hover();

        const csvItem = page.locator(
            '.ag-menu-option-text:has-text("CSV"), .ag-menu-option-text:has-text("csv")'
        ).filter({ hasText: 'CSV' }).first();

        // 有些版本菜单项文字是“CSV 导出/CSV Export”
        const csvItem2 = page.locator(
            '.ag-menu-option-text:has-text("CSV 导出"), .ag-menu-option-text:has-text("CSV Export"), .ag-menu-option-text:has-text("csv 导出")'
        ).first();

        const downloadPromise = page.waitForEvent('download', { timeout: 60000 });

        try {
            await csvItem2.waitFor({ state: 'visible', timeout: 5000 });
            await csvItem2.click();
        } catch {
            await csvItem.waitFor({ state: 'visible', timeout: 15000 });
            await csvItem.click();
        }

        const download = await downloadPromise;

        const desiredName = buildExportCsvName(options);
        const overwrite = Boolean(options.overwrite);
        const savePath = overwrite ? path.join(downloadDir, desiredName) : makeUniquePath(downloadDir, desiredName);

        if (overwrite && fs.existsSync(savePath)) {
            try {
                fs.unlinkSync(savePath);
            } catch {
                // ignore
            }
        }

        await download.saveAs(savePath);
        logger.success(`CSV 已导出: ${savePath}`);
        return savePath;
    }

    // 等待结果表格出现：不同页面/版本 class 可能不同，这里用多个锚点
    // 1) Element-UI：.el-table__body-wrapper / .el-table__row
    // 2) 兜底：页面内任意 table
    const anchors = [
        page.locator('.el-table__body-wrapper').first(),
        page.locator('.el-table__row').first(),
        page.locator('table').first()
    ];

    let anchorFound = false;
    for (const anchor of anchors) {
        try {
            await anchor.waitFor({ state: 'visible', timeout: 8000 });
            anchorFound = true;
            break;
        } catch {
            continue;
        }
    }

    if (!anchorFound) {
        await saveDebugScreenshot(page, 'export_csv_table_not_found');
        const elTableCount = await page.locator('.el-table').count();
        const elBodyCount = await page.locator('.el-table__body-wrapper').count();
        const tableCount = await page.locator('table').count();
        throw new Error(`未检测到结果表格（.el-table=${elTableCount}, .el-table__body-wrapper=${elBodyCount}, table=${tableCount}）`);
    }

    // 在表格单元格上右键，触发上下文菜单（优先 Element-UI 单元格）
    const cell = page.locator('.el-table__body-wrapper td').first();
    try {
        await cell.waitFor({ state: 'visible', timeout: 10000 });
        await cell.click({ button: 'right' });
    } catch {
        const fallbackCell = page.locator('table td').first();
        await fallbackCell.waitFor({ state: 'visible', timeout: 15000 });
        await fallbackCell.click({ button: 'right' });
    }

    // 菜单项“导出”
    const exportMenu = page.locator('li:has-text("导出")').first();
    await exportMenu.waitFor({ state: 'visible', timeout: 15000 });
    await exportMenu.hover();

    // 子菜单“csv 导出”（截图显示是小写 csv）
    const csvItem = page.locator('li:has-text("csv 导出"), li:has-text("CSV 导出")').first();
    await csvItem.waitFor({ state: 'visible', timeout: 15000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await csvItem.click();
    const download = await downloadPromise;

    const desiredName = buildExportCsvName(options);
    const overwrite = Boolean(options.overwrite);
    const savePath = overwrite ? path.join(downloadDir, desiredName) : makeUniquePath(downloadDir, desiredName);

    if (overwrite && fs.existsSync(savePath)) {
        try {
            fs.unlinkSync(savePath);
        } catch {
            // ignore
        }
    }

    await download.saveAs(savePath);
    logger.success(`CSV 已导出: ${savePath}`);
    return savePath;
}

async function exportStatisticsCsv(page, options = {}) {
    return exportGridCsv(page, { ...options, label: options.label || '装焊入库' });
}

function formatYmd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getLastMonth26ToThisMonth25(today = new Date()) {
    const thisMonth25 = new Date(today.getFullYear(), today.getMonth(), 25);
    const lastMonth26 = new Date(today.getFullYear(), today.getMonth() - 1, 26);
    return {
        start: formatYmd(lastMonth26),
        end: formatYmd(thisMonth25)
    };
}

function getMonth26ToMonth25ByEndYmd(endYmd) {
    const m = String(endYmd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error(`无效日期: ${endYmd}，期望格式 YYYY-MM-DD`);
    const y = Number(m[1]);
    const mon = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mon) || !Number.isFinite(d)) {
        throw new Error(`无效日期: ${endYmd}`);
    }
    // 收发存周期固定到 25 日（上月26日至本月25日）
    if (d !== 25) {
        throw new Error(`收发存 end 必须是当月25日：收到 ${endYmd}`);
    }
    const endDate = new Date(y, mon - 1, 25);
    const startDate = new Date(y, mon - 2, 26);
    return { start: formatYmd(startDate), end: formatYmd(endDate) };
}

function getMonth26ToMonth25ByMonthKey(monthKey) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error(`无效月份: ${monthKey}，期望格式 YYYY-MM`);
    const y = Number(m[1]);
    const mon = Number(m[2]);
    if (!Number.isFinite(y) || !Number.isFinite(mon) || mon < 1 || mon > 12) {
        throw new Error(`无效月份: ${monthKey}`);
    }
    const endDate = new Date(y, mon - 1, 25);
    const startDate = new Date(y, mon - 2, 26);
    return { start: formatYmd(startDate), end: formatYmd(endDate) };
}

function getFactoryMonth26ToToday(today = new Date()) {
    // 工厂月份：上月26日至本月25日
    // 若今天>=26号，则本周期从本月26号开始；否则从上月26号开始。
    const isAfterOrOn26 = today.getDate() >= 26;
    const startDate = isAfterOrOn26
        ? new Date(today.getFullYear(), today.getMonth(), 26)
        : new Date(today.getFullYear(), today.getMonth() - 1, 26);
    return {
        start: formatYmd(startDate),
        end: formatYmd(today)
    };
}

function parseYmdToLocalDate(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
        throw new Error(`无效日期: ${ymd}，期望格式 YYYY-MM-DD`);
    }
    const y = Number(m[1]);
    const mon = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mon) || !Number.isFinite(d)) {
        throw new Error(`无效日期: ${ymd}`);
    }
    return new Date(y, mon - 1, d);
}

async function clickControlNearText(page, labelText) {
    const candidates = [
        `xpath=//*[normalize-space()="${labelText}：" or normalize-space()="${labelText}:"]/following-sibling::*[1]`,
        `xpath=//*[contains(normalize-space(),"${labelText}：") or contains(normalize-space(),"${labelText}:")]/following-sibling::*[1]`,
        `xpath=//*[normalize-space()="${labelText}"]/following-sibling::*[1]`
    ];

    for (const selector of candidates) {
        const el = page.locator(selector).first();
        try {
            await el.waitFor({ state: 'visible', timeout: 3000 });
            await el.click({ force: true });
            return el;
        } catch {
            continue;
        }
    }

    // 有些控件在 label 后面不是 sibling，而是同一行更后面的 input/select
    const inputFallback = page.locator(
        `xpath=//*[normalize-space()="${labelText}：" or normalize-space()="${labelText}:"]/following::*[self::input or self::div][1]`
    ).first();
    await inputFallback.waitFor({ state: 'visible', timeout: 15000 });
    await inputFallback.click({ force: true });
    return inputFallback;
}

async function clickFormControlByLabel(page, labelText) {
    // 1) 优先尝试 Element-UI 的 el-form 结构（如果页面刚好是该结构）
    const label = page.locator(`.el-form-item__label:has-text("${labelText}")`).first();
    try {
        await label.waitFor({ state: 'visible', timeout: 2000 });
        const item = label.locator('..');
        const control = item.locator('.el-form-item__content').first();
        await control.click({ force: true });
        return item;
    } catch {
        // 2) 生产统计页是“文字+冒号+控件”的布局，走通用 xpath
        await clickControlNearText(page, labelText);
        return null;
    }
}

async function readSelectedCascaderValues(page, labelText) {
    const escaped = escapeRegExp(labelText);
    const item = page.locator(
        `xpath=//*[contains(@class,"el-form-item")][.//*[contains(@class,"el-form-item__label") and normalize-space()="${labelText}"]]`
    ).first();

    try {
        await item.waitFor({ state: 'visible', timeout: 2000 });
        const tags = item.locator('.el-cascader .el-tag .el-tag__content');
        const count = await tags.count();
        const values = [];
        for (let i = 0; i < count; i++) {
            const text = (await tags.nth(i).innerText()).trim();
            if (text) values.push(text);
        }
        if (values.length > 0) return values;
    } catch {
        // fallback to generic text extractor below
    }

    const fallback = page.locator(
        `xpath=//*[contains(normalize-space(),"${labelText}：") or contains(normalize-space(),"${labelText}:")]/following::*[contains(@class,"el-cascader")][1]//*[contains(@class,"el-tag__content") or contains(@class,"el-input__inner")]`
    );
    const fallbackCount = await fallback.count().catch(() => 0);
    const values = [];
    for (let i = 0; i < fallbackCount; i++) {
        const t = ((await fallback.nth(i).innerText().catch(() => '')) || '').trim();
        if (t) values.push(t);
    }
    return [...new Set(values.filter(v => !new RegExp(escaped).test(v)))];
}

async function selectDropdownOption(page, optionText) {
    // 根据你截图：<li class="el-select-dropdown__item"> <span>装焊报检</span> </li>
    // 同时页面可能存在多个下拉层（有的隐藏），这里只点击可见项
    const candidates = page.locator('.el-select-dropdown__item span').filter({ hasText: optionText });
    await candidates.first().waitFor({ state: 'attached', timeout: 15000 });

    const count = await candidates.count();
    for (let i = 0; i < count; i++) {
        const span = candidates.nth(i);
        if (await span.isVisible()) {
            await span.click({ force: true });
            return;
        }
    }

    // 兜底：如果 span 不可点击，尝试点击父 li
    const liFallback = page.locator('.el-select-dropdown__item').filter({ hasText: optionText }).first();
    await liFallback.waitFor({ state: 'visible', timeout: 15000 });
    await liFallback.click({ force: true });
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function selectCascaderCheckboxByText(page, optionText, options = {}) {
    const exact = Boolean(options.exact);
    const labelSelector = '.el-cascader-panel .el-cascader-node__label';
    const nodeLabel = exact
        ? page.locator(labelSelector).filter({ hasText: new RegExp(`^\\s*${escapeRegExp(optionText)}\\s*$`) }).first()
        : page.locator(`${labelSelector}:has-text("${optionText}")`).first();

    // 你的页面级联项文字在 span.el-cascader-node__label 里
    await nodeLabel.waitFor({ state: 'visible', timeout: 15000 });

    const node = nodeLabel.locator('xpath=ancestor::li[contains(@class,"el-cascader-node")][1]').first();
    const checkboxInput = node.locator('.el-checkbox__input').first();
    const checkboxInner = node.locator('.el-checkbox__inner').first();

    const isChecked = async () => {
        try {
            const cls = await checkboxInput.getAttribute('class');
            return typeof cls === 'string' && cls.includes('is-checked');
        } catch {
            return false;
        }
    };

    // 尝试点击同一节点上的 checkbox（多选级联常见结构），直到进入选中态
    try {
        await checkboxInner.waitFor({ state: 'visible', timeout: 2000 });
        if (!(await isChecked())) {
            await checkboxInner.click({ force: true });
        }
        if (!(await isChecked())) {
            await checkboxInput.click({ force: true });
        }
        if (!(await isChecked())) {
            await nodeLabel.click({ force: true });
        }
        if (await isChecked()) {
            return;
        }
    } catch {
        // ignore and fall through to label click
    }

    // 没有 checkbox 或 checkbox 无法稳定点击时，点击 label 本身也可能是选择
    await nodeLabel.click({ force: true });
}

async function setDateRangeByLabel(page, labelText, startYmd, endYmd) {
    // 1) 优先用 placeholder（从你截图看是“开始日期 / 结束日期”）
    const startInput = page.locator('input[placeholder="开始日期"]').first();
    const endInput = page.locator('input[placeholder="结束日期"]').first();
    try {
        await startInput.waitFor({ state: 'visible', timeout: 3000 });
        await endInput.waitFor({ state: 'visible', timeout: 3000 });

        for (const [input, value] of [[startInput, startYmd], [endInput, endYmd]]) {
            try {
                await input.fill(value);
            } catch {
                await page.evaluate(el => el.removeAttribute('readonly'), await input.elementHandle());
                await input.fill(value);
            }
        }
        await endInput.press('Enter');
        return;
    } catch {
        // 2) 如果 placeholder 不一致，退回到“时间范围”附近查找
        await clickControlNearText(page, labelText);
        const inputs = page.locator('.el-date-editor input');
        const count = await inputs.count();
        if (count < 2) {
            throw new Error(`未找到日期范围输入框（${labelText}）`);
        }

        for (const [idx, value] of [[0, startYmd], [1, endYmd]]) {
            const input = inputs.nth(idx);
            try {
                await input.fill(value);
            } catch {
                await page.evaluate(el => el.removeAttribute('readonly'), await input.elementHandle());
                await input.fill(value);
            }
        }

        await inputs.nth(1).press('Enter');
    }
}

async function runSubworkStatistics(browserAutomation, options = {}) {
    if (!options.forceWebExport) {
        try {
            return await exportSubworkStatisticsCsvViaApi(browserAutomation, options);
        } catch (error) {
            logger.warn(`装焊统计 API 导出失败，回退网页导出：${error && error.message ? error.message : String(error)}`);
        }
    }

    const page = browserAutomation.page;
    const url = config.website.subworkStatisticsUrl;
    if (!url) {
        throw new Error('subworkStatisticsUrl 为空，请在 config/default.json 填写统计页面URL');
    }

    try {
        logger.info(`导航到生产统计页面: ${url}`);
        await gotoWithRelogin(browserAutomation, url);
        logger.debug(`当前URL: ${page.url()}`);

        logger.info('统计部门勾选“钢结构厂”（精确匹配）...');
        await clickFormControlByLabel(page, '统计部门');
        await selectCascaderCheckboxByText(page, '钢结构厂', { exact: true });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const selectedDepartments = await readSelectedCascaderValues(page, '统计部门');
        logger.info(`统计部门当前选中：${selectedDepartments.length ? selectedDepartments.join('、') : '（未读取到）'}`);
        if (selectedDepartments.length === 0) {
            await saveDebugScreenshot(page, 'subwork_statistics_department_unreadable');
        }

        logger.info('工序选择“装焊报检”...');
        await clickFormControlByLabel(page, '工序');
        await selectDropdownOption(page, '装焊报检');

        const range = options.range || getLastMonth26ToThisMonth25(new Date());
        const start = range.start;
        const end = range.end;
        logger.info(`时间范围选择: ${start} 至 ${end}`);
        await setDateRangeByLabel(page, '时间范围', start, end);
        await saveDebugScreenshot(page, 'subwork_statistics_before_query');

        logger.info('点击查询...');
        const queryBtn = page.locator('button:has-text("查询")').first();
        await queryBtn.waitFor({ state: 'visible', timeout: 15000 });
        await queryBtn.click();

        await page.waitForLoadState('networkidle');
        await saveDebugScreenshot(page, 'subwork_statistics_after_query');

        const shouldExportCsv = Boolean(config.behavior && config.behavior.exportCsvAfterStatistics);
        if (shouldExportCsv) {
            const savePath = await exportStatisticsCsv(page, {
                endYmd: end,
                fileName: options.exportFileName,
                overwrite: options.exportOverwrite,
                outDir: options.outDir
            });
            return { start, end, savePath };
        }

        await saveDebugScreenshot(page, 'subwork_statistics_after_query');
        logger.success('统计页面查询已触发');
        return { start, end, savePath: null };
    } catch (error) {
        logger.error(`统计页自动化失败: ${error.message}`);
        logger.error(`失败时URL: ${page.url()}`);
        try {
            await saveDebugScreenshot(page, 'subwork_statistics_error');
        } catch (screenshotErr) {
            logger.warn(`失败截图保存失败: ${screenshotErr.message}`);
        }
        throw error;
    }
}

async function runOrderHistoryExport(browserAutomation, options = {}) {
    if (!options.forceWebExport) {
        try {
            return await exportOrderHistoryCsvViaApi(browserAutomation, options);
        } catch (error) {
            logger.warn(`发货历史 API 导出失败，回退网页导出：${error && error.message ? error.message : String(error)}`);
        }
    }

    const page = browserAutomation.page;
    const url = config.website.orderHistoryUrl;
    if (!url) {
        throw new Error('orderHistoryUrl 为空，请在 config/default.json 填写出入库记录页面URL');
    }

    try {
        logger.info(`导航到出入库记录页面: ${url}`);
        await gotoWithRelogin(browserAutomation, url);
        logger.debug(`当前URL: ${page.url()}`);

        logger.info('构件状态选择“已出库”...');
        await clickFormControlByLabel(page, '构件状态');
        await selectDropdownOption(page, '已出库');

        const range = options.range || getLastMonth26ToThisMonth25(new Date());
        const { start, end } = range;
        logger.info(`日期范围选择: ${start} 至 ${end}`);
        await setDateRangeByLabel(page, '日期范围', start, end);

        logger.info('点击查询...');
        const queryBtn = page.locator('button:has-text("查询")').first();
        await queryBtn.waitFor({ state: 'visible', timeout: 15000 });
        await queryBtn.click();
        await page.waitForLoadState('networkidle');

        const savePath = await exportGridCsv(page, {
            endYmd: end,
            label: '构件出库',
            fileName: options.exportFileName,
            overwrite: options.exportOverwrite,
            outDir: options.outDir
        });
        await saveDebugScreenshot(page, 'order_history_after_export');
        logger.success('出入库记录页导出已完成');
        return savePath;
    } catch (error) {
        logger.error(`出入库记录页自动化失败: ${error.message}`);
        logger.error(`失败时URL: ${page.url()}`);
        try {
            await saveDebugScreenshot(page, 'order_history_error');
        } catch (screenshotErr) {
            logger.warn(`失败截图保存失败: ${screenshotErr.message}`);
        }
        throw error;
    }
}

async function downloadInbound(browserAutomation) {
    if (!config.website.inboundUrl) {
        throw new Error('inboundUrl 为空，请在 config/default.json 填写入库数据页面URL');
    }

    logger.info(`打开入库数据页面: ${config.website.inboundUrl}`);
    await browserAutomation.page.goto(config.website.inboundUrl);
    await browserAutomation.page.waitForLoadState('networkidle');

    // TODO: 根据页面“导出/下载”按钮或接口实现
    logger.warn('downloadInbound 尚未实现：需要你提供导出按钮/接口信息');
}

async function downloadOutbound(browserAutomation) {
    if (!config.website.outboundUrl) {
        throw new Error('outboundUrl 为空，请在 config/default.json 填写发货数据页面URL');
    }

    logger.info(`打开发货数据页面: ${config.website.outboundUrl}`);
    await browserAutomation.page.goto(config.website.outboundUrl);
    await browserAutomation.page.waitForLoadState('networkidle');

    // TODO: 根据页面“导出/下载”按钮或接口实现
    logger.warn('downloadOutbound 尚未实现：需要你提供导出按钮/接口信息');
}

async function main() {
    ensureDirectories();

    const args = parseArgs(process.argv);
    const dailyMode = Boolean(args.daily);
    const shoufacunMode = Boolean(args.shoufacun);

    if (dailyMode) {
        const now = args.date ? parseYmdToLocalDate(args.date) : new Date();
        const { start, end } = getFactoryMonth26ToToday(now);
        const exportFileName = `${start}至${end}_装焊入库.csv`;
        const archiveDir = getDailyArchiveDir(end);
        ensureDir(archiveDir);

        logger.info(`每日模式：数据库查询范围 ${start} 至 ${end}，文件名 ${exportFileName}`);

        const csvPath = path.join(archiveDir, exportFileName);
        const reportOut = path.join(archiveDir, `日报_${end}_装焊入库重量.xlsx`);
        await exportDailyFitupCsvFromDb({ start, end, outPath: csvPath });

        logger.info(`生成当日日报：${reportOut}`);
        const { spawnSync } = require('child_process');
        const fillScript = path.join(__dirname, 'fill-daily-template-from-csv-exceljs.js');
        const r = spawnSync(
            'node',
            [
                fillScript,
                '--csv',
                csvPath,
                '--out',
                reportOut
            ],
            { stdio: 'inherit' }
        );
        if (r.status !== 0) {
            throw new Error(`日报生成失败，退出码: ${r.status}`);
        }

        try {
            const { exportXlsxToPng } = require('./wechat-notify');
            const pngOut = path.join(archiveDir, `日报_${end}_装焊入库重量.png`);
            logger.info(`导出日报图片：${pngOut}`);
            exportXlsxToPng({ inputXlsx: reportOut, outputPng: pngOut });
        } catch (e) {
            logger.warn(`导出日报图片失败（已忽略，不影响主流程）：${e && e.message ? e.message : String(e)}`);
        }

        try {
            const notifyCfg = config && config.notify && config.notify.wechat;
            const { getWechatTargets } = require('./wechat-recipients');
            const targets = getWechatTargets(config, { kind: 'daily', projectRoot: path.join(__dirname, '..') });
            const enabled = Boolean(notifyCfg && notifyCfg.enabled && notifyCfg.daily && notifyCfg.daily.enabled);
            if (enabled && targets.length > 0) {
                logger.info(`微信发送：日报接收人=${targets.join(',')}`);
                const { sendWechatFileBatch } = require('./wechat-notify');
                const pngOut = path.join(archiveDir, `日报_${end}_装焊入库重量.png`);
                sendWechatFileBatch(config, {
                    targets,
                    filePath: pngOut
                });
                logger.success('微信发送：日报图片已发送');
            }
        } catch (e) {
            logger.warn(`微信发送：日报图片发送失败（已忽略，不影响主流程）：${e && e.message ? e.message : String(e)}`);
        }

        logger.success('流程执行结束');
        return;
    }

    const browserAutomation = new BrowserAutomation(shoufacunMode
        ? { ...config, browser: { ...config.browser, headless: true } }
        : config);

    try {
        const started = await browserAutomation.launchBrowser();
        if (!started) {
            throw new Error('浏览器启动失败');
        }

        const maxLoginRetries = 3;
        let loginSuccess = false;
        for (let retry = 1; retry <= maxLoginRetries; retry++) {
            logger.info(`尝试登录 (${retry}/${maxLoginRetries})...`);
            loginSuccess = await browserAutomation.login();
            if (loginSuccess) {
                break;
            }
            if (retry < maxLoginRetries) {
                const waitMs = retry * 2000;
                logger.warn(`登录失败，${waitMs / 1000} 秒后重试...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }

        if (!loginSuccess) {
            throw new Error(`登录失败：已重试 ${maxLoginRetries} 次`);
        }

        if (false && dailyMode) {
            /*
             * 历史方案（网页自动化导出 CSV）暂时停用，不删除，方便后续排查页面异常时恢复：
             * - runSubworkStatistics(browserAutomation, { range, exportFileName, ... })
             * - 使用 result.savePath 生成日报
             */
        } else if (shoufacunMode) {
            const now = new Date();
            const shoufacunEnd = args['shoufacun-end'] || args['end'];
            const shoufacunMonth = args['shoufacun-month'] || args['month'];
            const { start, end } = shoufacunEnd
                ? getMonth26ToMonth25ByEndYmd(shoufacunEnd)
                : (shoufacunMonth ? getMonth26ToMonth25ByMonthKey(shoufacunMonth) : getLastMonth26ToThisMonth25(now));

            const archiveDir = getDailyArchiveDir(end);
            ensureDir(archiveDir);

            logger.info(`收发存 API 模式：${start} 至 ${end}，按 26—5 日、6—15 日、16—25 日分三段取数`);
            const { inboundCsv, outboundCsv } = await exportShoufacunApiCsvs(
                browserAutomation, { start, end }, archiveDir
            );

            const { generateShoufacunReport } = require('./generate-shoufacun-report-exceljs');
            const templatePath = path.join(__dirname, '..', '收发存模板.xlsx');
            const explicitLastMonthPath = args['last-month'] ? path.resolve(args['last-month']) : null;

            const prevEnd = addMonths(end, -1);
            const prevArchiveDir = prevEnd ? getDailyArchiveDir(prevEnd) : null;
            const autoLastMonthPath = prevArchiveDir ? findLatestShoufacunXlsx(prevArchiveDir) : null;
            const lastMonthPath = explicitLastMonthPath || autoLastMonthPath;

            if (!explicitLastMonthPath && autoLastMonthPath) {
                logger.info(`收发存模式：自动找到上月收发存文件用于回填：${autoLastMonthPath}`);
            }

            const parseYmd = (s) => {
                const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (!m) return null;
                return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
            };

            const sObj = parseYmd(start);
            const eObj = parseYmd(end);
            const periodText = (sObj && eObj)
                ? `周期：${sObj.y}年${sObj.m}月${sObj.d}日—${eObj.m}月${eObj.d}日  ${eObj.m}月份`
                : null;

            logger.info('收发存模式：开始生成收发存报表...');
            const outPath = await generateShoufacunReport({
                inboundCsv,
                outboundCsv,
                templatePath,
                outDir: archiveDir,
                lastMonthPath,
                periodText,
                outputFileName: `${end.slice(0, 7).replace('-', '')}收发存报表${args['from-api'] ? '_API' : ''}.xlsx`
            });
            logger.success(`收发存报表已生成: ${outPath}`);

            try {
                const notifyCfg = config && config.notify && config.notify.wechat;
                const { getWechatTargets } = require('./wechat-recipients');
                const targets = getWechatTargets(config, { kind: 'shoufacun', projectRoot: path.join(__dirname, '..') });
                const enabled = Boolean(notifyCfg && notifyCfg.enabled && notifyCfg.shoufacun && notifyCfg.shoufacun.enabled);
                if (args['from-api'] && enabled && targets.length > 0) {
                    logger.info(`微信发送：收发存接收人=${targets.join(',')}`);
                    const { sendWechatFileBatch } = require('./wechat-notify');
                    sendWechatFileBatch(config, {
                        targets,
                        filePath: outPath
                    });
                    logger.success('微信发送：收发存报表已发送');
                }
            } catch (e) {
                logger.warn(`微信发送：收发存报表发送失败（已忽略，不影响主流程）：${e && e.message ? e.message : String(e)}`);
            }
        } else {
            await runSubworkStatistics(browserAutomation);
        }

        const shouldExportOrderHistory = !dailyMode && !shoufacunMode && Boolean(config.behavior && config.behavior.exportOrderHistoryCsv);
        if (shouldExportOrderHistory) {
            await runOrderHistoryExport(browserAutomation);
        }

        const skipDownloads = Boolean(config.behavior && config.behavior.skipDownloads);
        if (!skipDownloads) {
            await downloadInbound(browserAutomation);
            await downloadOutbound(browserAutomation);
        } else {
            logger.warn('已按配置跳过下载步骤（behavior.skipDownloads=true）');
        }

        const keepOpen = !dailyMode && !shoufacunMode && Boolean(config.behavior && config.behavior.keepBrowserOpenAfterStatistics);
        if (keepOpen) {
            logger.info('已按配置保持浏览器打开：按回车键后退出...');
            await new Promise(resolve => {
                process.stdin.resume();
                process.stdin.once('data', () => resolve());
            });
        }

        logger.success('流程执行结束');
    } finally {
        await browserAutomation.closeBrowser();
    }
}

main().catch(err => {
    logger.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
});
