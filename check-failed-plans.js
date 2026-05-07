const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkFailedPlans() {
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
        console.log('=== 检查没有构件数据的计划 ===');
        
        // 查询所有计划，但缺少构件数据的
        const res = await pool.query(`
            SELECT 
                p.plan_id,
                p.plan_name,
                pr.project_name,
                p.component_count as expected_count,
                COUNT(c.component_id) as actual_count,
                CASE 
                    WHEN COUNT(c.component_id) = 0 THEN '❌ 完全失败'
                    WHEN COUNT(c.component_id) < p.component_count THEN '⚠️ 部分缺失'
                    ELSE '✅ 正常'
                END as status
            FROM production_plan p
            LEFT JOIN project pr ON p.project_id = pr.project_id
            LEFT JOIN component c ON p.plan_id = c.plan_id
            WHERE p.component_count > 0  -- 只检查应该有构件的计划
            GROUP BY p.plan_id, p.plan_name, pr.project_name, p.component_count
            ORDER BY p.plan_id DESC
            LIMIT 50
        `);

        console.log('计划ID\t计划名称\t项目名称\t预期数量\t实际数量\t状态');
        console.log('---\t---\t---\t---\t---\t---');
        
        const failedPlans = [];
        
        for (const row of res.rows) {
            const { plan_id, plan_name, project_name, expected_count, actual_count, status } = row;
            
            console.log(`${plan_id}\t${(plan_name || 'N/A').substring(0, 20)}\t${(project_name || 'N/A').substring(0, 20)}\t${expected_count}\t${actual_count}\t${status}`);
            
            if (status.includes('❌') || status.includes('⚠️')) {
                failedPlans.push(plan_id);
            }
        }

        console.log(`\n=== 失败计划列表 ===`);
        console.log(`共 ${failedPlans.length} 个计划需要重新导入`);
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
    checkFailedPlans().catch(console.error);
}

module.exports = { checkFailedPlans };
