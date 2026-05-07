const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkEventTableFields() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 2,
        application_name: 'check-event-table-fields'
    });

    try {
        // 检查 component_status_event 表结构
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'component_status_event' 
            ORDER BY ordinal_position
        `);
        
        console.log('component_status_event 表字段:');
        res.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type}`);
        });
    } catch (err) {
        console.error('错误:', err.message);
    } finally {
        await pool.end();
    }
}

checkEventTableFields();
