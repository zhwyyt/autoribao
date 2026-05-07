/**
 * 独立脚本：登录东吴云 → 打开生产计划详情页（ag-Grid）→ 提取表头与数据 → 导出 Excel
 *
 * 用法：
 *   node src/extract-production-plan-info.js --id 7639
 *   npm run extract-production-plan-info -- --id 7639
 */
const path = require('path');
const fs = require('fs');

const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');
const ExcelJS = require('exceljs');

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (!a || !a.startsWith('--')) continue;
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

function ensureDir(dir) {
    if (!dir) return;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`创建目录: ${dir}`);
    }
}

function getOutputDir() {
    const configured = (config.files && config.files.downloadFolder) ? config.files.downloadFolder : './downloads';
    const dir = path.isAbsolute(configured) ? configured : path.join(__dirname, '..', configured);
    ensureDir(dir);
    return dir;
}

function formatTimestamp() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}${m}${day}_${h}${min}`;
}

function buildUrl(id) {
    return `https://dwyunsc.ddwjzkj.com:22222/production/plan/info?id=${encodeURIComponent(String(id))}`;
}

function getOutputPath(id) {
    return path.join(getOutputDir(), `production_plan_info_${id}_${formatTimestamp()}.xlsx`);
}

async function extractAgGrid(page) {
    // 等待 ag-Grid 出现
    const root = page.locator('.ag-root[role=\"grid\"], .ag-root-wrapper, .ag-theme-alpine').first();
    await root.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // 优先：直接调用 ag-Grid 的 gridOptions.api 读取完整数据（不受虚拟滚动影响）
    const viaApi = await page.evaluate(() => {
        function findGridApi() {
            const roots = Array.from(document.querySelectorAll('.ag-root[role=\"grid\"], .ag-root-wrapper, .ag-theme-alpine'));
            if (!roots.length) return null;

            function getMetrics(el) {
                const ariaCol = Number(el.getAttribute('aria-colcount') || 0);
                const ariaRow = Number(el.getAttribute('aria-rowcount') || 0);
                const rect = el.getBoundingClientRect();
                const area = Math.max(0, rect.width) * Math.max(0, rect.height);
                return { ariaCol, ariaRow, area };
            }

            // 优先选择“列数最多/面积最大”的 grid root（避免页面有多个 grid 时拿错）
            const sorted = roots
                .map(r => ({ r, m: getMetrics(r) }))
                .sort((a, b) => (b.m.ariaCol - a.m.ariaCol) || (b.m.area - a.m.area) || (b.m.ariaRow - a.m.ariaRow));

            function tryExtract(holder, rootEl) {
                if (!holder) return null;
                // Some builds expose { gridOptions: { api, columnApi } }
                if (holder.gridOptions && holder.gridOptions.api && holder.gridOptions.columnApi) {
                    return { api: holder.gridOptions.api, columnApi: holder.gridOptions.columnApi, rootMetrics: rootEl ? getMetrics(rootEl) : null };
                }
                // Others expose { api, columnApi } directly
                if (holder.api && typeof holder.api.forEachNode === 'function' && holder.columnApi) {
                    return { api: holder.api, columnApi: holder.columnApi, rootMetrics: rootEl ? getMetrics(rootEl) : null };
                }
                // Or nested services (best-effort)
                if (holder.gridOptionsService && holder.gridOptionsService.gridOptions && holder.gridOptionsService.gridOptions.api && holder.gridOptionsService.gridOptions.columnApi) {
                    return { api: holder.gridOptionsService.gridOptions.api, columnApi: holder.gridOptionsService.gridOptions.columnApi, rootMetrics: rootEl ? getMetrics(rootEl) : null };
                }
                // In many ag-Grid builds, API is retrievable via context beans.
                try {
                    const ctx = holder.context || (holder.ctrl && holder.ctrl.context) || null;
                    if (ctx && typeof ctx.getBean === 'function') {
                        const gridApi = ctx.getBean('gridApi') || ctx.getBean('api') || null;
                        const columnApi = ctx.getBean('columnApi') || null;
                        if (gridApi && typeof gridApi.forEachNode === 'function' && columnApi) {
                            return { api: gridApi, columnApi, rootMetrics: rootEl ? getMetrics(rootEl) : null, via: 'context.getBean' };
                        }
                    }
                } catch {
                    // ignore
                }
                return null;
            }

            for (const { r } of sorted) {
                // Common instance property names across bundlers/minifiers
                const candidates = [
                    r.__agComponent,
                    r.__agGridInstance,
                    r.__agGridComponent,
                    r.__ag_grid_instance
                ];
                for (const c of candidates) {
                    const ok = tryExtract(c, r);
                    if (ok) return ok;
                }

                // If runtime attached instance under a different __ag* key, probe them.
                try {
                    const keys = Object.keys(r).filter(k => k.startsWith('__ag'));
                    for (const k of keys) {
                        const ok = tryExtract(r[k], r);
                        if (ok) return ok;
                    }
                } catch {
                    // ignore
                }

                // 有些版本把组件挂在父节点
                const parent = r.parentElement;
                if (parent) {
                    const parentCandidates = [
                        parent.__agComponent,
                        parent.__agGridInstance,
                        parent.__agGridComponent,
                        parent.__ag_grid_instance
                    ];
                    for (const c of parentCandidates) {
                        const ok = tryExtract(c, r);
                        if (ok) return ok;
                    }
                    try {
                        const keys = Object.keys(parent).filter(k => k.startsWith('__ag'));
                        for (const k of keys) {
                            const ok = tryExtract(parent[k], r);
                            if (ok) return ok;
                        }
                    } catch {
                        // ignore
                    }
                }
            }
            // 兜底：从 window 上找带 api.forEachNode 的对象
            for (const k of Object.keys(window)) {
                const v = window[k];
                if (v && v.api && typeof v.api.forEachNode === 'function' && v.columnApi) {
                    return { api: v.api, columnApi: v.columnApi, rootMetrics: null };
                }
            }
            return null;
        }

        const holder = findGridApi();
        if (!holder) return null;
        const { api, columnApi, rootMetrics } = holder;

        // 列顺序用“左固定 + 中间 + 右固定”，覆盖水平滚动所有显示列
        const cols = []
            .concat(columnApi.getAllDisplayedLeftColumns ? columnApi.getAllDisplayedLeftColumns() : [])
            .concat(columnApi.getAllDisplayedCenterColumns ? columnApi.getAllDisplayedCenterColumns() : [])
            .concat(columnApi.getAllDisplayedRightColumns ? columnApi.getAllDisplayedRightColumns() : []);

        // 兜底：如果上面 API 不存在或返回空，用 getAllDisplayedColumns
        const finalCols = cols.length ? cols : (columnApi.getAllDisplayedColumns ? columnApi.getAllDisplayedColumns() : []);

        const headers = finalCols.map(c => {
            const def = c && (c.colDef || c.getColDef && c.getColDef());
            const name = def && (def.headerName || def.header);
            return name || (c && c.getColId ? c.getColId() : '');
        });

        const diagnostics = {
            rootMetrics,
            via: holder.via || null,
            modelType: (api.getModel && api.getModel() && api.getModel().getType) ? api.getModel().getType() : null,
            rowCounts: {
                displayedRowCount: typeof api.getDisplayedRowCount === 'function' ? api.getDisplayedRowCount() : null,
                modelRowCount: (api.getModel && api.getModel() && typeof api.getModel().getRowCount === 'function') ? api.getModel().getRowCount() : null
            },
            displayedCols: {
                left: columnApi.getAllDisplayedLeftColumns ? columnApi.getAllDisplayedLeftColumns().length : null,
                center: columnApi.getAllDisplayedCenterColumns ? columnApi.getAllDisplayedCenterColumns().length : null,
                right: columnApi.getAllDisplayedRightColumns ? columnApi.getAllDisplayedRightColumns().length : null,
                allDisplayed: columnApi.getAllDisplayedColumns ? columnApi.getAllDisplayedColumns().length : null
            },
            allCols: {
                allGridColumns: columnApi.getAllGridColumns ? columnApi.getAllGridColumns().length : null,
                allColumns: columnApi.getAllColumns ? columnApi.getAllColumns().length : null
            },
            headerSample: headers.slice(0, 10)
        };

        const rows = [];
        const nodeKeySample = [];
        // 关键：用 api.getValue 从网格模型取值，避免字段/格式化导致错位
        api.forEachNodeAfterFilterAndSort
            ? api.forEachNodeAfterFilterAndSort(node => {
                const row = finalCols.map(col => {
                    try {
                        const v = api.getValue(col, node);
                        return v == null ? '' : String(v);
                    } catch {
                        return '';
                    }
                });
                rows.push(row);
                if (nodeKeySample.length < 3) {
                    nodeKeySample.push({
                        rowIndex: typeof node.rowIndex === 'number' ? node.rowIndex : null,
                        id: node.id != null ? String(node.id) : null,
                        key: node.key != null ? String(node.key) : null
                    });
                }
            })
            : api.forEachNode(node => {
                const row = finalCols.map(col => {
                    try {
                        const v = api.getValue(col, node);
                        return v == null ? '' : String(v);
                    } catch {
                        return '';
                    }
                });
                rows.push(row);
                if (nodeKeySample.length < 3) {
                    nodeKeySample.push({
                        rowIndex: typeof node.rowIndex === 'number' ? node.rowIndex : null,
                        id: node.id != null ? String(node.id) : null,
                        key: node.key != null ? String(node.key) : null
                    });
                }
            });

        diagnostics.nodeKeySample = nodeKeySample;
        return { headers, rows, diagnostics };
    });

    if (viaApi && Array.isArray(viaApi.headers) && Array.isArray(viaApi.rows)) {
        return viaApi;
    }
    return null;
}

