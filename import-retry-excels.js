const path = require('path');
const fs = require('fs');

const xlsx = require('xlsx');
const { Pool } = require('pg');

const config = require('./config/default.json');

function normalizeHeader(h) {
  return String(h || '').replace(/[\s\u3000\u200B\uFEFF]+/g, '').trim();
}

function canonicalizeHeader(h) {
  const t = normalizeHeader(h);
  if (!t) return '';

  // core fields
  if (t.includes('构件GUID')) return '构件GUID';
  if (t === 'GUID') return '构件GUID';
  if (t.includes('构件编号')) return '构件编号';
  if (t.includes('模型ID')) return '模型ID';
  if (t.includes('规格/型号') || t === '规格型号' || t === '规格') return '规格/型号';
  if (t === '数量' || t.includes('数量')) return '数量';
  if (t === '重量' || t.includes('重量')) return '重量';
  if (t === '长度' || t.includes('长度')) return '长度';
  if (t.includes('生产特征')) return '生产特征';
  if (t.includes('区域部位') || t.includes('所在楼层')) return '区域部位/所在楼层';

  // status fields
  if (t.includes('钢构生产开始')) return '钢构生产开始';
  if (t.includes('装焊报检')) return '装焊报检';
  if (t.includes('装焊探伤')) return '装焊探伤';
  if (t.includes('装焊质检')) return '装焊质检';
  if (t === '涂装' || t.includes('涂装')) return '涂装';
  if (t === 'is_deliver' || t.includes('is_deliver') || t === '发货' || t.includes('发货')) return 'is_deliver';
  if (t.includes('流水线报工')) return '流水线报工';
  if (t.includes('成品库')) return '成品库';

  // keep original (normalized) to avoid losing potential fields
  return t;
}

function sheetToRowObjects(ws) {
  const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false });
  if (!Array.isArray(aoa) || aoa.length === 0) return [];

  const headerRow = aoa[0] || [];
  const headers = headerRow.map(canonicalizeHeader);

  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!Array.isArray(r)) continue;
    const obj = {};
    let nonEmpty = 0;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const val = r[c];
      if (val !== null && val !== undefined && String(val).trim() !== '') nonEmpty++;
      obj[key] = val;
    }
    if (nonEmpty === 0) continue;
    rows.push(obj);
  }
  return rows;
}

function mapComponentsFromRows(rows, planId) {
  const components = [];
  for (const item of Array.isArray(rows) ? rows : []) {
    const planIdVal = Number(planId);
    const componentGuid = String(item['构件GUID'] || '').trim();
    const componentNo = String(item['构件编号'] || '').trim();
    const modelId = String(item['模型ID'] || '').trim();
    const spec = String(item['规格/型号'] || '').trim();

    const quantityRaw = item['数量'];
    const quantity = Number(String(quantityRaw ?? '').trim()) || 0;

    const weightRaw = item['重量'];
    const weight = weightRaw === null || weightRaw === undefined || String(weightRaw).trim() === '' ? null : Number(String(weightRaw).trim());

    const lengthRaw = item['长度'];
    const length = lengthRaw === null || lengthRaw === undefined || String(lengthRaw).trim() === '' ? null : Number(String(lengthRaw).trim());

    const productionFeature = String(item['生产特征'] || '').trim();
    const location = String(item['区域部位/所在楼层'] || '').trim();

    if (!planIdVal || !componentGuid) continue;

    // keep same constraint expectation as DB: quantity > 0
    if (quantity <= 0) continue;

    components.push({
      plan_id: planIdVal,
      component_guid: componentGuid,
      component_no: componentNo,
      model_id: modelId,
      spec,
      quantity,
      weight,
      length,
      production_feature: productionFeature,
      location
    });
  }
  return components;
}

