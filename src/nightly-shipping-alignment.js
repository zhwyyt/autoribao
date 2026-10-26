const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const config = require('../config/default.json');
const BrowserAutomation = require('./browser-automation');
const { query } = require('./query/sql-runner');
const { buildPreviousDayRange } = require('./nightly-process-reconciliation');
const SHIPPING_RAW_WEIGHT_GUID_RE = /^D9-2MB-2-fxc-251225-(0[1-9]|1[0-6])$/;
const SHIPPING_API_RAW_PREFIX = 'SHIPPING_API_JSON:';

function ensureDir(dir) {
    if (!dir) return;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function text(value) {
    return String(value == null ? '' : value).trim();
}

function num(value) {
    if (value == null || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function normalizeText(value) {
    return String(value == null ? '' : value)
        .trim()
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .replace(/【/g, '[')
        .replace(/】/g, ']')
        .replace(/\s+/g, '');
}

function makeKey(row) {
    return [
        normalizeText(row.project_name),
        normalizeText(row.component_guid),
        normalizeText(row.component_no),
        normalizeText(row.spec),
        normalizeText(row.location)
    ].join('|');
}

async function gotoWithRelogin(browserAutomation, url) {
    const page = browserAutomation.page;
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
        const ok = await browserAutomation.login();
        if (!ok) {
            throw new Error(`重新登录失败：${url}`);
        }
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
    if (!ok) {
        throw new Error(`未找到表单控件：${labelText}`);
    }
}

async function selectDropdownOption(page, optionText) {
    const candidates = page.locator('.el-select-dropdown__item span').filter({ hasText: optionText });
    await candidates.first().waitFor({ state: 'attached', timeout: 15000 });
    const count = await candidates.count();
    for (let i = 0; i < count; i += 1) {
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

    if (!captured) {
        throw new Error(`未捕获到 API 请求：${urlPart}`);
    }
    return captured;
}

async function replayCapturedApiRequest(page, captured) {
    const cookies = await page.context().cookies();
    const cookieStr = cookies.map(item => `${item.name}=${item.value}`).join('; ');
    const token = captured.headers.token || captured.headers.Token || captured.headers.TOKEN;
    if (!token) {
        throw new Error('重放发货 API 请求失败：未捕获到 Token');
    }

    const requestOptions = {
        data: captured.postData ? JSON.parse(captured.postData) : {},
        headers: {
            Token: token,
            'Content-Type': 'application/json;charset=utf-8',
            ...(cookieStr ? { Cookie: cookieStr } : {})
        },
        timeout: 180000
    };
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await page.request.post(captured.url, requestOptions);
            if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
            return await res.json();
        } catch (error) {
            lastError = error;
            if (attempt < 2) await page.waitForTimeout(2000);
        }
    }
    const message = String(lastError && lastError.message ? lastError.message : lastError).split(/\r?\n/)[0];
    throw new Error(`重放发货 API 请求失败（已重试2次）：${message}`);
}

async function ensureLogin(browserAutomation) {
    let ok = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        ok = await browserAutomation.login();
        if (!ok && !String(browserAutomation.page.url() || '').includes('/login')) {
            ok = true;
        }
        if (ok) break;
        await browserAutomation.page.waitForTimeout(1500 * attempt);
    }
    if (!ok) {
        throw new Error('登录失败');
    }
}

async function fetchApiRows(browserAutomation, range) {
    const page = browserAutomation.page;
    const url = config.website.orderHistoryUrl;
    if (!url) throw new Error('orderHistoryUrl 未配置');

    await gotoWithRelogin(browserAutomation, url);
    await clickFormControlByLabel(page, '构件状态');
    await selectDropdownOption(page, '已出库');
    await setDateRange(page, range.start, range.end);

    const queryBtn = page.locator('button:has-text("查询")').first();
    await queryBtn.waitFor({ state: 'visible', timeout: 15000 });
    const captured = await captureApiRequest(page, '/v1.order/getDeliveryHistory', async () => {
        await queryBtn.click();
    });
    const body = await replayCapturedApiRequest(page, captured);
    const list = Array.isArray(body && body.data && body.data.list) ? body.data.list : [];

    return list.map(item => ({
        project_name: text(item.project_name),
        component_name: text(item['构件名称'] || item.component_name),
        component_guid: text(item['构件GUID']),
        component_no: text(item['构件编号']),
        model_id: text(item['模型ID'] || item.model_id),
        spec: text(item['规格/型号']),
        location: text(item['区域部位/所在楼层']),
        weight_kg: num(item['重量']),
        quantity: num(item['数量']),
        volume: num(item['体积']),
        length: num(item['长度']),
        production_feature: text(item['生产特征'] || item.production_feature),
        axis_range: text(item['轴线范围'] || item.axis_range),
        component_type_code: text(item['构件类型编码'] || item.component_type_code),
        layout: text(item['所属布置图'] || item.layout),
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
}

async function fetchDbRows(range) {
    const sql = `
        SELECT
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'project_name'), ''), p.project_name) AS project_name,
            pp.plan_name,
            COALESCE(NULLIF(trim(c.component_guid), ''), '') AS component_guid,
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'component_no'), ''), NULLIF(trim(c.component_no), ''), '') AS component_no,
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'spec'), ''), NULLIF(trim(c.spec), ''), '') AS spec,
            COALESCE(NULLIF(trim(shipping_snapshot.data->>'location'), ''), NULLIF(trim(c.location), ''), '') AS location,
            COALESCE(NULLIF(shipping_snapshot.data->>'quantity', '')::numeric, c.quantity, 1)::numeric(18,3) AS quantity,
            COALESCE(c.weight, 0)::numeric(18,3) AS weight_kg,
            COALESCE(
                NULLIF(shipping_snapshot.data->>'weight_kg', '')::numeric,
                COALESCE(c.weight, 0) * COALESCE(c.quantity, 1)
            )::numeric(18,3) AS total_weight_kg,
            timezone('Asia/Shanghai', e.event_at) AS event_at_local,
            trim(e.operator_name) AS operator_name,
            e.event_id
        FROM component_status_event e
        JOIN component c ON c.component_id = e.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        LEFT JOIN LATERAL (
            SELECT CASE
                WHEN e.raw_value LIKE 'SHIPPING_API_JSON:%'
                    THEN substring(e.raw_value FROM 19)::jsonb
                ELSE NULL::jsonb
            END AS data
        ) shipping_snapshot ON true
        WHERE e.status_type = 'shipping'
          AND e.is_completed = TRUE
          AND e.event_at IS NOT NULL
          AND timezone('Asia/Shanghai', e.event_at)::date >= $1::date
          AND timezone('Asia/Shanghai', e.event_at)::date <= $2::date
        ORDER BY event_at_local ASC, p.project_name ASC, pp.plan_name ASC, c.component_guid ASC, e.event_id ASC
    `;
    const res = await query(sql, [range.start, range.end]);
    return (res.rows || []).map(row => ({
        ...row,
        key: makeKey(row),
        event_date: text(row.event_at_local).slice(0, 19)
    }));
}

function resolveShippingWeight(row) {
    const guid = text(row.component_guid);
    if (SHIPPING_RAW_WEIGHT_GUID_RE.test(guid)) {
        return num(row.weight_kg);
    }
    return num(row.total_weight_kg != null ? row.total_weight_kg : row.weight_kg);
}

function aggregateRows(rows, side) {
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
        if (row.event_date) item.dates.add(row.event_date);
        if (row.plan_name) item.plans.add(text(row.plan_name));
        if (row.delivery_username) item.operators.add(text(row.delivery_username));
        if (row.operator_name) item.operators.add(text(row.operator_name));
    }
    return map;
}

function finalizeAggregate(item) {
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

function compareRows(apiRows, dbRows) {
    const apiMap = aggregateRows(apiRows, 'api');
    const dbMap = aggregateRows(dbRows, 'db');
    const allKeys = Array.from(new Set([...apiMap.keys(), ...dbMap.keys()])).sort();
    const onlyApi = [];
    const onlyDb = [];
    const mismatches = [];

    for (const key of allKeys) {
        const apiItem = apiMap.get(key);
        const dbItem = dbMap.get(key);
        if (!apiItem) {
            onlyDb.push(finalizeAggregate(dbItem));
            continue;
        }
        if (!dbItem) {
            onlyApi.push(finalizeAggregate(apiItem));
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

    return {
        summary: {
            apiRowCount: apiRows.length,
            dbRowCount: dbRows.length,
            apiWeightKg: Number(apiRows.reduce((sum, row) => sum + num(row.weight_kg), 0).toFixed(3)),
            dbWeightKg: Number(dbRows.reduce((sum, row) => sum + resolveShippingWeight(row), 0).toFixed(3)),
            onlyApiCount: onlyApi.length,
            onlyDbCount: onlyDb.length,
            mismatchCount: mismatches.length
        },
        onlyApi,
        onlyDb,
        mismatches
    };
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

function formatShippingRawValue(row) {
    return `${SHIPPING_API_RAW_PREFIX}${JSON.stringify({
        source: 'delivery_history_api',
        project_name: text(row.project_name),
        component_name: text(row.component_name),
        component_guid: text(row.component_guid),
        component_no: text(row.component_no),
        model_id: text(row.model_id),
        spec: text(row.spec),
        location: text(row.location),
        volume: num(row.volume),
        length: num(row.length),
        production_feature: text(row.production_feature),
        axis_range: text(row.axis_range),
        component_type_code: text(row.component_type_code),
        layout: text(row.layout),
        quantity: num(row.quantity),
        weight_kg: num(row.weight_kg),
        complete_time_text: text(row.complete_time_text),
        delivery_time_text: text(row.delivery_time_text),
        delivery_username: text(row.delivery_username)
    })}`;
}

async function syncShippingEvents(rows) {
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
        application_name: 'nightly-shipping-alignment'
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

    try {
        await pool.query(`SET app.sync_source = 'nightly-shipping-alignment'`);
        await pool.query('BEGIN');
        for (const row of rows) {
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
        await pool.query('COMMIT');
    } catch (error) {
        try {
            await pool.query('ROLLBACK');
        } catch {}
        throw error;
    } finally {
        await pool.end();
    }

    return { inserted, updated, unchanged };
}

function buildSyncRows(apiRows, matches) {
    const grouped = new Map();
    const groupedWithoutSpec = new Map();
    const groupedByProjectGuid = new Map();
    const addMatch = (map, key, row) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
    };
    const makeWithoutSpecKey = row => [
        normalizeText(row.project_name),
        normalizeText(row.component_guid),
        normalizeText(row.component_no),
        normalizeText(row.location)
    ].join('|');
    const makeProjectGuidKey = row => [
        normalizeText(row.project_name),
        normalizeText(row.component_guid)
    ].join('|');
    for (const row of matches) {
        addMatch(grouped, makeKey(row), row);
        addMatch(groupedWithoutSpec, makeWithoutSpecKey(row), row);
        addMatch(groupedByProjectGuid, makeProjectGuidKey(row), row);
    }

    const rows = [];
    const skipped = {
        missingComponent: [],
        ambiguousComponent: [],
        missingDeliveryTime: [],
        missingComponentCount: 0,
        ambiguousComponentCount: 0,
        missingDeliveryTimeCount: 0
    };

    for (const row of apiRows) {
        const dbMatches = grouped.get(row.key)
            || groupedWithoutSpec.get(makeWithoutSpecKey(row))
            || groupedByProjectGuid.get(makeProjectGuidKey(row))
            || [];
        if (dbMatches.length === 0) {
            skipped.missingComponentCount += 1;
            if (skipped.missingComponent.length < 10) skipped.missingComponent.push(row);
            continue;
        }

        const componentIds = [...new Set(dbMatches.map(item => Number(item.component_id)).filter(Number.isFinite))];
        if (componentIds.length !== 1) {
            skipped.ambiguousComponentCount += 1;
            if (skipped.ambiguousComponent.length < 10) {
                skipped.ambiguousComponent.push({ api: row, dbMatches });
            }
            continue;
        }

        const eventAtText = text(row.delivery_time_text || row.complete_time_text);
        if (!eventAtText) {
            skipped.missingDeliveryTimeCount += 1;
            if (skipped.missingDeliveryTime.length < 10) skipped.missingDeliveryTime.push(row);
            continue;
        }

        rows.push({
            component_id: componentIds[0],
            project_name: row.project_name,
            component_guid: row.component_guid,
            component_no: row.component_no,
            spec: row.spec,
            location: row.location,
            delivery_username: text(row.delivery_username),
            event_at_text: eventAtText,
            raw_value: formatShippingRawValue(row)
        });
    }

    return { rows, skipped };
}

function buildSummaryText(range, before, syncResult, after) {
    return [
        `范围：${range.label}`,
        `对齐前：API ${before.summary.apiRowCount} 行 / ${before.summary.apiWeightKg}kg；DB ${before.summary.dbRowCount} 行 / ${before.summary.dbWeightKg}kg`,
        `差异：仅API ${before.summary.onlyApiCount}，仅DB ${before.summary.onlyDbCount}，不一致 ${before.summary.mismatchCount}`,
        `写库结果：新增 ${syncResult.inserted}，更新 ${syncResult.updated}，未变更 ${syncResult.unchanged}`,
        `对齐后：API ${after.summary.apiRowCount} 行 / ${after.summary.apiWeightKg}kg；DB ${after.summary.dbRowCount} 行 / ${after.summary.dbWeightKg}kg`,
        `复核：仅API ${after.summary.onlyApiCount}，仅DB ${after.summary.onlyDbCount}，不一致 ${after.summary.mismatchCount}`
    ].join('\n');
}

async function writeReport(range, before, syncResult, after) {
    const reportRoot = path.join(__dirname, '..', 'downloads', 'reconciliation', range.start.slice(0, 4), range.start.slice(5, 7), range.start.slice(8, 10));
    ensureDir(reportRoot);
    const fileName = `shipping-alignment-${range.start}_${range.end}.xlsx`;
    const filePath = path.join(reportRoot, fileName);

    const workbook = new ExcelJS.Workbook();
    const summarySheet = workbook.addWorksheet('汇总');
    summarySheet.columns = [
        { header: '项', key: 'label', width: 20 },
        { header: '值', key: 'value', width: 32 }
    ];
    summarySheet.getRow(1).font = { bold: true };

    const summaryRows = [
        ['范围', range.label],
        ['对齐前 API行数', before.summary.apiRowCount],
        ['对齐前 DB行数', before.summary.dbRowCount],
        ['对齐前 API重量(kg)', before.summary.apiWeightKg],
        ['对齐前 DB重量(kg)', before.summary.dbWeightKg],
        ['对齐前 仅API', before.summary.onlyApiCount],
        ['对齐前 仅DB', before.summary.onlyDbCount],
        ['对齐前 不一致', before.summary.mismatchCount],
        ['写库新增', syncResult.inserted],
        ['写库更新', syncResult.updated],
        ['写库未变更', syncResult.unchanged],
        ['对齐后 API行数', after.summary.apiRowCount],
        ['对齐后 DB行数', after.summary.dbRowCount],
        ['对齐后 API重量(kg)', after.summary.apiWeightKg],
        ['对齐后 DB重量(kg)', after.summary.dbWeightKg],
        ['对齐后 仅API', after.summary.onlyApiCount],
        ['对齐后 仅DB', after.summary.onlyDbCount],
        ['对齐后 不一致', after.summary.mismatchCount]
    ];
    for (const [label, value] of summaryRows) {
        summarySheet.addRow({ label, value });
    }

    const detailSheet = workbook.addWorksheet('对齐前差异');
    detailSheet.columns = [
        { header: '类型', key: 'type', width: 10 },
        { header: '项目名称', key: 'project_name', width: 28 },
        { header: '计划名称', key: 'db_plans', width: 36 },
        { header: '构件编号', key: 'component_no', width: 18 },
        { header: '构件GUID', key: 'component_guid', width: 24 },
        { header: '规格', key: 'spec', width: 22 },
        { header: '区域部位', key: 'location', width: 28 },
        { header: 'API重量(kg)', key: 'api_weight_kg', width: 14 },
        { header: 'DB重量(kg)', key: 'db_weight_kg', width: 14 },
        { header: 'API数量', key: 'api_quantity', width: 10 },
        { header: 'DB数量', key: 'db_quantity', width: 10 },
        { header: 'API行数', key: 'api_rows', width: 10 },
        { header: 'DB行数', key: 'db_rows', width: 10 },
        { header: 'API日期', key: 'api_dates', width: 22 },
        { header: 'DB日期', key: 'db_dates', width: 22 },
        { header: 'DB操作人', key: 'db_operators', width: 18 }
    ];
    detailSheet.getRow(1).font = { bold: true };

    for (const row of before.onlyApi) {
        detailSheet.addRow({
            type: '仅API',
            ...row,
            api_weight_kg: row.weight_kg,
            api_quantity: row.quantity,
            api_rows: row.rows,
            api_dates: row.dates
        });
    }
    for (const row of before.onlyDb) {
        detailSheet.addRow({
            type: '仅DB',
            ...row,
            db_weight_kg: row.weight_kg,
            db_quantity: row.quantity,
            db_rows: row.rows,
            db_dates: row.dates,
            db_operators: row.operators
        });
    }
    for (const row of before.mismatches) {
        detailSheet.addRow({
            type: '差异',
            ...row
        });
    }

    await workbook.xlsx.writeFile(filePath);
    return filePath;
}

async function runNightlyShippingAlignment(options = {}) {
    const range = options.range || buildPreviousDayRange(options.now || new Date());
    const browserAutomation = new BrowserAutomation({
        ...config,
        browser: {
            ...(config.browser || {}),
            headless: true
        }
    });

    const started = await browserAutomation.launchBrowser();
    if (!started) {
        throw new Error('浏览器启动失败');
    }

    try {
        await ensureLogin(browserAutomation);

        const apiRows = await fetchApiRows(browserAutomation, range);
        const beforeDbRows = await fetchDbRows(range);
        const before = compareRows(apiRows, beforeDbRows);
        const hasMismatch = before.summary.onlyApiCount > 0 || before.summary.onlyDbCount > 0 || before.summary.mismatchCount > 0;

        if (!hasMismatch && !options.refreshSnapshots) {
            return {
                range,
                hasMismatch: false,
                summaryText: buildSummaryText(range, before, { inserted: 0, updated: 0, unchanged: before.summary.dbRowCount }, before),
                reportPath: null,
                syncResult: { inserted: 0, updated: 0, unchanged: before.summary.dbRowCount },
                before,
                after: before
            };
        }

        if (options.checkOnly) {
            const matches = await fetchComponentMatches([...new Set(apiRows.map(row => row.component_guid).filter(Boolean))]);
            const syncPreview = buildSyncRows(apiRows, matches);
            return {
                range,
                hasMismatch: true,
                summaryText: buildSummaryText(range, before, { inserted: 0, updated: 0, unchanged: 0 }, before),
                reportPath: null,
                syncResult: null,
                syncPreview: {
                    readyRowCount: syncPreview.rows.length,
                    skipped: syncPreview.skipped
                },
                before,
                after: before
            };
        }

        const matches = await fetchComponentMatches([...new Set(apiRows.map(row => row.component_guid).filter(Boolean))]);
        const syncPayload = buildSyncRows(apiRows, matches);
        if (syncPayload.skipped.missingComponent.length || syncPayload.skipped.ambiguousComponent.length || syncPayload.skipped.missingDeliveryTime.length) {
            throw new Error('发货对齐存在无法唯一匹配或缺少时间的数据，已中止写库');
        }

        const syncResult = await syncShippingEvents(syncPayload.rows);
        const afterDbRows = await fetchDbRows(range);
        const after = compareRows(apiRows, afterDbRows);
        const reportPath = await writeReport(range, before, syncResult, after);

        return {
            range,
            hasMismatch: true,
            summaryText: buildSummaryText(range, before, syncResult, after),
            reportPath,
            syncResult,
            before,
            after
        };
    } finally {
        await browserAutomation.closeBrowser();
    }
}

module.exports = {
    runNightlyShippingAlignment,
    buildSyncRows,
    formatShippingRawValue
};

if (require.main === module) {
    runNightlyShippingAlignment()
        .then(result => {
            console.log(JSON.stringify({
                date: result.range.label,
                hasMismatch: result.hasMismatch,
                reportPath: result.reportPath,
                syncResult: result.syncResult,
                before: result.before.summary,
                after: result.after.summary
            }, null, 2));
        })
        .catch(err => {
            console.error(err);
            process.exitCode = 1;
        });
}
