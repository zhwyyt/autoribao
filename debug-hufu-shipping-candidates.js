const { query } = require('./src/query/sql-runner');

async function runOne(label, sql, params) {
  const res = await query(sql, params);
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(res.rows, null, 2));
}

async function main() {
  const start = '2026-03-26';
  const end = '2026-04-25';
  const projectName = '和孚重兆职工公寓项目';

  await runOne(
    'shipping events by event_at',
    `
      SELECT
        COUNT(*)::int AS row_count,
        COUNT(DISTINCT e.component_id)::int AS component_count,
        COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS weight_kg
      FROM component_status_event e
      JOIN component c ON c.component_id = e.component_id
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE p.project_name = $1
        AND e.status_type = 'shipping'
        AND e.is_completed = TRUE
        AND e.event_at IS NOT NULL
        AND timezone('Asia/Shanghai', e.event_at)::date BETWEEN $2::date AND $3::date
    `,
    [projectName, start, end]
  );

  await runOne(
    'components current_status=shipping by current_status_at',
    `
      SELECT
        COUNT(*)::int AS row_count,
        COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS weight_kg
      FROM component c
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE p.project_name = $1
        AND c.current_status = 'shipping'
        AND c.current_status_at IS NOT NULL
        AND timezone('Asia/Shanghai', c.current_status_at)::date BETWEEN $2::date AND $3::date
    `,
    [projectName, start, end]
  );

  await runOne(
    'components current_status=shipping regardless of date',
    `
      SELECT
        COUNT(*)::int AS row_count,
        COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS weight_kg
      FROM component c
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE p.project_name = $1
        AND c.current_status = 'shipping'
    `,
    [projectName]
  );

  await runOne(
    'all project components',
    `
      SELECT
        COUNT(*)::int AS row_count,
        COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS weight_kg
      FROM component c
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE p.project_name = $1
    `,
    [projectName]
  );

  await runOne(
    'all project components by component updated_at in cycle',
    `
      SELECT
        COUNT(*)::int AS row_count,
        COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS weight_kg
      FROM component c
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE p.project_name = $1
        AND timezone('Asia/Shanghai', c.updated_at)::date BETWEEN $2::date AND $3::date
    `,
    [projectName, start, end]
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
