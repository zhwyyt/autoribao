const { query } = require('./src/query/sql-runner');

async function main() {
  const projectName = process.argv[2];
  const guid = process.argv[3];
  if (!projectName || !guid) {
    throw new Error('用法: node .\\debug-query-fitup-guid.js "项目名" "构件GUID"');
  }

  const fitupSql = `
    SELECT
      p.project_name,
      pp.plan_name,
      c.component_guid,
      c.component_no,
      c.spec,
      c.quantity,
      c.weight,
      c.location,
      e.event_id,
      timezone('Asia/Shanghai', e.event_at) AS event_at_local,
      timezone('Asia/Shanghai', e.created_at) AS created_at_local,
      trim(e.team_name) AS team_name,
      trim(e.operator_name) AS operator_name,
      trim(e.trace_operator_name) AS trace_operator_name,
      e.observed_at,
      e.raw_value
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE e.status_type = 'fitup_weld_report'
      AND p.project_name = $1
      AND c.component_guid = $2
    ORDER BY e.event_at, e.event_id
  `;

  const componentSql = `
    SELECT
      p.project_name,
      pp.plan_name,
      c.component_guid,
      c.component_no,
      c.current_status,
      timezone('Asia/Shanghai', c.current_status_at) AS current_status_at_local,
      c.quantity,
      c.weight,
      c.location
    FROM component c
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE p.project_name = $1
      AND c.component_guid = $2
  `;

  const historySql = `
    SELECT
      e.status_type,
      e.is_completed,
      timezone('Asia/Shanghai', e.event_at) AS event_at_local,
      timezone('Asia/Shanghai', e.created_at) AS created_at_local,
      trim(e.team_name) AS team_name,
      trim(e.operator_name) AS operator_name,
      trim(e.trace_operator_name) AS trace_operator_name,
      e.raw_value
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE p.project_name = $1
      AND c.component_guid = $2
    ORDER BY e.event_at, e.event_id
  `;

  const [componentRes, fitupRes, historyRes] = await Promise.all([
    query(componentSql, [projectName, guid]),
    query(fitupSql, [projectName, guid]),
    query(historySql, [projectName, guid])
  ]);

  console.log(JSON.stringify({
    component: componentRes.rows || [],
    fitupEvents: fitupRes.rows || [],
    allEvents: historyRes.rows || []
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
