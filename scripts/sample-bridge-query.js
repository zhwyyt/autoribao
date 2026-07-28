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
    const r = await pool.query(
        `SELECT oc.dwyun_artifact_id, oc.production_artifact_id, oc.plan_id, oc.scheduling_id,
                so.order_id, so.order_name, c.component_no, c.component_guid
         FROM order_component oc
         JOIN sales_order so ON so.order_id = oc.order_id
         JOIN component c ON c.component_id = oc.component_id
         WHERE oc.plan_id = 8143
         LIMIT 3`
    );
    console.log(JSON.stringify(r.rows, null, 2));
    await pool.end();
})();
