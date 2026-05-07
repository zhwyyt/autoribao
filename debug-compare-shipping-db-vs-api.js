const config = require('./config/default.json');
const BrowserAutomation = require('./src/browser-automation');
const { query } = require('./src/query/sql-runner');

const DEFAULT_START = '2026-03-25';
const DEFAULT_END = '2026-04-28';
const SHIPPING_RAW_WEIGHT_GUID_RE = /^D9-2MB-2-fxc-251225-(0[1-9]|1[0-6])$/;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function num(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

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

function escapeRegExp(textValue) {
  return String(textValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function gotoWithRelogin(browserAutomation, url) {
  const page = browserAutomation.page;
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  if (page.url().includes('/login')) {
    const ok = await browserAutomation.login();
    if (!ok) throw new Error(`重新登录失败：${url}`);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
  }
}

async function clickControlNearText(page, labelText) {
  const candidates = [
    `xpath=//*[normalize-space()="${labelText}：" or normalize-space()="${labelText}:"]/following-sibling::*[1]`,
    `xpath=//*[contains(normalize-space(),"${labelText}：") or contains(normalize-space(),"${labelText}:")]/following-sibling::*[1]`,
    `xpath=//*[normalize-space()="${labelText}"]/following-sibling::*[1]`
  ];
  for (const selector of candidates) {
    const el = page.locator(selector).first();
    try {
      await el.waitFor({ state: 'visible', timeout: 3000 });
      await el.click({ force: true });
      return true;
    } catch {}
  }
  return false;
}

async function clickFormControlByLabel(page, labelText) {
  const label = page.locator(`.el-form-item__label:has-text("${labelText}")`).first();
  try {
    await label.waitFor({ state: 'visible', timeout: 2000 });
    const item = label.locator('..');
    const control = item.locator('.el-form-item__content').first();
    await control.click({ force: true });
    return;
  } catch {}
  const ok = await clickControlNearText(page, labelText);
  if (!ok) throw new Error(`未找到表单控件：${labelText}`);
}

async function selectDropdownOption(page, optionText) {
  const candidates = page.locator('.el-select-dropdown__item span').filter({ hasText: optionText });
  await candidates.first().waitFor({ state: 'attached', timeout: 15000 });
  const count = await candidates.count();
  for (let i = 0; i < count; i++) {
    const span = candidates.nth(i);
    if (await span.isVisible()) {
      await span.click({ force: true });
      return;
    }
  }
  throw new Error(`下拉选项不可见：${optionText}`);
}

async function setDateRangeByLabel(page, startYmd, endYmd) {
  const startInput = page.locator('input[placeholder="开始日期"]').first();
  const endInput = page.locator('input[placeholder="结束日期"]').first();
  await startInput.waitFor({ state: 'visible', timeout: 3000 });
  await endInput.waitFor({ state: 'visible', timeout: 3000 });
  for (const [input, value] of [[startInput, startYmd], [endInput, endYmd]]) {
    try {
      await input.fill(value);
    } catch {
      await page.evaluate(el => el.removeAttribute('readonly'), await input.elementHandle());
      await input.fill(value);
    }
  }
  await endInput.press('Enter');
}

async function captureApiRequest(page, urlPart, trigger, timeout = 60000) {
  let captured = null;
  const handler = req => {
    try {
      const url = String(req.url() || '');
      if (!url.includes(urlPart)) return;
      captured = {
        url,
        headers: req.headers ? req.headers() : {},
        postData: req.postData ? req.postData() : ''
      };
    } catch {}
  };
  page.on('request', handler);
  try {
    await trigger();
    const startedAt = Date.now();
    while (!captured && Date.now() - startedAt < timeout) {
      await page.waitForTimeout(250);
    }
  } finally {
    page.off('request', handler);
  }
  if (!captured) throw new Error(`未捕获到 API 请求：${urlPart}`);
  return captured;
}

async function replayCapturedApiRequest(page, captured) {
  const cookies = await page.context().cookies();
  const cookieStr = cookies.map(item => `${item.name}=${item.value}`).join('; ');
  const token = captured.headers.token || captured.headers.Token || captured.headers.TOKEN;
  const res = await page.request.post(captured.url, {
    data: captured.postData ? JSON.parse(captured.postData) : {},
    headers: {
      Token: token,
      'Content-Type': 'application/json;charset=utf-8',
      ...(cookieStr ? { Cookie: cookieStr } : {})
    },
    timeout: 60000
  });
  return res.json();
}

async function fetchApiRows(startDate, endDate) {
  const browserAutomation = new BrowserAutomation({ ...config, browser: { ...(config.browser || {}), headless: true } });
  const started = await browserAutomation.launchBrowser();
  if (!started) throw new Error('浏览器启动失败');
  try {
    const ok = await browserAutomation.login();
    if (!ok) throw new Error('登录失败');
    const page = browserAutomation.page;
    await gotoWithRelogin(browserAutomation, config.website.orderHistoryUrl);
    await clickFormControlByLabel(page, '构件状态');
    await selectDropdownOption(page, '已出库');
    await setDateRangeByLabel(page, startDate, endDate);
    const queryBtn = page.locator('button:has-text("查询")').first();
    await queryBtn.waitFor({ state: 'visible', timeout: 15000 });
    const captured = await captureApiRequest(page, '/v1.order/getDeliveryHistory', async () => {
      await queryBtn.click();
    });
    const body = await replayCapturedApiRequest(page, captured);
    const list = Array.isArray(body?.data?.list) ? body.data.list : [];
    return list.map(item => ({
      project_name: text(item.project_name),
      component_guid: text(item['构件GUID']),
      component_no: text(item['构件编号']),
      spec: text(item['规格/型号']),
      location: text(item['区域部位/所在楼层']),
      weight_kg: num(item['重量']),
      quantity: num(item['数量']),
      delivery_time_text: text(item.delivery_time_text),
      complete_time_text: text(item.complete_time_text),
      delivery_username: text(item.delivery_username),
      key: [text(item.project_name), text(item['构件GUID']), text(item['构件编号']), text(item['规格/型号']), text(item['区域部位/所在楼层'])].join('|')
    }));
  } finally {
    await browserAutomation.closeBrowser();
  }
}

async function fetchDbRows(startDate, endDate) {
  const sql = `
    SELECT
      p.project_name,
      pp.plan_name,
      COALESCE(NULLIF(trim(c.component_guid), ''), '') AS component_guid,
      COALESCE(NULLIF(trim(c.component_no), ''), '') AS component_no,
      COALESCE(NULLIF(trim(c.spec), ''), '') AS spec,
      COALESCE(NULLIF(trim(c.location), ''), '') AS location,
      COALESCE(c.quantity, 1)::int AS quantity,
      COALESCE(c.weight, 0)::numeric(18,3) AS weight_kg,
      (COALESCE(c.weight, 0) * COALESCE(c.quantity, 1))::numeric(18,3) AS total_weight_kg,
      timezone('Asia/Shanghai', e.event_at) AS event_at_local,
      timezone('Asia/Shanghai', e.created_at) AS created_at_local,
      trim(e.team_name) AS team_name,
      trim(e.operator_name) AS operator_name,
      trim(e.trace_operator_name) AS trace_operator_name,
      e.event_id
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE e.status_type = 'shipping'
      AND e.is_completed = TRUE
      AND e.event_at IS NOT NULL
      AND timezone('Asia/Shanghai', e.event_at)::date >= $1::date
      AND timezone('Asia/Shanghai', e.event_at)::date <= $2::date
    ORDER BY event_at_local ASC, p.project_name ASC, pp.plan_name ASC, c.component_guid ASC, e.event_id ASC
  `;
  const res = await query(sql, [startDate, endDate]);
  return (res.rows || []).map(row => ({
    ...row,
    key: [text(row.project_name), text(row.component_guid), text(row.component_no), text(row.spec), text(row.location)].join('|')
  }));
}

function resolveShippingWeight(row) {
  const guid = text(row.component_guid);
  if (SHIPPING_RAW_WEIGHT_GUID_RE.test(guid)) {
    return num(row.weight_kg);
  }
  return num(row.total_weight_kg != null ? row.total_weight_kg : row.weight_kg);
}

function aggregate(rows, side) {
  const map = new Map();
  for (const row of rows) {
    const key = row.key;
    if (!map.has(key)) {
      map.set(key, {
        key,
        side,
        project_name: row.project_name,
        component_guid: row.component_guid,
        component_no: row.component_no,
        spec: row.spec,
        location: row.location,
        weight_kg: 0,
        quantity: 0,
        rows: 0,
        dates: new Set(),
        plans: new Set(),
        operators: new Set()
      });
    }
    const item = map.get(key);
    item.weight_kg += resolveShippingWeight(row);
    item.quantity += num(row.quantity);
    item.rows += 1;
    if (row.delivery_time_text) item.dates.add(row.delivery_time_text);
    if (row.event_at_local) item.dates.add(text(row.event_at_local));
    if (row.plan_name) item.plans.add(text(row.plan_name));
    if (row.delivery_username) item.operators.add(text(row.delivery_username));
    if (row.operator_name) item.operators.add(text(row.operator_name));
  }
  return map;
}

function finalize(item) {
  return {
    project_name: item.project_name,
    component_guid: item.component_guid,
    component_no: item.component_no,
    spec: item.spec,
    location: item.location,
    weight_kg: Number(item.weight_kg.toFixed(3)),
    quantity: Number(item.quantity.toFixed(3)),
    rows: item.rows,
    dates: Array.from(item.dates).sort().join(' | '),
    plans: Array.from(item.plans).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(' | '),
    operators: Array.from(item.operators).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(', ')
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const startDate = text(args.start) || DEFAULT_START;
  const endDate = text(args.end) || DEFAULT_END;
  const [apiRows, dbRows] = await Promise.all([
    fetchApiRows(startDate, endDate),
    fetchDbRows(startDate, endDate)
  ]);

  const apiMap = aggregate(apiRows, 'api');
  const dbMap = aggregate(dbRows, 'db');
  const allKeys = Array.from(new Set([...apiMap.keys(), ...dbMap.keys()])).sort();
  const onlyApi = [];
  const onlyDb = [];
  const mismatches = [];

  for (const key of allKeys) {
    const apiItem = apiMap.get(key);
    const dbItem = dbMap.get(key);
    if (!apiItem) {
      onlyDb.push(finalize(dbItem));
      continue;
    }
    if (!dbItem) {
      onlyApi.push(finalize(apiItem));
      continue;
    }
    const apiWeight = Number(apiItem.weight_kg.toFixed(3));
    const dbWeight = Number(dbItem.weight_kg.toFixed(3));
    const apiQty = Number(apiItem.quantity.toFixed(3));
    const dbQty = Number(dbItem.quantity.toFixed(3));
    if (apiWeight !== dbWeight || apiQty !== dbQty || apiItem.rows !== dbItem.rows) {
      mismatches.push({
        project_name: apiItem.project_name,
        component_guid: apiItem.component_guid,
        component_no: apiItem.component_no,
        spec: apiItem.spec,
        location: apiItem.location,
        api_weight_kg: apiWeight,
        db_weight_kg: dbWeight,
        api_quantity: apiQty,
        db_quantity: dbQty,
        api_rows: apiItem.rows,
        db_rows: dbItem.rows,
        api_dates: Array.from(apiItem.dates).sort().join(' | '),
        db_dates: Array.from(dbItem.dates).sort().join(' | '),
        db_plans: Array.from(dbItem.plans).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(' | '),
        db_operators: Array.from(dbItem.operators).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(', ')
      });
    }
  }

  console.log(JSON.stringify({
    startDate,
    endDate,
    apiRows: apiRows.length,
    dbRows: dbRows.length,
    apiWeightKg: Number(apiRows.reduce((sum, row) => sum + num(row.weight_kg), 0).toFixed(3)),
    dbWeightKg: Number(dbRows.reduce((sum, row) => sum + resolveShippingWeight(row), 0).toFixed(3)),
    onlyApiCount: onlyApi.length,
    onlyDbCount: onlyDb.length,
    mismatchCount: mismatches.length
  }, null, 2));

  const print = (title, rows) => {
    console.log(`\n=== ${title} (${rows.length}) ===`);
    for (const row of rows.slice(0, 20)) {
      console.log(JSON.stringify(row, null, 2));
    }
    if (rows.length > 20) console.log(`... 其余 ${rows.length - 20} 条省略`);
  };

  print('only-in-api', onlyApi);
  print('only-in-db', onlyDb);
  print('mismatches', mismatches);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
