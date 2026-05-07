const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkConstraint() {
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
            SELECT conname, pg_get_constraintdef(oid) as definition
            FROM pg_constraint 
            WHERE conname = 'component_quantity_chk'
        `);
        
        if (res.rows.length > 0) {
            console.log('约束内容:', res.rows[0].definition);
        } else {
            console.log('未找到约束 component_quantity_chk');
        }
        
    } finally {
        await pool.end();
    }
}

checkConstraint().catch(console.error);
