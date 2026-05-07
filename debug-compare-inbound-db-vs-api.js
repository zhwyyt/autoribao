const path = require('path');
const XLSX = require('xlsx');

const { query } = require('./src/query/sql-runner');

const DEFAULT_API_SOURCE = path.join(__dirname, 'downloads', '2026', '04', '25', '202604收发存报表.xlsx');
const DEFAULT_START = '2026-03-26';
const DEFAULT_END = '2026-04-25';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function dateKey(value) {
  const s = text(value);
  if (!s) return '';
  return s.slice(0, 10);
}

function parseRawJson(raw) {
  const s = text(raw);
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function addToMapList(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function sumBy(rows, getter) {
  return rows.reduce((acc, row) => acc + num(getter(row)), 0);
}

function buildGroupSummary(rows, labelGetter) {
  const groups = new Map();
  for (const row of rows) {
    const key = text(labelGetter(row)) || '<<EMPTY>>';
    if (!groups.has(key)) {
      groups.set(key, { key, rows: 0, guidCount: new Set(), weightKg: 0 });
    }
    const item = groups.get(key);
    item.rows += 1;
    item.guidCount.add(text(row.component_guid || row.guid));
    item.weightKg += num(row.total_weight_kg || row.weight_kg || row.api_weight_kg);
  }
  return Array.from(groups.values())
    .map(item => ({
      key: item.key,
      rows: item.rows,
      guids: item.guidCount.size,
      weightKg: Number(item.weightKg.toFixed(3))
    }))
    .sort((a, b) => b.weightKg - a.weightKg || b.rows - a.rows || a.key.localeCompare(b.key, 'zh-CN'));
}

function printSection(title, rows, limit = 20) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const row of rows.slice(0, limit)) {
    console.log(JSON.stringify(row, null, 2));
  }
  if (rows.length > limit) {
    console.log(`... 其余 ${rows.length - limit} 条省略`);
  }
}

function pickApiSheetName(workbook, sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm' || ext === '.xls') {
    if (workbook.SheetNames.includes('入库明细')) return '入库明细';
  }
  return workbook.SheetNames[0];
}

function readApiRows(sourcePath, projectName) {
  const workbook = XLSX.readFile(sourcePath, { raw: false });
  const sheetName = pickApiSheetName(workbook, sourcePath);
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows
    .map(row => ({
      project_name: text(row['项目名称'] || row.project_name),
      component_name: text(row['构件名称']),
      component_no: text(row['构件编号']),
      component_guid: text(row['构件GUID']),
      spec: text(row['规格/型号']),
      quantity: num(row['数量']),
      weight_kg: num(row['重量']),
      total_weight_kg: num(row['重量']),
      location: text(row['区域部位/所在楼层']),
      process_name: text(row['工序'] || row.process_name),
      department_parent: text(row['部门父级'] || row.department_parent),
      department: text(row['班组'] || row.department),
      create_user_name: text(row['创建人'] || row.create_user_name),
      create_time_text: text(row['创建时间'] || row.create_time_text),
      today: text(row['日期'] || row.today),
      last_process: text(row['上一工序'] || row['最后工序'] || row.last_process)
    }))
    .filter(row => row.project_name === projectName);
}

