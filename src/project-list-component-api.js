/**
 * 项目列表页点击【构件】触发的云端 API 封装。
 *
 * 页面：https://dwyunsc.ddwjzkj.com:22222/project/index
 *
 * 1) POST /v1.order/getAllOrder
 *    { "project_id": "<云项目ID>" }
 *    → 该项目下订单列表（构件弹窗顶部筛选）
 *
 * 2) POST /v1.project/getProjectArtifacts（按订单逐个请求，不用 order_id=0 全量）
 *    { "proj_id": "<云项目ID>", "order_id": <订单ID>, "keyword": "", "production": 0, "type": 2 }
 *    → 先 getAllOrder 拿订单列表，再对每个 order_id 分别拉构件（避免网关 504）
 *    每条含：id(订单构件云上ID)、order_id、scheduling_id、scheduling_name、order_name、guid 等
 *
 * 3) POST /v1.production/getPlans（生产计划页，补 plan_id）
 *    { "proj_id": "<云项目ID>", page, size, ... }
 *    → id=生产计划页ID(plan_id)，scheduling_id 与构件 API 对齐
 */
const API_ORIGIN = 'https://dwyunsc.ddwjzkj.com:10086';
const API_GET_ALL_ORDER = `${API_ORIGIN}/v1.order/getAllOrder`;
const API_GET_PROJECT_ARTIFACTS = `${API_ORIGIN}/v1.project/getProjectArtifacts`;
const API_GET_PLANS = `${API_ORIGIN}/v1.production/getPlans`;

const DEFAULT_GET_PLANS_FILTER = {
    code: '',
    create_user: 0,
    department: 0,
    end_time: 0,
    keyword: '',
    production_status: -1,
    start_time: 0
};

const DEFAULT_ARTIFACT_FILTER = {
    keyword: '',
    production: 0,
    type: 2
};

function extractList(body) {
    if (!body || body.code !== 0) {
        return { ok: false, msg: body && body.msg, list: [] };
    }
    const data = body.data;
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : []);
    return { ok: true, msg: body.msg, list };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} token
 * @param {number|string} projectId 云项目 ID
 */
async function postJson(page, token, url, payload, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || 120000;
    const maxAttempts = Number(options.maxAttempts) || 1;
    const retryDelayMs = Number(options.retryDelayMs) || 3000;
    const retryStatuses = new Set(options.retryStatuses || [502, 503, 504, 550]);

    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await page.request.post(url, {
                data: payload,
                headers: {
                    Token: token,
                    'Content-Type': 'application/json;charset=utf-8'
                },
                timeout: timeoutMs
            });
            if (!res.ok()) {
                const text = await res.text().catch(() => '');
                const err = new Error(`HTTP ${res.status()} ${url}: ${String(text).slice(0, 300)}`);
                err.status = res.status();
                if (retryStatuses.has(res.status()) && attempt < maxAttempts) {
                    await page.waitForTimeout(retryDelayMs);
                    continue;
                }
                throw err;
            }
            return res.json();
        } catch (err) {
            lastErr = err;
            const status = err && err.status;
            const retriable = !status || retryStatuses.has(status) || /timeout|ETIMEDOUT|ECONNRESET/i.test(String(err.message || err));
            if (retriable && attempt < maxAttempts) {
                await page.waitForTimeout(retryDelayMs);
                continue;
            }
            throw err;
        }
    }
    throw lastErr || new Error(`request failed: ${url}`);
}

/**
 * 获取项目下订单列表（构件弹窗用）。
 * @param {import('playwright').Page} page
 * @param {string} token
 * @param {number|string} cloudProjectId
 */
async function fetchProjectOrders(page, token, cloudProjectId) {
    const body = await postJson(page, token, API_GET_ALL_ORDER, {
        project_id: String(cloudProjectId)
    });
    return extractList(body);
}

