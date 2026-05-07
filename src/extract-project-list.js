/**
 * 独立脚本：登录东吴云 → 打开“项目列表”页（Element-UI 表格）→ 提取表格数据 → 导出 Excel
 *
 * 用法：
 *   node src/extract-project-list.js
 *   npm run extract-project-list
 */
const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');
const { Pool } = require('pg');

const PROJECT_LIST_URL = 'https://dwyunsc.ddwjzkj.com:22222/project/index';

const API_ORIGIN = 'https://dwyunsc.ddwjzkj.com:10086';
const API_GET_PROJECT_LIST = `${API_ORIGIN}/v1.project/getList`;

let capturedToken = '';

function installTokenCapture(page) {
    if (!page || typeof page.on !== 'function') return;
    page.on('request', req => {
        try {
            const url = String(req.url() || '');
            if (!url.includes('/v1.project/getList')) return;
            const headers = req.headers ? req.headers() : {};
            const token = headers && (headers.token || headers.Token || headers.TOKEN);
            if (token && String(token).trim()) capturedToken = String(token).trim();
        } catch {
        }
    });
}

async function getTokenFromPage(page) {
    if (capturedToken) return capturedToken;
    try {
        const token = await page.evaluate(() => {
            return (
                window.localStorage.getItem('Token') ||
                window.localStorage.getItem('token') ||
                window.sessionStorage.getItem('Token') ||
                window.sessionStorage.getItem('token') ||
                ''
            );
        });
        if (token && String(token).trim()) {
            capturedToken = String(token).trim();
            return capturedToken;
        }
    } catch {
    }
    return '';
}

async function fetchProjectListPageByApi(page, payload) {
    const token = await getTokenFromPage(page);
    if (!token) {
        throw new Error('无法获取接口 Token（请求头/Storage 中未找到 Token），无法调用 project/getList');
    }

    const sanitize = s => {
        const text = String(s || '');
        return text
            .replace(/(Token:\s*)([^\s\r\n]+)/gi, '$1<TOKEN>')
            .replace(/(token=)([^;\s]+)/gi, '$1<TOKEN>')
            .replace(/(factory_token=)([^;\s]+)/gi, '$1<TOKEN>');
    };

    const url = API_GET_PROJECT_LIST;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Get cookies from current page context to manually attach
            const cookies = await page.context().cookies();
            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            const res = await page.request.post(url, {
                data: payload,
                headers: {
                    Token: token,
                    'Content-Type': 'application/json;charset=utf-8',
                    ...(cookieStr ? { Cookie: cookieStr } : {})
                },
                timeout: 60000
            });

            if (!res.ok()) {
                let snippet = '';
                try {
                    const t = await res.text();
                    snippet = String(t || '').slice(0, 500);
                } catch {
                }
                throw new Error(`project/getList HTTP失败：status=${res.status()} body=${sanitize(snippet)}`);
            }

            try {
                const json = await res.json();
                return json;
            } catch {
                let snippet = '';
                try {
                    const t = await res.text();
                    snippet = String(t || '').slice(0, 500);
                } catch {
                }
                throw new Error(`project/getList 响应非JSON：status=${res.status()} body=${sanitize(snippet)}`);
            }
        } catch (err) {
            const msg = sanitize(err && err.message ? err.message : err);
            if (attempt === maxAttempts) throw new Error(`project/getList 请求失败（第${attempt}次尝试）：${msg}`);
            await page.waitForTimeout(2000);
        }
    }
    throw new Error('project/getList 请求失败：重试次数耗尽');
}

