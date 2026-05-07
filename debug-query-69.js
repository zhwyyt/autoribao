const { Pool } = require('pg');
const config = require('./config/default.json');

async function debugQuery69() {
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
    
    // 检查计划69是否出现在"无事件状态"查询中
    const checkRes = await pool.query(`
      SELECT pp.plan_id, pp.plan_name, p.project_name, pp.start_at, pp.end_at,
             COUNT(c.component_id) as component_count
      FROM production_plan pp
      JOIN component c ON c.plan_id = pp.plan_id
      JOIN project p ON pp.project_id = p.project_id
      WHERE pp.plan_id = $1
      AND NOT EXISTS (
        SELECT 1 FROM component_status_event cse 
        WHERE cse.component_id = c.component_id
      )
      GROUP BY pp.plan_id, pp.plan_name, p.project_name, pp.start_at, pp.end_at
      ORDER BY pp.plan_id
    `, [planId]);
    
    console.log(`计划69是否在"无事件状态"查询中: ${checkRes.rows.length > 0 ? '是' : '否'}`);
    
    if (checkRes.rows.length > 0) {
      console.log('查询结果:');
      console.log(checkRes.rows[0]);
    }
    
    // 手动检查是否存在状态事件
    const eventCheckRes = await pool.query(`
      SELECT cse.component_id, cse.status_type, cse.event_at
      FROM component_status_event cse
      JOIN component c ON cse.component_id = c.component_id
      WHERE c.plan_id = $1
      LIMIT 5
    `, [planId]);
    
    console.log(`\n手动检查计划69的状态事件:`);
    console.log(`找到 ${eventCheckRes.rows.length} 条状态事件`);
    eventCheckRes.rows.forEach(row => {
      console.log(`  component_id: ${row.component_id}, status_type: ${row.status_type}, event_at: ${row.event_at}`);
    });
    
  } finally {
    await pool.end();
  }
}

debugQuery69().catch(console.error);
