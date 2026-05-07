/**
 * 独立脚本：登录东吴云 → 打开生产计划页 → 提取表格数据 → 导出 Excel / 同步数据库
 *
 * 用法：
 *   node src/extract-production-plan.js           # 全量模式：抓取所有页、导出 Excel、全量同步
 *   node src/extract-production-plan.js --by-project   # 按项目增量：仅同步活跃项目（building/pipeline）
 *   node src/extract-production-plan.js --api --by-project   # 按项目增量：仅同步活跃项目（building/pipeline），使用 API 模式
 *   node src/extract-production-plan.js --api --by-project --components   # 按项目增量 + API 模式 + 构件同步（调用 getPlanArtifacts）
 *   node src/extract-production-plan.js --api --by-project --components-changed-only   # 先同步计划，再仅对有变更的计划拉构件
 *   node src/extract-production-plan.js --api --components --plan-id 6891   # 单计划模式：仅处理指定 plan_id 的构件
 *   node src/extract-production-plan.js --inspect-artifact-keys 7107   # 核对 getPlanArtifacts 首条构件 JSON 键名是否与解析字段一致
 *   npm run extract-production-plan
 *   npm run extract-production-plan-by-project
 */
const path = require('path');
const fs = require('fs');

const config = require('../config/default.json');
const logger = require('./logger');
const BrowserAutomation = require('./browser-automation');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const WEBSITE_ORIGIN = (() => {
    const loginUrl = config && config.website ? config.website.loginUrl : '';
    try {
        return loginUrl ? new URL(String(loginUrl)).origin : '';
    } catch {
        return '';
    }
})();

const PLAN_URL = `${WEBSITE_ORIGIN}/production/plan`;
const PLAN_INFO_URL = `${WEBSITE_ORIGIN}/production/plan/info`;

const API_ORIGIN = 'https://dwyunsc.ddwjzkj.com:10086';
const API_GET_PLANS = `${API_ORIGIN}/v1.production/getPlans`;
const API_GET_PLAN_ARTIFACTS = `${API_ORIGIN}/v1.production/getPlanArtifacts`;

let capturedToken = '';
const GJG_ROLLBACK_STATUS_TYPES = ['fitup_weld_report', 'fitup_weld_ndi', 'fitup_weld_qc'];

function setCapturedToken(token) {
    const text = String(token || '').trim();
    if (text) {
        capturedToken = text;
    }
}

/**
 * 从数据库读取项目列表
 * @param {boolean} includeClosed 是否包含 closed 项目
 */
async function fetchProjects(includeClosed = false) {
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
        max: 2
    });
    try {
        const statusFilter = includeClosed 
            ? "('building','pipeline','closed')"
            : "('building','pipeline')";
            
        const res = await pool.query(
            `SELECT project_id, project_name, project_status FROM project
             WHERE project_status IN ${statusFilter}
             ORDER BY project_id`
        );
        return res.rows;
    } finally {
        await pool.end();
    }
}

/**
 * 从数据库读取活跃项目列表（钢构在建 building / 流水线 pipeline）
 * @deprecated 使用 fetchProjects(false) 替代
 */
async function fetchActiveProjects() {
    return fetchProjects(false);
}

function installTokenCapture(page) {
    if (!page || typeof page.on !== 'function') return;
    page.on('request', req => {
        try {
            const url = String(req.url() || '');
            if (!url.includes('/v1.production/getPlans')) return;
            const headers = req.headers ? req.headers() : {};
            const token = headers && (headers.token || headers.Token || headers.TOKEN);
            if (token && String(token).trim()) capturedToken = String(token).trim();
        } catch {
        }
    });
}

async function getTokenFromPage(page) {
    if (capturedToken) return capturedToken;
    try {
        const token = await page.evaluate(() => {
            return (
                window.localStorage.getItem('Token') ||
                window.localStorage.getItem('token') ||
                window.sessionStorage.getItem('Token') ||
                window.sessionStorage.getItem('token') ||
                ''
            );
        });
        if (token && String(token).trim()) {
            capturedToken = String(token).trim();
            return capturedToken;
        }
    } catch {
    }
    return '';
}

async function fetchPlansPageByApi(page, payload) {
    const token = await getTokenFromPage(page);
    if (!token) {
        throw new Error('无法获取接口 Token（请求头/Storage 中未找到 Token），无法调用 getPlans');
    }

    const res = await page.request.post(API_GET_PLANS, {
        data: payload,
        headers: {
            Token: token,
            'Content-Type': 'application/json;charset=utf-8'
        }
    });
    const json = await res.json();
    return json;
}

function mapPlanStatusFromApi(item) {
    if (!item || typeof item !== 'object') return 'producing';
    const name = String(item.production_status_name || '').trim();
    if (name.includes('完成') || name.includes('已完成') || name.includes('完工')) return 'completed';
    return 'producing';
}

function mapPlansFromApiList(list) {
    const plans = [];
    for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== 'object') continue;
        const planId = item.id;
        const planName = String(item.name || '').trim();
        const projectName = String(item.project_name || '').trim();
        const startAt = String(item.plan_start_time || '').trim();
        const endAt = String(item.plan_end_time || '').trim();
        const updatedAt = String(item.update_time || '').trim();
        const artifactsCount = Number(item.artifacts_count);

        plans.push({
            plan_id: String(planId || '').trim(),
            plan_name: planName,
            project_name: projectName,
            start_at_raw: startAt,
            end_at_raw: endAt,
            updated_at_raw: updatedAt,
            component_count: Number.isFinite(artifactsCount) ? artifactsCount : 0,
            plan_status: mapPlanStatusFromApi(item)
        });
    }
    return plans;
}

async function fetchAllPlansByApi(page, projId, options = {}) {
    const size = Number.isFinite(Number(options.size)) ? Number(options.size) : 200;
    const basePayload = {
        code: '',
        create_user: 0,
        department: 0,
        end_time: 0,
        keyword: '',
        production_status: -1,
        proj_id: Number(projId),
        size,
        start_time: 0
    };

    const first = await fetchPlansPageByApi(page, { ...basePayload, page: 1 });
    if (!first || first.code !== 0) {
        throw new Error(`getPlans 调用失败：code=${first && first.code !== undefined ? first.code : '未知'} msg=${first && first.msg ? first.msg : ''}`);
    }
    const data0 = first.data;
    if (!data0 || typeof data0 !== 'object') throw new Error('getPlans 返回缺少 data 字段');
    if (!Array.isArray(data0.list)) throw new Error('getPlans 返回 data.list 不是数组');

    const total = Number(data0.count);
    const pageSize = Number(data0.size);
    const totalPages = Number.isFinite(total) && total > 0 && Number.isFinite(pageSize) && pageSize > 0
        ? Math.max(1, Math.ceil(total / pageSize))
        : 1;

    const all = [...data0.list];
    for (let p = 2; p <= totalPages; p++) {
        const json = await fetchPlansPageByApi(page, { ...basePayload, page: p });
        if (!json || json.code !== 0) {
            throw new Error(`getPlans 第${p}页调用失败：code=${json && json.code !== undefined ? json.code : '未知'} msg=${json && json.msg ? json.msg : ''}`);
        }
        const d = json.data;
        if (!d || typeof d !== 'object') throw new Error(`getPlans 第${p}页返回缺少 data 字段`);
        if (!Array.isArray(d.list)) throw new Error(`getPlans 第${p}页返回 data.list 不是数组`);
        all.push(...d.list);
    }

    if (Number.isFinite(total) && total >= 0 && all.length !== total) {
        throw new Error(`接口抓取不完整：接口count=${total} 实际获取=${all.length}`);
    }

    return { total, size: pageSize, list: all };
}

