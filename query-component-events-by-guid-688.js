const { Pool } = require('pg');
const config = require('./config/default.json');

async function main() {
  const db = config.db || {};
  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database,
    max: 2,
    application_name: 'query-component-events-by-guid-688'
  });

  const planId = 688;
  const componentGuid = '0511GABxcfYC-4';

  try {
    const cRes = await pool.query(
      `
      SELECT component_id, component_no, component_guid, quantity
      FROM component
      WHERE plan_id = $1 AND component_guid = $2
      `,
      [planId, componentGuid]
    );

    if (cRes.rows.length === 0) {
      const likeRes = await pool.query(
        `
        SELECT component_no, component_guid
        FROM component
        WHERE plan_id = $1 AND component_guid ILIKE $2
        ORDER BY component_guid
        LIMIT 20
        `,
        [planId, `%${componentGuid}%`]
      );

      console.log('未找到该 component_guid 的构件记录');
      if (likeRes.rows.length > 0) {
        console.log('以下为相似 component_guid（前20条）：');
        for (const r of likeRes.rows) {
          console.log(`  ${r.component_guid}\t${r.component_no || ''}`);
        }
      }
      return;
    }

    const c = cRes.rows[0];
    console.log(`component_id=${c.component_id}\tcomponent_no=${c.component_no || ''}\tcomponent_guid=${c.component_guid}`);

    const eRes = await pool.query(
      `
      SELECT status_type, event_at, is_completed, operator_name, team_name, raw_value
      FROM component_status_event
      WHERE component_id = $1
      ORDER BY event_at DESC NULLS LAST, updated_at DESC
      `,
      [c.component_id]
    );

    if (eRes.rows.length === 0) {
      console.log('该构件没有任何状态事件');
      return;
    }

    const typeCount = new Map();
    for (const r of eRes.rows) {
      typeCount.set(r.status_type, (typeCount.get(r.status_type) || 0) + 1);
    }

    console.log('状态类型统计:');
    for (const [t, n] of typeCount.entries()) {
      console.log(`  ${t}: ${n}`);
    }

    const shipping = eRes.rows.filter(r => r.status_type === 'shipping');
    if (shipping.length > 0) {
      console.log('\nshipping 事件(最多5条):');
      for (const r of shipping.slice(0, 5)) {
        console.log(`  event_at=${r.event_at ? new Date(r.event_at).toISOString() : ''}\toperator=${r.operator_name || ''}\traw=${r.raw_value || ''}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
