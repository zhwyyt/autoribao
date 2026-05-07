const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkEventTableConstraints() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database,
        max: 2,
        application_name: 'check-event-table-constraints'
    });

    try {
        // 检查所有约束
        const res = await pool.query(`
            SELECT 
                tc.constraint_name,
                tc.constraint_type,
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            WHERE tc.table_name = 'component_status_event'
                AND tc.table_schema = 'public'
            ORDER BY tc.constraint_type, tc.constraint_name
        `);
        
        console.log('component_status_event 表约束:');
        res.rows.forEach(row => {
            console.log(`  ${row.constraint_type}: ${row.constraint_name} (${row.column_name})`);
        });
    } catch (err) {
        console.error('错误:', err.message);
    } finally {
        await pool.end();
    }
}

checkEventTableConstraints();