async function fetchPlansFirstPageDebug(page, projId, size) {
    const payload = {
        code: '',
        create_user: 0,
        department: 0,
        end_time: 0,
        keyword: '',
        page: 1,
        production_status: -1,
        proj_id: Number(projId),
        size: Number(size),
        start_time: 0
    };

    const json = await fetchPlansPageByApi(page, payload);
    if (!json || json.code !== 0) {
        throw new Error(`getPlans 调用失败：code=${json && json.code !== undefined ? json.code : '未知'} msg=${json && json.msg ? json.msg : ''}`);
    }
    const data = json.data;
    if (!data || typeof data !== 'object') {
        throw new Error('getPlans 返回缺少 data 字段');
    }

    const keys = Object.keys(data);
    const arrays = keys.filter(k => Array.isArray(data[k]));
    logger.info(`getPlans 响应 data 字段：keys=${keys.join(', ')}`);
    logger.info(`getPlans 响应 data 数组候选字段：${arrays.length ? arrays.join(', ') : '无'}`);
    logger.info(`getPlans 分页：count=${data.count} page=${data.page} size=${data.size}`);

    if (Array.isArray(data.list) && data.list.length) {
        const first = data.list[0];
        if (first && typeof first === 'object') {
            const itemKeys = Object.keys(first);
            logger.info(`getPlans data.list[0] 字段：keys=${itemKeys.join(', ')}`);

            const sample = {};
            for (const k of itemKeys.slice(0, 30)) {
                const v = first[k];
                if (v === null || v === undefined) {
                    sample[k] = v;
                    continue;
                }
                const t = typeof v;
                if (t === 'string' || t === 'number' || t === 'boolean') {
                    sample[k] = v;
                }
            }
            logger.info(`getPlans data.list[0] 样例(仅原始类型字段)：${JSON.stringify(sample)}`);
        }
    }

    throw new Error('已进入接口调试模式：请在 DevTools 的 Response 中展开 data 下的列表数组字段与第1条记录字段，贴图/复制 JSON，用于严格映射入库字段');
}

async function fetchPlanArtifactsByApi(page, planId, debugMode = false) {
    const token = await getTokenFromPage(page);
    if (!token) {
        throw new Error('无法获取接口 Token（请求头/Storage 中未找到 Token），无法调用 getPlanArtifacts');
    }

    const sanitize = s => {
        const text = String(s || '');
        return text
            .replace(/(Token:\s*)([^\s\r\n]+)/gi, '$1<TOKEN>')
            .replace(/(token=)([^;\s]+)/gi, '$1<TOKEN>')
            .replace(/(factory_token=)([^;\s]+)/gi, '$1<TOKEN>');
    };

    const url = API_GET_PLAN_ARTIFACTS;
    const payload = { id: Number(planId) };
    const headers = {
        Token: token,
        Origin: WEBSITE_ORIGIN,
        Referer: `${WEBSITE_ORIGIN}/`,
        'Content-Type': 'application/json;charset=utf-8'
    };

    // 获取 cookies 并手动附加
    const cookies = await page.context().cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    if (cookieStr) {
        headers.Cookie = cookieStr;
    }

    if (debugMode) {
        const safeHeaders = {
            ...headers,
            Token: '<TOKEN>',
            Cookie: cookieStr ? '<COOKIES>' : undefined
        };
        logger.info(`[DEBUG] getPlanArtifacts 请求：`);
        logger.info(`  URL: ${url}`);
        logger.info(`  Payload: ${JSON.stringify(payload)}`);
        logger.info(`  Headers: ${JSON.stringify(safeHeaders)}`);
    }

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await page.request.post(url, {
                data: payload,
                headers,
                timeout: 120000
            });

            if (debugMode) {
                logger.info(`[DEBUG] getPlanArtifacts 响应：`);
                logger.info(`  Status: ${res.status()}`);
                logger.info(`  StatusText: ${res.statusText()}`);
                const responseHeaders = res.headers();
                logger.info(`  Response Headers: ${JSON.stringify(responseHeaders)}`);
            }

            if (!res.ok()) {
                let snippet = '';
                try {
                    const t = await res.text();
                    snippet = String(t || '').slice(0, 500);
                } catch {
                }
                if (debugMode) {
                    logger.info(`[DEBUG] getPlanArtifacts 失败响应体（前500字符）：${snippet}`);
                }
                throw new Error(`getPlanArtifacts HTTP失败：status=${res.status()} body=${sanitize(snippet)}`);
            }

            try {
                const json = await res.json();
                if (debugMode) {
                    logger.info(`[DEBUG] getPlanArtifacts 成功响应 JSON：${JSON.stringify(json)}`);
                }
                return json;
            } catch {
                let snippet = '';
                try {
                    const t = await res.text();
                    snippet = String(t || '').slice(0, 500);
                } catch {
                }
                if (debugMode) {
                    logger.info(`[DEBUG] getPlanArtifacts 响应非 JSON（前500字符）：${snippet}`);
                }
                throw new Error(`getPlanArtifacts 响应非JSON：status=${res.status()} body=${sanitize(snippet)}`);
            }
        } catch (err) {
            const msg = sanitize(err && err.message ? err.message : err);
            if (debugMode) {
                logger.info(`[DEBUG] getPlanArtifacts 第${attempt}次尝试失败：${msg}`);
            }
            if (attempt === maxAttempts) throw new Error(`getPlanArtifacts 请求失败（第${attempt}次尝试）：${msg}`);
            await page.waitForTimeout(2000);
        }
    }
    throw new Error('getPlanArtifacts 请求失败：重试次数耗尽');
}

function mapComponentsFromApiList(list, planId) {
    const components = [];
    for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== 'object') continue;
        const planIdVal = Number(planId);
        const componentGuid = String(item.guid || item['构件GUID'] || '').trim();
        const componentNo = String(item.dode || item.code || item['构件编号'] || '').trim();
        const modelId = String(item.model_id || item['模型ID'] || '').trim();
        const spec = String(item['规格/型号'] || item.spec || '').trim();
        const quantityRaw = item.num ?? item['数量'];
        const quantity = Number(String(quantityRaw ?? '').trim()) || 0;
        const weightRaw = item.weight ?? item['重量'];
        const weight = weightRaw === null || weightRaw === undefined || String(weightRaw).trim() === '' ? null : Number(String(weightRaw).trim());
        const lengthRaw = item.length ?? item['长度'];
        const length = lengthRaw === null || lengthRaw === undefined || String(lengthRaw).trim() === '' ? null : Number(String(lengthRaw).trim());
        const productionFeature = String(item['生产特征'] || item.production_feature || '').trim();
        const location = String(item['区域部位/所在楼层'] || item.location || '').trim();

        if (!planIdVal || !componentGuid) continue;
        
        // 过滤掉数量 <= 0 的构件，避免违反 component_quantity_chk 约束
        if (quantity <= 0) {
            logger.warn(`跳过数量为 0 或负数的构件: ${componentNo} (数量: ${quantity})`);
            continue;
        }
        
        // 调试：记录构件信息
        if (planId == 2284 || planId == 1527 || planId == 688) {
            logger.info(`[DEBUG] 计划${planId} 构件: ${componentNo}, 数量: ${quantity}, 重量: ${weight}, 长度: ${length}`);
        }

        components.push({
            plan_id: planIdVal,
            component_guid: componentGuid,
            component_no: componentNo,
            model_id: modelId,
            spec: spec,
            quantity: quantity,
            weight: weight,
            length: length,
            production_feature: productionFeature,
            location: location
        });
    }
    return components;
}

