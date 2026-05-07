const { query } = require('./src/query/sql-runner');

async function main() {
  const sql = `
    SELECT
      p.project_name,
      pp.plan_name,
      c.component_id,
      c.component_guid,
      c.component_no,
      c.spec,
      c.location,
      c.quantity,
      c.weight,
      (COALESCE(c.weight, 0) * COALESCE(c.quantity, 1))::numeric(18,3) AS total_weight_kg
    FROM component c
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE c.component_guid ~ '^D9-2MB-2-fxc-251225-(0[1-9]|1[0-6])$'
    ORDER BY c.component_guid ASC
  `;
  const res = await query(sql, []);
  console.log(JSON.stringify(res.rows || [], null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
