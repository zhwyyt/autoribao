const { query } = require('./src/query/sql-runner');

async function main() {
  const res = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'component'
    ORDER BY ordinal_position
  `);
  console.log(JSON.stringify(res.rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
