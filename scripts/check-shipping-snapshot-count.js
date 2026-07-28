const { query } = require('../src/query/sql-runner');

async function main() {
    const res = await query(`
        SELECT
            count(*)::int AS rows,
            count(*) FILTER (WHERE raw_value LIKE 'SHIPPING_API_JSON:%')::int AS snapshots
        FROM component_status_event
        WHERE status_type = 'shipping'
          AND is_completed = true
          AND timezone('Asia/Shanghai', event_at)::date BETWEEN DATE '2026-06-26' AND DATE '2026-07-25'
    `);
    console.log(JSON.stringify(res.rows[0]));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
