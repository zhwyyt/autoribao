const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const config = require('../config/default.json');
const BrowserAutomation = require('./browser-automation');
const { query } = require('./query/sql-runner');
const { loadTeamDirectory } = require('./query/team-directory-loader');
const { syncArtifactsForPlanFromApi, setCapturedToken: setProductionPlanCapturedToken } = require('./extract-production-plan');

const PROCESS_TASKS = [
    {
        key: 'fitup_report',
        processLabel: '装焊报检',
        statusType: 'fitup_weld_report',
        departmentLabel: '钢结构厂',
        departmentPathLabels: ['钢结构厂'],
        teamField: 'fitupTeamName',
        fallbackNames: []
    },
    {
        key: 'fitup_ndi',
        processLabel: '装焊探伤',
        statusType: 'fitup_weld_ndi',
        departmentLabel: '探伤部门',
        departmentPathLabels: ['质检与探伤', '探伤部门'],
        teamField: 'ndiTeamName',
        fallbackNames: ['王国良探伤组']
    },
    {
        key: 'fitup_qc',
        processLabel: '装焊质检',
        statusType: 'fitup_weld_qc',
        departmentLabel: '质检',
        departmentPathLabels: ['质检与探伤', '质检'],
        teamField: 'qcTeamName',
        fallbackNames: ['杨东国质检组']
    },
    {
        key: 'painting',
        processLabel: '涂装',
        statusType: 'painting',
        departmentLabel: '涂装与成品',
        departmentPathLabels: ['涂装与成品', '涂装车间'],
        teamField: 'paintTeamName',
        fallbackNames: ['重钢涂装车间']
    }
];

const MISMATCH_ALERT_TASK_KEYS = new Set(['fitup_report', 'painting']);
const PROCESS_API_SNAPSHOT_PREFIX = 'PROCESS_API_JSON:';