function parseStatusValue(rawValue, fieldName) {
  const v = String(rawValue ?? '').trim();
  if (!v) return null;

  if (v === '未发货') {
    return {
      isCompleted: false,
      eventAt: null,
      teamName: null,
      operatorName: null,
      traceOperatorName: null
    };
  }

  const timeRegex = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/;
  const timeMatch = v.match(timeRegex);
  const hasTime = !!timeMatch;

  const bracketRegex = /【([^】]+)】/g;
  const brackets = [];
  let m;
  while ((m = bracketRegex.exec(v)) !== null) {
    brackets.push(m[1]);
  }

  if (brackets.length === 0) {
    if (hasTime) {
      return {
        isCompleted: true,
        eventAt: timeMatch[1],
        teamName: null,
        operatorName: null,
        traceOperatorName: null
      };
    }
    return null;
  }

  const result = {
    isCompleted: hasTime,
    eventAt: hasTime ? timeMatch[1] : null,
    teamName: null,
    operatorName: null,
    traceOperatorName: null
  };

  if (fieldName === '装焊报检') {
    result.teamName = brackets[0] || null;
    result.operatorName = brackets[1] || null;
    if (brackets.length >= 3) {
      result.traceOperatorName = brackets[2] || null;
    }
  } else if (fieldName === 'is_deliver' && brackets.length >= 1) {
    result.operatorName = brackets[0] || null;
  } else if (brackets.length >= 2) {
    result.teamName = brackets[0] || null;
    result.operatorName = brackets[1] || null;
  } else if (brackets.length >= 1) {
    result.teamName = brackets[0] || null;
  }

  return result;
}

function parseComponentStatusEvents(rows, planId, planStartAt, projectStatus) {
  const events = [];

  const statusFieldMap = {
    '钢构生产开始': 'steel_production_start'
  };

  if (projectStatus === 'building' || projectStatus === 'closed') {
    statusFieldMap['装焊报检'] = 'fitup_weld_report';
    statusFieldMap['装焊探伤'] = 'fitup_weld_ndi';
    statusFieldMap['装焊质检'] = 'fitup_weld_qc';
    statusFieldMap['涂装'] = 'painting';
    statusFieldMap['is_deliver'] = 'shipping';
  } else if (projectStatus === 'pipeline') {
    statusFieldMap['流水线报工'] = 'pipeline_report_work';
  }

  for (const item of Array.isArray(rows) ? rows : []) {
    const componentGuid = String(item['构件GUID'] || '').trim();
    if (!componentGuid) continue;

    const statusValues = new Map();
    for (const [fieldName, statusType] of Object.entries(statusFieldMap)) {
      const rawValue = String(item[fieldName] ?? '').trim();
      if (!rawValue) continue;

      const parsed = parseStatusValue(rawValue, fieldName);
      if (!parsed) continue;

      statusValues.set(statusType, { fieldName, rawValue, parsed });
    }

    for (const [statusType, { rawValue, parsed }] of statusValues) {
      events.push({
        plan_id: Number(planId),
        component_guid: componentGuid,
        status_type: statusType,
        event_at: parsed.eventAt || (planStartAt ? new Date(planStartAt) : null),
        is_completed: parsed.isCompleted,
        team_name: parsed.teamName,
        operator_name: parsed.operatorName,
        trace_operator_name: parsed.traceOperatorName,
        observed_at: planStartAt ? new Date(planStartAt) : null,
        raw_value: rawValue
      });
    }
  }

  return events;
}

async function withPool(applicationName) {
  const db = config.db || {};
  if (!db.host || !db.user || !db.database) {
    throw new Error('缺少数据库配置：请在 config/default.json 的 db 节点配置 host/user/database');
  }
  return new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database,
    max: 5,
    application_name: applicationName
  });
}

async function resolvePlanIdByPlanName(pool, planName) {
  const res = await pool.query(
    `
    SELECT plan_id, plan_name
    FROM production_plan
    WHERE regexp_replace(plan_name, '[\\s\\u3000\\u200B\\uFEFF]+', '', 'g') = regexp_replace($1, '[\\s\\u3000\\u200B\\uFEFF]+', '', 'g')
    ORDER BY plan_id
    LIMIT 2
    `,
    [planName]
  );
  if (res.rows.length === 0) return null;
  return Number(res.rows[0].plan_id);
}

