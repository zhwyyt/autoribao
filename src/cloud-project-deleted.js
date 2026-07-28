/**
 * 云上已删除项目登记与查询（cloud_project_deleted）。
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '../db/alter_cloud_project_deleted.sql');

/** 历史确认删除（compare-db-projects-vs-api 2026-05-21） */
const LEGACY_DELETED_CLOUD_PROJECT_IDS = [1, 2, 13, 16, 18, 22, 28, 29, 30, 31, 32, 33, 34, 35, 57];

async function ensureCloudProjectDeletedSchema(pool) {
    const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const statements = sql
        .split(';')
        .map(s => s.replace(/^\s*\\.*$/gm, '').trim())
        .filter(s => s && !s.startsWith('--') && s.toUpperCase() !== 'BEGIN' && s.toUpperCase() !== 'COMMIT');
    for (const statement of statements) {
        await pool.query(statement);
    }
}

async function loadExcludedCloudProjectIds(pool) {
    const res = await pool.query(`SELECT cloud_project_id FROM cloud_project_deleted ORDER BY cloud_project_id`);
    const fromDb = (res.rows || []).map(r => Number(r.cloud_project_id)).filter(Number.isFinite);
    if (fromDb.length > 0) return fromDb;
    return [...LEGACY_DELETED_CLOUD_PROJECT_IDS];
}

function isExcludedCloudProject(cloudProjectId, excludedIds) {
    const id = Number(cloudProjectId);
    if (!Number.isFinite(id)) return false;
    const list = Array.isArray(excludedIds) ? excludedIds : LEGACY_DELETED_CLOUD_PROJECT_IDS;
    return list.includes(id);
}

async function upsertCloudProjectDeleted(pool, row) {
    await pool.query(
        `
            INSERT INTO cloud_project_deleted (
                cloud_project_id, project_name, source, note, order_count, deleted_at, last_verified_at
            )
            VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), now())
            ON CONFLICT (cloud_project_id) DO UPDATE
              SET project_name = COALESCE(NULLIF(EXCLUDED.project_name, ''), cloud_project_deleted.project_name),
                  source = EXCLUDED.source,
                  note = COALESCE(EXCLUDED.note, cloud_project_deleted.note),
                  order_count = COALESCE(EXCLUDED.order_count, cloud_project_deleted.order_count),
                  last_verified_at = now()
        `,
        [
            row.cloud_project_id,
            row.project_name || null,
            row.source || 'compare_api',
            row.note || null,
            row.order_count != null ? Number(row.order_count) : null,
            row.deleted_at || null
        ]
    );
}

module.exports = {
    LEGACY_DELETED_CLOUD_PROJECT_IDS,
    ensureCloudProjectDeletedSchema,
    loadExcludedCloudProjectIds,
    isExcludedCloudProject,
    upsertCloudProjectDeleted
};