function ensureDir(dir) {
    if (!dir) return;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function toNumber(value) {
    if (value == null || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function formatProcessRawValue(row) {
    return `${PROCESS_API_SNAPSHOT_PREFIX}${JSON.stringify({
        project_name: row.project_name || '',
        component_guid: row.component_guid || '',
        component_no: row.component_no || '',
        spec: row.spec || '',
        location: row.location || '',
        quantity: row.quantity,
        weight_kg: row.weight_kg,
        event_date: row.event_date || '',
        operator_name: row.operator_name || '',
        create_time_text: row.create_time_text || ''
    })}`;
}

async function refreshProcessSnapshots(task, apiRows) {
    if (!task || task.statusType !== 'fitup_weld_report' || !Array.isArray(apiRows) || apiRows.length === 0) {
        return { updated: 0, unmatched: 0 };
    }
    const payload = apiRows.map((row, index) => ({
        row_no: index + 1,
        project_name: row.project_name,
        component_guid: row.component_guid,
        event_date: row.event_date,
        raw_value: formatProcessRawValue(row)
    }));
    const sql = `
        WITH raw_input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(
                row_no int, project_name text, component_guid text, event_date text, raw_value text
            )
        ), input_rows AS (
            SELECT DISTINCT ON (project_name, component_guid, event_date)
                row_no, project_name, component_guid, event_date, raw_value
            FROM raw_input
            ORDER BY project_name, component_guid, event_date, row_no
        ), matched AS (
            SELECT DISTINCT i.row_no, e.event_id, i.raw_value
            FROM input_rows i
            JOIN project p ON trim(p.project_name) = trim(i.project_name)
            JOIN production_plan pp ON pp.project_id = p.project_id
            JOIN component c ON c.plan_id = pp.plan_id AND trim(c.component_guid) = trim(i.component_guid)
            JOIN component_status_event e ON e.component_id = c.component_id
                AND e.status_type = $2 AND e.is_completed = true
                AND timezone('Asia/Shanghai', e.event_at)::date = i.event_date::date
        ), updated AS (
            UPDATE component_status_event e
            SET raw_value = matched.raw_value, updated_at = now()
            FROM matched
            WHERE e.event_id = matched.event_id AND e.raw_value IS DISTINCT FROM matched.raw_value
            RETURNING e.event_id
        )
        SELECT (SELECT count(*)::int FROM updated) AS updated,
               ((SELECT count(*) FROM input_rows) - (SELECT count(DISTINCT row_no) FROM matched))::int AS unmatched
    `;
    const result = await query(sql, [JSON.stringify(payload), task.statusType]);
    return result.rows[0] || { updated: 0, unmatched: payload.length };
}

function formatDateYmd(date) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function buildPreviousDayRange(now = new Date()) {
    const local = new Date(now);
    const end = new Date(local.getFullYear(), local.getMonth(), local.getDate() - 1);
    const ymd = formatDateYmd(end);
    return {
        start: ymd,
        end: ymd,
        label: ymd
    };
}

function buildMonthlyBusinessRange(now = new Date()) {
    const local = new Date(now);
    const end = new Date(local.getFullYear(), local.getMonth(), 25);
    const start = new Date(local.getFullYear(), local.getMonth() - 1, 26);
    return {
        start: formatDateYmd(start),
        end: formatDateYmd(end),
        label: `${formatDateYmd(start)}至${formatDateYmd(end)}`
    };
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
    const clicked = await clickControlNearText(page, labelText);
    if (!clicked) {
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

async function selectCascaderCheckboxByText(page, optionText, options = {}) {
    const exact = options.exact !== false;
    const labelSelector = '.el-cascader-panel .el-cascader-node__label';
    const pattern = exact
        ? new RegExp(`^\\s*${escapeRegExp(optionText)}\\s*$`)
        : new RegExp(escapeRegExp(optionText));
    const nodeLabel = page.locator(labelSelector).filter({ hasText: pattern }).first();
    await nodeLabel.waitFor({ state: 'visible', timeout: 15000 });
    const node = nodeLabel.locator('xpath=ancestor::li[contains(@class,"el-cascader-node")][1]').first();
    const checkboxInner = node.locator('.el-checkbox__inner').first();
    try {
        await checkboxInner.waitFor({ state: 'visible', timeout: 2000 });
        await checkboxInner.click({ force: true });
    } catch {
        await nodeLabel.click({ force: true });
    }
}

async function expandCascaderNodeByText(page, optionText) {
    const labelSelector = '.el-cascader-panel .el-cascader-node__label';
    const nodeLabel = page.locator(labelSelector).filter({ hasText: new RegExp(`^\\s*${escapeRegExp(optionText)}\\s*$`) }).first();
    await nodeLabel.waitFor({ state: 'visible', timeout: 5000 });
    try {
        await nodeLabel.hover();
        await page.waitForTimeout(500);
    } catch {}
    try {
        await nodeLabel.click({ force: true });
        await page.waitForTimeout(500);
    } catch {}
}

async function selectDepartmentScope(page, task) {
    const pathLabels = Array.isArray(task.departmentPathLabels) ? task.departmentPathLabels.filter(Boolean) : [];
    if (pathLabels.length === 0) {
        await selectCascaderCheckboxByText(page, task.departmentLabel, { exact: true });
        return task.departmentLabel;
    }

    try {
        for (let i = 0; i < pathLabels.length - 1; i += 1) {
            await expandCascaderNodeByText(page, pathLabels[i]);
        }
        await selectCascaderCheckboxByText(page, pathLabels[pathLabels.length - 1], { exact: true });
        return pathLabels.join(' > ');
    } catch {
        await selectCascaderCheckboxByText(page, task.departmentLabel, { exact: true });
        return task.departmentLabel;
    }
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
    const headers = captured && captured.headers ? captured.headers : {};
    const token = headers.token || headers.Token || headers.TOKEN;
    if (!token) {
        throw new Error('重放 API 请求失败：未捕获到 Token');
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
    throw new Error(`重放工序 API 请求失败（已重试2次）：${message}`);
}

function buildApiRowKey(row) {
    return [
        normalizeText(row.project_name),
        normalizeText(row.component_guid),
        normalizeText(row.component_no),
        normalizeText(row.spec),
        normalizeText(row.location)
    ].join('|');
}

function buildDbRowKey(row) {
    return [
        normalizeText(row.project_name),
        normalizeText(row.component_guid),
        normalizeText(row.component_no),
        normalizeText(row.spec),
        normalizeText(row.location)
    ].join('|');
}

function collectTeamNames(directory, task) {
    const values = new Set();
    for (const member of directory.members || []) {
        const raw = member && member[task.teamField];
        const text = String(raw || '').trim();
        if (text) values.add(text.replace(/\s+/g, ''));
    }
    for (const item of task.fallbackNames || []) {
        const text = String(item || '').trim();
        if (text) values.add(text.replace(/\s+/g, ''));
    }
    return Array.from(values);
}

async function fetchApiRows(browserAutomation, task, range) {
    const page = browserAutomation.page;
    const url = config.website.subworkStatisticsUrl;
    if (!url) throw new Error('subworkStatisticsUrl 未配置');

    await gotoWithRelogin(browserAutomation, url);
    await clickFormControlByLabel(page, '统计部门');
    await selectDepartmentScope(page, task);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await clickFormControlByLabel(page, '工序');
    await selectDropdownOption(page, task.processLabel);
    await setDateRange(page, range.start, range.end);

    const queryBtn = page.locator('button:has-text("查询")').first();
    await queryBtn.waitFor({ state: 'visible', timeout: 15000 });

    const captured = await captureApiRequest(
        page,
        '/v1.statistical/getStatisticalDays',
        async () => {
            await queryBtn.click();
        }
    );
    const body = await replayCapturedApiRequest(page, captured);
    const capturedHeaders = captured && captured.headers ? captured.headers : {};
    const capturedToken = capturedHeaders.token || capturedHeaders.Token || capturedHeaders.TOKEN;
    if (capturedToken) {
        setProductionPlanCapturedToken(capturedToken);
    }
    const packet = Array.isArray(body && body.data) ? body.data[0] : null;
    const list = Array.isArray(packet && packet.list) ? packet.list : [];

    return list.map(item => ({
        key: buildApiRowKey({
            project_name: item.project_name,
            component_guid: item['构件GUID'],
            component_no: item['构件编号'],
            spec: item['规格/型号'],
            location: item['区域部位/所在楼层']
        }),
        project_name: String(item.project_name || '').trim(),
        component_guid: String(item['构件GUID'] || '').trim(),
        component_no: String(item['构件编号'] || '').trim(),
        spec: String(item['规格/型号'] || '').trim(),
        location: String(item['区域部位/所在楼层'] || '').trim(),
        weight_kg: toNumber(item['重量']),
        quantity: toNumber(item['数量']),
        event_date: String(item.today || item['日期'] || '').trim(),
        department_parent: String(item.department_parent || '').trim(),
        department: String(item.department || '').trim(),
        process_name: String(item.process_name || '').trim(),
        operator_name: String(item.create_user_name || '').trim(),
        create_time_text: String(item.create_time_text || '').trim(),
        last_process: String(item.last_process || '').trim()
    }));
}

async function fetchDbRows(task, range, teamNames) {
    const params = [task.statusType];
    const filters = [
        `e.status_type = $1`
    ];

    if (Array.isArray(teamNames) && teamNames.length > 0) {
        params.push(teamNames);
        filters.push(`regexp_replace(coalesce(e.team_name, ''), '\\s+', '', 'g') = ANY($${params.length}::text[])`);
    }

    params.push(range.start);
    const startIndex = params.length;
    params.push(range.end);
    const endIndex = params.length;

    const sql = `
        WITH latest_process AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
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
                e.is_completed,
                COALESCE(NULLIF(trim(e.team_name), ''), '') AS team_name,
                COALESCE(NULLIF(trim(e.operator_name), ''), '') AS operator_name,
                COALESCE(NULLIF(trim(e.trace_operator_name), ''), '') AS trace_operator_name
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE ${filters.join('\n              AND ')}
            ORDER BY
                p.project_name ASC,
                pp.plan_name ASC,
                c.component_guid ASC,
                COALESCE(timezone('Asia/Shanghai', e.event_at), timezone('Asia/Shanghai', e.updated_at), timezone('Asia/Shanghai', e.created_at)) DESC,
                e.event_id DESC
        )
        SELECT *
        FROM latest_process
        WHERE is_completed = TRUE
          AND event_at_local IS NOT NULL
          AND event_at_local::date >= $${startIndex}::date
          AND event_at_local::date <= $${endIndex}::date
        ORDER BY event_at_local ASC, project_name ASC, plan_name ASC, component_guid ASC
    `;

    const res = await query(sql, params);
    return (res.rows || []).map(row => ({
        key: buildDbRowKey(row),
        ...row,
        event_date: String(row.event_at_local || '').slice(0, 10)
    }));
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
                teams: new Set(),
                plans: new Set()
            });
        }
        const item = map.get(key);
        item.weight_kg += toNumber(row.total_weight_kg != null ? row.total_weight_kg : row.weight_kg);
        item.quantity += toNumber(row.quantity);
        item.rows += 1;
        if (row.event_date) item.dates.add(row.event_date);
        if (row.department) item.teams.add(row.department);
        if (row.team_name) item.teams.add(row.team_name);
        if (row.plan_name) item.plans.add(row.plan_name);
    }
    return map;
}

function finalizeAggregate(item) {
    return {
        key: item.key,
        project_name: item.project_name,
        component_guid: item.component_guid,
        component_no: item.component_no,
        spec: item.spec,
        location: item.location,
        weight_kg: Number(item.weight_kg.toFixed(3)),
        quantity: Number(item.quantity.toFixed(3)),
        rows: item.rows,
        dates: Array.from(item.dates).sort().join(', '),
        teams: Array.from(item.teams).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(', '),
        plans: Array.from(item.plans).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(' | ')
    };
}

function compareProcessRows(task, apiRows, dbRows) {
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
                ...finalizeAggregate(apiItem),
                api_weight_kg: apiWeight,
                db_weight_kg: dbWeight,
                api_quantity: apiQty,
                db_quantity: dbQty,
                api_rows: apiItem.rows,
                db_rows: dbItem.rows,
                api_dates: Array.from(apiItem.dates).sort().join(', '),
                db_dates: Array.from(dbItem.dates).sort().join(', '),
                api_teams: Array.from(apiItem.teams).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(', '),
                db_teams: Array.from(dbItem.teams).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(', '),
                db_plans: Array.from(dbItem.plans).sort((a, b) => a.localeCompare(b, 'zh-CN')).join(' | ')
            });
        }
    }

    return {
        task,
        apiRows,
        dbRows,
        onlyApi,
        onlyDb,
        mismatches,
        summary: {
            key: task.key,
            processLabel: task.processLabel,
            departmentLabel: task.departmentLabel,
            apiRowCount: apiRows.length,
            dbRowCount: dbRows.length,
            apiWeightKg: Number(apiRows.reduce((sum, row) => sum + toNumber(row.weight_kg), 0).toFixed(3)),
            dbWeightKg: Number(dbRows.reduce((sum, row) => sum + toNumber(row.total_weight_kg != null ? row.total_weight_kg : row.weight_kg), 0).toFixed(3)),
            onlyApiCount: onlyApi.length,
            onlyDbCount: onlyDb.length,
            mismatchCount: mismatches.length
        }
    };
}

