const { loadTeamDirectory } = require('./src/query/team-directory-loader');

async function main() {
  const directory = await loadTeamDirectory();
  const groups = new Map();
  for (const member of directory.members || []) {
    const workshop = String(member.fitupWorkshopName || '').trim() || '(空)';
    const team = String(member.fitupTeamName || '').trim();
    if (!groups.has(workshop)) groups.set(workshop, new Set());
    if (team) groups.get(workshop).add(team);
  }
  const out = Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
    .map(([workshop, teams]) => ({
      workshop,
      teamCount: teams.size,
      teams: Array.from(teams).sort((a, b) => a.localeCompare(b, 'zh-CN')).slice(0, 50)
    }));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