async function fetchAllProjectsByApi(page, options = {}) {
    const size = Number.isFinite(Number(options.size)) ? Number(options.size) : 200;
    const basePayload = {
        code: '',
        keyword: '',
        page: 1,
        size
    };

    const first = await fetchProjectListPageByApi(page, basePayload);
    if (!first || first.code !== 0) {
        throw new Error(`project/getList 调用失败：code=${first && first.code !== undefined ? first.code : '未知'} msg=${first && first.msg ? first.msg : ''}`);
    }
    const data0 = first.data;
    if (!data0 || typeof data0 !== 'object') throw new Error('project/getList 返回缺少 data 字段');
    if (!Array.isArray(data0.list)) throw new Error('project/getList 返回 data.list 不是数组');

    const total = Number(data0.count);
    const pageSize = Number(data0.size);
    const totalPages = Number.isFinite(total) && total > 0 && Number.isFinite(pageSize) && pageSize > 0
        ? Math.max(1, Math.ceil(total / pageSize))
        : 1;

    const all = [...data0.list];
    for (let p = 2; p <= totalPages; p++) {
        const json = await fetchProjectListPageByApi(page, { ...basePayload, page: p });
        if (!json || json.code !== 0) {
            throw new Error(`project/getList 第${p}页调用失败：code=${json && json.code !== undefined ? json.code : '未知'} msg=${json && json.msg ? json.msg : ''}`);
        }
        const d = json.data;
        if (!d || typeof d !== 'object') throw new Error(`project/getList 第${p}页返回缺少 data 字段`);
        if (!Array.isArray(d.list)) throw new Error(`project/getList 第${p}页返回 data.list 不是数组`);
        all.push(...d.list);
    }

    if (Number.isFinite(total) && total >= 0 && all.length !== total) {
        throw new Error(`接口抓取不完整：接口count=${total} 实际获取=${all.length}`);
    }

    return { total, size: pageSize, list: all };
}

function parseArgs() {
    const args = process.argv.slice(2);
    const apiMode = args.includes('--api');
    return { apiMode };
}

/**
 * 从 Element-UI 项目列表表格中提取表头 + 行数据。
 * 逻辑与 extract-production-plan.js 中的 extractTableData 基本一致，
 * 主要通过 .el-table__body-wrapper / .el-table 选择器定位表格。
 */
async function extractProjectTable(page) {
    // 等待“有表格”这个事实成立
    const anchors = [
        page.locator('.el-table__body-wrapper').first(),
        page.locator('.el-table').first(),
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
        throw new Error('未检测到结果表格（.el-table__body-wrapper / .el-table / table）');
    }

    async function pickFirstNonFixedTable(tablesLocator) {
        const n = await tablesLocator.count();
        for (let i = 0; i < n; i++) {
            const t = tablesLocator.nth(i);
            const isFixed = await t.evaluate(el => Boolean(el.closest('.el-table__fixed') || el.closest('.el-table__fixed-right')));
            if (!isFixed) return t;
        }
        return tablesLocator.first();
    }

    // 主表体（排除固定列的表体）
    const bodyCandidates = page.locator('table.el-table__body');
    let table = await pickFirstNonFixedTable(bodyCandidates);
    if (await table.count() === 0) {
        table = page.locator('.el-table__body-wrapper table').first();
    }
    if (await table.count() === 0) {
        table = page.locator('table').first();
    }

    // 表头优先取主表头（排除固定列表头）
    let headers = [];
    const headerTable = await pickFirstNonFixedTable(page.locator('table.el-table__header'));
    let headerCells = headerTable.locator('thead th .cell');
    let headerCount = await headerCells.count();

    if (headerCount === 0) {
        // 兜底：直接从正文表的 thead 里取
        headerCells = table.locator('thead th .cell');
        headerCount = await headerCells.count();
    }

    if (headerCount > 0) {
        headers = await headerCells.allTextContents();
        headers = headers.map(h => String(h || '').trim());
    }

    // 数据行：tbody tr → 每行 td .cell
    const rows = [];
    const trs = table.locator('tbody tr');
    const rowCount = await trs.count();

    for (let i = 0; i < rowCount; i++) {
        const cells = trs.nth(i).locator('td .cell');
        const cellCount = await cells.count();
        const texts = [];
        for (let j = 0; j < cellCount; j++) {
            const t = await cells.nth(j).textContent();
            texts.push(String(t || '').trim());
        }
        rows.push(texts);
    }

    // 若表头是“主表+固定列”拼接导致比行列数长，按首行列数裁剪，避免右侧重复一份表头
    if (headers.length && rows.length) {
        const colCount = rows[0].length;
        if (headers.length > colCount) {
            headers = headers.slice(0, colCount);
        }
    }

    // 若没有表头但有多列，用“列1、列2…”作为表头便于对比
    if (headers.length === 0 && rows.length > 0) {
        const colCount = rows[0].length;
        headers = Array.from({ length: colCount }, (_, i) => `列${i + 1}`);
    }

    return { headers, rows };
}

