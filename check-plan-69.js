const { Pool } = require('pg');
const config = require('./config/default.json');

async function checkPlan69() {
  const db = config.db || {};
  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database
  });

  try {
    const planId = 69;
    
    // 查询构件数量
    const componentRes = await pool.query(`
      SELECT COUNT(*) as count FROM component WHERE plan_id = $1
    `, [planId]);
    
    // 查询状态事件数量
    const eventRes = await pool.query(`
      SELECT COUNT(*) as count 
      FROM component_status_event cse
      JOIN component c ON cse.component_id = c.component_id
      WHERE c.plan_id = $1
    `, [planId]);
    
    // 查询状态事件类型分布
    const eventTypeRes = await pool.query(`
      SELECT cse.status_type, COUNT(*) as count
      FROM component_status_event cse
      JOIN component c ON cse.component_id = c.component_id
      WHERE c.plan_id = $1
      GROUP BY cse.status_type
      ORDER BY cse.status_type
    `, [planId]);
    
    console.log(`计划ID ${planId} 检查结果:`);
    console.log(`构件数量: ${componentRes.rows[0].count}`);
    console.log(`状态事件总数: ${eventRes.rows[0].count}`);
    
    if (eventTypeRes.rows.length > 0) {
      console.log('状态事件类型分布:');
      eventTypeRes.rows.forEach(row => {
        console.log(`  ${row.status_type}: ${row.count}`);
      });
    } else {
      console.log('❌ 该计划确实没有任何状态事件');
    }
    
  } finally {
    await pool.end();
  }
}

checkPlan69().catch(console.error);
