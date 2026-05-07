const { query } = require('./src/query/sql-runner');

async function main() {
  const start = '2026-03-26';
  const end = '2026-04-25';
  const projectName = '和孚重兆职工公寓项目';

  const sql = `
    SELECT
      p.project_name,
      COUNT(*)::int AS event_count,
      SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)) AS raw_sum,
      pg_typeof(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)))::text AS raw_sum_type,
      MAX(c.weight) AS max_weight,
      MIN(c.weight) AS min_weight
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE e.status_type = 'fitup_weld_report'
      AND e.is_completed = TRUE
      AND e.event_at IS NOT NULL
      AND timezone('Asia/Shanghai', e.event_at)::date >= $1::date
      AND timezone('Asia/Shanghai', e.event_at)::date <= $2::date
      AND p.project_name = $3
    GROUP BY p.project_name
  `;

  const res = await query(sql, [start, end, projectName]);
  console.log(JSON.stringify(res.rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
