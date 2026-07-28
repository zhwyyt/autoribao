const { Pool } = require('pg');
const config = require('../config/default.json');

async function main() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database
    });
    const res = await pool.query(`
        SELECT
            (SELECT count(*)::int FROM sales_order) AS sales_order_count,
            (SELECT count(*)::int FROM order_component) AS order_component_count,
            (SELECT count(*)::int FROM order_component WHERE component_id IS NOT NULL) AS linked_count
    `);
    console.log(JSON.stringify(res.rows[0], null, 2));
    await pool.end();
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
