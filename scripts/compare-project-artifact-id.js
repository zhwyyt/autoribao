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
    const guid = '2-2GKZ-1-GJG-20260507152515-0001';
    const r = await pool.query(
        `SELECT dwyun_artifact_id, order_id, plan_id, scheduling_id, production_artifact_id
         FROM order_component WHERE component_guid = $1 LIMIT 3`,
        [guid]
    );
    console.log(JSON.stringify(r.rows, null, 2));
    await pool.end();
})();