async function getPlanInfoFromDb(pool, planId) {
  const res = await pool.query(
    `
    SELECT p.start_at, pr.project_status
    FROM production_plan p
    LEFT JOIN project pr ON p.project_id = pr.project_id
    WHERE p.plan_id = $1
    `,
    [planId]
  );
  if (res.rows.length === 0) return null;
  return {
    start_at_raw: res.rows[0].start_at,
    project_status: res.rows[0].project_status
  };
}

async function syncComponentsToDb(pool, components) {
  const unique = new Map();
  for (const c of components) {
    const key = `${c.plan_id}:${c.component_guid}`;
    unique.set(key, c);
  }
  const uniqComponents = Array.from(unique.values());

  const sql = `
    INSERT INTO component (plan_id, component_guid, component_no, model_id, spec, quantity, weight, length, production_feature, location, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
    ON CONFLICT (plan_id, component_guid) DO UPDATE
      SET component_no = EXCLUDED.component_no,
          model_id = EXCLUDED.model_id,
          spec = EXCLUDED.spec,
          quantity = EXCLUDED.quantity,
          weight = EXCLUDED.weight,
          length = EXCLUDED.length,
          production_feature = EXCLUDED.production_feature,
          location = EXCLUDED.location,
          updated_at = now()
    WHERE (component.component_no, component.model_id, component.spec, component.quantity, component.weight, component.length, component.production_feature, component.location)
          IS DISTINCT FROM (EXCLUDED.component_no, EXCLUDED.model_id, EXCLUDED.spec, EXCLUDED.quantity, EXCLUDED.weight, EXCLUDED.length, EXCLUDED.production_feature, EXCLUDED.location)
    RETURNING (xmax = 0) AS inserted
  `;

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const c of uniqComponents) {
    const res = await pool.query(sql, [
      c.plan_id,
      c.component_guid,
      c.component_no,
      c.model_id,
      c.spec,
      c.quantity,
      c.weight,
      c.length,
      c.production_feature,
      c.location
    ]);

    if (res.rowCount === 0) {
      unchanged++;
    } else if (res.rows[0] && res.rows[0].inserted) {
      inserted++;
    } else {
      updated++;
    }
  }

  return { inserted, updated, unchanged, uniqueCount: uniqComponents.length };
}

async function syncComponentStatusEventsToDb(pool, events) {
  if (!events || events.length === 0) {
    return { inserted: 0, updated: 0, unchanged: 0 };
  }

  const sql = `
    INSERT INTO component_status_event (
        component_id, status_type, event_at, is_completed,
        team_name, operator_name, trace_operator_name,
        observed_at, raw_value, updated_at
    )
    SELECT c.component_id, $2, $3, $4, $5, $6, $7, $8, $9, now()
    FROM component c
    WHERE c.plan_id = $1 AND c.component_guid = $10
    ON CONFLICT (component_id, status_type, event_at) DO UPDATE
      SET is_completed = EXCLUDED.is_completed,
          team_name = EXCLUDED.team_name,
          operator_name = EXCLUDED.operator_name,
          trace_operator_name = EXCLUDED.trace_operator_name,
          observed_at = EXCLUDED.observed_at,
          raw_value = EXCLUDED.raw_value,
          updated_at = now()
    WHERE (component_status_event.is_completed, component_status_event.team_name,
           component_status_event.operator_name, component_status_event.trace_operator_name,
           component_status_event.observed_at, component_status_event.raw_value)
          IS DISTINCT FROM (EXCLUDED.is_completed, EXCLUDED.team_name, EXCLUDED.operator_name,
                          EXCLUDED.trace_operator_name, EXCLUDED.observed_at, EXCLUDED.raw_value)
    RETURNING (xmax = 0) AS inserted
  `;

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const e of events) {
    const res = await pool.query(sql, [
      e.plan_id,
      e.status_type,
      e.event_at,
      e.is_completed,
      e.team_name,
      e.operator_name,
      e.trace_operator_name,
      e.observed_at,
      e.raw_value,
      e.component_guid
    ]);

    if (res.rowCount === 0) {
      unchanged++;
    } else if (res.rows[0] && res.rows[0].inserted) {
      inserted++;
    } else {
      updated++;
    }
  }

  return { inserted, updated, unchanged };
}

