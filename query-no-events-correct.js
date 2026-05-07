const { Pool } = require('pg');
const config = require('./config/default.json');

async function queryNoEventsCorrect() {
  const db = config.db || {};
  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database
  });

  try {
    // 查询完全无事件状态的计划（有构件但没有任何状态事件）
    const plansWithoutEventsListRes = await pool.query(`
      SELECT pp.plan_id, pp.plan_name, p.project_name, pp.start_at, pp.end_at,
             COUNT(c.component_id) as component_count
      FROM production_plan pp
      JOIN component c ON c.plan_id = pp.plan_id
      JOIN project p ON pp.project_id = p.project_id
      WHERE NOT EXISTS (
        SELECT 1 FROM component_status_event cse 
        WHERE cse.component_id = c.component_id
      )
      GROUP BY pp.plan_id, pp.plan_name, p.project_name, pp.start_at, pp.end_at
      ORDER BY pp.plan_id
    `);
    
    const plansWithoutEventsCount = plansWithoutEventsListRes.rows.length;
    
    console.log('=== 完全无事件状态的计划统计 ===');
    console.log(`完全无事件状态的计划数: ${plansWithoutEventsCount}`);
    
    if (plansWithoutEventsListRes.rows.length > 0) {
      console.log('\n=== 完全无事件状态的计划列表 ===');
      plansWithoutEventsListRes.rows.forEach(row => {
        console.log(`计划ID: ${row.plan_id}`);
        console.log(`  计划名称: ${row.plan_name}`);
        console.log(`  项目名称: ${row.project_name}`);
        console.log(`  构件数量: ${row.component_count}`);
        console.log(`  开始时间: ${row.start_at ? row.start_at.toISOString().split('T')[0] : 'NULL'}`);
        console.log(`  结束时间: ${row.end_at ? row.end_at.toISOString().split('T')[0] : 'NULL'}`);
        console.log('---');
      });
    } else {
      console.log('\n✅ 所有有构件的计划都有状态事件');
    }
    
  } finally {
    await pool.end();
  }
}

queryNoEventsCorrect().catch(console.error);