function shouldCountForMismatch(result) {
    const taskKey = String(result && result.task && result.task.key || '').trim();
    return MISMATCH_ALERT_TASK_KEYS.has(taskKey);
}

function hasAnyMismatch(results) {
    return results.some(result => shouldCountForMismatch(result) && (
        result.summary.onlyApiCount > 0 ||
        result.summary.onlyDbCount > 0 ||
        result.summary.mismatchCount > 0 ||
        result.summary.apiWeightKg !== result.summary.dbWeightKg ||
        result.summary.apiRowCount !== result.summary.dbRowCount
    ));
}

function buildResultsSectionLines(title, results) {
    const lines = [title];
    for (const result of results) {
        const s = result.summary;
        lines.push(
            `${s.processLabel} / ${s.departmentLabel}: API ${s.apiRowCount}行 ${s.apiWeightKg}kg，DB ${s.dbRowCount}行 ${s.dbWeightKg}kg，` +
            `仅API ${s.onlyApiCount}，仅DB ${s.onlyDbCount}，差异 ${s.mismatchCount}`
        );
    }
    return lines;
}

function buildPlanSyncTargets(rows) {
    const map = new Map();
    for (const row of rows || []) {
        const planId = Number(row && row.plan_id);
        if (!Number.isFinite(planId) || planId <= 0) continue;
        const taskKey = String(row.taskKey || '').trim();
        const key = `${taskKey}|${planId}`;
        if (!map.has(key)) {
            map.set(key, {
                taskKey,
                taskLabel: String(row.taskLabel || '').trim(),
                planId,
                planName: String(row.plan_name || '').trim(),
                projectName: String(row.project_name || '').trim(),
                sources: new Set(),
                componentGuids: new Set()
            });
        }
        const item = map.get(key);
        if (row.sourceType) item.sources.add(String(row.sourceType).trim());
        if (row.component_guid) item.componentGuids.add(String(row.component_guid).trim());
        if (!item.planName && row.plan_name) item.planName = String(row.plan_name || '').trim();
        if (!item.projectName && row.project_name) item.projectName = String(row.project_name || '').trim();
    }
    return Array.from(map.values())
        .map(item => ({
            taskKey: item.taskKey,
            taskLabel: item.taskLabel,
            planId: item.planId,
            planName: item.planName,
            projectName: item.projectName,
            sources: Array.from(item.sources).sort(),
            componentGuids: Array.from(item.componentGuids).sort()
        }))
        .sort((a, b) => a.taskKey.localeCompare(b.taskKey, 'en') || a.planId - b.planId);
}

