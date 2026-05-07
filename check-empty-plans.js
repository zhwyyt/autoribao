const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkEmptyPlans() {
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
                p.plan_id,
                p.plan_name,
                pr.project_name,
                p.component_count as expected_count,
                COUNT(c.component_id) as actual_count
            FROM production_plan p
            LEFT JOIN project pr ON p.project_id = pr.project_id
            LEFT JOIN component c ON p.plan_id = c.plan_id
            WHERE p.component_count > 0
            GROUP BY p.plan_id, p.plan_name, pr.project_name, p.component_count
            HAVING COUNT(c.component_id) = 0
            ORDER BY p.plan_id DESC
        `);
        
        console.log(`=== 没有构件数据的计划 (${res.rows.length} 个) ===`);
        console.log('计划ID\t计划名称\t项目名称\t预期数量');
        console.log('---\t---\t---\t---');
        
        for (const row of res.rows) {
            const { plan_id, plan_name, project_name, expected_count } = row;
            console.log(`${plan_id}\t${(plan_name || 'N/A').substring(0, 20)}\t${(project_name || 'N/A').substring(0, 20)}\t${expected_count}`);
        }
        
    } finally {
        await pool.end();
    }
}

checkEmptyPlans().catch(console.error);