function parseComponentStatusEvents(list, planId, planStartAt, projectStatus) {
    const events = [];
    
    // 根据项目状态决定要解析的状态字段
    const statusFieldMap = {
        '钢构生产开始': 'steel_production_start'
    };
    
    if (projectStatus === 'building') {
        // building 项目：完整的 6 个状态
        statusFieldMap['装焊报检'] = 'fitup_weld_report';
        statusFieldMap['装焊探伤'] = 'fitup_weld_ndi';
        statusFieldMap['装焊质检'] = 'fitup_weld_qc';
        statusFieldMap['涂装'] = 'painting';
        statusFieldMap['is_deliver'] = 'shipping';
    } else if (projectStatus === 'closed') {
        // closed 项目：兼容性处理，支持历史数据字段
        statusFieldMap['装焊报检'] = 'fitup_weld_report';
        statusFieldMap['构件装焊'] = 'fitup_weld_report';  // 兼容字段
        statusFieldMap['装焊'] = 'fitup_weld_report';      // 兼容字段
        statusFieldMap['装焊探伤'] = 'fitup_weld_ndi';
        statusFieldMap['装焊质检'] = 'fitup_weld_qc';
        statusFieldMap['涂装'] = 'painting';
        statusFieldMap['is_deliver'] = 'shipping';
    } else if (projectStatus === 'pipeline') {
        statusFieldMap['流水线报工'] = 'pipeline_report_work';
    }

    for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== 'object') continue;
        const componentGuid = String(item.guid || item['构件GUID'] || '').trim();
        if (!componentGuid) continue;

        // 用于去重：同一个构件的同一个状态类型只保留一个有效值
        const statusValues = new Map(); // statusType -> {fieldName, rawValue, parsed}

        for (const [fieldName, statusType] of Object.entries(statusFieldMap)) {
            const rawValue = String(item[fieldName] || '').trim();
            if (!rawValue) continue;

            const parsed = parseStatusValue(rawValue, fieldName, planId);
            if (!parsed) continue;

            // 对于 closed 项目，如果已有相同状态类型的值，优先级：装焊报检 > 构件装焊 > 装焊
            if (statusValues.has(statusType)) {
                const existing = statusValues.get(statusType);
                const priority = {
                    '装焊报检': 3,
                    '构件装焊': 2,
                    '装焊': 1
                };
                const existingPriority = priority[existing.fieldName] || 0;
                const newPriority = priority[fieldName] || 0;
                if (newPriority <= existingPriority) {
                    continue; // 跳过低优先级的值
                }
            }

            statusValues.set(statusType, { fieldName, rawValue, parsed });
        }

        // 生成事件
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

/**
 * 核对接口返回的构件对象键名是否包含 parseComponentStatusEvents 使用的字段（仅打印，不写库）
 * @param {object[]} list getPlanArtifacts 解析后的构件列表
 * @param {string|null} projectStatus project.project_status
 */
function printArtifactKeyVerification(list, projectStatus) {
    const first = list[0];
    if (!first || typeof first !== 'object') {
        logger.warn('构件列表首条无效，无法核对');
        return;
    }
    const keys = Object.keys(first).sort();
    logger.info(`=== 首条构件 JSON 键名（共 ${keys.length} 个，已排序）===`);
    logger.info(keys.join(', '));

    logger.info(`=== 数据库中的项目状态 project_status=${projectStatus == null ? '(无)' : projectStatus} ===`);

    const expectedByStatus = {
        building: ['钢构生产开始', '装焊报检', '装焊探伤', '装焊质检', '涂装', 'is_deliver'],
        closed: ['钢构生产开始', '装焊报检', '构件装焊', '装焊', '装焊探伤', '装焊质检', '涂装', 'is_deliver'],
        pipeline: ['钢构生产开始', '流水线报工']
    };
    const expected = expectedByStatus[projectStatus] || expectedByStatus.building;
    logger.info('=== 与解析脚本字段名逐项核对（缺失则该行状态不会被写入）===');
    for (const k of expected) {
        const ok = Object.prototype.hasOwnProperty.call(first, k);
        logger.info(`  [${ok ? 'OK' : '!!'}] "${k}" — ${ok ? '键存在' : '键不存在'}`);
    }

    const zhuanghan = keys.filter(k => k.includes('装焊'));
    logger.info(`=== 键名包含「装焊」的字段（用于发现命名差异）===`);
    logger.info(zhuanghan.length ? zhuanghan.join(' | ') : '（无）');

    const sample = field => {
        const v = first[field];
        if (v == null || v === '') return '(空)';
        const s = String(v).replace(/\s+/g, ' ').trim();
        return s.length > 200 ? `${s.slice(0, 200)}…` : s;
    };
    logger.info('=== 首条构件样例（装焊相关列）===');
    logger.info(`  装焊报检: ${sample('装焊报检')}`);
    logger.info(`  装焊探伤: ${sample('装焊探伤')}`);
    logger.info(`  装焊质检: ${sample('装焊质检')}`);
    logger.info('=== 说明：fitup_weld_report←装焊报检，fitup_weld_ndi←装焊探伤（ndi=探伤）===');
}

function parseStatusValue(rawValue, fieldName, planId) {
    if (rawValue === '未发货') {
        return {
            isCompleted: false,
            eventAt: null,
            teamName: null,
            operatorName: null,
            traceOperatorName: null
        };
    }

    const timeRegex = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/;
    const timeMatch = rawValue.match(timeRegex);
    const hasTime = !!timeMatch;
    
    // 修复特定计划的日期错误：将 2023-04-70 和 2023-03-70 改为 2023-04-17 和 2023-03-17
    const problematicPlanIds = [455, 454, 453, 452, 450, 449, 448, 274, 273];
    if (problematicPlanIds.includes(Number(planId)) && hasTime) {
        let fixedTime = timeMatch[1].replace(/2023-(04|03)-70/g, '2023-$1-17');
        timeMatch[1] = fixedTime;
    }

    const bracketRegex = /【([^】]+)】/g;
    const brackets = [];
    let match;
    while ((match = bracketRegex.exec(rawValue)) !== null) {
        brackets.push(match[1]);
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
        // 追溯人允许为空，只有当有3个括号时才设置
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

function isGjgProductionFeature(value) {
    return String(value || '').trim().toUpperCase() === 'GJG';
}

function buildGjgRollbackEvents(planId, components, apiEvents, latestDbStates, observedAt = new Date()) {
    const gjgComponents = new Map();
    for (const item of components || []) {
        const guid = String(item && item.component_guid || '').trim();
        if (!guid || !isGjgProductionFeature(item.production_feature)) continue;
        gjgComponents.set(guid, item);
    }

    const apiEventStateByKey = new Map();
    for (const item of apiEvents || []) {
        const guid = String(item && item.component_guid || '').trim();
        const statusType = String(item && item.status_type || '').trim();
        if (!guid || !statusType || !gjgComponents.has(guid) || !GJG_ROLLBACK_STATUS_TYPES.includes(statusType)) continue;
        apiEventStateByKey.set(`${guid}|${statusType}`, item);
    }

    const latestDbStateByKey = new Map();
    for (const row of latestDbStates || []) {
        const guid = String(row && row.component_guid || '').trim();
        const statusType = String(row && row.status_type || '').trim();
        if (!guid || !statusType) continue;
        latestDbStateByKey.set(`${guid}|${statusType}`, row);
    }

    const rollbackEvents = [];
    for (const guid of gjgComponents.keys()) {
        for (const statusType of GJG_ROLLBACK_STATUS_TYPES) {
            const apiRow = apiEventStateByKey.get(`${guid}|${statusType}`);
            const latestDbRow = latestDbStateByKey.get(`${guid}|${statusType}`);
            const apiCompleted = Boolean(apiRow && apiRow.is_completed === true);
            const dbCompleted = Boolean(latestDbRow && latestDbRow.is_completed === true);
            if (!apiCompleted && dbCompleted) {
                rollbackEvents.push({
                    plan_id: Number(planId),
                    component_guid: guid,
                    status_type: statusType,
                    event_at: observedAt,
                    is_completed: false,
                    team_name: null,
                    operator_name: 'api-sync-rollback',
                    trace_operator_name: null,
                    observed_at: observedAt,
                    raw_value: 'API_MISSING_ROLLBACK'
                });
            }
        }
    }

    return rollbackEvents;
}

async function syncComponentsToDb(components, planId) {
    const unique = new Map();
    for (const c of components) {
        const key = `${c.plan_id}:${c.component_guid}`;
        unique.set(key, c);
    }
    const uniqComponents = Array.from(unique.values());

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
        application_name: 'extract-production-plan-components'
    });

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

    try {
        await pool.query(`SET app.sync_source = 'extract-production-plan-components'`);

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
    } finally {
        await pool.end();
    }

    return { inserted, updated, unchanged };
}

