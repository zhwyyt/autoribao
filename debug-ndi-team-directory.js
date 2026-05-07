const { loadTeamDirectory } = require('./src/query/team-directory-loader');

async function main() {
  const directory = await loadTeamDirectory();
  const set = new Set();
  for (const member of directory.members || []) {
    const text = String(member && member.ndiTeamName || '').trim();
    if (text) set.add(text.replace(/\s+/g, ''));
  }
  set.add('王国良探伤组');
  console.log(JSON.stringify({
    count: set.size,
    teams: Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
