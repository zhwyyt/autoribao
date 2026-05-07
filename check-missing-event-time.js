const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkMissingEventTime() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 2
    });
    
    try {
        console.log('=== 检查没有状态时间的计划 ===');
        
        // 查询有构件但状态事件缺少 event_at 时间的计划
        const res = await pool.query(`
            SELECT DISTINCT 
                p.plan_id,
                p.plan_name,
                pr.project_name,
                COUNT(c.component_id) as component_count,
                COUNT(e.event_id) as event_count,
                COUNT(CASE WHEN e.event_at IS NULL THEN 1 END) as missing_time_count,
                COUNT(CASE WHEN e.event_at IS NOT NULL THEN 1 END) as has_time_count
            FROM production_plan p
            LEFT JOIN project pr ON p.project_id = pr.project_id
            LEFT JOIN component c ON p.plan_id = c.plan_id
            LEFT JOIN component_status_event e ON c.component_id = e.component_id
            WHERE p.component_count > 0
            GROUP BY p.plan_id, p.plan_name, pr.project_name
            HAVING COUNT(c.component_id) > 0 
                AND COUNT(e.event_id) > 0 
                AND COUNT(CASE WHEN e.event_at IS NULL THEN 1 END) > 0
            ORDER BY p.plan_id DESC
            LIMIT 50
        `);

        console.log('计划ID\t计划名称\t项目名称\t构件数\t事件数\t无时间数\t有时间数');
        console.log('---\t---\t---\t---\t---\t---\t---');
        
        const plansMissingTime = [];
        
        for (const row of res.rows) {
            const { plan_id, plan_name, project_name, component_count, event_count, missing_time_count, has_time_count } = row;
            
            console.log(`${plan_id}\t${(plan_name || 'N/A').substring(0, 20)}\t${(project_name || 'N/A').substring(0, 20)}\t${component_count}\t${event_count}\t${missing_time_count}\t${has_time_count}`);
            
            plansMissingTime.push(plan_id);
        }

        console.log(`\n=== 需要重新导入的计划列表 ===`);
        console.log(`共 ${plansMissingTime.length} 个计划缺少状态时间`);
        console.log('计划ID:', plansMissingTime.join(', '));
        
        // 生成重新导入命令
        if (plansMissingTime.length > 0) {
            console.log(`\n=== 重新导入命令 ===`);
            console.log('# 单个计划导入:');
            plansMissingTime.forEach(planId => {
                console.log(`node src/extract-production-plan.js --api --by-project --components --plan-id ${planId}`);
            });
            
            console.log(`\n# 批量导入 (分批执行):`);
            const batchSize = 5;
            for (let i = 0; i < plansMissingTime.length; i += batchSize) {
                const batch = plansMissingTime.slice(i, i + batchSize);
                const planIds = batch.map(id => `--plan-id ${id}`).join(' ');
                console.log(`node src/extract-production-plan.js --api --by-project --components ${planIds}`);
            }
        } else {
            console.log('✅ 所有计划的状态事件都有时间信息');
        }

    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkMissingEventTime().catch(console.error);
}

module.exports = { checkMissingEventTime };
