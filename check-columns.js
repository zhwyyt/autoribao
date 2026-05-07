const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkColumns() {
  const db = config.db || {};
  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database
  });

  try {
    const res = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'component_status_event' 
      ORDER BY ordinal_position
    `);
    
    console.log('component_status_event 表字段列表:');
    res.rows.forEach(row => console.log('  ' + row.column_name));
  } finally {
    await pool.end();
  }
}

checkColumns().catch(console.error);
