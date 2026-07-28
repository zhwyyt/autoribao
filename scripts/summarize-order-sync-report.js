const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');
const config = require('../config/default.json');

async function summarizeSkipped(filePath) {
    const byReason = {};
    const orderReasons = {};
    let lines = 0;
    if (!fs.existsSync(filePath)) return { lines, byReason, orderReasons };

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, 'utf8'),
        crlfDelay: true
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        lines += 1;
        let row;
        try {
            row = JSON.parse(line);
        } catch {
            continue;
        }
        const reason = row.reason || 'unknown';
        byReason[reason] = (byReason[reason] || 0) + 1;
        if (row.scope === 'order') {
            orderReasons[reason] = (orderReasons[reason] || 0) + 1;
        }
    }
    return { lines, byReason, orderReasons };
}

async function main() {
    const reportPath = process.argv[2] || path.join(__dirname, '../logs/order_sync_report_20260520081836.json');
    const skippedPath = process.argv[3] || path.join(__dirname, '../logs/order_sync_skipped_20260520081836.jsonl');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const skipped = await summarizeSkipped(skippedPath);

    const db = config.db || {};
    const pool = new Pool({
        host: db.host,
        port: db.port || 5432,
        user: db.user,
        password: db.password || '',
        database: db.database,
        max: 2
    });
    const notes = await pool.query(
        `
            SELECT sync_note, count(*)::int AS c
            FROM sales_order
            GROUP BY sync_note
            ORDER BY c DESC
            LIMIT 20
        `
    );
    const totals = await pool.query(
        `
            SELECT
                (SELECT count(*)::int FROM sales_order) AS sales_order,
                (SELECT count(*)::int FROM order_component) AS order_component,
                (SELECT count(*)::int FROM order_component WHERE component_id IS NOT NULL) AS linked
        `
    );
    await pool.end();

    console.log(JSON.stringify({
        reportPath,
        skippedPath,
        reportSummary: report.summary,
        skippedSummary: skipped,
        dbTotals: totals.rows[0],
        syncNotes: notes.rows
    }, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
