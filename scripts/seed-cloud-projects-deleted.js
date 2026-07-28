/**
 * 将「库/订单有、API 无」的云项目写入 cloud_project_deleted。
 * 用法：node scripts/seed-cloud-projects-deleted.js
 */
const { Pool } = require('pg');
const config = require('../config/default.json');
const {
    ensureCloudProjectDeletedSchema,
    upsertCloudProjectDeleted,
    LEGACY_DELETED_CLOUD_PROJECT_IDS
} = require('../src/cloud-project-deleted');

(async () => {
    const pool = new Pool({ ...config.db, max: 3 });
    await ensureCloudProjectDeletedSchema(pool);

    const res = await pool.query(
        `
            SELECT
                so.cloud_project_id,
                MAX(so.project_name) AS project_name,
                count(DISTINCT so.order_id)::int AS order_count
            FROM sales_order so
            WHERE so.cloud_project_id = ANY($1::bigint[])
            GROUP BY so.cloud_project_id
            ORDER BY so.cloud_project_id
        `,
        [LEGACY_DELETED_CLOUD_PROJECT_IDS]
    );

    for (const row of res.rows) {
        await upsertCloudProjectDeleted(pool, {
            cloud_project_id: Number(row.cloud_project_id),
            project_name: row.project_name || '',
            order_count: row.order_count,
            source: 'compare_api',
            note: '云上 getList 不可见，仅 sales_order 历史遗留'
        });
    }

    for (const id of LEGACY_DELETED_CLOUD_PROJECT_IDS) {
        if (!res.rows.some(r => Number(r.cloud_project_id) === id)) {
            await upsertCloudProjectDeleted(pool, {
                cloud_project_id: id,
                project_name: '',
                order_count: 0,
                source: 'compare_api',
                note: '云上 getList 不可见'
            });
        }
    }

    const all = await pool.query(
        `SELECT cloud_project_id, project_name, order_count, source, note, last_verified_at
         FROM cloud_project_deleted ORDER BY cloud_project_id`
    );
    console.log(JSON.stringify({ count: all.rows.length, rows: all.rows }, null, 2));
    await pool.end();
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
