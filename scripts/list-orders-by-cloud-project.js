const { Pool } = require('pg');
const config = require('../config/default.json');

const IDS = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n));
const target = IDS.length ? IDS : [1, 16, 18];

(async () => {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database
    });
    const r = await pool.query(
        `
            SELECT cloud_project_id, order_id, order_name, order_code, project_name, artifacts_count
            FROM sales_order
            WHERE cloud_project_id = ANY($1::bigint[])
            ORDER BY cloud_project_id, order_id
        `,
        [target]
    );
    const byProj = {};
    for (const row of r.rows) {
        const k = String(row.cloud_project_id);
        if (!byProj[k]) byProj[k] = [];
        byProj[k].push({
            order_id: Number(row.order_id),
            order_name: row.order_name,
            order_code: row.order_code,
            project_name: row.project_name,
            artifacts_count: row.artifacts_count
        });
    }
    console.log(JSON.stringify(byProj, null, 2));
    await pool.end();
})();
