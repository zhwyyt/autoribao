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
    application_name: 'query-shipping-by-guid-688'
  });

  const planId = 688;
  const componentGuid = '0511GABxcfYC-4';

  try {
    const res = await pool.query(
      `
      SELECT
        c.component_no,
        c.component_guid,
        e.status_type,
        e.event_at,
        e.is_completed,
        e.operator_name,
        e.team_name,
        e.trace_operator_name,
        e.raw_value,
        e.updated_at
      FROM component c
      LEFT JOIN component_status_event e ON e.component_id = c.component_id
      WHERE c.plan_id = $1
        AND c.component_guid = $2
        AND e.status_type = 'shipping'
      ORDER BY e.event_at DESC NULLS LAST, e.updated_at DESC
      `,
      [planId, componentGuid]
    );

    if (res.rows.length === 0) {
      console.log('未查到 shipping(发货) 状态事件');
      return;
    }

    for (const r of res.rows) {
      console.log(
        [
          `component_no=${r.component_no || ''}`,
          `event_at=${r.event_at ? new Date(r.event_at).toISOString() : ''}`,
          `operator_name=${r.operator_name || ''}`,
          `team_name=${r.team_name || ''}`,
          `is_completed=${r.is_completed}`,
          `raw_value=${r.raw_value || ''}`
        ].join('\t')
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
