const { query } = require('./src/query/sql-runner');

async function queryTeamCounts(statusType) {
  const sql = `
    SELECT
      COALESCE(NULLIF(trim(team_name), ''), '<<EMPTY>>') AS team_name,
      COUNT(*)::int AS row_count,
      COUNT(DISTINCT e.component_id)::int AS component_count,
      COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS total_weight_kg
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    WHERE e.status_type = $1
      AND e.is_completed = TRUE
      AND e.event_at IS NOT NULL
      AND timezone('Asia/Shanghai', e.event_at)::date = DATE '2026-04-28'
    GROUP BY COALESCE(NULLIF(trim(team_name), ''), '<<EMPTY>>')
    ORDER BY row_count DESC, team_name ASC
  `;
  const res = await query(sql, [statusType]);
  return res.rows || [];
}

async function queryGuidEvents(statusType, guids) {
  const sql = `
    SELECT
      p.project_name,
      pp.plan_name,
      c.component_guid,
      c.component_no,
      c.spec,
      c.location,
      c.quantity,
      c.weight,
      timezone('Asia/Shanghai', e.event_at) AS event_at_local,
      COALESCE(NULLIF(trim(e.team_name), ''), '<<EMPTY>>') AS team_name,
      COALESCE(NULLIF(trim(e.operator_name), ''), '<<EMPTY>>') AS operator_name,
      e.event_id
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE e.status_type = $1
      AND c.component_guid = ANY($2)
    ORDER BY c.component_guid ASC, e.event_at DESC NULLS LAST, e.event_id DESC
  `;
  const res = await query(sql, [statusType, guids]);
  return res.rows || [];
}

async function main() {
  const ndiCounts = await queryTeamCounts('fitup_weld_ndi');
  const reportCounts = await queryTeamCounts('fitup_weld_report');
  const sampleGuids = [
    'T2-4BGZ1-21-GJG-20260415102853-0022',
    'T2-5BGL1-1-GJG-20260415102853-0079',
    'A1-8GKL-1-GJG-20260327134535-0033',
    'A1-4GZ-1-GJG-20260327134535-0001',
    'A1-4GZ-9-GJG-20260327134535-0009'
  ];
  const ndiEvents = await queryGuidEvents('fitup_weld_ndi', sampleGuids);
  const reportEvents = await queryGuidEvents('fitup_weld_report', sampleGuids);
  console.log(JSON.stringify({
    ndiCounts,
    reportCounts,
    ndiEvents,
    reportEvents
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