async function readPaginationState(page) {
    const pagination = page.locator('.el-pagination').first();
    if ((await pagination.count()) === 0) return null;

    const currentText = (await pagination.locator('.el-pager li.active').first().textContent().catch(() => '')) || '';
    const current = Number(String(currentText).trim()) || 1;

    const nextBtn = pagination.locator('button.btn-next').first();
    const nextDisabled = (await nextBtn.count()) ? await nextBtn.isDisabled() : true;

    const totalText = (await pagination.locator('.el-pagination__total').first().textContent().catch(() => '')) || '';

    return {
        current,
        nextDisabled,
        totalText: String(totalText).trim()
    };
}

function parseTotalItems(totalText) {
    // e.g. "共 116 条"
    const m = String(totalText || '').match(/(\d+)\s*条/);
    return m ? Number(m[1]) : null;
}

async function readPageSize(page) {
    // Element-UI pagination sizes: ".el-pagination__sizes .el-select .el-input__inner"
    const sizesInput = page.locator('.el-pagination .el-pagination__sizes .el-select .el-input__inner').first();
    if ((await sizesInput.count()) === 0) return null;
    // Often displays like "10条/页"
    const v =
        (await sizesInput.inputValue().catch(() => '')) ||
        (await sizesInput.getAttribute('value').catch(() => '')) ||
        (await sizesInput.getAttribute('aria-label').catch(() => '')) ||
        (await sizesInput.textContent().catch(() => '')) ||
        '';
    const m = String(v).match(/(\d+)/);
    const n = m ? Number(m[1]) : Number(String(v).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function readTotalPages(page) {
    const state = await readPaginationState(page);
    if (!state) return { totalItems: null, pageSize: null, totalPages: 1 };

    const totalItems = parseTotalItems(state.totalText);
    const pageSize = await readPageSize(page);
    if (totalItems && pageSize) {
        return { totalItems, pageSize, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) };
    }

    // Fallback: infer last page number from pager buttons (may be truncated with "...")
    const lastText = (await page.locator('.el-pagination .el-pager li.number').last().textContent().catch(() => '')) || '';
    const last = Number(String(lastText).trim());
    return { totalItems, pageSize, totalPages: Number.isFinite(last) && last > 0 ? last : 1 };
}

function stableRowKey(row) {
    return (row || []).map(v => String(v || '').trim()).join('\u001f');
}

function normalizeHeader(h) {
    return String(h || '').replace(/\s+/g, '').trim();
}

function findHeaderIndex(headers, candidates) {
    const normalized = headers.map(normalizeHeader);
    for (const c of candidates) {
        const want = normalizeHeader(c);
        const idx = normalized.findIndex(h => h === want);
        if (idx >= 0) return idx;
    }
    for (const c of candidates) {
        const want = normalizeHeader(c);
        const idx = normalized.findIndex(h => h.includes(want) || want.includes(h));
        if (idx >= 0) return idx;
    }
    return -1;
}

function mapProjectStatusFromResponsibleText(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.includes('钢构在建')) return 'building';
    if (t.includes('流水线')) return 'pipeline';
    if (t.includes('完结库存0') || t.includes('已完结')) return 'closed';
    return null;
}

function mapProjectsFromApiList(list) {
    const projects = [];
    for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== 'object') continue;
        const id = item.id;
        const name = String(item.name || '').trim();
        const headPersonName = String(item.head_person_name || '').trim();
        if (!id || !name) continue;
        if (headPersonName.includes('PC')) continue;
        projects.push({
            project_id: String(id).trim(),
            project_name: name,
            head_person_name: headPersonName,
            project_status: mapProjectStatusFromResponsibleText(headPersonName)
        });
    }
    return projects;
}

