const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');
const config = require('../config/default.json');

async function countSkipReasonsForOrder(orderId) {
    const logDir = path.join(__dirname, '../logs');
    const counts = {};
    if (!fs.existsSync(logDir)) return counts;
    const files = fs.readdirSync(logDir).filter(f => f.startsWith('order_sync_skipped_') && f.endsWith('.jsonl'));
    for (const file of files) {
        const rl = readline.createInterface({
            input: fs.createReadStream(path.join(logDir, file)),
            crlfDelay: true
        });
        for await (const line of rl) {
            try {
                const o = JSON.parse(line);
                if (Number(o.order_id) !== Number(orderId)) continue;
                const key = o.reason || 'unknown';
                counts[key] = (counts[key] || 0) + 1;
            } catch {}
        }
    }
    return counts;
}

(async () => {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port || 5432,
        user: config.db.user,
        password: config.db.password || '',
        database: config.db.database
    });

    const zeroRows = await pool.query(
        `
            SELECT order_id, cloud_project_id, project_name, order_name, order_code,
                   artifacts_count, sync_note
            FROM sales_order so
            WHERE artifacts_count > 0
              AND cloud_project_id NOT IN (1, 16, 18)
              AND NOT EXISTS (SELECT 1 FROM order_component oc WHERE oc.order_id = so.order_id)
            ORDER BY artifacts_count DESC
            LIMIT 2
        `
    );

    const partial = await pool.query(
        `
            SELECT so.order_id, so.cloud_project_id, so.project_name, so.order_name, so.order_code,
                   so.artifacts_count, so.sync_note,
                   count(oc.order_component_id)::int AS oc_count
            FROM sales_order so
            LEFT JOIN order_component oc ON oc.order_id = so.order_id
            WHERE so.artifacts_count > 0 AND so.cloud_project_id NOT IN (1, 16, 18)
            GROUP BY so.order_id, so.cloud_project_id, so.project_name, so.order_name,
                     so.order_code, so.artifacts_count, so.sync_note
            HAVING count(oc.order_component_id) > 0
               AND count(oc.order_component_id) < so.artifacts_count
            ORDER BY (so.artifacts_count - count(oc.order_component_id)) DESC
            LIMIT 2
        `
    );

    const out = [];
    for (const row of [...zeroRows.rows, ...partial.rows]) {
        const ocCount = row.oc_count != null ? row.oc_count : 0;
        const skipReasons = await countSkipReasonsForOrder(row.order_id);
        const prodComp = await pool.query(
            `
                SELECT count(*)::int AS n FROM component c
                JOIN production_plan pp ON pp.plan_id = c.plan_id
                JOIN project p ON p.project_id = pp.project_id
                WHERE regexp_replace(p.project_name, '[\\s\\u3000]+', '', 'g')
                    = regexp_replace($1, '[\\s\\u3000]+', '', 'g')
            `,
            [row.project_name]
        );
        out.push({
            order_id: Number(row.order_id),
            cloud_project_id: Number(row.cloud_project_id),
            project_name: row.project_name,
            order_name: row.order_name,
            order_code: row.order_code,
            api_artifacts_count: Number(row.artifacts_count),
            order_component_in_db: ocCount,
            missing_in_order_component: Number(row.artifacts_count) - ocCount,
            order_sync_note: row.sync_note,
            order_sync_skip_reasons: skipReasons,
            production_component_count_same_project: prodComp.rows[0].n,
            typical_pattern: ocCount === 0 ? '整单未进 order_component' : '部分构件未进 order_component'
        });
    }

    console.log(JSON.stringify(out, null, 2));
    await pool.end();
})();
