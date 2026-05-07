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
        p.project_name
      FROM production_plan pp
      JOIN project p ON p.project_id = pp.project_id
      WHERE pp.plan_name = $1
    ),
    component_base AS (
      SELECT
        tp.project_name,
        tp.plan_name,
        c.component_id,
        c.component_guid,
        c.component_no,
        c.weight,
        c.quantity
      FROM target_plan tp
      JOIN component c ON c.plan_id = tp.plan_id
    ),
    shipped AS (
      SELECT
        e.component_id,
        MAX(e.event_at) AS last_shipping_at,
        COUNT(*)::int AS shipping_event_count
      FROM component_status_event e
      JOIN component_base cb ON cb.component_id = e.component_id
      WHERE e.status_type = 'shipping'
        AND e.is_completed = TRUE
      GROUP BY e.component_id
    )
    SELECT
      cb.project_name,
      cb.plan_name,
      COUNT(*)::int AS component_count,
      COUNT(s.component_id)::int AS shipped_component_count,
      COALESCE(SUM(CASE WHEN s.component_id IS NOT NULL THEN COALESCE(cb.weight, 0) * COALESCE(cb.quantity, 1) ELSE 0 END), 0)::numeric(18,3) AS shipped_weight_kg,
      MIN(s.last_shipping_at) AS first_shipping_at,
      MAX(s.last_shipping_at) AS last_shipping_at
    FROM component_base cb
    LEFT JOIN shipped s ON s.component_id = cb.component_id
    GROUP BY cb.project_name, cb.plan_name
  `;

  const detailSql = `
    WITH target_plan AS (
      SELECT pp.plan_id
      FROM production_plan pp
      WHERE pp.plan_name = $1
    )
    SELECT
      c.component_no,
      c.component_guid,
      COALESCE(c.weight, 0)::numeric(18,3) AS weight_kg,
      COALESCE(c.quantity, 1)::int AS quantity,
      MAX(e.event_at) AS last_shipping_at,
      COUNT(e.event_id)::int AS shipping_event_count
    FROM component c
    JOIN target_plan tp ON tp.plan_id = c.plan_id
    LEFT JOIN component_status_event e
      ON e.component_id = c.component_id
     AND e.status_type = 'shipping'
     AND e.is_completed = TRUE
    GROUP BY c.component_id, c.component_no, c.component_guid, c.weight, c.quantity
    HAVING COUNT(e.event_id) > 0
    ORDER BY last_shipping_at DESC NULLS LAST, c.component_no ASC, c.component_guid ASC
    LIMIT 20
  `;

  const [summaryRes, detailRes] = await Promise.all([
    query(sql, [planName]),
    query(detailSql, [planName])
  ]);

  console.log(JSON.stringify({
    planName,
    summary: summaryRes.rows,
    shippedSamples: detailRes.rows
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