async function syncComponentStatusEventsToDb(events, planId, options = {}) {
    if (!events || events.length === 0) {
        return { inserted: 0, updated: 0, unchanged: 0 };
    }

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
        application_name: 'extract-production-plan-component-events'
    });

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
    let rollbackInserted = 0;
    let rollbackUpdated = 0;
    let rollbackUnchanged = 0;

    async function upsertStatusEvents(eventRows) {
        let localInserted = 0;
        let localUpdated = 0;
        let localUnchanged = 0;
        for (const e of eventRows) {
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
                localUnchanged++;
            } else if (res.rows[0] && res.rows[0].inserted) {
                localInserted++;
            } else {
                localUpdated++;
            }
        }
        return {
            inserted: localInserted,
            updated: localUpdated,
            unchanged: localUnchanged
        };
    }

    try {
        await pool.query(`SET app.sync_source = 'extract-production-plan-component-events'`);
        const baseStats = await upsertStatusEvents(events);
        inserted += baseStats.inserted;
        updated += baseStats.updated;
        unchanged += baseStats.unchanged;

        const latestStateSql = `
            SELECT DISTINCT ON (c.component_guid, e.status_type)
                c.component_guid,
                e.status_type,
                e.is_completed,
                COALESCE(e.event_at, e.updated_at, e.created_at) AS effective_at,
                e.event_id
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            WHERE c.plan_id = $1
              AND upper(COALESCE(NULLIF(trim(c.production_feature), ''), '')) = 'GJG'
              AND e.status_type = ANY($2::component_status_type[])
            ORDER BY
                c.component_guid ASC,
                e.status_type ASC,
                COALESCE(e.event_at, e.updated_at, e.created_at) DESC,
                e.event_id DESC
        `;
        const latestStateRes = await pool.query(latestStateSql, [planId, GJG_ROLLBACK_STATUS_TYPES]);
        const rollbackObservedAt = new Date();
        const rollbackEvents = buildGjgRollbackEvents(
            planId,
            Array.isArray(options.components) ? options.components : [],
            events,
            latestStateRes.rows || [],
            rollbackObservedAt
        );
        if (rollbackEvents.length > 0) {
            const rollbackStats = await upsertStatusEvents(rollbackEvents);
            rollbackInserted += rollbackStats.inserted;
            rollbackUpdated += rollbackStats.updated;
            rollbackUnchanged += rollbackStats.unchanged;
        }
    } finally {
        await pool.end();
    }

    return { inserted, updated, unchanged, rollbackInserted, rollbackUpdated, rollbackUnchanged };
}

async function getPlanInfoFromDb(planId) {
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
        max: 2,
        application_name: 'extract-production-plan-get-plan-info'
    });

    try {
        const sql = `
            SELECT p.start_at, pr.project_status
            FROM production_plan p
            LEFT JOIN project pr ON p.project_id = pr.project_id
            WHERE p.plan_id = $1
        `;
        const res = await pool.query(sql, [planId]);
        if (res.rows.length > 0) {
            return {
                start_at_raw: res.rows[0].start_at,
                project_status: res.rows[0].project_status
            };
        }
        return null;
    } finally {
        await pool.end();
    }
}

/**
 * 在生产计划页选择项目并点击查询，等待列表刷新
 * @param {import('playwright').Page} page
 * @param {string} projectName 项目名称（与下拉项文本精确匹配）
 */
async function selectProjectAndQuery(page, projectName) {
    // 1) 打开项目下拉：点击项目选择器触发区域
    const triggerCandidates = [
        page.locator('.el-form-item__label:has-text("所属项目")').locator('..').locator('.el-select, .el-input'),
        page.locator('.el-form-item__label:has-text("项目")').locator('..').locator('.el-select, .el-input'),
        page.locator('.el-select').filter({ has: page.locator('input[placeholder*="项目"], input[placeholder*="选择"]') }).first(),
        page.locator('input[placeholder*="项目"]').first(),
        page.locator('.el-form-item').filter({ hasText: '项目' }).locator('.el-select .el-input__inner, .el-input').first()
    ];
    let triggered = false;
    for (const loc of triggerCandidates) {
        try {
            if ((await loc.count()) > 0) {
                await loc.first().click({ timeout: 3000 });
                triggered = true;
                break;
            }
        } catch {
            continue;
        }
    }
    if (!triggered) {
        throw new Error('未找到项目选择器，无法打开下拉');
    }

    await page.waitForTimeout(300);

    // 2) 在下拉中选择项目名称（Element-UI: el-select-dropdown__item）
    const item = page.locator('.el-select-dropdown__item, .el-select-dropdown_item')
        .filter({ hasText: projectName })
        .first();
    try {
        await item.waitFor({ state: 'visible', timeout: 3000 });
        await item.click({ force: true });
    } catch {
        throw new Error(`未找到项目下拉项：${projectName}`);
    }

    await page.waitForTimeout(200);

    // 3) 点击查询按钮
    const queryBtn = page.locator('button.el-button--primary').filter({ has: page.locator('span:has-text("查询")') }).first();
    await queryBtn.waitFor({ state: 'visible', timeout: 3000 });
    await queryBtn.click();

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
}

