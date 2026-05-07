const { query } = require('./src/query/sql-runner');

async function main() {
  const start = '2026-03-26';
  const end = '2026-04-25';
  const projectName = '和孚重兆职工公寓项目';

  const fields = ['event_at', 'created_at', 'updated_at', 'observed_at'];

  for (const field of fields) {
    const sql = `
      SELECT
        '${field}' AS field_name,
        COUNT(*)::int AS event_count,
        COUNT(DISTINCT e.component_id)::int AS component_count,
        COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS weight_kg
      FROM component_status_event e
      JOIN component c ON c.component_id = e.component_id
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE e.status_type = 'shipping'
        AND e.is_completed = TRUE
        AND e.${field} IS NOT NULL
        AND timezone('Asia/Shanghai', e.${field})::date >= $1::date
        AND timezone('Asia/Shanghai', e.${field})::date <= $2::date
        AND p.project_name = $3
    `;
    const res = await query(sql, [start, end, projectName]);
    console.log(JSON.stringify(res.rows, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
