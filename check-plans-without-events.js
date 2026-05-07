const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkPlansWithoutEvents() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 2
    });
    
    try {
        console.log('=== 检查完全没有状态事件的计划 ===');
        
        // 查询有构件但完全没有状态事件的计划
        const res = await pool.query(`
            SELECT 
                p.plan_id,
                p.plan_name,
                pr.project_name,
                p.component_count as expected_count,
                COUNT(c.component_id) as actual_component_count,
                COUNT(e.event_id) as event_count
            FROM production_plan p
            LEFT JOIN project pr ON p.project_id = pr.project_id
            LEFT JOIN component c ON p.plan_id = c.plan_id
            LEFT JOIN component_status_event e ON c.component_id = e.component_id
            WHERE p.component_count > 0
            GROUP BY p.plan_id, p.plan_name, pr.project_name, p.component_count
            HAVING COUNT(c.component_id) > 0 AND COUNT(e.event_id) = 0
            ORDER BY p.plan_id DESC
        `);

        console.log('计划ID\t计划名称\t项目名称\t预期数量\t实际构件数\t状态事件数');
        console.log('---\t---\t---\t---\t---\t---');
        
        const plansWithoutEvents = [];
        
        for (const row of res.rows) {
            const { plan_id, plan_name, project_name, expected_count, actual_component_count, event_count } = row;
            
            console.log(`${plan_id}\t${(plan_name || 'N/A').substring(0, 20)}\t${(project_name || 'N/A').substring(0, 20)}\t${expected_count}\t${actual_component_count}\t${event_count}`);
            
            plansWithoutEvents.push(plan_id);
        }

        console.log(`\n=== 完全没有状态事件的计划列表 ===`);
        console.log(`共 ${plansWithoutEvents.length} 个计划没有状态事件`);
        console.log('计划ID:', plansWithoutEvents.join(', '));
        
        // 生成重新导入命令
        if (plansWithoutEvents.length > 0) {
            console.log(`\n=== 重新导入命令 ===`);
            console.log('# 单个计划导入:');
            plansWithoutEvents.forEach(planId => {
                console.log(`node src/extract-production-plan.js --api --by-project --components --plan-id ${planId}`);
            });
            
            console.log(`\n# 批量导入 (分批执行):`);
            const batchSize = 5;
            for (let i = 0; i < plansWithoutEvents.length; i += batchSize) {
                const batch = plansWithoutEvents.slice(i, i + batchSize);
                const planIds = batch.map(id => `--plan-id ${id}`).join(' ');
                console.log(`node src/extract-production-plan.js --api --by-project --components ${planIds}`);
            }
        } else {
            console.log('✅ 所有有构件的计划都有状态事件');
        }

    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkPlansWithoutEvents().catch(console.error);
}

module.exports = { checkPlansWithoutEvents };
