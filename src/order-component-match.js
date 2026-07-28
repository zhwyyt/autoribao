/**
 * 订单构件 ↔ 生产库 component 匹配（项目名 + 可选排产 scheduling_id + GUID）。
 */
function normalizeText(value) {
    return String(value == null ? '' : value)
        .trim()
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .replace(/\s+/g, '');
}

function makeMatchKey2(projectName, guid) {
    return `${normalizeText(projectName)}|${normalizeText(guid)}`;
}

function makeMatchKey3(projectName, schedulingId, guid) {
    return `${normalizeText(projectName)}|${Number(schedulingId)}|${normalizeText(guid)}`;
}

function pickGuid(item) {
    return normalizeText(item.guid || item['构件GUID'] || item.component_guid || '');
}

function pickSchedulingId(item) {
    const n = Number(item.scheduling_id);
    return Number.isFinite(n) ? n : null;
}

function pickComponentNo(item) {
    return normalizeText(item['构件编号'] || item.code || item.dode || item.component_no || '');
}

function pickSpec(item) {
    return normalizeText(item['规格/型号'] || item.spec || '');
}

function pickLocation(item) {
    return normalizeText(item['区域部位/所在楼层'] || item.location || '');
}

async function loadPlanToSchedulingFromDb(pool) {
    const res = await pool.query(
        `
            SELECT DISTINCT plan_id, scheduling_id
            FROM order_component
            WHERE plan_id IS NOT NULL AND scheduling_id IS NOT NULL
        `
    );
    const map = new Map();
    for (const row of res.rows || []) {
        map.set(Number(row.plan_id), Number(row.scheduling_id));
    }
    return map;
}

function mergePlanToSchedulingFromPlans(planToScheduling, planList) {
    for (const item of Array.isArray(planList) ? planList : []) {
        const planId = Number(item.id);
        const schedulingId = Number(item.scheduling_id);
        if (Number.isFinite(planId) && Number.isFinite(schedulingId)) {
            planToScheduling.set(planId, schedulingId);
        }
    }
    return planToScheduling;
}

/**
 * @param {import('pg').Pool} pool
 * @param {Map<number, number>} planToScheduling plan_id → scheduling_id
 */
async function loadComponentMatchIndex(pool, planToScheduling) {
    const res = await pool.query(
        `
            SELECT
                c.component_id,
                c.component_guid::text AS component_guid,
                c.component_no,
                c.spec,
                p.project_name,
                pp.plan_id
            FROM component c
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE coalesce(trim(c.component_guid::text), '') <> ''
        `
    );
    const index2 = new Map();
    const index3 = new Map();
    for (const row of res.rows || []) {
        const entry = {
            component_id: Number(row.component_id),
            component_no: normalizeText(row.component_no),
            spec: normalizeText(row.spec),
            plan_id: Number(row.plan_id)
        };
        const k2 = makeMatchKey2(row.project_name, row.component_guid);
        if (!index2.has(k2)) index2.set(k2, []);
        index2.get(k2).push(entry);

        const schedulingId = planToScheduling.get(Number(row.plan_id));
        if (Number.isFinite(schedulingId)) {
            const k3 = makeMatchKey3(row.project_name, schedulingId, row.component_guid);
            if (!index3.has(k3)) index3.set(k3, []);
            index3.get(k3).push(entry);
        }
    }
    return { index2, index3 };
}

function fieldChecks(artifact, match) {
    const apiNo = pickComponentNo(artifact);
    const apiSpec = pickSpec(artifact);
    if (apiNo && match.component_no && apiNo !== match.component_no) {
        return { ok: false, reason: 'field_mismatch_component_no' };
    }
    if (apiSpec && match.spec && apiSpec !== match.spec) {
        return { ok: false, reason: 'field_mismatch_spec' };
    }
    return { ok: true };
}

function resolveComponentMatch(indexes, orderProjectName, artifact) {
    const guid = pickGuid(artifact);
    if (!guid) {
        return { ok: false, reason: 'missing_guid', guid: '', matches: [], scheduling_id: null };
    }

    const schedulingId = pickSchedulingId(artifact);
    if (Number.isFinite(schedulingId)) {
        const matches3 = indexes.index3.get(makeMatchKey3(orderProjectName, schedulingId, guid)) || [];
        if (matches3.length === 1) {
            const check = fieldChecks(artifact, matches3[0]);
            if (!check.ok) {
                return { ok: false, reason: check.reason, guid, matches: matches3, scheduling_id: schedulingId };
            }
            return {
                ok: true,
                reason: 'linked_scheduling',
                guid,
                matches: matches3,
                scheduling_id: schedulingId,
                plan_id: matches3[0].plan_id
            };
        }
        if (matches3.length > 1) {
            return { ok: false, reason: 'db_ambiguous_scheduling', guid, matches: matches3, scheduling_id: schedulingId };
        }
        return { ok: false, reason: 'db_missing_scheduling', guid, matches: [], scheduling_id: schedulingId };
    }

    const matches2 = indexes.index2.get(makeMatchKey2(orderProjectName, guid)) || [];
    if (matches2.length === 0) {
        return { ok: false, reason: 'db_missing', guid, matches: [], scheduling_id: null };
    }
    if (matches2.length > 1) {
        return { ok: false, reason: 'db_ambiguous', guid, matches: matches2, scheduling_id: null };
    }
    const check = fieldChecks(artifact, matches2[0]);
    if (!check.ok) {
        return { ok: false, reason: check.reason, guid, matches: [matches2[0]], scheduling_id: null };
    }
    return {
        ok: true,
        reason: 'linked',
        guid,
        matches: matches2,
        scheduling_id: null,
        plan_id: matches2[0].plan_id
    };
}

module.exports = {
    normalizeText,
    makeMatchKey2,
    makeMatchKey3,
    pickGuid,
    pickSchedulingId,
    pickComponentNo,
    pickSpec,
    pickLocation,
    loadPlanToSchedulingFromDb,
    mergePlanToSchedulingFromPlans,
    loadComponentMatchIndex,
    resolveComponentMatch
};