async function readDbRows(projectName, startDate, endDate) {
  const sql = `
    WITH latest_fitup AS (
      SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
        p.project_name,
        pp.plan_name,
        c.component_id,
        COALESCE(NULLIF(trim(c.component_guid), ''), '') AS component_guid,
        COALESCE(NULLIF(trim(c.component_no), ''), '') AS component_no,
        COALESCE(NULLIF(trim(c.spec), ''), '') AS spec,
        COALESCE(c.quantity, 1)::int AS quantity,
        COALESCE(c.weight, 0)::numeric(18,3) AS unit_weight_kg,
        (COALESCE(c.weight, 0) * COALESCE(c.quantity, 1))::numeric(18,3) AS total_weight_kg,
        COALESCE(NULLIF(trim(c.location), ''), '') AS location,
        e.event_id,
        timezone('Asia/Shanghai', e.event_at) AS event_at_local,
        timezone('Asia/Shanghai', e.created_at) AS created_at_local,
        COALESCE(NULLIF(trim(e.team_name), ''), '') AS team_name,
        COALESCE(NULLIF(trim(e.operator_name), ''), '') AS operator_name,
        COALESCE(NULLIF(trim(e.trace_operator_name), ''), '') AS trace_operator_name,
        COALESCE(e.raw_value, '') AS raw_value
      FROM component_status_event e
      JOIN component c ON c.component_id = e.component_id
      JOIN production_plan pp ON pp.plan_id = c.plan_id
      JOIN project p ON p.project_id = pp.project_id
      WHERE e.status_type = 'fitup_weld_report'
        AND e.is_completed = TRUE
        AND e.event_at IS NOT NULL
        AND p.project_name = $3
      ORDER BY
        p.project_name ASC,
        pp.plan_name ASC,
        c.component_guid ASC,
        timezone('Asia/Shanghai', e.event_at) DESC,
        e.event_id DESC
    )
    SELECT *
    FROM latest_fitup
    WHERE event_at_local::date >= $1::date
      AND event_at_local::date <= $2::date
    ORDER BY event_at_local ASC, component_guid ASC, event_id ASC
  `;
  const res = await query(sql, [startDate, endDate, projectName]);
  return (res.rows || []).map(row => {
    const raw = parseRawJson(row.raw_value);
    return {
      ...row,
      process_name: text(raw && (raw.process_name || raw.processName)),
      process_id: raw && (raw.process_id || raw.processId || raw.process_from_id || raw.processFromId || ''),
      department: text(raw && (raw.department || raw.department_name || raw.team_name)),
      department_parent: text(raw && (raw.department_parent || raw.departmentParent)),
      raw_today: text(raw && (raw.today || raw.date)),
      raw_keys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 20) : []
    };
  });
}

function groupByGuid(rows) {
  const map = new Map();
  for (const row of rows) {
    const guid = text(row.component_guid);
    if (!guid) continue;
    addToMapList(map, guid, row);
  }
  return map;
}

