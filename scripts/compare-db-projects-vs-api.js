/**
 * 对比数据库 project 表与云端 project/getList，导出「库内有、API 无」等清单。
 *
 * 用法：node scripts/compare-db-projects-vs-api.js
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const config = require('../config/default.json');
const logger = require('../src/logger');
const BrowserAutomation = require('../src/browser-automation');
const {
    ensureCloudProjectDeletedSchema,
    upsertCloudProjectDeleted
} = require('../src/cloud-project-deleted');

const PROJECT_LIST_URL = 'https://dwyunsc.ddwjzkj.com:22222/project/index';
const API_GET_PROJECT_LIST = 'https://dwyunsc.ddwjzkj.com:10086/v1.project/getList';

let capturedToken = '';

function installTokenCapture(page) {
    page.on('request', req => {
        try {
            if (String(req.url() || '').includes('/v1.project/getList')) {
                const h = req.headers();
                const token = h && (h.token || h.Token || h.TOKEN);
                if (token && String(token).trim()) capturedToken = String(token).trim();
            }
        } catch {}
    });
}

async function fetchProjectListPage(page, payload) {
    const res = await page.request.post(API_GET_PROJECT_LIST, {
        data: payload,
        headers: { Token: capturedToken, 'Content-Type': 'application/json;charset=utf-8' },
        timeout: 120000
    });
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
    const json = await res.json();
    if (!json || json.code !== 0) throw new Error(json && json.msg ? json.msg : 'API code!=0');
    return json;
}

async function fetchAllApiProjects(page) {
    const size = 200;
    const first = await fetchProjectListPage(page, { code: '', keyword: '', page: 1, size });
    const data0 = first.data || {};
    const total = Number(data0.count) || 0;
    const pageSize = Number(data0.size) || size;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const all = [...(data0.list || [])];
    for (let p = 2; p <= totalPages; p++) {
        const json = await fetchProjectListPage(page, { code: '', keyword: '', page: p, size });
        all.push(...((json.data && json.data.list) || []));
    }
    return { total, list: all };
}

function mapApiRow(item) {
    const id = Number(item.id);
    if (!Number.isFinite(id)) return null;
    return {
        cloud_project_id: id,
        project_name: String(item.name || item.engineer_name || '').trim(),
        project_code: String(item.code || '').trim() || null,
        head_person_name: String(item.head_person_name || '').trim() || null,
        raw_status: item.status != null ? String(item.status) : '',
        is_delete: item.is_delete != null ? Number(item.is_delete) : null
    };
}

(async () => {
    const pool = new Pool({ ...config.db, max: 3, application_name: 'compare-db-projects-vs-api' });
    await ensureCloudProjectDeletedSchema(pool);

    const dbRes = await pool.query(
        `
            SELECT
                p.project_id,
                p.project_name,
                p.project_status::text AS project_status,
                p.head_person_name,
                p.updated_at,
                (SELECT count(*)::int FROM production_plan pp WHERE pp.project_id = p.project_id) AS plan_count,
                (SELECT count(*)::int FROM component c
                 JOIN production_plan pp ON pp.plan_id = c.plan_id
                 WHERE pp.project_id = p.project_id) AS component_count
            FROM project p
            ORDER BY p.project_id
        `
    );

    const soRes = await pool.query(
        `
            SELECT
                so.cloud_project_id,
                MAX(so.project_name) AS project_name,
                count(DISTINCT so.order_id)::int AS order_count,
                count(oc.order_component_id)::int AS order_component_count
            FROM sales_order so
            LEFT JOIN order_component oc ON oc.order_id = so.order_id
            WHERE so.cloud_project_id IS NOT NULL
            GROUP BY so.cloud_project_id
            ORDER BY so.cloud_project_id
        `
    );

    const browserAutomation = new BrowserAutomation({
        ...config,
        browser: { ...(config.browser || {}), headless: true }
    });

    let apiList = [];
    try {
        if (!(await browserAutomation.launchBrowser())) throw new Error('浏览器启动失败');
        if (!(await browserAutomation.login())) throw new Error('登录失败');
        const page = browserAutomation.page;
        installTokenCapture(page);
        await page.goto(PROJECT_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);
        if (!capturedToken) {
            capturedToken = await page.evaluate(() =>
                localStorage.getItem('Token') || localStorage.getItem('token') || ''
            );
        }
        if (!capturedToken) throw new Error('无法获取 Token');
        const fetched = await fetchAllApiProjects(page);
        apiList = fetched.list.map(mapApiRow).filter(Boolean);
        logger.info(`API 项目 ${apiList.length} 个（count=${fetched.total}）`);
    } finally {
        await browserAutomation.closeBrowser().catch(() => {});
    }

    const apiById = new Map(apiList.map(r => [r.cloud_project_id, r]));
    const dbById = new Map(dbRes.rows.map(r => [Number(r.project_id), r]));
    const soById = new Map(soRes.rows.map(r => [Number(r.cloud_project_id), r]));

    const allIds = new Set([...apiById.keys(), ...dbById.keys(), ...soById.keys()]);

    const rows = [];
    for (const id of [...allIds].sort((a, b) => a - b)) {
        const api = apiById.get(id);
        const db = dbById.get(id);
        const so = soById.get(id);
        let category = '';
        if (api && db) category = '两边都有';
        else if (api && !db) category = '仅API有(库未同步)';
        else if (!api && db) category = '仅库有(疑已删云项目)';
        else if (!api && so) {
            category = db ? '库+订单有、API无(疑已删)' : '仅订单遗留、API无(疑已删)';
        } else if (api && !db && so) category = 'API+订单(库无project)';

        if (!category && api) category = '仅API有(库未同步)';
        if (!category && db) category = '仅库有(疑已删云项目)';
        if (!category && so) category = '仅订单有云ID';

        rows.push({
            cloud_project_id: id,
            category,
            api_project_name: api ? api.project_name : '',
            api_code: api ? api.project_code : '',
            api_head_person: api ? api.head_person_name : '',
            api_is_delete: api && api.is_delete != null ? api.is_delete : '',
            db_project_name: db ? db.project_name : '',
            db_status: db ? db.project_status : '',
            db_plan_count: db ? db.plan_count : '',
            db_component_count: db ? db.component_count : '',
            db_updated_at: db && db.updated_at ? db.updated_at.toISOString() : '',
            order_count: so ? so.order_count : 0,
            order_component_count: so ? so.order_component_count : 0,
            order_project_name: so ? so.project_name : ''
        });
    }

    const deletedLikely = rows.filter(
        r => r.category.includes('疑已删') || r.category === '仅库有(疑已删云项目)'
    );
    const apiOnly = rows.filter(r => r.category.startsWith('仅API'));
    const both = rows.filter(r => r.category === '两边都有');

    const outDir = path.join(__dirname, '../downloads');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const xlsxPath = path.join(outDir, `项目库与API对比_${stamp}.xlsx`);

    const wb = new ExcelJS.Workbook();
    const addSheet = (name, subset, columns) => {
        const ws = wb.addWorksheet(name);
        ws.columns = columns;
        ws.getRow(1).font = { bold: true };
        for (const r of subset) ws.addRow(r);
    };

    const cols = [
        { header: '云项目ID', key: 'cloud_project_id', width: 10 },
        { header: '分类', key: 'category', width: 22 },
        { header: 'API项目名称', key: 'api_project_name', width: 36 },
        { header: 'API编号', key: 'api_code', width: 14 },
        { header: 'API负责人', key: 'api_head_person', width: 14 },
        { header: 'API is_delete', key: 'api_is_delete', width: 10 },
        { header: '库项目名称', key: 'db_project_name', width: 36 },
        { header: '库状态', key: 'db_status', width: 12 },
        { header: '计划数', key: 'db_plan_count', width: 8 },
        { header: '构件数', key: 'db_component_count', width: 10 },
        { header: '订单数', key: 'order_count', width: 8 },
        { header: '订单构件行数', key: 'order_component_count', width: 12 },
        { header: '库更新时间', key: 'db_updated_at', width: 22 }
    ];

    addSheet('疑已删或遗留', deletedLikely, cols);
    addSheet('仅API未入库', apiOnly, cols);
    addSheet('全部对比', rows, cols);

    const sum = wb.addWorksheet('汇总');
    sum.addRow(['指标', '数量']);
    sum.getRow(1).font = { bold: true };
    sum.addRow(['API 项目总数', apiList.length]);
    sum.addRow(['数据库 project 总数', dbRes.rows.length]);
    sum.addRow(['两边都有', both.length]);
    sum.addRow(['疑已删或订单遗留', deletedLikely.length]);
    sum.addRow(['仅API/未入库', apiOnly.length]);
    sum.addRow(['说明', '「仅库有」= project 表有记录但当前 getList 拉不到，多为云上已删除']);

    await wb.xlsx.writeFile(xlsxPath);

    let registeredDeleted = 0;
    for (const r of deletedLikely) {
        await upsertCloudProjectDeleted(pool, {
            cloud_project_id: r.cloud_project_id,
            project_name: r.db_project_name || r.order_project_name || r.api_project_name || '',
            order_count: r.order_count || 0,
            source: 'compare_api',
            note: r.category
        });
        registeredDeleted += 1;
    }

    console.log(
        JSON.stringify(
            {
                xlsxPath,
                apiCount: apiList.length,
                dbCount: dbRes.rows.length,
                deletedLikelyCount: deletedLikely.length,
                deletedLikelyIds: deletedLikely.map(r => r.cloud_project_id),
                registeredToCloudProjectDeleted: registeredDeleted
            },
            null,
            2
        )
    );

    await pool.end().catch(() => {});
})().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