/**
 * 获取项目下构件列表（含订单、排产对应关系）。
 * @param {import('playwright').Page} page
 * @param {string} token
 * @param {object} options
 * @param {number|string} options.cloudProjectId 云项目 ID (proj_id)
 * @param {number|string} options.orderId 订单 ID（同步流程必须逐单传入，勿用 0 全量）
 * @param {string} [options.keyword='']
 * @param {number} [options.production=0]
 * @param {number} [options.type=2]
 */
async function fetchProjectArtifacts(page, token, options) {
    const cloudProjectId = options.cloudProjectId;
    const body = await postJson(page, token, API_GET_PROJECT_ARTIFACTS, {
        proj_id: String(cloudProjectId),
        order_id: Number(options.orderId || 0),
        keyword: options.keyword != null ? String(options.keyword) : DEFAULT_ARTIFACT_FILTER.keyword,
        production: Number(options.production != null ? options.production : DEFAULT_ARTIFACT_FILTER.production),
        type: Number(options.type != null ? options.type : DEFAULT_ARTIFACT_FILTER.type)
    }, {
        timeoutMs: options.timeoutMs || 300000,
        maxAttempts: options.maxAttempts || 3,
        retryDelayMs: options.retryDelayMs || 5000
    });
    return extractList(body);
}

/**
 * 生产计划列表（与 /production/plan 页一致），用于 scheduling_id → plan_id。
 */
async function fetchProductionPlans(page, token, cloudProjectId, options = {}) {
    const size = Number.isFinite(Number(options.size)) ? Number(options.size) : 200;
    const basePayload = {
        ...DEFAULT_GET_PLANS_FILTER,
        proj_id: Number(cloudProjectId),
        size
    };
    const first = await postJson(page, token, API_GET_PLANS, { ...basePayload, page: 1 });
    const parsed = extractList(first);
    if (!parsed.ok) {
        return { ok: false, msg: parsed.msg, list: [] };
    }
    const data0 = first.data || {};
    const total = Number(data0.count);
    const pageSize = Number(data0.size) || size;
    const totalPages = Number.isFinite(total) && total > 0
        ? Math.max(1, Math.ceil(total / pageSize))
        : 1;
    const all = [...parsed.list];
    for (let p = 2; p <= totalPages; p++) {
        const json = await postJson(page, token, API_GET_PLANS, { ...basePayload, page: p });
        const next = extractList(json);
        if (!next.ok) {
            return { ok: false, msg: next.msg, list: all };
        }
        all.push(...next.list);
    }
    return { ok: true, msg: parsed.msg, list: all };
}

/**
 * scheduling_id → plan_id（生产计划页 ID）
 */
function buildSchedulingToPlanMap(planList) {
    const map = new Map();
    for (const item of Array.isArray(planList) ? planList : []) {
        const planId = Number(item.id);
        const schedulingId = Number(item.scheduling_id);
        if (!Number.isFinite(planId) || !Number.isFinite(schedulingId)) continue;
        map.set(schedulingId, {
            plan_id: planId,
            plan_name: String(item.name || '').trim(),
            plan_code: String(item.code || '').trim() || null,
            scheduling_id: schedulingId
        });
    }
    return map;
}

/**
 * 按订单逐个拉取构件并合并（同步默认方式）。
 */
async function fetchProjectArtifactsPerOrder(page, token, cloudProjectId, orderList, options = {}) {
    const merged = [];
    const errors = [];
    for (const order of orderList) {
        const orderId = Number(order.id != null ? order.id : order.order_id);
        if (!Number.isFinite(orderId)) continue;
        try {
            const part = await fetchProjectArtifacts(page, token, {
                cloudProjectId,
                orderId,
                timeoutMs: options.timeoutMs || 180000,
                maxAttempts: options.maxAttempts || 2,
                retryDelayMs: options.retryDelayMs || 3000
            });
            if (part.ok) merged.push(...part.list);
            else errors.push({ orderId, msg: part.msg });
        } catch (err) {
            errors.push({ orderId, msg: err.message });
        }
        if (options.sleepMs > 0) await page.waitForTimeout(options.sleepMs);
    }
    return {
        ok: merged.length > 0,
        msg: errors.length ? `partial:${errors.length} order errors` : 'ok',
        list: merged,
        errors
    };
}

