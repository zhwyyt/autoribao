const config = require('./config/default.json');
const BrowserAutomation = require('./src/browser-automation');
const { Pool } = require('pg');
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

function makeKey(row) {
  return [
    text(row.project_name),
    text(row.component_guid),
    text(row.component_no),
    text(row.spec),
    text(row.location)
  ].join('|');
}

function formatRawValue(operatorName, eventAtText) {
  const operator = text(operatorName);
  const eventAt = text(eventAtText);
  if (operator && eventAt) return `【${operator}】${eventAt}`;
  return eventAt || operator || '已发货';
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
    let ok = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      ok = await browserAutomation.login();
      if (!ok && !String(browserAutomation.page.url() || '').includes('/login')) {
        ok = true;
      }
      if (ok) break;
      await browserAutomation.page.waitForTimeout(1500 * attempt);
    }
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
      key: makeKey({
        project_name: item.project_name,
        component_guid: item['构件GUID'],
        component_no: item['构件编号'],
        spec: item['规格/型号'],
        location: item['区域部位/所在楼层']
      })
    }));
  } finally {
    await browserAutomation.closeBrowser();
  }
}

function aggregateApiRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.key;
    if (!map.has(key)) {
      map.set(key, {
        ...row,
        rows: 0
      });
    }
    const item = map.get(key);
    item.rows += 1;
    const currentTime = text(item.delivery_time_text || item.complete_time_text);
    const nextTime = text(row.delivery_time_text || row.complete_time_text);
    if (!currentTime || (nextTime && nextTime > currentTime)) {
      item.delivery_time_text = text(row.delivery_time_text);
      item.complete_time_text = text(row.complete_time_text);
      item.delivery_username = text(row.delivery_username);
    }
  }
  return Array.from(map.values());
}

async function fetchComponentMatches(guids) {
  if (!guids.length) return [];
  const sql = `
    SELECT
      p.project_name,
      pp.plan_name,
      c.component_id,
      COALESCE(NULLIF(trim(c.component_guid), ''), '') AS component_guid,
      COALESCE(NULLIF(trim(c.component_no), ''), '') AS component_no,
      COALESCE(NULLIF(trim(c.spec), ''), '') AS spec,
      COALESCE(NULLIF(trim(c.location), ''), '') AS location
    FROM component c
    JOIN production_plan pp ON pp.plan_id = c.plan_id
    JOIN project p ON p.project_id = pp.project_id
    WHERE c.component_guid = ANY($1)
    ORDER BY p.project_name, pp.plan_name, c.component_guid
  `;
  const res = await query(sql, [guids]);
  return res.rows || [];
}

async function syncShippingEvents(rows, dryRun) {
  const db = config.db || {};
  if (!db.host || !db.user || !db.database) {
    throw new Error('缺少数据库配置：请在 config/default.json 的 db 节点配置 host/user/database');
  }

  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    user: db.user,
    password: db.password || '',
    database: db.database,
    max: 5,
    application_name: 'sync-shipping-from-api'
  });

  const sql = `
    INSERT INTO component_status_event (
      component_id, status_type, event_at, is_completed,
      team_name, operator_name, trace_operator_name,
      observed_at, raw_value, updated_at
    )
    VALUES (
      $1, 'shipping', $2::timestamptz, TRUE,
      NULL, NULLIF($3, ''), NULL,
      $2::timestamptz, $4, now()
    )
    ON CONFLICT (component_id, status_type, event_at) DO UPDATE
      SET is_completed = TRUE,
          operator_name = NULLIF(EXCLUDED.operator_name, ''),
          observed_at = EXCLUDED.observed_at,
          raw_value = EXCLUDED.raw_value,
          updated_at = now()
    WHERE (component_status_event.is_completed,
           COALESCE(component_status_event.operator_name, ''),
           component_status_event.observed_at,
           COALESCE(component_status_event.raw_value, ''))
       IS DISTINCT FROM
          (TRUE,
           COALESCE(EXCLUDED.operator_name, ''),
           EXCLUDED.observed_at,
           COALESCE(EXCLUDED.raw_value, ''))
    RETURNING (xmax = 0) AS inserted
  `;

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const sample = [];

  try {
    await pool.query(`SET app.sync_source = 'sync-shipping-from-api'`);
    await pool.query('BEGIN');
    for (const row of rows) {
      if (sample.length < 5) sample.push(row);
      const res = await pool.query(sql, [
        row.component_id,
        row.event_at_text,
        row.delivery_username,
        row.raw_value
      ]);
      if (res.rowCount === 0) {
        unchanged += 1;
      } else if (res.rows[0] && res.rows[0].inserted) {
        inserted += 1;
      } else {
        updated += 1;
      }
    }
    if (dryRun) {
      await pool.query('ROLLBACK');
    } else {
      await pool.query('COMMIT');
    }
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    await pool.end();
  }

  return { inserted, updated, unchanged, sample };
}

async function main() {
  const args = parseArgs(process.argv);
  const startDate = text(args.start) || DEFAULT_START;
  const endDate = text(args.end) || DEFAULT_END;
  const dryRun = String(args['dry-run'] || '') === 'true' || args['dry-run'] === true;

  const apiRows = aggregateApiRows(await fetchApiRows(startDate, endDate));
  const dbMatches = await fetchComponentMatches([...new Set(apiRows.map(row => row.component_guid).filter(Boolean))]);

  const grouped = new Map();
  for (const row of dbMatches) {
    const key = makeKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const toSync = [];
  const skipped = {
    missingComponent: [],
    ambiguousComponent: [],
    missingDeliveryTime: []
  };

  for (const row of apiRows) {
    const matches = grouped.get(row.key) || [];
    if (matches.length === 0) {
      if (skipped.missingComponent.length < 10) skipped.missingComponent.push(row);
      continue;
    }
    const componentIds = [...new Set(matches.map(item => Number(item.component_id)).filter(Number.isFinite))];
    if (componentIds.length !== 1) {
      if (skipped.ambiguousComponent.length < 10) {
        skipped.ambiguousComponent.push({
          api: row,
          dbMatches: matches
        });
      }
      continue;
    }
    const eventAtText = text(row.delivery_time_text || row.complete_time_text);
    if (!eventAtText) {
      if (skipped.missingDeliveryTime.length < 10) skipped.missingDeliveryTime.push(row);
      continue;
    }

    toSync.push({
      component_id: componentIds[0],
      project_name: row.project_name,
      component_guid: row.component_guid,
      component_no: row.component_no,
      spec: row.spec,
      location: row.location,
      delivery_username: text(row.delivery_username),
      event_at_text: eventAtText,
      raw_value: formatRawValue(row.delivery_username, eventAtText)
    });
  }

  const syncResult = await syncShippingEvents(toSync, dryRun);
  console.log(JSON.stringify({
    startDate,
    endDate,
    dryRun,
    apiUniqueRows: apiRows.length,
    preparedToSync: toSync.length,
    skippedMissingComponent: skipped.missingComponent.length,
    skippedAmbiguousComponent: skipped.ambiguousComponent.length,
    skippedMissingDeliveryTime: skipped.missingDeliveryTime.length,
    syncResult,
    skippedSamples: skipped
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
