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
    application_name: 'cleanup-2660-null-events'
  });

  const planId = 2660;

  try {
    const before = await pool.query(
      `
      SELECT count(*)::bigint AS c
      FROM component_status_event e
      JOIN component c ON c.component_id = e.component_id
      WHERE c.plan_id = $1 AND e.event_at IS NULL
      `,
      [planId]
    );

    const beforeCount = before.rows[0] ? Number(before.rows[0].c) : 0;
    console.log(`plan_id=${planId} event_at IS NULL 行数(删除前): ${beforeCount}`);

    const del = await pool.query(
      `
      DELETE FROM component_status_event e
      USING component c
      WHERE c.component_id = e.component_id
        AND c.plan_id = $1
        AND e.event_at IS NULL
      `,
      [planId]
    );

    console.log(`plan_id=${planId} 已删除 event_at IS NULL 行数: ${del.rowCount || 0}`);

    const after = await pool.query(
      `
      SELECT count(*)::bigint AS c
      FROM component_status_event e
      JOIN component c ON c.component_id = e.component_id
      WHERE c.plan_id = $1 AND e.event_at IS NULL
      `,
      [planId]
    );

    const afterCount = after.rows[0] ? Number(after.rows[0].c) : 0;
    console.log(`plan_id=${planId} event_at IS NULL 行数(删除后): ${afterCount}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