/**
 * 项目构件 + 订单 + 生产计划映射（同步入口，构件固定按订单分批拉取）。
 */
async function fetchProjectBridgeBundle(page, token, cloudProjectId, options = {}) {
    const orders = await fetchProjectOrders(page, token, cloudProjectId);
    const plans = await fetchProductionPlans(page, token, cloudProjectId);
    const artifacts = orders.ok
        ? await fetchProjectArtifactsPerOrder(page, token, cloudProjectId, orders.list, {
            timeoutMs: options.artifactTimeoutMs || 180000,
            maxAttempts: options.artifactMaxAttempts || 2,
            retryDelayMs: options.artifactRetryDelayMs || 3000,
            sleepMs: options.perOrderSleepMs != null ? options.perOrderSleepMs : 200
        })
        : { ok: false, msg: 'getAllOrder failed', list: [] };

    const schedulingToPlan = plans.ok ? buildSchedulingToPlanMap(plans.list) : new Map();
    return { orders, artifacts, plans, schedulingToPlan };
}

/**
 * 与页面【构件】一致：订单列表 + 按订单分批拉构件。
 */
async function fetchProjectComponentBundle(page, token, cloudProjectId, options = {}) {
    const orders = await fetchProjectOrders(page, token, cloudProjectId);
    const artifacts = orders.ok
        ? await fetchProjectArtifactsPerOrder(page, token, cloudProjectId, orders.list, {
            sleepMs: options.perOrderSleepMs != null ? options.perOrderSleepMs : 200
        })
        : { ok: false, msg: 'getAllOrder failed', list: [] };
    return { orders, artifacts };
}

function mapArtifactRow(item) {
    if (!item || typeof item !== 'object') return null;
    const dwyunArtifactId = Number(item.id);
    const orderId = Number(item.order_id);
    const schedulingId = Number(item.scheduling_id);
    if (!Number.isFinite(dwyunArtifactId) || !Number.isFinite(orderId)) return null;
    return {
        dwyun_artifact_id: dwyunArtifactId,
        order_id: orderId,
        scheduling_id: Number.isFinite(schedulingId) ? schedulingId : null,
        scheduling_name: String(item.scheduling_name || '').trim() || null,
        order_name: String(item.order_name || '').trim() || null,
        cloud_project_id: Number(item.project_id) || null,
        component_guid: String(item.guid || item['构件GUID'] || '').trim(),
        component_no: String(item.code || item['构件编号'] || '').trim() || null,
        component_name: String(item.name || item['构件名称'] || '').trim() || null,
        spec: String(item['规格/型号'] || '').trim() || null,
        location: String(item['区域部位/所在楼层'] || '').trim() || null,
        raw: item
    };
}

function mapOrderRow(item) {
    if (!item || typeof item !== 'object') return null;
    const orderId = Number(item.id);
    if (!Number.isFinite(orderId)) return null;
    return {
        order_id: orderId,
        cloud_project_id: Number(item.project_id) || null,
        order_name: String(item.name || '').trim(),
        order_code: String(item.code || '').trim() || null,
        raw: item
    };
}

module.exports = {
    API_GET_ALL_ORDER,
    API_GET_PROJECT_ARTIFACTS,
    API_GET_PLANS,
    DEFAULT_ARTIFACT_FILTER,
    DEFAULT_GET_PLANS_FILTER,
    fetchProjectOrders,
    fetchProjectArtifacts,
    fetchProductionPlans,
    buildSchedulingToPlanMap,
    fetchProjectArtifactsPerOrder,
    fetchProjectBridgeBundle,
    fetchProjectComponentBundle,
    mapArtifactRow,
    mapOrderRow,
    extractList
};