function buildPlanLookupSeedRows(results) {
    const rows = [];
    for (const result of results || []) {
        const dbRowsByKey = new Map();
        for (const row of result.dbRows || []) {
            if (!dbRowsByKey.has(row.key)) dbRowsByKey.set(row.key, []);
            dbRowsByKey.get(row.key).push(row);
        }

        const pushDbMatches = (items, sourceType) => {
            for (const item of items || []) {
                for (const raw of dbRowsByKey.get(item.key) || []) {
                    rows.push({
                        taskKey: result.task.key,
                        taskLabel: result.task.processLabel,
                        sourceType,
                        plan_id: raw.plan_id,
                        plan_name: raw.plan_name,
                        project_name: raw.project_name,
                        component_guid: raw.component_guid,
                        component_no: raw.component_no,
                        spec: raw.spec,
                        location: raw.location
                    });
                }
            }
        };

        pushDbMatches(result.onlyDb, 'onlyDb');
        pushDbMatches(result.mismatches, 'mismatch');

        for (const item of result.onlyApi || []) {
            rows.push({
                taskKey: result.task.key,
                taskLabel: result.task.processLabel,
                sourceType: 'onlyApi',
                plan_id: null,
                plan_name: '',
                project_name: item.project_name,
                component_guid: item.component_guid,
                component_no: item.component_no,
                spec: item.spec,
                location: item.location
            });
        }
    }
    return rows;
}

