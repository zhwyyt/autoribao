const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkPlanFields() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 2,
        application_name: 'check-plan-fields'
    });

    try {
        // 检查 production_plan 表结构
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'production_plan' 
            ORDER BY ordinal_position
        `);
        
        console.log('production_plan 表字段:');
        res.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type}`);
        });

        // 检查计划 6516 的数据
        const planRes = await pool.query(`
            SELECT * FROM production_plan WHERE plan_id = 6516 LIMIT 1
        `);
        
        if (planRes.rows.length > 0) {
            console.log('\n计划 6516 的数据:');
            Object.keys(planRes.rows[0]).forEach(key => {
                console.log(`  ${key}: ${planRes.rows[0][key]}`);
            });
        } else {
            console.log('\n计划 6516 不存在');
        }
    } catch (err) {
        console.error('错误:', err.message);
    } finally {
        await pool.end();
    }
}

checkPlanFields();