async function extractAgGridWithFallback(page) {
    const viaApi = await extractAgGrid(page);
    if (viaApi) return viaApi;

    throw new Error('无法获取 ag-Grid API（api/columnApi）。已禁用 DOM 降级。');
}

async function writeExcel(filePath, headers, rows) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('计划详情', { views: [{ state: 'frozen', ySplit: 1 }] });

    if (headers && headers.length) {
        sheet.addRow(headers);
        sheet.getRow(1).font = { bold: true };
    }
    for (const row of rows) sheet.addRow(row);

    // 自适应列宽（限制最大宽度）
    const colCount = headers.length || (rows[0] ? rows[0].length : 0);
    if (colCount) {
        sheet.columns.forEach(col => {
            let max = 10;
            col.eachCell({ includeEmpty: true }, cell => {
                const v = cell.value == null ? '' : String(cell.value);
                if (v.length > max) max = Math.min(v.length, 80);
            });
            col.width = max;
        });
    }

    await workbook.xlsx.writeFile(filePath);
    logger.success(`Excel 已导出: ${filePath}`);
    return filePath;
}

function pickFirstArray(obj, keys) {
    for (const k of keys) {
        if (obj && Array.isArray(obj[k])) return obj[k];
    }
    return null;
}

function guessTabularFromJson(json) {
    if (!json || typeof json !== 'object') return null;

    const root = json.data && typeof json.data === 'object' ? json.data : json;
    const columns =
        pickFirstArray(root, ['columns', 'cols', 'columnList']) ||
        pickFirstArray(json, ['columns', 'cols', 'columnList']);
    const list =
        pickFirstArray(root, ['list', 'rows', 'data', 'records', 'items']) ||
        pickFirstArray(json, ['list', 'rows', 'data', 'records', 'items']);

    if (Array.isArray(columns) && columns.length && Array.isArray(list) && list.length) {
        const headers = columns.map(c => {
            if (typeof c === 'string') return c;
            if (!c || typeof c !== 'object') return '';
            return c.headerName || c.label || c.title || c.name || c.header || c.prop || c.field || '';
        }).map(s => String(s || '').trim());

        const fields = columns.map(c => {
            if (typeof c === 'string') return c;
            if (!c || typeof c !== 'object') return '';
            return c.field || c.prop || c.key || c.dataIndex || c.name || '';
        });

        const rows = list.map(item => {
            if (!item || typeof item !== 'object') return [String(item ?? '')];
            return fields.map(f => {
                const v = f && Object.prototype.hasOwnProperty.call(item, f) ? item[f] : '';
                return v == null ? '' : String(v);
            });
        });
        return { headers, rows, source: 'network:columns+list' };
    }

    if (Array.isArray(list) && list.length && typeof list[0] === 'object' && list[0] !== null) {
        const headers = Object.keys(list[0]);
        const rows = list.map(item => headers.map(h => item && item[h] != null ? String(item[h]) : ''));
        return { headers, rows, source: 'network:derive-keys' };
    }

    return null;
}

