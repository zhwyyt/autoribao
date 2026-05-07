const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkSpecificPlans() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 2
    });
    
    try {
        const planIds = [2284, 1527, 688];
        
        for (const planId of planIds) {
            console.log(`\n=== 检查计划 ${planId} ===`);
            
            // 检查计划信息
            const planRes = await pool.query(`
                SELECT plan_id, plan_name, component_count
                FROM production_plan 
                WHERE plan_id = $1
            `, [planId]);
            
            if (planRes.rows.length === 0) {
                console.log(`计划 ${planId} 不存在`);
                continue;
            }
            
            const plan = planRes.rows[0];
            console.log(`计划名称: ${plan.plan_name}`);
            console.log(`预期构件数: ${plan.component_count}`);
            
            // 检查构件数据
            const compRes = await pool.query(`
                SELECT component_no, quantity, weight, length
                FROM component 
                WHERE plan_id = $1
                ORDER BY component_no
                LIMIT 10
            `, [planId]);
            
            console.log(`实际构件数: ${compRes.rows.length}`);
            
            if (compRes.rows.length > 0) {
                console.log('前10个构件:');
                compRes.forEach(row => {
                    console.log(`  ${row.component_no}: 数量=${row.quantity}, 重量=${row.weight}, 长度=${row.length}`);
                });
                
                // 检查是否有异常数量
                const invalidQty = await pool.query(`
                    SELECT COUNT(*) as count
                    FROM component 
                    WHERE plan_id = $1 AND (quantity IS NULL OR quantity <= 0)
                `, [planId]);
                
                if (invalidQty.rows[0].count > 0) {
                    console.log(`⚠️ 发现 ${invalidQty.rows[0].count} 个数量异常的构件`);
                    
                    const invalidList = await pool.query(`
                        SELECT component_no, quantity
                        FROM component 
                        WHERE plan_id = $1 AND (quantity IS NULL OR quantity <= 0)
                        LIMIT 5
                    `, [planId]);
                    
                    console.log('异常构件示例:');
                    invalidList.forEach(row => {
                        console.log(`  ${row.component_no}: 数量=${row.quantity}`);
                    });
                }
            } else {
                console.log('❌ 该计划没有构件数据');
            }
        }
        
    } finally {
        await pool.end();
    }
}

checkSpecificPlans().catch(console.error);
