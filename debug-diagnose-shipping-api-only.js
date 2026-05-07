const config = require('./config/default.json');
const BrowserAutomation = require('./src/browser-automation');
const { query } = require('./src/query/sql-runner');

const DEFAULT_START = '2026-03-25';
const DEFAULT_END = '2026-04-28';

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

async function setDateRange(page, startYmd, endYmd) {
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
    await setDateRange(page, startDate, endDate);
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
      key: [
        text(item.project_name),
        text(item['构件GUID']),
        text(item['构件编号']),
        text(item['规格/型号']),
        text(item['区域部位/所在楼层'])
      ].join('|')
    }));
  } finally {
    await browserAutomation.closeBrowser();
  }
}

async function fetchDbRangeKeys(startDate, endDate) {
  const sql = `
    SELECT
      p.project_name,
      COALESCE(NULLIF(trim(c.component_guid), ''), '') AS component_guid,
      COALESCE(NULLIF(trim(c.component_no), ''), '') AS component_no,
      COALESCE(NULLIF(trim(c.spec), ''), '') AS spec,
      COALESCE(NULLIF(trim(c.location), ''), '') AS location
    FROM component_status_event e
    JOIN component c ON c.component_id = e.component_id
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE e.status_type = 'shipping'
      AND e.is_completed = TRUE
      AND e.event_at IS NOT NULL
      AND timezone('Asia/Shanghai', e.event_at)::date >= $1::date
      AND timezone('Asia/Shanghai', e.event_at)::date <= $2::date
  `;
  const res = await query(sql, [startDate, endDate]);
  return new Set((res.rows || []).map(row => [
    text(row.project_name),
    text(row.component_guid),
    text(row.component_no),
    text(row.spec),
    text(row.location)
  ].join('|')));
}

async function fetchDbMatches(guids) {
  if (!guids.length) return [];
  const sql = `
    SELECT
      p.project_name,
      pp.plan_name,
      c.component_id,
      COALESCE(NULLIF(trim(c.component_guid), ''), '') AS component_guid,
      COALESCE(NULLIF(trim(c.component_no), ''), '') AS component_no,
      COALESCE(NULLIF(trim(c.spec), ''), '') AS spec,
      COALESCE(NULLIF(trim(c.location), ''), '') AS location,
      COALESCE(c.quantity, 1)::int AS quantity,
      (COALESCE(c.weight, 0) * COALESCE(c.quantity, 1))::numeric(18,3) AS total_weight_kg,
      c.current_status,
      timezone('Asia/Shanghai', c.current_status_at) AS current_status_at,
      e.event_id,
      timezone('Asia/Shanghai', e.event_at) AS event_at_local,
      e.is_completed,
      trim(e.operator_name) AS operator_name,
      trim(e.team_name) AS team_name
    FROM component c
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    LEFT JOIN component_status_event e
      ON e.component_id = c.component_id
     AND e.status_type = 'shipping'
    WHERE c.component_guid = ANY($1)
    ORDER BY
      p.project_name ASC,
      c.component_guid ASC,
      pp.plan_name ASC,
      e.event_at DESC NULLS LAST,
      e.event_id DESC
  `;
  const res = await query(sql, [guids]);
  return res.rows || [];
}

function pushSample(bucket, value) {
  if (bucket.length < 5) bucket.push(value);
}

async function main() {
  const args = parseArgs(process.argv);
  const startDate = text(args.start) || DEFAULT_START;
  const endDate = text(args.end) || DEFAULT_END;

  const [apiRows, dbRangeKeys] = await Promise.all([
    fetchApiRows(startDate, endDate),
    fetchDbRangeKeys(startDate, endDate)
  ]);
  const onlyApiRows = apiRows.filter(row => !dbRangeKeys.has(row.key));
  const dbMatches = await fetchDbMatches([...new Set(onlyApiRows.map(row => row.component_guid).filter(Boolean))]);

  const grouped = new Map();
  for (const row of dbMatches) {
    const key = [
      text(row.project_name),
      text(row.component_guid),
      text(row.component_no),
      text(row.spec),
      text(row.location)
    ].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const summary = {
    startDate,
    endDate,
    onlyApiCount: onlyApiRows.length,
    noComponent: 0,
    hasComponentNoShipping: 0,
    hasShippingOnlyOutsideRange: 0,
    ambiguousMultipleComponents: 0
  };
  const samples = {
    noComponent: [],
    hasComponentNoShipping: [],
    hasShippingOnlyOutsideRange: [],
    ambiguousMultipleComponents: []
  };

  for (const apiRow of onlyApiRows) {
    const matches = grouped.get(apiRow.key) || [];
    if (matches.length === 0) {
      summary.noComponent += 1;
      pushSample(samples.noComponent, apiRow);
      continue;
    }

    const componentIds = [...new Set(matches.map(item => Number(item.component_id)).filter(Number.isFinite))];
    if (componentIds.length !== 1) {
      summary.ambiguousMultipleComponents += 1;
      pushSample(samples.ambiguousMultipleComponents, {
        api: apiRow,
        dbMatches: matches.slice(0, 8)
      });
      continue;
    }

    const shippingRows = matches.filter(item => item.event_id != null);
    if (shippingRows.length === 0) {
      summary.hasComponentNoShipping += 1;
      pushSample(samples.hasComponentNoShipping, {
        api: apiRow,
        dbComponent: matches[0]
      });
      continue;
    }

    summary.hasShippingOnlyOutsideRange += 1;
    pushSample(samples.hasShippingOnlyOutsideRange, {
      api: apiRow,
      dbShippingRows: shippingRows.slice(0, 8)
    });
  }

  console.log(JSON.stringify({ summary, samples }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