function parseProjectsFromTable(headers, rows) {
    const idxId = findHeaderIndex(headers, ['项目ID', '项目Id', 'ID']);
    const idxName = findHeaderIndex(headers, ['项目名称', '名称']);
    const idxResp = findHeaderIndex(headers, ['项目负责人', '负责人']);

    if (idxId < 0 || idxName < 0 || idxResp < 0) {
        throw new Error(
            `无法从表头定位必需列：项目ID/项目名称/项目负责人。` +
            `请检查页面表头是否变化。当前表头=${JSON.stringify(headers)}`
        );
    }

    const projects = [];
    for (const row of rows) {
        const projectIdRaw = row[idxId];
        const projectName = String(row[idxName] || '').trim();
        const responsible = row[idxResp];
        const responsibleText = String(responsible || '').trim();

        const projectIdStr = String(projectIdRaw || '').trim();
        if (!projectIdStr || !projectName) continue;
        if (responsibleText.includes('PC')) continue;

        projects.push({
            project_id: projectIdStr, // keep as string to avoid JS bigint precision issues
            project_name: projectName,
            project_status: mapProjectStatusFromResponsibleText(responsibleText)
        });
    }

    return projects;
}

async function syncProjectsToDb(projects) {
    const db = config.db || {};
    if (!db.host || !db.user || !db.database) {
        throw new Error('缺少数据库配置：请在 config/default.json 的 db 节点配置 host/user/database');
    }

    const pool = new Pool({
        host: db.host,
        port: db.port || 5432,
        user: db.user,
        password: db.password || '',
        database: db.database,
        max: 5,
        application_name: 'extract-project-list'
    });

    const sql = `
        INSERT INTO project (project_id, project_name, head_person_name, project_status, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (project_id) DO UPDATE
          SET project_name = EXCLUDED.project_name,
              head_person_name = EXCLUDED.head_person_name,
              project_status = EXCLUDED.project_status,
              updated_at = now()
        WHERE (project.project_name, project.head_person_name, project.project_status)
              IS DISTINCT FROM (EXCLUDED.project_name, EXCLUDED.head_person_name, EXCLUDED.project_status)
        RETURNING (xmax = 0) AS inserted
    `;

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    try {
        // Tag history trigger source (used by trg_project_name_history()).
        await pool.query(`SET app.sync_source = 'extract-project-list'`);

        for (const p of (projects || [])) {
            if (!p || !p.project_status) continue;
            const res = await pool.query(sql, [p.project_id, p.project_name, p.head_person_name, p.project_status]);
            if (res.rowCount === 0) {
                unchanged++;
            } else if (res.rows[0] && res.rows[0].inserted) {
                inserted++;
            } else {
                updated++;
            }
        }
    } finally {
        await pool.end();
    }

    return { inserted, updated, unchanged };
}

async function readFirstRowSentinel(page) {
    const cells = page.locator('.el-table__body-wrapper table tbody tr').first().locator('td .cell');
    const n = await cells.count();
    if (!n) return '';
    const take = Math.min(n, 3);
    const parts = [];
    for (let i = 0; i < take; i++) {
        const t = await cells.nth(i).textContent().catch(() => '');
        parts.push(String(t || '').trim());
    }
    return parts.join('|');
}

async function gotoPage(page, targetPage) {
    const state = await readPaginationState(page);
    if (!state) return true;
    if (state.current === targetPage) return true;

    const pagination = page.locator('.el-pagination').first();
    const jumperInput = pagination.locator('.el-pagination__jump input').first();

    const beforeSentinel = await readFirstRowSentinel(page);

    async function attemptJump() {
        if ((await jumperInput.count()) > 0) {
            await jumperInput.click().catch(() => {});
            await jumperInput.fill(String(targetPage));
            await jumperInput.press('Enter');
        } else {
            const btn = pagination.locator('.el-pager li.number', { hasText: String(targetPage) }).first();
            if ((await btn.count()) === 0) return false;
            await btn.click();
        }
        return true;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const ok = await attemptJump();
        if (!ok) throw new Error(`无法定位分页跳转控件（jump input / page button）。目标页=${targetPage}`);

        await page.waitForLoadState('networkidle');

        for (let i = 0; i < 40; i++) {
            const nowState = await readPaginationState(page);
            const nowSentinel = await readFirstRowSentinel(page);
            if (nowState && nowState.current === targetPage && nowSentinel !== beforeSentinel) {
                return true;
            }
            await page.waitForTimeout(200);
        }
    }

    const finalState = await readPaginationState(page);
    const finalSentinel = await readFirstRowSentinel(page);
    throw new Error(
        `分页跳转失败：期望第 ${targetPage} 页，实际第 ${finalState ? finalState.current : '未知'} 页，` +
        `sentinelChanged=${finalSentinel !== beforeSentinel}`
    );
}

