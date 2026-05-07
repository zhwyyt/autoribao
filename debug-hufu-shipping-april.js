const { query } = require('./src/query/sql-runner');

async function main() {
  const start = '2026-03-26';
  const end = '2026-04-25';
  const projectName = '和孚重兆职工公寓项目';

  const summarySql = `
    SELECT
      p.project_name,
      COUNT(*)::int AS event_count,
      COUNT(DISTINCT e.component_id)::int AS component_count,
      COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS weight_kg
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE e.status_type = 'shipping'
      AND e.is_completed = TRUE
      AND e.event_at IS NOT NULL
      AND timezone('Asia/Shanghai', e.event_at)::date >= $1::date
      AND timezone('Asia/Shanghai', e.event_at)::date <= $2::date
      AND p.project_name = $3
    GROUP BY p.project_name
  `;

  const detailSql = `
    SELECT
      to_char(timezone('Asia/Shanghai', e.event_at), 'YYYY-MM-DD HH24:MI:SS') AS event_at,
      c.component_no,
      c.component_guid,
      c.quantity,
      c.weight,
      (COALESCE(c.weight, 0) * COALESCE(c.quantity, 1))::numeric(18,3) AS weight_kg,
      pp.plan_name,
      e.operator_name,
      e.team_name
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE e.status_type = 'shipping'
      AND e.is_completed = TRUE
      AND e.event_at IS NOT NULL
      AND timezone('Asia/Shanghai', e.event_at)::date >= $1::date
      AND timezone('Asia/Shanghai', e.event_at)::date <= $2::date
      AND p.project_name = $3
    ORDER BY e.event_at, c.component_no
    LIMIT 200
  `;

  const [summaryRes, detailRes] = await Promise.all([
    query(summarySql, [start, end, projectName]),
    query(detailSql, [start, end, projectName])
  ]);

  console.log('=== SHIPPING SUMMARY ===');
  console.log(JSON.stringify(summaryRes.rows, null, 2));
  console.log('=== SHIPPING DETAILS ===');
  console.log(JSON.stringify(detailRes.rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