function pickSheet(wb) {
  const want = '计划构件详情';
  if (wb.SheetNames.includes(want)) return want;
  return wb.SheetNames[0];
}

async function importOneExcel(pool, filePath) {
  const planName = path.basename(filePath, path.extname(filePath)).trim();
  const planId = await resolvePlanIdByPlanName(pool, planName);
  if (!planId) {
    return { filePath, planName, planId: null, error: '在 production_plan 中找不到匹配的 plan_name' };
  }

  const planInfo = await getPlanInfoFromDb(pool, planId);
  if (!planInfo) {
    return { filePath, planName, planId, error: '在 production_plan 中找不到 plan_id' };
  }

  const wb = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = pickSheet(wb);
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return { filePath, planName, planId, error: `找不到工作表: ${sheetName}` };
  }

  const rows = sheetToRowObjects(ws);

  const components = mapComponentsFromRows(rows, planId);
  const compStats = await syncComponentsToDb(pool, components);

  const events = parseComponentStatusEvents(rows, planId, planInfo.start_at_raw, planInfo.project_status);
  const eventStats = await syncComponentStatusEventsToDb(pool, events);

  return { filePath, planName, planId, sheetName, rows: rows.length, compStats, eventStats };
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyIdx = argv.findIndex(a => a === '--only');
  const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] || '').trim() : '';
  const planIdIdx = argv.findIndex(a => a === '--plan-id');
  const onlyPlanId = planIdIdx >= 0 ? Number(String(argv[planIdIdx + 1] || '').trim()) : NaN;

  const retryDir = path.resolve(__dirname, 'retry');
  let files = fs.readdirSync(retryDir)
    .filter(f => f.endsWith('.xlsx'));

  if (only) {
    const onlyNorm = normalizeHeader(only).toLowerCase();
    files = files.filter(f => normalizeHeader(f).toLowerCase().includes(onlyNorm));
  }

  files = files.map(f => path.join(retryDir, f));

  if (files.length === 0) {
    if (only) {
      console.error(`retry 文件夹下找不到匹配的 .xlsx：--only ${only}`);
    } else {
      console.error('retry 文件夹下找不到 .xlsx');
    }
    process.exitCode = 1;
    return;
  }

  const pool = await withPool('import-retry-excels');
  try {
    await pool.query(`SET app.sync_source = 'import-retry-excels'`);

    const results = [];
    for (const f of files) {
      try {
        const r = await importOneExcel(pool, f);
        if (Number.isFinite(onlyPlanId) && r.planId !== onlyPlanId) {
          continue;
        }
        results.push(r);

        if (r.error) {
          console.error(`[FAIL] ${path.basename(f)} plan_id=${r.planId || ''} ${r.error}`);
        } else {
          console.log(
            `[OK] ${path.basename(f)} plan_id=${r.planId} sheet=${r.sheetName} ` +
            `rows=${r.rows} components(unique)=${r.compStats.uniqueCount} ` +
            `comp(+${r.compStats.inserted} ~${r.compStats.updated} =${r.compStats.unchanged}) ` +
            `events(+${r.eventStats.inserted} ~${r.eventStats.updated} =${r.eventStats.unchanged})`
          );
        }
      } catch (e) {
        console.error(`[ERROR] ${path.basename(f)}: ${e && e.message ? e.message : String(e)}`);
        process.exitCode = 1;
      }
    }

    const failed = results.filter(r => r.error);
    if (failed.length > 0) {
      console.error(`\n导入完成，但有 ${failed.length} 个文件失败：`);
      for (const r of failed) {
        console.error(`- ${path.basename(r.filePath)} (planName=${r.planName}) => ${r.error}`);
      }
      process.exitCode = 1;
    } else {
      console.log(`\n导入完成：共 ${results.length} 个文件全部成功。`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