async function resolveOnlyApiPlanRows(rows) {
    const pendingRows = (rows || []).filter(row => !row.plan_id && row.project_name && row.component_guid);
    if (pendingRows.length === 0) return [];

    const values = [];
    const params = [];
    let index = 1;
    pendingRows.forEach((row, rowNo) => {
        values.push(`($${index++}::int, $${index++}::text, $${index++}::text, $${index++}::text, $${index++}::text)`);
        params.push(
            rowNo,
            String(row.taskKey || '').trim(),
            String(row.taskLabel || '').trim(),
            String(row.project_name || '').trim(),
            String(row.component_guid || '').trim()
        );
    });

    const sql = `
        WITH input_rows (row_no, task_key, task_label, project_name, component_guid) AS (
            VALUES ${values.join(',\n                   ')}
        )
        SELECT
            i.row_no,
            i.task_key,
            i.task_label,
            p.project_name,
            pp.plan_id,
            pp.plan_name,
            c.component_guid,
            c.component_no,
            c.spec,
            c.location
        FROM input_rows i
        JOIN project p
          ON regexp_replace(coalesce(p.project_name, ''), '\\s+', '', 'g')
           = regexp_replace(coalesce(i.project_name, ''), '\\s+', '', 'g')
        JOIN production_plan pp ON pp.project_id = p.project_id
        JOIN component c
          ON c.plan_id = pp.plan_id
         AND regexp_replace(coalesce(c.component_guid, ''), '\\s+', '', 'g')
           = regexp_replace(coalesce(i.component_guid, ''), '\\s+', '', 'g')
        ORDER BY i.row_no ASC, pp.plan_id ASC
    `;

    const res = await query(sql, params);
    return (res.rows || []).map(row => ({
        taskKey: row.task_key,
        taskLabel: row.task_label,
        sourceType: 'onlyApi',
        plan_id: row.plan_id,
        plan_name: row.plan_name,
        project_name: row.project_name,
        component_guid: row.component_guid,
        component_no: row.component_no,
        spec: row.spec,
        location: row.location
    }));
}

