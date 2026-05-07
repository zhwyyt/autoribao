const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkMissingStatusEvents() {
    const db = config.db || {};
    if (!db.host || !db.user || !db.database) {
        throw new Error('缺少数据库配置');
    }

    const pool = new Pool({
        host: db.host,
        port: db.port || 5432,
        user: db.user,
        password: db.password || '',
        database: db.database,
        max: 2
    });

    try {
        console.log('=== 检查缺少状态事件的计划 ===');
        
        // 查询有构件但缺少状态事件的计划
        const res = await pool.query(`
            SELECT 
                p.plan_id,
                p.plan_name,
                pr.project_name,
                COUNT(c.component_id) as component_count,
                COUNT(e.event_id) as event_count,
                COUNT(DISTINCT e.status_type) as status_types_count,
                CASE 
                    WHEN COUNT(e.event_id) = 0 THEN '❌ 无状态事件'
                    WHEN COUNT(DISTINCT e.status_type) < 2 THEN '⚠️ 状态类型过少'
                    ELSE '✅ 正常'
                END as status
            FROM production_plan p
            LEFT JOIN project pr ON p.project_id = pr.project_id
            LEFT JOIN component c ON p.plan_id = c.plan_id
            LEFT JOIN component_status_event e ON c.component_id = e.component_id
            WHERE p.component_count > 0
            GROUP BY p.plan_id, p.plan_name, pr.project_name
            HAVING COUNT(c.component_id) > 0
            ORDER BY p.plan_id DESC
            LIMIT 50
        `);

        console.log('计划ID\t计划名称\t项目名称\t构件数\t事件数\t状态类型数\t状态');
        console.log('---\t---\t---\t---\t---\t---\t---');
        
        const failedPlans = [];
        
        for (const row of res.rows) {
            const { plan_id, plan_name, project_name, component_count, event_count, status_types_count, status } = row;
            
            console.log(`${plan_id}\t${(plan_name || 'N/A').substring(0, 20)}\t${(project_name || 'N/A').substring(0, 20)}\t${component_count}\t${event_count}\t${status_types_count}\t${status}`);
            
            if (status.includes('❌') || status.includes('⚠️')) {
                failedPlans.push(plan_id);
            }
        }

        console.log(`\n=== 缺少状态事件的计划列表 ===`);
        console.log(`共 ${failedPlans.length} 个计划需要重新导入状态事件`);
        console.log('计划ID:', failedPlans.join(', '));
        
        // 生成重新导入命令
        if (failedPlans.length > 0) {
            console.log(`\n=== 重新导入命令 ===`);
            console.log('# 单个计划导入:');
            failedPlans.forEach(planId => {
                console.log(`node src/extract-production-plan.js --api --by-project --components --plan-id ${planId}`);
            });
            
            console.log(`\n# 批量导入 (分批执行):`);
            const batchSize = 5;
            for (let i = 0; i < failedPlans.length; i += batchSize) {
                const batch = failedPlans.slice(i, i + batchSize);
                const planIds = batch.map(id => `--plan-id ${id}`).join(' ');
                console.log(`node src/extract-production-plan.js --api --by-project --components ${planIds}`);
            }
        }

    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkMissingStatusEvents().catch(console.error);
}

module.exports = { checkMissingStatusEvents };
