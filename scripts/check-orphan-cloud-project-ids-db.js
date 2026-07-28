const { Pool } = require('pg');
const config = require('../config/default.json');

(async () => {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database
    });

    const check = await pool.query(
        `
            SELECT cloud_project_id, count(*)::int AS orders,
                   min(project_name) AS project_name_min, max(project_name) AS project_name_max
            FROM sales_order
            WHERE cloud_project_id IN (1, 16, 18, 15, 23, 163)
            GROUP BY cloud_project_id
            ORDER BY cloud_project_id
        `
    );

    const distinctCloud = await pool.query(
        `SELECT count(DISTINCT cloud_project_id)::int AS n FROM sales_order WHERE cloud_project_id IS NOT NULL`
    );

    const lowIds = await pool.query(
        `
            SELECT cloud_project_id, count(*)::int AS orders
            FROM sales_order
            WHERE cloud_project_id IS NOT NULL AND cloud_project_id < 20
            GROUP BY cloud_project_id
            ORDER BY cloud_project_id
        `
    );

    const bridgeSource = await pool.query(
        `
            SELECT DISTINCT so.cloud_project_id, count(oc.*)::int AS components
            FROM sales_order so
            LEFT JOIN order_component oc ON oc.order_id = so.order_id
            WHERE so.cloud_project_id IN (1, 16, 18)
            GROUP BY so.cloud_project_id
        `
    );

    console.log(JSON.stringify({
        note: 'cloud_project_id 来自订单 API 的 project_id 字段，不是项目列表页当前可见集合',
        distinctCloudProjectIdsInSalesOrder: distinctCloud.rows[0].n,
        checkIds: check.rows,
        cloudProjectIdBelow20: lowIds.rows,
        bridgeRelated: bridgeSource.rows
    }, null, 2));

    await pool.end();
})();