async function resolvePlanLookupRows(results) {
    const seedRows = buildPlanLookupSeedRows(results);
    const resolvedOnlyApiRows = await resolveOnlyApiPlanRows(seedRows);
    return [
        ...seedRows.filter(row => row.plan_id),
        ...resolvedOnlyApiRows
    ];
}

async function syncProcessMismatchPlans(browserAutomation, results) {
    const relevantResults = (results || []).filter(item => shouldCountForMismatch(item));
    const lookupRows = await resolvePlanLookupRows(relevantResults);
    const syncTargets = buildPlanSyncTargets(lookupRows);
    const syncedPlans = [];
    const failedPlans = [];

    for (const target of syncTargets) {
        try {
            const syncResult = await syncArtifactsForPlanFromApi(
                browserAutomation.page,
                target.planId,
                false,
                `工序差异回填(${target.taskLabel})：`
            );
            syncedPlans.push({
                ...target,
                ok: Boolean(syncResult),
                compStats: syncResult ? syncResult.compStats : null,
                eventStats: syncResult ? syncResult.eventStats : null
            });
        } catch (error) {
            failedPlans.push({
                ...target,
                error: error && error.message ? error.message : String(error)
            });
        }
    }

    return {
        lookupRows,
        syncTargets,
        syncedPlans,
        failedPlans
    };
}

function buildSummaryText(range, beforeResults, syncResult, afterResults) {
    const lines = [`工序数据校对异常报告`, `日期：${range.label}`, ''];
    lines.push(...buildResultsSectionLines('同步前：', beforeResults));
    if (syncResult) {
        lines.push('');
        lines.push(
            `定向同步计划数：${syncResult.syncTargets.length}，成功 ${syncResult.syncedPlans.filter(item => item.ok).length}，失败 ${syncResult.failedPlans.length}`
        );
    }
    if (afterResults) {
        lines.push('');
        lines.push(...buildResultsSectionLines('同步后：', afterResults));
    }
    return lines.join('\n');
}

