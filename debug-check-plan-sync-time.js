const { query } = require('./src/query/sql-runner');

async function main() {
  const planName = process.argv.slice(2).join(' ').trim();
  if (!planName) {
    throw new Error('请传入计划名称');
  }

  const sql = `
    WITH target_plan AS (
      SELECT
        pp.plan_id,
        pp.plan_name,
        pp.created_at AS plan_created_at,
        pp.updated_at AS plan_updated_at,
        p.project_name
      FROM production_plan pp
      JOIN project p ON p.project_id = pp.project_id
      WHERE pp.plan_name = $1
    ),
    component_stats AS (
      SELECT
        c.plan_id,
        COUNT(*)::int AS component_count,
        MIN(c.created_at) AS first_component_created_at,
        MAX(c.created_at) AS last_component_created_at,
        MIN(c.updated_at) AS first_component_updated_at,
        MAX(c.updated_at) AS last_component_updated_at
      FROM component c
      JOIN target_plan tp ON tp.plan_id = c.plan_id
      GROUP BY c.plan_id
    ),
    event_stats AS (
      SELECT
        c.plan_id,
        COUNT(*)::int AS event_count,
        MIN(e.created_at) AS first_event_created_at,
        MAX(e.created_at) AS last_event_created_at,
        MIN(e.event_at) AS first_event_at,
        MAX(e.event_at) AS last_event_at
      FROM component c
      JOIN target_plan tp ON tp.plan_id = c.plan_id
      LEFT JOIN component_status_event e ON e.component_id = c.component_id
      GROUP BY c.plan_id
    )
    SELECT
      tp.project_name,
      tp.plan_name,
      tp.plan_created_at,
      tp.plan_updated_at,
      cs.component_count,
      cs.first_component_created_at,
      cs.last_component_created_at,
      cs.first_component_updated_at,
      cs.last_component_updated_at,
      es.event_count,
      es.first_event_created_at,
      es.last_event_created_at,
      es.first_event_at,
      es.last_event_at
    FROM target_plan tp
    LEFT JOIN component_stats cs ON cs.plan_id = tp.plan_id
    LEFT JOIN event_stats es ON es.plan_id = tp.plan_id
  `;

  const res = await query(sql, [planName]);
  console.log(JSON.stringify({
    planName,
    rows: res.rows
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
