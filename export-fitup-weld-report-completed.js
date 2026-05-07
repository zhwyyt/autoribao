const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const config = require('./config/default.json');

const DEFAULT_PROJECT_NAME = '杭钢玉环汽摩配智施智造中心及产业集成项目';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return null;
  return process.argv[idx + 1];
}

async function fetchRows(pool, projectName) {
  const sql = `
    WITH completed_fitup_weld_report AS (
      SELECT
        e.component_id,
        MAX(e.event_at) AS fitup_weld_report_completed_at
      FROM component_status_event e
      WHERE e.status_type = 'fitup_weld_report'
        AND e.is_completed = TRUE
      GROUP BY e.component_id
    )
    SELECT
      p.project_id,
      p.project_name,
      pp.plan_id,
      pp.plan_name,
      c.component_id,
      c.component_no,
      c.component_guid,
      c.model_id,
      c.spec,
      c.quantity,
      c.weight,
      c.length,
      c.production_feature,
      c.location,
      c.current_status,
      c.current_status_at,
      r.fitup_weld_report_completed_at
    FROM completed_fitup_weld_report r
    JOIN component c
      ON c.component_id = r.component_id
    JOIN production_plan pp
      ON pp.plan_id = c.plan_id
    JOIN project p
      ON p.project_id = pp.project_id
    WHERE p.project_name = $1
    ORDER BY
      pp.plan_id,
      c.component_no NULLS LAST,
      c.component_id;
  `;

  const res = await pool.query(sql, [projectName]);
  return res.rows;
}

async function exportExcel(rows, projectName, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Codex';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('装焊报检已完成构件');
  sheet.columns = [
    { header: '项目ID', key: 'project_id', width: 12 },
    { header: '项目名称', key: 'project_name', width: 36 },
    { header: '计划ID', key: 'plan_id', width: 12 },
    { header: '计划名称', key: 'plan_name', width: 28 },
    { header: '构件内部ID', key: 'component_id', width: 14 },
    { header: '构件编号', key: 'component_no', width: 22 },
    { header: '构件GUID', key: 'component_guid', width: 28 },
    { header: '模型ID', key: 'model_id', width: 18 },
    { header: '规格型号', key: 'spec', width: 22 },
    { header: '数量', key: 'quantity', width: 10 },
    { header: '重量', key: 'weight', width: 12 },
    { header: '长度', key: 'length', width: 12 },
    { header: '生产特征', key: 'production_feature', width: 18 },
    { header: '区域部位', key: 'location', width: 18 },
    { header: '当前状态', key: 'current_status', width: 16 },
    { header: '当前状态时间', key: 'current_status_at', width: 22 },
    { header: '装焊报检完成时间', key: 'fitup_weld_report_completed_at', width: 22 }
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: 'A1',
    to: 'Q1'
  };

  for (const row of rows) {
    sheet.addRow({
      ...row,
      weight: row.weight == null ? null : Number(row.weight),
      length: row.length == null ? null : Number(row.length)
    });
  }

  const dateColumns = ['P', 'Q'];
  for (const col of dateColumns) {
    sheet.getColumn(col).numFmt = 'yyyy-mm-dd hh:mm:ss';
  }
  sheet.getColumn('J').numFmt = '0';
  sheet.getColumn('K').numFmt = '0.000';
  sheet.getColumn('L').numFmt = '0.000';

  const summary = workbook.addWorksheet('说明');
  summary.columns = [
    { header: '项', key: 'item', width: 24 },
    { header: '值', key: 'value', width: 80 }
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRows([
    { item: '项目名称', value: projectName },
    { item: '导出时间', value: new Date() },
    { item: '构件数量', value: rows.length },
    { item: '筛选条件', value: "status_type = 'fitup_weld_report' AND is_completed = true" }
  ]);
  summary.getColumn('B').numFmt = 'yyyy-mm-dd hh:mm:ss';

  await workbook.xlsx.writeFile(outputPath);
}

async function main() {
  const db = config.db || {};
  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database,
    application_name: 'export-fitup-weld-report-completed'
  });

  const projectName = getArgValue('--project-name') || DEFAULT_PROJECT_NAME;
  const outputArg = getArgValue('--output');
  const outputDir = path.resolve(__dirname, 'downloads');
  ensureDir(outputDir);
  const outputPath = outputArg
    ? path.resolve(outputArg)
    : path.join(outputDir, `${projectName}-装焊报检已完成构件.xlsx`);

  try {
    const rows = await fetchRows(pool, projectName);
    if (rows.length === 0) {
      console.log(`未查询到项目“${projectName}”下装焊报检已完成的构件。`);
      return;
    }

    await exportExcel(rows, projectName, outputPath);
    console.log(`导出完成，共 ${rows.length} 条构件记录。`);
    console.log(`文件路径: ${outputPath}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