async function writeReport(range, beforeResults, syncResult, afterResults) {
    const reportRoot = path.join(__dirname, '..', 'downloads', 'reconciliation', range.start.slice(0, 4), range.start.slice(5, 7), range.start.slice(8, 10));
    ensureDir(reportRoot);
    const filePath = path.join(reportRoot, `${range.start}_工序数据校对报告.xlsx`);
    const workbook = new ExcelJS.Workbook();

    const summarySheet = workbook.addWorksheet('汇总');
    summarySheet.columns = [
        { header: '阶段', key: 'phase', width: 10 },
        { header: '工序', key: 'processLabel', width: 16 },
        { header: '统计部门', key: 'departmentLabel', width: 16 },
        { header: 'API行数', key: 'apiRowCount', width: 12 },
        { header: 'DB行数', key: 'dbRowCount', width: 12 },
        { header: 'API重量(kg)', key: 'apiWeightKg', width: 14 },
        { header: 'DB重量(kg)', key: 'dbWeightKg', width: 14 },
        { header: '仅API', key: 'onlyApiCount', width: 10 },
        { header: '仅DB', key: 'onlyDbCount', width: 10 },
        { header: '差异', key: 'mismatchCount', width: 10 }
    ];
    summarySheet.getRow(1).font = { bold: true };
    for (const result of beforeResults) {
        summarySheet.addRow({ phase: '同步前', ...result.summary });
    }
    if (afterResults) {
        for (const result of afterResults) {
            summarySheet.addRow({ phase: '同步后', ...result.summary });
        }
    }

    if (syncResult) {
        const syncSheet = workbook.addWorksheet('计划同步');
        syncSheet.columns = [
            { header: '工序', key: 'taskLabel', width: 16 },
            { header: '项目名称', key: 'projectName', width: 28 },
            { header: '计划ID', key: 'planId', width: 12 },
            { header: '计划名称', key: 'planName', width: 36 },
            { header: '来源', key: 'sources', width: 18 },
            { header: '构件GUID', key: 'componentGuids', width: 40 },
            { header: '状态', key: 'status', width: 12 },
            { header: '构件同步', key: 'compStats', width: 28 },
            { header: '事件同步', key: 'eventStats', width: 28 },
            { header: '错误', key: 'error', width: 36 }
        ];
        syncSheet.getRow(1).font = { bold: true };

        for (const item of syncResult.syncedPlans || []) {
            syncSheet.addRow({
                taskLabel: item.taskLabel,
                projectName: item.projectName,
                planId: item.planId,
                planName: item.planName,
                sources: (item.sources || []).join(', '),
                componentGuids: (item.componentGuids || []).join(', '),
                status: item.ok ? '成功' : '未返回',
                compStats: item.compStats ? `新增${item.compStats.inserted} 更新${item.compStats.updated} 无变化${item.compStats.unchanged}` : '',
                eventStats: item.eventStats ? `新增${item.eventStats.inserted} 更新${item.eventStats.updated} 无变化${item.eventStats.unchanged}` : ''
            });
        }
        for (const item of syncResult.failedPlans || []) {
            syncSheet.addRow({
                taskLabel: item.taskLabel,
                projectName: item.projectName,
                planId: item.planId,
                planName: item.planName,
                sources: (item.sources || []).join(', '),
                componentGuids: (item.componentGuids || []).join(', '),
                status: '失败',
                error: item.error
            });
        }
    }

    const phases = [
        { label: '同步前', results: beforeResults },
        ...(afterResults ? [{ label: '同步后', results: afterResults }] : [])
    ];

    for (const phase of phases) {
        for (const result of phase.results) {
            const sheet = workbook.addWorksheet(`${phase.label}-${result.task.processLabel}`.slice(0, 28));
        sheet.columns = [
            { header: '类型', key: 'type', width: 10 },
            { header: '项目名称', key: 'project_name', width: 28 },
            { header: '计划名称', key: 'db_plans', width: 36 },
            { header: '构件编号', key: 'component_no', width: 18 },
            { header: '构件GUID', key: 'component_guid', width: 24 },
            { header: '规格', key: 'spec', width: 24 },
            { header: '区域部位', key: 'location', width: 30 },
            { header: 'API重量(kg)', key: 'api_weight_kg', width: 14 },
            { header: 'DB重量(kg)', key: 'db_weight_kg', width: 14 },
            { header: 'API数量', key: 'api_quantity', width: 12 },
            { header: 'DB数量', key: 'db_quantity', width: 12 },
            { header: 'API行数', key: 'api_rows', width: 10 },
            { header: 'DB行数', key: 'db_rows', width: 10 },
            { header: 'API日期', key: 'api_dates', width: 18 },
            { header: 'DB日期', key: 'db_dates', width: 18 },
            { header: 'API班组', key: 'api_teams', width: 24 },
            { header: 'DB班组', key: 'db_teams', width: 24 }
        ];
            sheet.getRow(1).font = { bold: true };

            for (const row of result.onlyApi) {
                sheet.addRow({
                    type: '仅API',
                    ...row,
                    api_weight_kg: row.weight_kg,
                    api_quantity: row.quantity,
                    api_rows: row.rows,
                    api_dates: row.dates,
                    api_teams: row.teams
                });
            }
            for (const row of result.onlyDb) {
                sheet.addRow({
                    type: '仅DB',
                    ...row,
                    db_weight_kg: row.weight_kg,
                    db_quantity: row.quantity,
                    db_rows: row.rows,
                    db_dates: row.dates,
                    db_teams: row.teams,
                    db_plans: row.plans
                });
            }
            for (const row of result.mismatches) {
                sheet.addRow({
                    type: '差异',
                    ...row
                });
            }
        }
    }

    await workbook.xlsx.writeFile(filePath);
    return filePath;
}

