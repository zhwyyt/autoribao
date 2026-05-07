const { query } = require('./src/query/sql-runner');
const { loadTeamDirectory } = require('./src/query/team-directory-loader');

async function main() {
  const directory = await loadTeamDirectory();
  const values = new Set();
  for (const member of directory.members || []) {
    const raw = member && member.ndiTeamName;
    const text = String(raw || '').trim();
    if (text) values.add(text.replace(/\s+/g, ''));
  }
  values.add('王国良探伤组');
  const teamNames = Array.from(values);

  const sql = `
    WITH latest_process AS (
      SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
        p.project_name,
        pp.plan_name,
        COALESCE(NULLIF(trim(c.component_guid), ''), '') AS component_guid,
        COALESCE(NULLIF(trim(c.component_no), ''), '') AS component_no,
        COALESCE(NULLIF(trim(c.spec), ''), '') AS spec,
        COALESCE(NULLIF(trim(c.location), ''), '') AS location,
        COALESCE(c.quantity, 1)::int AS quantity,
        COALESCE(c.weight, 0)::numeric(18,3) AS weight_kg,
        (COALESCE(c.weight, 0) * COALESCE(c.quantity, 1))::numeric(18,3) AS total_weight_kg,
        timezone('Asia/Shanghai', e.event_at) AS event_at_local,
        COALESCE(NULLIF(trim(e.team_name), ''), '') AS team_name
      FROM component_status_event e
      JOIN component c ON c.component_id = e.component_id
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE e.status_type = 'fitup_weld_ndi'
        AND e.is_completed = TRUE
        AND e.event_at IS NOT NULL
        AND regexp_replace(coalesce(e.team_name, ''), '\\s+', '', 'g') = ANY($1::text[])
      ORDER BY
        p.project_name ASC,
        pp.plan_name ASC,
        c.component_guid ASC,
        timezone('Asia/Shanghai', e.event_at) DESC,
        e.event_id DESC
    )
    SELECT team_name, COUNT(*)::int AS row_count, COALESCE(SUM(total_weight_kg),0)::numeric(18,3) AS total_weight_kg
    FROM latest_process
    WHERE event_at_local::date >= DATE '2026-04-28'
      AND event_at_local::date <= DATE '2026-04-28'
    GROUP BY team_name
    ORDER BY row_count DESC, team_name ASC
  `;
  const res = await query(sql, [teamNames]);
  console.log(JSON.stringify({ teamNames, rows: res.rows || [] }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
