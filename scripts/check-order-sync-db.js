const { Pool } = require('pg');
const config = require('../config/default.json');

async function main() {
    const db = config.db || {};
    const pool = new Pool({
        host: db.host,
        port: db.port || 5432,
        user: db.user,
        password: db.password || '',
        database: db.database,
        max: 2
    });

    try {
        const tables = await pool.query(
            `
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN ('sales_order', 'order_component')
                ORDER BY table_name
            `
        );

        const backupSchemas = await pool.query(
            `
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name LIKE 'backup_order_sync_%'
                ORDER BY schema_name DESC
                LIMIT 5
            `
        );

        let counts = null;
        let sample = null;
        if (tables.rows.length === 2) {
            counts = (await pool.query(
                `
                    SELECT
                        (SELECT count(*)::int FROM sales_order) AS sales_order,
                        (SELECT count(*)::int FROM order_component) AS order_component,
                        (SELECT count(*)::int FROM order_component WHERE component_id IS NOT NULL) AS linked_components
                `
            )).rows[0];

            sample = (await pool.query(
                `
                    SELECT
                        so.order_id,
                        so.project_name,
                        oc.dwyun_artifact_id,
                        oc.component_guid,
                        oc.component_id
                    FROM order_component oc
                    JOIN sales_order so ON so.order_id = oc.order_id
                    ORDER BY oc.synced_at DESC
                    LIMIT 3
                `
            )).rows;
        }

        const columns = await pool.query(
            `
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name IN ('sales_order', 'order_component')
                ORDER BY table_name, ordinal_position
            `
        );

        console.log(JSON.stringify({
            tablesExist: tables.rows.map(r => r.table_name),
            backupSchemas: backupSchemas.rows.map(r => r.schema_name),
            counts,
            sample,
            columns: columns.rows
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