async function ensurePlanInfoPage(page, planId, options = {}) {
    const id = Number(planId);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error(`无效 plan_id：${planId}`);
    }
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 30000;
    const waitMs = Number.isFinite(Number(options.waitMs)) ? Number(options.waitMs) : 800;
    const url = `${PLAN_INFO_URL}?id=${id}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
    if (waitMs > 0) await page.waitForTimeout(waitMs);
}

function mapPlanStatusFromText(text) {
    const t = String(text || '').trim();
    if (!t) return 'producing';
    if (t.includes('完成') || t.includes('已完成') || t.includes('完工')) return 'completed';
    return 'producing';
}

function parsePlansFromTable(headers, rows) {
    const idxId = findHeaderIndex(headers, ['计划ID', 'ID']);
    const idxName = findHeaderIndex(headers, ['生产计划名称', '计划名称', '名称']);
    const idxProjectName = findHeaderIndex(headers, ['所属项目', '项目名称']);
    const idxStartAt = findHeaderIndex(headers, ['计划开始时间', '开始时间']);
    const idxEndAt = findHeaderIndex(headers, ['计划结束时间', '结束时间']);
    const idxUpdatedAt = findHeaderIndex(headers, ['更新时间']);
    const idxComponentCount = findHeaderIndex(headers, ['构件数量', '构件数']);
    const idxStatus = findHeaderIndex(headers, ['生产状态', '计划状态', '状态']);

    if (idxId < 0 || idxName < 0 || idxProjectName < 0) {
        throw new Error(
            `无法从表头定位必需列：计划ID/计划名称/所属项目。` +
            `请检查页面表头是否变化。当前表头=${JSON.stringify(headers)}`
        );
    }

    const plans = [];
    for (const row of rows) {
        const planIdRaw = row[idxId];
        const planName = String(row[idxName] || '').trim();
        const projectName = String(row[idxProjectName] || '').trim();
        if (!planIdRaw || !planName || !projectName) continue;

        const startAt = idxStartAt >= 0 ? String(row[idxStartAt] || '').trim() : '';
        const endAt = idxEndAt >= 0 ? String(row[idxEndAt] || '').trim() : '';
        const updatedAt = idxUpdatedAt >= 0 ? String(row[idxUpdatedAt] || '').trim() : '';
        const componentCountRaw = idxComponentCount >= 0 ? String(row[idxComponentCount] || '').trim() : '';
        const statusText = idxStatus >= 0 ? row[idxStatus] : '';

        const componentCount = componentCountRaw ? Number(componentCountRaw.replace(/[^\d.-]/g, '')) : 0;

        plans.push({
            plan_id: String(planIdRaw || '').trim(),
            plan_name: planName,
            project_name: projectName,
            start_at_raw: startAt,
            end_at_raw: endAt,
            updated_at_raw: updatedAt,
            component_count: Number.isFinite(componentCount) ? componentCount : 0,
            plan_status: mapPlanStatusFromText(statusText)
        });
    }

    return plans;
}

async function syncPlansToDb(plans, expectedTotalItems = null) {
    // 入库前按 plan_id 去重（页面导出保留原始行数，用于核对；入库只认 plan_id）
    const uniqueById = new Map();
    for (const p of plans) {
        if (!p || !p.plan_id) continue;
        uniqueById.set(String(p.plan_id).trim(), p);
    }
    const uniquePlans = Array.from(uniqueById.values());

    const expected = Number.isFinite(Number(expectedTotalItems)) ? Number(expectedTotalItems) : null;
    if (expected && uniquePlans.length !== expected) {
        throw new Error(`抓取不完整：网页total=${expected} 抓取去重=${uniquePlans.length}。为确保数据正确，已终止数据库写入。`);
    }

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
        application_name: 'extract-production-plan'
    });

    const sqlUpsert = `
        payload AS (
            SELECT
                $1::bigint AS plan_id,
                $2::bigint AS project_id,
                $3::text AS plan_name,
                NULLIF($4, '')::timestamptz AS start_at,
                NULLIF($5, '')::timestamptz AS end_at,
                NULLIF($6, '')::timestamptz AS updated_at,
                COALESCE($7::integer, 0) AS component_count,
                $8::plan_status AS plan_status
        )
        INSERT INTO production_plan (plan_id, project_id, plan_name, start_at, end_at, updated_at, component_count, plan_status)
        SELECT
            p.plan_id,
            p.project_id,
            p.plan_name,
            p.start_at,
            p.end_at,
            p.updated_at,
            p.component_count,
            p.plan_status
        FROM payload p
        ON CONFLICT (plan_id) DO UPDATE
          SET project_id  = EXCLUDED.project_id,
              plan_name   = EXCLUDED.plan_name,
              start_at    = EXCLUDED.start_at,
              end_at      = EXCLUDED.end_at,
              updated_at  = EXCLUDED.updated_at,
              component_count = EXCLUDED.component_count,
              plan_status = EXCLUDED.plan_status
        WHERE (production_plan.updated_at, production_plan.component_count)
              IS DISTINCT FROM (EXCLUDED.updated_at, EXCLUDED.component_count)
        RETURNING (xmax = 0) AS inserted
    `;

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let skippedNoProject = 0;
    let archived = 0;

    try {
        await pool.query(`SET app.sync_source = 'extract-production-plan'`);

        if (uniquePlans.length !== plans.length) {
            logger.info(`生产计划入库按 plan_id 去重：原始 ${plans.length} 条，去重后 ${uniquePlans.length} 条`);
        }

        for (const p of uniquePlans) {
            const res = await pool.query(sqlUpsert, [
                p.plan_id,
                p.project_name,
                p.plan_name,
                p.start_at_raw,
                p.end_at_raw,
                p.updated_at_raw,
                p.component_count,
                p.plan_status
            ]);

            if (res.rowCount === 0) {
                // 未找到对应项目，跳过
                skippedNoProject++;
                logger.warn(`跳过生产计划（未找到所属项目）：plan_id=${p.plan_id} plan_name=${p.plan_name} project_name=${p.project_name}`);
            } else if (res.rows[0] && res.rows[0].inserted) {
                inserted++;
            } else {
                updated++;
            }
        }

        // 若某个计划ID在页面数据中已经不存在，视为计划已取消：数据库中对应记录改为归档，保留历史构件与状态事件。
        const planIds = uniquePlans.map(p => p.plan_id).filter(Boolean);
        if (planIds.length > 0) {
            const resArchive = await pool.query(
                `UPDATE production_plan
                 SET plan_status = 'archived'
                 WHERE plan_id NOT IN (SELECT UNNEST($1::bigint[]))
                   AND plan_status <> 'archived'`,
                [planIds]
            );
            archived = resArchive.rowCount || 0;
        }
    } finally {
        await pool.end();
    }

    unchanged = uniquePlans.length - inserted - updated - skippedNoProject;
    if (unchanged < 0) unchanged = 0;

    return { inserted, updated, unchanged, skippedNoProject, archived };
}

/**
 * 按项目范围同步生产计划（仅删除该 project_id 下缺失的 plan_id，不删其他项目）
 * @param {Array} plans 解析后的计划列表（project_name 需与 project 表匹配）
 * @param {number} projectId 当前项目 project_id
 */
async function syncPlansToDbForProject(plans, projectId, expectedTotalItems) {
    const uniqueById = new Map();
    for (const p of plans) {
        if (!p || !p.plan_id) continue;
        uniqueById.set(String(p.plan_id).trim(), p);
    }
    const uniquePlans = Array.from(uniqueById.values());

    const expected = Number.isFinite(Number(expectedTotalItems)) ? Number(expectedTotalItems) : null;
    const allowWrite = !(expected && uniquePlans.length !== expected);
    if (!allowWrite) {
        return {
            inserted: 0,
            updated: 0,
            unchanged: 0,
            skippedNoProject: 0,
            archived: 0,
            uniqueCount: uniquePlans.length,
            changedPlanIds: [],
            deleteGuard: {
                allowDelete: false,
                allowArchive: false,
                expectedTotalItems: expected,
                actual: uniquePlans.length,
                allowWrite: false
            }
        };
    }

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
        application_name: 'extract-production-plan'
    });

    const sqlUpsert = `
        WITH payload AS (
            SELECT
                $1::bigint AS plan_id,
                $2::bigint AS project_id,
                $3::text AS plan_name,
                NULLIF($4, '')::timestamptz AS start_at,
                NULLIF($5, '')::timestamptz AS end_at,
                NULLIF($6, '')::timestamptz AS updated_at,
                COALESCE($7::integer, 0) AS component_count,
                $8::plan_status AS plan_status
        )
        INSERT INTO production_plan (plan_id, project_id, plan_name, start_at, end_at, updated_at, component_count, plan_status)
        SELECT
            p.plan_id,
            p.project_id,
            p.plan_name,
            p.start_at,
            p.end_at,
            p.updated_at,
            p.component_count,
            p.plan_status
        FROM payload p
        ON CONFLICT (plan_id) DO UPDATE
          SET project_id  = EXCLUDED.project_id,
              plan_name   = EXCLUDED.plan_name,
              start_at    = EXCLUDED.start_at,
              end_at      = EXCLUDED.end_at,
              updated_at  = EXCLUDED.updated_at,
              component_count = EXCLUDED.component_count,
              plan_status = EXCLUDED.plan_status
        WHERE (production_plan.updated_at, production_plan.component_count)
              IS DISTINCT FROM (EXCLUDED.updated_at, EXCLUDED.component_count)
        RETURNING plan_id, (xmax = 0) AS inserted
    `;

    let inserted = 0;
    let updated = 0;
    let skippedNoProject = 0;
    let archived = 0;
    const changedPlanIds = [];

    const allowArchive = true;

    try {
        await pool.query(`SET app.sync_source = 'extract-production-plan'`);

        for (const p of uniquePlans) {
            const res = await pool.query(sqlUpsert, [
                p.plan_id,
                projectId,
                p.plan_name,
                p.start_at_raw,
                p.end_at_raw,
                p.updated_at_raw,
                p.component_count,
                p.plan_status
            ]);

            if (res.rowCount === 0) {
                // RETURNING 无行：计划行未变（updated_at / component_count 与库中一致）
            } else if (res.rows[0]) {
                const row = res.rows[0];
                const pid = row.plan_id != null ? Number(row.plan_id) : Number(p.plan_id);
                if (Number.isFinite(pid)) changedPlanIds.push(pid);
                if (row.inserted) inserted++;
                else updated++;
            }
        }

        const planIds = uniquePlans.map(p => p.plan_id).filter(Boolean);
        if (allowArchive && planIds.length > 0) {
            const resArchive = await pool.query(
                `UPDATE production_plan
                 SET plan_status = 'archived'
                 WHERE project_id = $1
                   AND plan_id NOT IN (SELECT UNNEST($2::bigint[]))
                   AND plan_status <> 'archived'`,
                [projectId, planIds]
            );
            archived = resArchive.rowCount || 0;
        }
    } finally {
        await pool.end();
    }

    const unchanged = Math.max(0, uniquePlans.length - inserted - updated - skippedNoProject);
    return {
        inserted,
        updated,
        unchanged,
        skippedNoProject,
        archived,
        uniqueCount: uniquePlans.length,
        changedPlanIds,
        deleteGuard: {
            allowDelete: false,
            allowArchive,
            expectedTotalItems: expected,
            actual: uniquePlans.length,
            allowWrite: true
        }
    };
}

/**
 * 调用 getPlanArtifacts 并写入 component / component_status_event（供按项目增量与单计划模式复用）
 * @param {import('playwright').Page} page
 * @param {number} planId
 * @param {boolean} debugMode
 * @param {string} logPrefix
 * @returns {Promise<{ compStats: object, eventStats: object } | null>}
 */
async function syncArtifactsForPlanFromApi(page, planId, debugMode, logPrefix) {
    const prefix = logPrefix || '';
    await ensurePlanInfoPage(page, planId, { timeoutMs: 30000, waitMs: 800 });
    const artifactsJson = await fetchPlanArtifactsByApi(page, planId, debugMode);
    if (!artifactsJson || artifactsJson.code !== 0) {
        logger.warn(`${prefix}计划 ${planId} getPlanArtifacts 失败：${artifactsJson && artifactsJson.msg ? artifactsJson.msg : '未知错误'}`);
        return null;
    }
    const data = artifactsJson.data;
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : null);
    if (!list) {
        logger.warn(`${prefix}计划 ${planId} getPlanArtifacts 返回数据格式异常（期望 data 为数组 或 data.list 为数组）`);
        return null;
    }
    const expectedCount = Array.isArray(data) ? list.length : (Number(data.count) || list.length);
    if (expectedCount !== list.length) {
        logger.warn(`${prefix}计划 ${planId} 构件 count 不一致：${expectedCount} vs ${list.length}`);
    }
    const components = mapComponentsFromApiList(list, planId);
    const compStats = await syncComponentsToDb(components, planId);
    logger.info(`${prefix}计划 ${planId} 构件同步：新增 ${compStats.inserted}，更新 ${compStats.updated}，无变化 ${compStats.unchanged}`);

    const planInfo = await getPlanInfoFromDb(planId);
    let eventStats = { inserted: 0, updated: 0, unchanged: 0 };
    if (planInfo && planInfo.project_status) {
        const statusEvents = parseComponentStatusEvents(list, planId, planInfo.start_at_raw, planInfo.project_status);
        eventStats = await syncComponentStatusEventsToDb(statusEvents, planId, { components });
        logger.info(`${prefix}计划 ${planId} 状态事件同步：新增 ${eventStats.inserted}，更新 ${eventStats.updated}，无变化 ${eventStats.unchanged}`);
    } else {
        logger.warn(`${prefix}计划 ${planId} 无法获取项目状态，跳过状态事件解析`);
    }
    return { compStats, eventStats };
}

/**
 * 将表头 + 行数据写入 Excel 文件
 */
async function writeExcel(filePath, headers, rows) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('生产计划', { views: [{ state: 'frozen', ySplit: 1 }] });

    if (headers.length) {
        sheet.addRow(headers);
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true };
    }

    for (const row of rows) {
        sheet.addRow(row);
    }

    if (headers.length) {
        sheet.columns.forEach((col, i) => {
            let max = 12;
            col.eachCell({ includeEmpty: true }, cell => {
                const len = String(cell.value || '').length;
                if (len > max) max = Math.min(len, 80);
            });
            col.width = max;
        });
    }

    await workbook.xlsx.writeFile(filePath);
    logger.success(`Excel 已导出: ${filePath}`);
    return filePath;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const byProject = args.includes('--by-project');
    const apiMode = args.includes('--api');
    const componentsMode = args.includes('--components');
    const componentsChangedOnly = args.includes('--components-changed-only');
    const debugMode = args.includes('--debug');
    const includeClosed = args.includes('--include-closed');

    const projectNameFilters = [];
    const planIdFilter = [];
    let inspectArtifactKeysPlanId = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--project-name' && args[i + 1]) {
            projectNameFilters.push(String(args[i + 1]).trim());
            i++;
        } else if (args[i] === '--plan-id' && args[i + 1]) {
            planIdFilter.push(String(args[i + 1]).trim());
            i++;
        } else if (args[i] === '--inspect-artifact-keys' && args[i + 1]) {
            inspectArtifactKeysPlanId = String(args[i + 1]).trim();
            i++;
        }
    }

    return {
        byProject,
        projectNameFilters,
        apiMode,
        componentsMode,
        componentsChangedOnly,
        planIdFilter,
        debugMode,
        includeClosed,
        inspectArtifactKeysPlanId
    };
}

async function main() {
    const {
        byProject,
        projectNameFilters,
        apiMode,
        componentsMode,
        componentsChangedOnly,
        planIdFilter,
        debugMode,
        includeClosed,
        inspectArtifactKeysPlanId
    } = parseArgs();

    if (componentsChangedOnly) {
        if (!byProject) {
            logger.error('--components-changed-only 需配合 --by-project 使用');
            process.exit(1);
        }
        if (!apiMode) {
            logger.error('--components-changed-only 需配合 --api 使用');
            process.exit(1);
        }
    }

    const browserAutomation = new BrowserAutomation(config);

    try {
        const launched = await browserAutomation.launchBrowser();
        if (!launched) {
            logger.error('浏览器启动失败，退出');
            process.exit(1);
        }

        const loggedIn = await browserAutomation.login();
        if (!loggedIn) {
            logger.error('登录失败，退出');
            await browserAutomation.closeBrowser();
            process.exit(1);
        }

        logger.info(`导航到生产计划页: ${PLAN_URL}`);
        const page = browserAutomation.page;
        installTokenCapture(page);
        await page.goto(PLAN_URL);
        await page.waitForLoadState('networkidle');

        if (inspectArtifactKeysPlanId) {
            const pid = Number(inspectArtifactKeysPlanId);
            if (!Number.isFinite(pid) || pid <= 0) {
                logger.error('--inspect-artifact-keys 需要有效的 plan_id');
                process.exitCode = 1;
                return;
            }
            logger.info(`--inspect-artifact-keys：请求 getPlanArtifacts，plan_id=${pid}`);
            const artifactsJson = await fetchPlanArtifactsByApi(page, pid, false);
            if (!artifactsJson || artifactsJson.code !== 0) {
                logger.error(`getPlanArtifacts 失败：${artifactsJson && artifactsJson.msg ? artifactsJson.msg : '未知'}`);
                return;
            }
            const data = artifactsJson.data;
            const list = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : null);
            if (!list || !list.length) {
                logger.error('构件列表为空，无法核对');
                return;
            }
            logger.info(`构件条数：${list.length}`);
            const planInfo = await getPlanInfoFromDb(pid);
            const projectStatus = planInfo && planInfo.project_status;
            printArtifactKeyVerification(list, projectStatus);
            logger.info('核对结束（未写入数据库）。');
            return;
        }

        if (apiMode) {
            logger.info(`API 模式启用：getPlans=${API_GET_PLANS}`);
            if (componentsMode || componentsChangedOnly) {
                logger.info(
                    `构件模式启用：getPlanArtifacts=${API_GET_PLAN_ARTIFACTS}` +
                    (componentsChangedOnly ? '（仅同步本批次计划行有变更的 plan_id）' : '')
                );
            }
        }

        if (planIdFilter && planIdFilter.length) {
            // 单计划模式：直接调用 getPlanArtifacts
            for (const planId of planIdFilter) {
                logger.info(`单计划模式：处理 plan_id=${planId}`);
                if (!componentsMode) {
                    logger.warn(`单计划模式需要配合 --components 使用，否则仅获取计划信息`);
                }
                if (componentsMode) {
                    try {
                        await syncArtifactsForPlanFromApi(page, planId, debugMode, '单计划模式：');
                    } catch (err) {
                        logger.error(`plan_id=${planId} 构件同步失败：${err && err.message ? err.message : err}`);
                    }
                }
            }
            return;
        }

        if (byProject) {
            await runByProjectMode(page, projectNameFilters, apiMode, componentsMode, includeClosed, componentsChangedOnly, debugMode);
        } else {
            await runFullMode(page);
        }
    } catch (error) {
        logger.error(`执行失败: ${error && error.message ? error.message : String(error)}`);
        if (error && error.stack) logger.error(error.stack);
        process.exitCode = 1;
    } finally {
        await browserAutomation.closeBrowser();
    }
}

/**
 * 按项目增量模式：从项目列表获取每个项目的计划，同步计划和构件
 * @param {import('playwright').Page} page
 * @param {string[]} projectNameFilters 项目名称过滤列表
 * @param {boolean} apiMode 是否使用 API 模式
 * @param {boolean} componentsMode 是否启用构件模式（全部计划）
 * @param {boolean} includeClosed 是否包含 closed 项目
 * @param {boolean} componentsChangedOnly 是否仅对本批次计划行有插入/更新的 plan_id 拉构件（需 apiMode）
 * @param {boolean} debugMode
 */
async function runByProjectMode(page, projectNameFilters, apiMode, componentsMode, includeClosed = false, componentsChangedOnly = false, debugMode = false) {
    let projects = await fetchProjects(includeClosed);
    if (projectNameFilters && projectNameFilters.length) {
        const filterSet = new Set(projectNameFilters.map(s => String(s).trim()));
        projects = projects.filter(p => filterSet.has(String(p.project_name).trim()));
        logger.info(`按项目增量模式：仅同步指定项目 ${projectNameFilters.join(', ')}`);
    }
    if (projects.length === 0) {
        const projectTypes = includeClosed ? 'building/pipeline/closed' : 'building/pipeline';
        logger.warn(`未找到目标项目（${projectTypes}），跳过同步`);
        return;
    }
    logger.info(`按项目增量模式：共 ${projects.length} 个目标项目`);

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalArchived = 0;
    let totalSkipped = 0;
    let totalComponentInserted = 0;
    let totalComponentUpdated = 0;
    let totalComponentUnchanged = 0;
    let totalEventInserted = 0;
    let totalEventUpdated = 0;
    let totalEventUnchanged = 0;

    for (let i = 0; i < projects.length; i++) {
        const { project_id, project_name, project_status } = projects[i];
        const t0 = Date.now();

        if (apiMode) {
            const t0Api = Date.now();
            const { total, list } = await fetchAllPlansByApi(page, project_id, { size: 200 });
            const plans = mapPlansFromApiList(list);
            const stats = await syncPlansToDbForProject(plans, project_id, total);
            const guard = stats && stats.deleteGuard ? stats.deleteGuard : null;
            const elapsed = ((Date.now() - t0Api) / 1000).toFixed(1);

            totalInserted += stats.inserted;
            totalUpdated += stats.updated;
            totalArchived += stats.archived;
            totalSkipped += stats.skippedNoProject;

            if (guard && guard.expectedTotalItems && !guard.allowWrite) {
                logger.warn(
                    `[${i + 1}/${projects.length}] ${project_name}：抓取不完整，已跳过数据库写入。` +
                     `网页total=${guard.expectedTotalItems} 抓取去重=${guard.actual}`
                );
            }

            logger.info(
                `[${i + 1}/${projects.length}] ${project_name}：` +
                `API抓取 ${list.length} 条；解析 ${plans.length} 条；` +
                `新增 ${stats.inserted}，更新 ${stats.updated}，归档 ${stats.archived}；` +
                `耗时 ${elapsed}s`
            );

            // 构件模式：对每个计划调用 getPlanArtifacts；--components-changed-only 时仅处理本批次 UPSERT 有返回行的 plan_id
            const syncAllComponents = (componentsMode || componentsChangedOnly) && plans.length > 0;
            if (syncAllComponents) {
                const logLabel = `[${i + 1}/${projects.length}] ${project_name}：`;
                const idsToSync = componentsChangedOnly
                    ? (Array.isArray(stats.changedPlanIds) ? stats.changedPlanIds : [])
                    : plans.map(p => Number(p.plan_id)).filter(id => Number.isFinite(id) && id > 0);

                if (componentsChangedOnly) {
                    logger.info(`${logLabel}构件同步（仅本批次计划行有变更）共 ${idsToSync.length} 个 plan_id`);
                    if (idsToSync.length === 0) {
                        logger.info(`${logLabel}无计划变更，跳过构件同步`);
                    }
                } else {
                    logger.info(`${logLabel}开始同步构件（共 ${idsToSync.length} 个计划）`);
                }

                for (let j = 0; j < idsToSync.length; j++) {
                    const planId = idsToSync[j];
                    try {
                        const result = await syncArtifactsForPlanFromApi(page, planId, debugMode, logLabel);
                        if (result) {
                            totalComponentInserted += result.compStats.inserted;
                            totalComponentUpdated += result.compStats.updated;
                            totalComponentUnchanged += result.compStats.unchanged;
                            totalEventInserted += result.eventStats.inserted;
                            totalEventUpdated += result.eventStats.updated;
                            totalEventUnchanged += result.eventStats.unchanged;
                        }
                    } catch (err) {
                        logger.warn(`${logLabel}计划 ${planId} 构件同步失败：${err && err.message ? err.message : err}`);
                    }
                }
                logger.info(`${logLabel}构件同步完成：累计新增 ${totalComponentInserted}，更新 ${totalComponentUpdated}，无变化 ${totalComponentUnchanged}`);
                if (totalEventInserted > 0 || totalEventUpdated > 0 || totalEventUnchanged > 0) {
                    logger.info(`${logLabel}状态事件同步完成：累计新增 ${totalEventInserted}，更新 ${totalEventUpdated}，无变化 ${totalEventUnchanged}`);
                }
            }

            continue;
        }

        try {
            await selectProjectAndQuery(page, project_name);
        } catch (err) {
            logger.warn(`项目 ${project_name} 选择/查询失败，跳过: ${err && err.message ? err.message : err}`);
            continue;
        }

        const state0 = await waitForPaginationReady(page).catch(() => null);

        const pageSizeOk = await setPageSize(page, 200);

        let headers = [];
        const allRows = [];
        const seenRowKeys = new Set();
        let idxId = -1;
        let duplicated = 0;
        const paging = await readTotalPages(page);

        if (!pageSizeOk && (!paging.pageSize || paging.pageSize <= 0)) {
            throw new Error('无法确认 pageSize：页面未提供每页条数选择器且无法从分页控件读取 pageSize');
        }

        logger.info(
            `[${i + 1}/${projects.length}] ${project_name}：分页信息 ` +
            `total=${paging.totalItems ?? '未知'} pageSize=${paging.pageSize ?? '未知'} totalPages=${paging.totalPages}` +
            `${state0 && state0.totalText ? ` totalText=${state0.totalText}` : ''}` +
            `${pageSizeOk ? '' : '（未能设置为200条/页）'}`
        );

        if (paging.totalPages < 1) {
            logger.info(`[${i + 1}/${projects.length}] ${project_name}：无数据，跳过`);
            continue;
        }

        for (let p = 1; p <= paging.totalPages; p++) {
            if (p > 1) {
                await gotoPage(page, p, idxId >= 0 ? idxId : null);
            }
            let rows;
            let h;
            try {
                const { headers: hh, rows: rr } = await extractTableData(page);
                h = hh;
                rows = rr;
            } catch (err) {
                const msg = err && err.message ? err.message : String(err);
                logger.warn(`[${i + 1}/${projects.length}] ${project_name}：第${p}页提取失败，跳过该项目: ${msg}`);
                rows = null;
            }
            if (!rows) {
                headers = [];
                allRows.length = 0;
                break;
            }

            if (!headers.length) {
                headers = h;
                idxId = findHeaderIndex(headers, ['计划ID', 'ID']);
            }
            for (const r of rows) {
                const key = idxId >= 0 ? String(r[idxId] || '').trim() : '';
                const rowKey = key || stableRowKey(r);
                if (rowKey && seenRowKeys.has(rowKey)) {
                    duplicated++;
                    continue;
                }
                if (rowKey) seenRowKeys.add(rowKey);
                allRows.push(r);
            }
        }

        if (!headers.length) {
            continue;
        }

        const plans = parsePlansFromTable(headers, allRows);
        const stats = await syncPlansToDbForProject(plans, project_id, paging.totalItems);
        const guard = stats && stats.deleteGuard ? stats.deleteGuard : null;
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        totalInserted += stats.inserted;
        totalUpdated += stats.updated;
        totalArchived += stats.archived;
        totalSkipped += stats.skippedNoProject;

        if (guard && guard.expectedTotalItems && !guard.allowWrite) {
            logger.warn(
                `[${i + 1}/${projects.length}] ${project_name}：抓取不完整，已跳过数据库写入。` +
                `网页total=${guard.expectedTotalItems} 抓取去重=${guard.actual}`
            );
        }

        logger.info(
            `[${i + 1}/${projects.length}] ${project_name}：` +
            `抓取 ${allRows.length} 行（过滤重复行 ${duplicated}），去重 ${stats.uniqueCount} 条；` +
            `新增 ${stats.inserted}，更新 ${stats.updated}，归档 ${stats.archived}；` +
            `耗时 ${elapsed}s`
        );
    }

    const componentSummary =
        componentsMode || componentsChangedOnly
            ? `；构件：新增 ${totalComponentInserted}，更新 ${totalComponentUpdated}，无变化 ${totalComponentUnchanged}`
            : '';
    const eventSummary =
        (componentsMode || componentsChangedOnly) && (totalEventInserted > 0 || totalEventUpdated > 0 || totalEventUnchanged > 0)
            ? `；状态事件：新增 ${totalEventInserted}，更新 ${totalEventUpdated}，无变化 ${totalEventUnchanged}`
            : '';
    logger.success(
        `按项目增量同步完成：` +
        `新增 ${totalInserted}，更新 ${totalUpdated}，归档 ${totalArchived}，跳过 ${totalSkipped}` +
        componentSummary + eventSummary
    );
}

/**
 * 全量模式：抓取所有页、导出 Excel、全量同步
 */
async function runFullMode(page) {
    let headers = [];
    const allRows = [];
    const seenRowKeys = new Set();
    let idxId = -1;
    let duplicated = 0;

    const paging = await readTotalPages(page);
    logger.info(`分页信息：总条数=${paging.totalItems}，每页=${paging.pageSize}，总页数=${paging.totalPages} ${paging.totalText ? `(${paging.totalText})` : ''}`);

    for (let p = 1; p <= paging.totalPages; p++) {
        if (p > 1) {
            await gotoPage(page, p, idxId >= 0 ? idxId : null);
        }
        const state = await readPaginationState(page);
        const { headers: h, rows } = await extractTableData(page);

        if (!headers.length) {
            headers = h;
            idxId = findHeaderIndex(headers, ['计划ID', 'ID']);
        }
        let kept = 0;
        for (const r of rows) {
            const key = idxId >= 0 ? String(r[idxId] || '').trim() : '';
            const rowKey = key || stableRowKey(r);
            if (rowKey && seenRowKeys.has(rowKey)) {
                duplicated++;
                continue;
            }
            if (rowKey) seenRowKeys.add(rowKey);
            allRows.push(r);
            kept++;
        }
        logger.info(`第 ${state ? state.current : p} 页 抓取 ${rows.length} 行，保留 ${kept} 行，累计 ${allRows.length} 行`);
    }

    logger.info(`提取到表头 ${headers.length} 列，合计 ${allRows.length} 行数据（过滤重复行 ${duplicated}）`);
    if (paging.totalItems && allRows.length !== paging.totalItems) {
        logger.warn(`抓取行数与网页总条数不一致：网页=${paging.totalItems}，抓取（去重后）=${allRows.length}（请以网页为准核对分页/表格渲染）`);
    }

    const filePath = getOutputPath();
    await writeExcel(filePath, headers, allRows);
    logger.info(`Excel 导出完成，可用于人工核对: ${filePath}`);

    const plans = parsePlansFromTable(headers, allRows);
    logger.info(`解析到生产计划数据 ${plans.length} 条，开始同步到数据库: ${config.db && config.db.database ? config.db.database : ''}`);
    const stats = await syncPlansToDb(plans, paging.totalItems);
    logger.success(
        `生产计划同步完成：新增 ${stats.inserted}，更新 ${stats.updated}，` +
        `无变化（推算）${stats.unchanged}，因未找到所属项目而跳过 ${stats.skippedNoProject}，` +
        `归档 ${stats.archived}`
    );
    logger.info('完成。请打开上述 Excel 核对提取结果。');
}

module.exports = {
    syncArtifactsForPlanFromApi,
    setCapturedToken,
    buildGjgRollbackEvents
};

if (require.main === module) {
    main();
}
