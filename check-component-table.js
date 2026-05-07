const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkComponentTableFields() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 2,
        application_name: 'check-component-table-fields'
    });

    try {
        // 检查 component 表结构
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'component' 
            ORDER BY ordinal_position
        `);
        
        console.log('component 表字段:');
        res.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type}`);
        });

        // 检查主键约束
        const pkRes = await pool.query(`
            SELECT a.attname
            FROM pg_constraint c
            JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
            WHERE c.conrelid = 'component'::regclass AND c.contype = 'p'
        `);
        
        console.log('\ncomponent 表主键:');
        pkRes.rows.forEach(row => {
            console.log(`  ${row.attname}`);
        });
    } catch (err) {
        console.error('错误:', err.message);
    } finally {
        await pool.end();
    }
}

checkComponentTableFields();