function summarizeGuidRows(rows, side) {
  const weightKg = Number(sumBy(rows, row => row.total_weight_kg || row.weight_kg).toFixed(3));
  const qty = Number(sumBy(rows, row => row.quantity).toFixed(3));
  const dates = Array.from(new Set(rows.map(row => dateKey(row.event_at_local || row.create_time_text || row.today)).filter(Boolean))).sort();
  const teams = Array.from(new Set(rows.map(row => text(row.team_name || row.department)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const departments = Array.from(new Set(rows.map(row => text(row.department_parent)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const processes = Array.from(new Set(rows.map(row => text(row.process_name || row.last_process)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const sample = rows[0] || {};
  return {
    side,
    guid: text(sample.component_guid),
    component_no: text(sample.component_no),
    spec: text(sample.spec),
    location: text(sample.location),
    rows: rows.length,
    quantitySum: qty,
    weightKg,
    dates,
    teams,
    departments,
    processes
  };
}

function buildRowSamples(rows, side) {
  return rows.slice(0, 10).map(row => ({
    side,
    eventId: row.event_id || '',
    date: dateKey(row.event_at_local || row.create_time_text || row.today),
    eventAt: text(row.event_at_local),
    createTime: text(row.create_time_text || row.created_at_local),
    team: text(row.team_name || row.department),
    departmentParent: text(row.department_parent),
    process: text(row.process_name || row.last_process),
    operator: text(row.operator_name || row.create_user_name),
    traceOperator: text(row.trace_operator_name),
    componentNo: text(row.component_no),
    guid: text(row.component_guid),
    quantity: num(row.quantity),
    weightKg: num(row.total_weight_kg || row.weight_kg),
    planName: text(row.plan_name),
    rawKeys: row.raw_keys || []
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const projectName = text(args.project || args.name);
  if (!projectName) {
    throw new Error('请传入 --project "项目名称"');
  }
  const startDate = text(args.start) || DEFAULT_START;
  const endDate = text(args.end) || DEFAULT_END;
  const apiSource = text(args.apiSource || args.apiCsv || args.xlsx) || DEFAULT_API_SOURCE;

  const [apiRows, dbRows] = await Promise.all([
    Promise.resolve(readApiRows(apiSource, projectName)),
    readDbRows(projectName, startDate, endDate)
  ]);

  const apiByGuid = groupByGuid(apiRows);
  const dbByGuid = groupByGuid(dbRows);
  const allGuids = Array.from(new Set([...apiByGuid.keys(), ...dbByGuid.keys()])).sort();

  const onlyDb = [];
  const onlyApi = [];
  const weightMismatch = [];
  const multiplicityMismatch = [];

  for (const guid of allGuids) {
    const apiGuidRows = apiByGuid.get(guid) || [];
    const dbGuidRows = dbByGuid.get(guid) || [];
    if (apiGuidRows.length === 0) {
      onlyDb.push({
        ...summarizeGuidRows(dbGuidRows, 'db'),
        dbEventIds: dbGuidRows.slice(0, 10).map(row => row.event_id),
        dbPlanNames: Array.from(new Set(dbGuidRows.map(row => text(row.plan_name)).filter(Boolean))).slice(0, 5)
      });
      continue;
    }
    if (dbGuidRows.length === 0) {
      onlyApi.push(summarizeGuidRows(apiGuidRows, 'api'));
      continue;
    }

    const apiWeight = Number(sumBy(apiGuidRows, row => row.total_weight_kg || row.weight_kg).toFixed(3));
    const dbWeight = Number(sumBy(dbGuidRows, row => row.total_weight_kg || row.weight_kg).toFixed(3));
    if (apiWeight !== dbWeight) {
      weightMismatch.push({
        guid,
        apiWeightKg: apiWeight,
        dbWeightKg: dbWeight,
        deltaKg: Number((dbWeight - apiWeight).toFixed(3)),
        apiRows: apiGuidRows.length,
        dbRows: dbGuidRows.length,
        api: summarizeGuidRows(apiGuidRows, 'api'),
        db: summarizeGuidRows(dbGuidRows, 'db'),
        apiSamples: buildRowSamples(apiGuidRows, 'api'),
        dbSamples: buildRowSamples(dbGuidRows, 'db')
      });
    } else if (apiGuidRows.length !== dbGuidRows.length) {
      multiplicityMismatch.push({
        guid,
        weightKg: apiWeight,
        apiRows: apiGuidRows.length,
        dbRows: dbGuidRows.length,
        api: summarizeGuidRows(apiGuidRows, 'api'),
        db: summarizeGuidRows(dbGuidRows, 'db'),
        apiSamples: buildRowSamples(apiGuidRows, 'api'),
        dbSamples: buildRowSamples(dbGuidRows, 'db')
      });
    }
  }

  const dbTotal = Number(sumBy(dbRows, row => row.total_weight_kg).toFixed(3));
  const apiTotal = Number(sumBy(apiRows, row => row.total_weight_kg).toFixed(3));

  console.log(JSON.stringify({
    projectName,
    startDate,
    endDate,
    apiSource,
    apiRows: apiRows.length,
    dbRows: dbRows.length,
    apiGuids: apiByGuid.size,
    dbGuids: dbByGuid.size,
    apiTotalKg: apiTotal,
    dbTotalKg: dbTotal,
    deltaKg: Number((dbTotal - apiTotal).toFixed(3)),
    onlyDbGuids: onlyDb.length,
    onlyApiGuids: onlyApi.length,
    weightMismatchGuids: weightMismatch.length,
    multiplicityMismatchGuids: multiplicityMismatch.length
  }, null, 2));

  const onlyDbRawRows = dbRows.filter(row => !apiByGuid.has(text(row.component_guid)));
  const onlyApiRawRows = apiRows.filter(row => !dbByGuid.has(text(row.component_guid)));

  console.log('\n=== only-in-db by team ===');
  console.log(JSON.stringify(buildGroupSummary(onlyDbRawRows, row => row.team_name), null, 2));
  console.log('\n=== only-in-db by process ===');
  console.log(JSON.stringify(buildGroupSummary(onlyDbRawRows, row => row.process_name), null, 2));
  console.log('\n=== only-in-db by department_parent ===');
  console.log(JSON.stringify(buildGroupSummary(onlyDbRawRows, row => row.department_parent), null, 2));

  console.log('\n=== only-in-api by department ===');
  console.log(JSON.stringify(buildGroupSummary(onlyApiRawRows, row => row.department), null, 2));
  console.log('\n=== only-in-api by process ===');
  console.log(JSON.stringify(buildGroupSummary(onlyApiRawRows, row => row.process_name), null, 2));
  console.log('\n=== only-in-api by department_parent ===');
  console.log(JSON.stringify(buildGroupSummary(onlyApiRawRows, row => row.department_parent), null, 2));

  printSection('only-in-db guid summary', onlyDb, 12);
  printSection('only-in-api guid summary', onlyApi, 12);
  printSection('weight mismatch guid summary', weightMismatch, 12);
  printSection('multiplicity mismatch guid summary', multiplicityMismatch, 12);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
