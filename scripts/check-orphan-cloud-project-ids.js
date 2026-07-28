/**
 * 核对 sales_order.cloud_project_id 是否仍在东吴云项目列表中存在。
 */
const { Pool } = require('pg');
const config = require('../config/default.json');
const BrowserAutomation = require('../src/browser-automation');

const CHECK_IDS = [1, 16, 18, 15, 23, 163];

async function fetchAllCloudProjectIds(page, token) {
    const API = 'https://dwyunsc.ddwjzkj.com:10086/v1.project/getList';
    const size = 200;
    const all = [];
    let pageNo = 1;
    let totalPages = 1;
    do {
        const json = await page.request.post(API, {
            data: { keyword: '', code: '', page: pageNo, size },
            headers: { Token: token, 'Content-Type': 'application/json' }
        }).then(r => r.json());
        if (!json || json.code !== 0) throw new Error(`getList failed page ${pageNo}`);
        const data = json.data || {};
        all.push(...(data.list || []));
        const total = Number(data.count);
        const pageSize = Number(data.size) || size;
        totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
        pageNo += 1;
    } while (pageNo <= totalPages);
    return all;
}

(async () => {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database
    });

    const dbIds = await pool.query(
        `
            SELECT cloud_project_id, count(*)::int AS order_count, max(project_name) AS project_name
            FROM sales_order
            WHERE cloud_project_id = ANY($1::bigint[])
            GROUP BY cloud_project_id
            ORDER BY cloud_project_id
        `,
        [CHECK_IDS]
    );

    const b = new BrowserAutomation({ ...config, browser: { headless: true } });
    await b.launchBrowser();
    await b.login();
    let token = '';
    b.page.on('request', r => {
        const t = r.headers().token || r.headers().Token;
        if (t) token = t;
    });
    await b.page.goto('https://dwyunsc.ddwjzkj.com:22222/project/index');
    await b.page.waitForTimeout(2000);

    const projects = await fetchAllCloudProjectIds(b.page, token);
    const liveIds = new Set(projects.map(p => Number(p.id)));
    const liveById = new Map(projects.map(p => [Number(p.id), p]));

    const orphanInDb = await pool.query(
        `
            SELECT cloud_project_id, count(*)::int AS order_count
            FROM sales_order
            WHERE cloud_project_id IS NOT NULL
              AND cloud_project_id NOT IN (SELECT unnest($1::bigint[]))
            GROUP BY cloud_project_id
            ORDER BY order_count DESC
            LIMIT 20
        `,
        [[...liveIds]]
    );

    console.log(JSON.stringify({
        liveProjectCount: projects.length,
        liveIdMin: Math.min(...liveIds),
        liveIdMax: Math.max(...liveIds),
        checkIds: CHECK_IDS.map(id => ({
            cloud_project_id: id,
            inLiveProjectList: liveIds.has(id),
            liveName: liveById.get(id) && liveById.get(id).name,
            dbOrders: dbIds.rows.find(r => Number(r.cloud_project_id) === id) || null
        })),
        orphanCloudProjectIdsInSalesOrder: orphanInDb.rows
    }, null, 2));

    await pool.end();
    await b.closeBrowser();
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