async function runNightlyProcessReconciliation(options = {}) {
    const range = options.range || buildPreviousDayRange(options.now || new Date());
    const browserAutomation = new BrowserAutomation({
        ...config,
        browser: {
            ...(config.browser || {}),
            headless: true
        }
    });

    const directory = await loadTeamDirectory();
    const started = await browserAutomation.launchBrowser();
    if (!started) {
        throw new Error('浏览器启动失败');
    }

    try {
        const ok = await browserAutomation.login();
        if (!ok) {
            throw new Error('登录失败');
        }

        const selectedTasks = Array.isArray(options.taskKeys) && options.taskKeys.length > 0
            ? PROCESS_TASKS.filter(task => options.taskKeys.includes(task.key))
            : PROCESS_TASKS;
        const beforeResults = [];
        const apiRowsByTask = new Map();
        for (const task of selectedTasks) {
            const [apiRows, dbRows] = await Promise.all([
                fetchApiRows(browserAutomation, task, range),
                fetchDbRows(task, range, collectTeamNames(directory, task))
            ]);
            apiRowsByTask.set(task.key, apiRows);
            beforeResults.push(compareProcessRows(task, apiRows, dbRows));
        }

        let snapshotResult = null;
        if (options.refreshSnapshots) {
            const fitupTask = selectedTasks.find(task => task.statusType === 'fitup_weld_report');
            snapshotResult = await refreshProcessSnapshots(
                fitupTask,
                fitupTask ? apiRowsByTask.get(fitupTask.key) : []
            );
        }

        const hasMismatch = hasAnyMismatch(beforeResults);

        if (!hasMismatch) {
            return {
                range,
                hasMismatch: false,
                results: beforeResults,
                beforeResults,
                afterResults: beforeResults,
                syncResult: snapshotResult ? { snapshotResult } : null,
                summaryText: buildSummaryText(range, beforeResults, null, beforeResults),
                reportPath: null
            };
        }

        if (options.checkOnly) {
            return {
                range,
                hasMismatch: true,
                results: beforeResults,
                beforeResults,
                afterResults: beforeResults,
                syncResult: snapshotResult ? { snapshotResult } : null,
                summaryText: buildSummaryText(range, beforeResults, null, beforeResults),
                reportPath: null
            };
        }

        const syncResult = await syncProcessMismatchPlans(browserAutomation, beforeResults);

        const afterResults = [];
        for (const task of PROCESS_TASKS) {
            const [apiRows, dbRows] = await Promise.all([
                fetchApiRows(browserAutomation, task, range),
                fetchDbRows(task, range, collectTeamNames(directory, task))
            ]);
            afterResults.push(compareProcessRows(task, apiRows, dbRows));
        }

        const reportPath = await writeReport(range, beforeResults, syncResult, afterResults);
        return {
            range,
            hasMismatch: true,
            results: afterResults,
            beforeResults,
            afterResults,
            syncResult,
            summaryText: buildSummaryText(range, beforeResults, syncResult, afterResults),
            reportPath
        };
    } finally {
        await browserAutomation.closeBrowser();
    }
}

module.exports = {
    runNightlyProcessReconciliation,
    buildPreviousDayRange,
    buildMonthlyBusinessRange,
    buildPlanSyncTargets,
    shouldCountForMismatch,
    formatProcessRawValue,
    refreshProcessSnapshots
};

if (require.main === module) {
    runNightlyProcessReconciliation()
        .then(result => {
            console.log(JSON.stringify({
                date: result.range.label,
                hasMismatch: result.hasMismatch,
                reportPath: result.reportPath,
                summary: result.results.map(item => item.summary)
            }, null, 2));
        })
        .catch(err => {
            console.error(err);
            process.exitCode = 1;
        });
}
