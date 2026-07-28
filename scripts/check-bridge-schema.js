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
    const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'order_component'
         ORDER BY ordinal_position`
    );
    const plans = await pool.query('SELECT count(*)::int c, min(plan_id) minp, max(plan_id) maxp FROM production_plan');
    const cloud = await pool.query(
        `SELECT count(DISTINCT cloud_project_id)::int projects,
                count(*)::int orders
         FROM sales_order WHERE cloud_project_id IS NOT NULL`
    );
    console.log(JSON.stringify({
        orderComponentColumns: cols.rows.map(r => r.column_name),
        productionPlanStats: plans.rows[0],
        salesOrderCloudProjects: cloud.rows[0]
    }, null, 2));
    await pool.end();
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
