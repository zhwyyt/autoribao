const { Pool } = require('pg');
const config = require('./config/default.json');

async function querySummaryStats() {
  const db = config.db || {};
  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database
  });

  try {
    // 查询项目总数
    const projectRes = await pool.query('SELECT COUNT(*) as total FROM project');
    const projectCount = projectRes.rows[0].total;
    
    // 查询计划总数
    const planRes = await pool.query('SELECT COUNT(*) as total FROM production_plan');
    const planCount = planRes.rows[0].total;
    
    // 查询有构件的计划
    const plansWithComponentsRes = await pool.query(`
      SELECT COUNT(DISTINCT plan_id) as total 
      FROM component
    `);
    const plansWithComponentsCount = plansWithComponentsRes.rows[0].total;
    
    // 查询完全无事件状态的计划（有构件但没有任何状态事件）
    const plansWithoutEventsRes = await pool.query(`
      SELECT COUNT(*) as total
      FROM production_plan pp
      WHERE EXISTS (
        SELECT 1 FROM component c WHERE c.plan_id = pp.plan_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM component_status_event cse 
        JOIN component c ON cse.component_id = c.component_id 
        WHERE c.plan_id = pp.plan_id
      )
    `);
    const plansWithoutEventsCount = plansWithoutEventsRes.rows[0].total;
    
    // 查询这些无事件状态的计划详情
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
    
    console.log('=== 数据统计概览 ===');
    console.log(`项目总数: ${projectCount}`);
    console.log(`计划总数: ${planCount}`);
    console.log(`有构件的计划数: ${plansWithComponentsCount}`);
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

querySummaryStats().catch(console.error);
