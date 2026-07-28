const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const config = require('../config/default.json');

function findPgDump() {
    const candidates = [
        'pg_dump',
        'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe'
    ];
    for (const candidate of candidates) {
        if (candidate === 'pg_dump') {
            const probe = spawnSync('where', ['pg_dump'], { encoding: 'utf8' });
            if (probe.status === 0 && probe.stdout.trim()) {
                return probe.stdout.trim().split(/\r?\n/)[0];
            }
            continue;
        }
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function main() {
    const db = config.db || {};
    if (!db.host || !db.user || !db.database) {
        throw new Error('缺少数据库配置');
    }

    const pgDump = findPgDump();
    if (!pgDump) {
        throw new Error('未找到 pg_dump，请先安装 PostgreSQL 客户端工具');
    }

    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backupFile = path.join(backupDir, `dwyunsc_before_order_sync_${stamp}.dump`);

    const args = [
        '-h', String(db.host),
        '-p', String(db.port || 5432),
        '-U', String(db.user),
        '-d', String(db.database),
        '-F', 'c',
        '-f', backupFile
    ];

    const result = spawnSync(pgDump, args, {
        env: { ...process.env, PGPASSWORD: db.password || '' },
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        throw new Error(`pg_dump 失败：${result.stderr || result.stdout || result.status}`);
    }
    if (!fs.existsSync(backupFile)) {
        throw new Error(`备份文件未生成：${backupFile}`);
    }

    const sizeMb = (fs.statSync(backupFile).size / (1024 * 1024)).toFixed(2);
    console.log(JSON.stringify({ ok: true, backupFile, sizeMb }, null, 2));
}

main();
