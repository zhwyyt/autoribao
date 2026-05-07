const { query } = require('./src/query/sql-runner');

async function main() {
  const componentNo = process.argv.slice(2).join(' ').trim();
  if (!componentNo) {
    throw new Error('请传入构件编号');
  }

  const sql = `
    WITH matched AS (
      SELECT
        p.project_name,
        pp.plan_name,
        c.component_id,
        c.component_no,
        c.component_guid,
        c.model_id,
        COALESCE(c.weight, 0)::numeric(18,3) AS weight_kg,
        COALESCE(c.quantity, 1)::int AS quantity
      FROM component c
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE c.component_no = $1
    ),
    shipping AS (
      SELECT
        e.component_id,
        COUNT(*)::int AS shipping_event_count,
        MIN(e.event_at) AS first_shipping_at,
        MAX(e.event_at) AS last_shipping_at
      FROM component_status_event e
      JOIN matched m ON m.component_id = e.component_id
      WHERE e.status_type = 'shipping'
        AND e.is_completed = TRUE
      GROUP BY e.component_id
    )
    SELECT
      m.project_name,
      m.plan_name,
      m.component_no,
      m.component_guid,
      COALESCE(m.model_id, '') AS model_id,
      m.weight_kg,
      m.quantity,
      COALESCE(s.shipping_event_count, 0)::int AS shipping_event_count,
      s.first_shipping_at,
      s.last_shipping_at
    FROM matched m
    LEFT JOIN shipping s ON s.component_id = m.component_id
    ORDER BY m.project_name, m.plan_name, m.component_guid
  `;

  const res = await query(sql, [componentNo]);
  console.log(JSON.stringify({
    componentNo,
    count: res.rows.length,
    rows: res.rows
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
