/**
 * 无 pg_dump 时：在库内创建快照 schema 备份 public 下业务表。
 */
const fs = require('fs');
const path = require('path');
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
        max: 2,
        application_name: 'backup-dwyunsc-inplace'
    });

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const schemaName = `backup_order_sync_${stamp}`;

    const tablesRes = await pool.query(
        `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              AND table_name NOT LIKE 'backup_order_sync_%'
            ORDER BY table_name
        `
    );

    const tables = (tablesRes.rows || []).map(r => r.table_name);
    const manifest = {
        createdAt: new Date().toISOString(),
        database: db.database,
        schemaName,
        tables: []
    };

    await pool.query(`CREATE SCHEMA ${schemaName}`);
    for (const tableName of tables) {
        const started = Date.now();
        await pool.query(`CREATE TABLE ${schemaName}.${tableName} AS TABLE public.${tableName}`);
        const countRes = await pool.query(`SELECT count(*)::bigint AS c FROM ${schemaName}.${tableName}`);
        manifest.tables.push({
            table: tableName,
            rows: Number(countRes.rows[0].c),
            elapsedMs: Date.now() - started
        });
        console.log(`[backup] ${tableName} -> ${schemaName}.${tableName} (${countRes.rows[0].c} rows)`);
    }

    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const manifestPath = path.join(backupDir, `${schemaName}_manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    console.log(JSON.stringify({ ok: true, schemaName, manifestPath, tableCount: tables.length }, null, 2));
    await pool.end();
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
