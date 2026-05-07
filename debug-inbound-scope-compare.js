const { query } = require('./src/query/sql-runner');
const { loadTeamDirectory } = require('./src/query/team-directory-loader');

async function fetchScopeSums(teamNames) {
  const sql = `
    SELECT
      p.project_name,
      COALESCE(SUM(COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)), 0)::numeric(18,3) AS weight_kg
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE e.status_type = 'fitup_weld_report'
      AND e.is_completed = TRUE
      AND e.event_at IS NOT NULL
      AND timezone('Asia/Shanghai', e.event_at)::date >= $1::date
      AND timezone('Asia/Shanghai', e.event_at)::date <= $2::date
      AND regexp_replace(COALESCE(e.team_name, ''), '\\s+', '', 'g') = ANY($3::text[])
    GROUP BY p.project_name
    ORDER BY p.project_name
  `;
  const res = await query(sql, ['2026-03-26', '2026-04-25', teamNames]);
  return new Map((res.rows || []).map(row => [row.project_name, Number(row.weight_kg || 0)]));
}

async function main() {
  const directory = await loadTeamDirectory();
  const allTeams = [];
  const zhTeams = [];
  const noEmptyOrExternal = [];

  for (const member of directory.members || []) {
    const team = String(member.fitupTeamName || '').trim().replace(/\s+/g, '');
    const workshop = String(member.fitupWorkshopName || '').trim();
    if (!team) continue;
    allTeams.push(team);
    if (workshop.startsWith('装焊')) zhTeams.push(team);
    if (workshop && !workshop.includes('外包队')) noEmptyOrExternal.push(team);
  }

  const [allMap, zhMap, noExternalMap] = await Promise.all([
    fetchScopeSums(Array.from(new Set(allTeams))),
    fetchScopeSums(Array.from(new Set(zhTeams))),
    fetchScopeSums(Array.from(new Set(noEmptyOrExternal)))
  ]);

  const targets = [
    '上海东站T2酒店',
    '上海西岑文化艺术中心',
    '上海黄埔E地块（上海金融城）',
    '徐汇区黄浦江南延伸段WS3单元xh130D号地块项目钢结构工程',
    '杭政储出【2019】65号地块国家（杭州）短视频基地施工总承包',
    '浙江共美鸿辉年处理90万方再生混凝土绿色循环综合利用项目',
    '澳洲黄金别墅',
    '和孚重兆职工公寓项目'
  ];

  const out = targets.map(name => ({
    project: name,
    all: allMap.get(name) || 0,
    zhOnly: zhMap.get(name) || 0,
    noEmptyOrExternal: noExternalMap.get(name) || 0
  }));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
