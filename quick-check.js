const { Pool } = require('pg');
const config = require('./config/default.json');

async function quickCheck() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 2
    });
    
    try {
        const res = await pool.query(`
            SELECT 
                COUNT(DISTINCT p.plan_id) as total_plans,
                COUNT(DISTINCT CASE WHEN c.component_id IS NOT NULL THEN p.plan_id END) as plans_with_components,
                COUNT(DISTINCT CASE WHEN e.event_id IS NOT NULL THEN p.plan_id END) as plans_with_events
            FROM production_plan p
            LEFT JOIN component c ON p.plan_id = c.plan_id
            LEFT JOIN component_status_event e ON c.component_id = e.component_id
            WHERE p.component_count > 0
        `);
        
        const { total_plans, plans_with_components, plans_with_events } = res.rows[0];
        console.log(`总计划数: ${total_plans}`);
        console.log(`有构件的计划数: ${plans_with_components}`);
        console.log(`有状态事件的计划数: ${plans_with_events}`);
        console.log(`覆盖率: ${Math.round(plans_with_events / total_plans * 100)}%`);
        
    } finally {
        await pool.end();
    }
}

quickCheck().catch(console.error);
