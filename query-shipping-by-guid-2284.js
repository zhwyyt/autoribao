const { Pool } = require('pg');
const config = require('./config/default.json');

async function main() {
  const db = config.db || {};
  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database
  });
    const planName = '1118安吉艺术中心舞台楼梯';
  const componentGuid = '1118ANJIwtLT-9';
  
  try {
    // 先查询计划ID
    const planRes = await pool.query(`
        SELECT plan_id 
        FROM production_plan 
        WHERE plan_name = $1
    `, [planName]);
    
    if (planRes.rows.length === 0) {
      console.log(`未找到计划: ${planName}`);
      return;
    }
    
    const planId = planRes.rows[0].plan_id;
    console.log(`找到计划: ${planName} (plan_id=${planId})`);
    
    // 查询构件基本信息
    const componentRes = await pool.query(`
        SELECT component_id, component_no, component_guid
        FROM component 
        WHERE plan_id = $1 AND component_guid = $2
    `, [planId, componentGuid]);
    
    if (componentRes.rows.length === 0) {
      console.log(`未找到构件: ${componentGuid}`);
      return;
    }
    
    const component = componentRes.rows[0];
    console.log(`构件信息: component_id=${component.component_id} component_no=${component.component_no} component_guid=${component.component_guid}`);
    
    // 查询发货状态事件
    const shippingRes = await pool.query(`
        SELECT event_at, operator_name, trace_operator_name
        FROM component_status_event 
        WHERE component_id = $1 AND status_type = 'shipping'
        ORDER BY event_at DESC
    `, [component.component_id]);
    
    if (shippingRes.rows.length === 0) {
      console.log('未查到 shipping(发货) 状态事件');
    } else {
      console.log('\n发货状态事件:');
      shippingRes.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. 发货时间: ${row.event_at ? row.event_at.toISOString() : 'NULL'}`);
        console.log(`     操作人员: ${row.operator_name || 'NULL'}`);
        console.log(`     追溯操作人员: ${row.trace_operator_name || 'NULL'}`);
      });
    }
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
