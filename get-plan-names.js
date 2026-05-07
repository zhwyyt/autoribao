const { Pool } = require('pg');
const config = require('./config/default.json');

async function main() {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port || 5432,
    user: config.db.user,
    password: config.db.password || '',
    database: config.db.database,
    max: 2
  });

  const planIds = [2808, 2803, 2660, 2071, 2065, 2284, 1527, 688];

  try {
    const res = await pool.query(
      `
      SELECT p.plan_id, p.plan_name, pr.project_name
      FROM production_plan p
      LEFT JOIN project pr ON pr.project_id = p.project_id
      WHERE p.plan_id = ANY($1::int[])
      `,
      [planIds]
    );

    const map = new Map(res.rows.map(r => [Number(r.plan_id), r]));

    for (const id of planIds) {
      const row = map.get(id);
      if (!row) {
        console.log(`${id}\t<NOT_FOUND>`);
        continue;
      }
      console.log(`${id}\t${row.plan_name || ''}\t${row.project_name || ''}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