async function main() {
    const args = parseArgs(process.argv);
    const id = args.id || 7639;
    const url = buildUrl(id);

    const browserAutomation = new BrowserAutomation(config);
    try {
        const launched = await browserAutomation.launchBrowser();
        if (!launched) process.exit(1);

        // 登录：先走通用登录逻辑；若偶发页面慢导致“未找到输入框”，这里做兜底重试（不改动现有模块）
        let loggedIn = await browserAutomation.login();
        if (!loggedIn) {
            logger.warn('通用登录失败，尝试兜底登录流程（更长等待/重试）...');
            const page = browserAutomation.page;
            await page.goto(config.website.loginUrl);
            await page.waitForLoadState('domcontentloaded');

            // 兼容已登录直接跳转：如果此时已经不在登录页，就认为已登录
            const currentUrl = page.url();
            if (!currentUrl.includes('/login') && !currentUrl.endsWith('/')) {
                loggedIn = true;
            } else {
                const usernameSel = 'input[name="account"], input[name="username"], input[placeholder*="账号"], input[placeholder*="用户名"], input[type="text"]';
                const passwordSel = 'input[name="password"], input[type="password"], input[placeholder*="密码"]';
                await page.waitForSelector(usernameSel, { timeout: 30000 });
                await page.waitForSelector(passwordSel, { timeout: 30000 });
                await page.fill(usernameSel, config.credentials.username);
                await page.fill(passwordSel, config.credentials.password);

                const btn = page.locator('button:has-text("登 录"), button:has-text("登录"), button[type="submit"], .el-button--primary').first();
                if (await btn.count()) {
                    await btn.click();
                } else {
                    await page.keyboard.press('Enter');
                }

                // 等待任一“登录成功迹象”
                await Promise.race([
                    page.waitForURL('**/index*', { timeout: 30000 }),
                    page.waitForURL('**/home*', { timeout: 30000 }),
                    page.waitForURL('**/main*', { timeout: 30000 }),
                    page.waitForURL('**/production/**', { timeout: 30000 }),
                    page.waitForLoadState('networkidle')
                ]);
                loggedIn = true;
            }
        }

        if (!loggedIn) process.exit(1);

        logger.info(`导航到计划详情页: ${url}`);
        const page = browserAutomation.page;

        await page.goto(url);
        await page.waitForLoadState('networkidle');
        let result = await extractAgGridWithFallback(page);

        const { headers, rows, diagnostics } = result;
        logger.info(`提取到表头 ${headers.length} 列，${rows.length} 行数据`);

        const out = getOutputPath(id);
        await writeExcel(out, headers, rows);
        logger.info('完成。请打开 Excel 核对表头与内容。');
    } catch (e) {
        logger.error(`执行失败: ${e && e.message ? e.message : String(e)}`);
        if (e && e.stack) logger.error(e.stack);
        process.exitCode = 1;
    } finally {
        await browserAutomation.closeBrowser();
    }
}

main();

