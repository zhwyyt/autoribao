const path = require('path');
const XLSX = require('xlsx');
const { query } = require('./src/query/sql-runner');

const CORRECT_PATH = path.join(__dirname, 'downloads', '2026', '04', '25', '2026年4月份成品仓库收发存-正确版.xlsx');
const START_DATE = '2026-03-26';
const END_DATE = '2026-04-25';

function normName(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/\s+/g, '');
}

function toNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (!s) return 0;
  if (s.startsWith('=')) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function readCorrectInboundSummary(workbookPath) {
  const wb = XLSX.readFile(workbookPath, { raw: false, cellFormula: true });
  const ws = wb.Sheets['汇总'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const out = new Map();
  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    const name = normName(row[1]);
    if (!name) continue;
    if (['合计', '编制', '审核', '审批', '统计', '制表'].some(k => name.includes(k))) continue;
    out.set(name, {
      display: row[1],
      inboundTon: toNumber(row[3])
    });
  }
  return out;
}

async function readDbInboundSummary(startDate, endDate) {
  const sql = `
    WITH latest_fitup AS (
      SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
        p.project_name,
        timezone('Asia/Shanghai', e.event_at) AS event_at,
        (COALESCE(c.weight, 0) * COALESCE(c.quantity, 1))::numeric(18,3) AS total_weight_kg
      FROM component_status_event e
      JOIN component c ON c.component_id = e.component_id
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE e.status_type = 'fitup_weld_report'
        AND e.is_completed = TRUE
        AND e.event_at IS NOT NULL
      ORDER BY
        p.project_name ASC,
        pp.plan_name ASC,
        c.component_guid ASC,
        timezone('Asia/Shanghai', e.event_at) DESC,
        e.event_id DESC
    )
    SELECT
      project_name,
      COALESCE(SUM(total_weight_kg), 0)::numeric(18,3) AS total_weight_kg
    FROM latest_fitup
    WHERE timezone('Asia/Shanghai', event_at)::date >= $1::date
      AND timezone('Asia/Shanghai', event_at)::date <= $2::date
    GROUP BY project_name
    ORDER BY project_name
  `;
  const res = await query(sql, [startDate, endDate]);
  return new Map((res.rows || []).map(row => [
    normName(row.project_name),
    {
      display: row.project_name,
      inboundTon: Number((Number(row.total_weight_kg || 0) / 1000).toFixed(3)),
      inboundKg: Number(Number(row.total_weight_kg || 0).toFixed(3))
    }
  ]));
}

async function main() {
  const correct = readCorrectInboundSummary(CORRECT_PATH);
  const db = await readDbInboundSummary(START_DATE, END_DATE);
  const allNames = Array.from(new Set([...correct.keys(), ...db.keys()])).sort((a, b) => a.localeCompare(b, 'zh-CN'));

  console.log(JSON.stringify({
    correctProjectCount: correct.size,
    dbProjectCount: db.size,
    startDate: START_DATE,
    endDate: END_DATE
  }, null, 2));

  const diffs = [];
  for (const name of allNames) {
    const c = correct.get(name);
    const d = db.get(name);
    if (!c) {
      diffs.push({ type: 'ONLY_DB', project: d.display, dbInTon: d.inboundTon });
      continue;
    }
    if (!d) {
      diffs.push({ type: 'ONLY_CORRECT', project: c.display, correctInTon: c.inboundTon });
      continue;
    }
    const cv = c.inboundTon;
    const dv = d.inboundTon;
    if (cv === null || dv === null) {
      if (cv !== dv) diffs.push({ type: 'VALUE_MISMATCH', project: d.display, correctInTon: cv, dbInTon: dv });
      continue;
    }
    if (Number((cv - dv).toFixed(3)) !== 0) {
      diffs.push({
        type: 'VALUE_MISMATCH',
        project: d.display,
        correctInTon: Number(cv.toFixed(3)),
        dbInTon: Number(dv.toFixed(3)),
        deltaTon: Number((dv - cv).toFixed(3))
      });
    }
  }

  console.log(`diff_count=${diffs.length}`);
  for (const diff of diffs) {
    console.log(JSON.stringify(diff, null, 2));
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