async function main() {
    const { apiMode } = parseArgs();
    const browserAutomation = new BrowserAutomation(config);

    try {
        const launched = await browserAutomation.launchBrowser();
        if (!launched) {
            logger.error('浏览器启动失败，退出');
            process.exit(1);
        }

        const loggedIn = await browserAutomation.login();
        if (!loggedIn) {
            logger.error('登录失败，退出');
            await browserAutomation.closeBrowser();
            process.exit(1);
        }

        logger.info(`导航到项目列表页: ${PROJECT_LIST_URL}`);
        const page = browserAutomation.page;
        installTokenCapture(page);
        await page.goto(PROJECT_LIST_URL);
        await page.waitForLoadState('networkidle');

        if (apiMode) {
            logger.info(`API 模式启用：getList=${API_GET_PROJECT_LIST}`);
            const t0Api = Date.now();
            const { total, list } = await fetchAllProjectsByApi(page, { size: 200 });
            const projectsAll = mapProjectsFromApiList(list);
            const skippedNoStatus = projectsAll.filter(p => !p || !p.project_status).length;
            const projects = projectsAll.filter(p => p && p.project_status);
            logger.info(
                `API抓取 ${list.length} 条；解析 ${projectsAll.length} 条；` +
                `未匹配状态跳过 ${skippedNoStatus} 条；有效 ${projects.length} 条；` +
                `开始同步到数据库: ${config.db && config.db.database ? config.db.database : ''}`
            );
            const stats = await syncProjectsToDb(projects);
            const elapsed = ((Date.now() - t0Api) / 1000).toFixed(1);
            logger.success(`数据库同步完成：新增 ${stats.inserted}，更新 ${stats.updated}，无变化 ${stats.unchanged}；耗时 ${elapsed}s`);
            logger.info('完成。');
            return;
        }

        let headers = [];
        const allRows = [];
        const seen = new Set();

        const paging = await readTotalPages(page);
        logger.info(`分页信息：总条数=${paging.totalItems ?? '未知'}，每页=${paging.pageSize ?? '未知'}，总页数=${paging.totalPages}`);

        const visitedPages = new Set();
        for (let p = 1; p <= paging.totalPages; p++) {
            await gotoPage(page, p);
            visitedPages.add(p);

            const state = await readPaginationState(page);
            const { headers: h, rows } = await extractProjectTable(page);
            if (!headers.length) headers = h;

            let appended = 0;
            for (const r of rows) {
                const key = stableRowKey(r);
                if (!key) continue;
                if (seen.has(key)) continue;
                seen.add(key);
                allRows.push(r);
                appended++;
            }

            logger.info(`第 ${state ? state.current : p} 页 抓取 ${rows.length} 行，新增 ${appended} 行，累计 ${allRows.length} 行`);
        }

        if (visitedPages.size !== paging.totalPages) {
            throw new Error(`分页抓取不完整：期望 ${paging.totalPages} 页，实际抓取 ${visitedPages.size} 页`);
        }

        logger.info(`提取到表头 ${headers.length} 列，合计 ${allRows.length} 行数据`);

        const projectsAll = parseProjectsFromTable(headers, allRows);
        const skippedNoStatus = projectsAll.filter(p => !p || !p.project_status).length;
        const projects = projectsAll.filter(p => p && p.project_status);
        logger.info(
            `解析到项目数据 ${projectsAll.length} 条；` +
            `未匹配状态跳过 ${skippedNoStatus} 条；有效 ${projects.length} 条；` +
            `开始同步到数据库: ${config.db && config.db.database ? config.db.database : ''}`
        );
        const stats = await syncProjectsToDb(projects);
        logger.success(`数据库同步完成：新增 ${stats.inserted}，更新 ${stats.updated}，无变化 ${stats.unchanged}`);

        logger.info('完成。');
    } catch (error) {
        logger.error(`执行失败: ${error && error.message ? error.message : String(error)}`);
        if (error && error.stack) logger.error(error.stack);
        process.exitCode = 1;
    } finally {
        await browserAutomation.closeBrowser();
    }
}

main();

