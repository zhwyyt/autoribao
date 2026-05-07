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
    max: 3,
    application_name: 'verify-retry-import'
  });

  const planIds = [2808, 2803, 2660, 2071, 2065, 2284, 1527, 688];

  try {
    const res = await pool.query(
      `
      WITH base AS (
        SELECT p.plan_id, p.plan_name, pr.project_name
        FROM production_plan p
        LEFT JOIN project pr ON pr.project_id = p.project_id
        WHERE p.plan_id = ANY($1::int[])
      ),
      comp AS (
        SELECT plan_id, count(*)::bigint AS component_rows
        FROM component
        WHERE plan_id = ANY($1::int[])
        GROUP BY plan_id
      ),
      evt AS (
        SELECT c.plan_id,
               count(e.*)::bigint AS event_rows,
               count(*) FILTER (WHERE e.event_at IS NULL)::bigint AS event_at_null,
               count(*) FILTER (WHERE e.event_at IS NOT NULL)::bigint AS event_at_not_null
        FROM component c
        LEFT JOIN component_status_event e ON e.component_id = c.component_id
        WHERE c.plan_id = ANY($1::int[])
        GROUP BY c.plan_id
      )
      SELECT b.plan_id, b.plan_name, b.project_name,
             COALESCE(comp.component_rows, 0) AS component_rows,
             COALESCE(evt.event_rows, 0) AS event_rows,
             COALESCE(evt.event_at_not_null, 0) AS event_at_not_null,
             COALESCE(evt.event_at_null, 0) AS event_at_null
      FROM base b
      LEFT JOIN comp ON comp.plan_id = b.plan_id
      LEFT JOIN evt ON evt.plan_id = b.plan_id
      ORDER BY array_position($1::int[], b.plan_id)
      `,
      [planIds]
    );

    console.log('plan_id\tcomponents\tevents\tevent_at_not_null\tevent_at_null\tplan_name\tproject_name');
    for (const r of res.rows) {
      console.log(
        `${r.plan_id}\t${r.component_rows}\t${r.event_rows}\t${r.event_at_not_null}\t${r.event_at_null}\t${r.plan_name || ''}\t${r.project_name || ''}`
      );
    }

    const problematic = res.rows.filter(r => Number(r.component_rows) > 0 && Number(r.event_rows) === 0);
    if (problematic.length > 0) {
      console.log('\n[WARN] 有构件但仍然没有状态事件的计划:');
      for (const r of problematic) console.log(`- ${r.plan_id} ${r.plan_name}`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
