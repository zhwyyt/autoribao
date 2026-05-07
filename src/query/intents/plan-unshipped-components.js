const { query } = require('../sql-runner');
const { formatWeight } = require('../result-formatter');
const { buildEffectivePlanScopeFilter } = require('../effective-plan-filter');

const EFFECTIVE_PLAN_SCOPE_FILTER = buildEffectivePlanScopeFilter({ projectAlias: 'p', planAlias: 'pp' });

async function resolvePlan(planSelector) {
    if (!planSelector) return { status: 'missing' };

    if (planSelector.planId) {
        const res = await query(
            `
                SELECT
                    pp.plan_id,
                    pp.plan_name,
                    p.project_name
                FROM production_plan pp
                JOIN project p ON p.project_id = pp.project_id
                WHERE pp.plan_id = $1
                  AND ${EFFECTIVE_PLAN_SCOPE_FILTER}
                LIMIT 1
            `,
            [planSelector.planId]
        );
        if (res.rows.length === 0) return { status: 'not-found' };
        return { status: 'ok', plan: res.rows[0] };
    }

    const res = await query(
        `
            SELECT
                pp.plan_id,
                pp.plan_name,
                p.project_name
            FROM production_plan pp
            JOIN project p ON p.project_id = pp.project_id
            WHERE pp.plan_name ILIKE $1
              AND ${EFFECTIVE_PLAN_SCOPE_FILTER}
            ORDER BY pp.updated_at DESC, pp.plan_id DESC
            LIMIT 6
        `,
        [`%${planSelector.planNameLike}%`]
    );

    if (res.rows.length === 0) return { status: 'not-found' };
    if (res.rows.length > 1) return { status: 'ambiguous', candidates: res.rows };
    return { status: 'ok', plan: res.rows[0] };
}

module.exports = {
    intent: 'plan_unshipped_components',

    async execute(queryInput) {
        const planResolution = await resolvePlan(queryInput.planSelector);
        if (planResolution.status === 'missing') {
            return {
                intent: 'plan_unshipped_components',
                ok: false,
                replyText: '没有识别到要查询的计划名称或计划 ID。'
            };
        }

        if (planResolution.status === 'not-found') {
            return {
                intent: 'plan_unshipped_components',
                ok: false,
                replyText: '没有找到对应的生产计划。'
            };
        }

        if (planResolution.status === 'ambiguous') {
            const candidates = planResolution.candidates
                .slice(0, 5)
                .map(item => `${item.plan_id}-${item.plan_name}`)
                .join('；');
            return {
                intent: 'plan_unshipped_components',
                ok: false,
                replyText: `匹配到多个生产计划，请说得更具体一些。候选有：${candidates}`
            };
        }

        const plan = planResolution.plan;
        const summaryRes = await query(
            `
                WITH latest_shipping AS (
                    SELECT DISTINCT ON (e.component_id)
                        e.component_id,
                        e.is_completed
                    FROM component_status_event e
                    WHERE e.status_type = 'shipping'
                    ORDER BY e.component_id, COALESCE(e.event_at, e.updated_at, e.created_at) DESC, e.event_id DESC
                )
                SELECT
                    count(*)::int AS unshipped_components,
                    COALESCE(sum(COALESCE(c.weight, 0) * c.quantity), 0)::numeric(18,3) AS total_weight
                FROM component c
                LEFT JOIN latest_shipping ls ON ls.component_id = c.component_id
                WHERE c.plan_id = $1
                  AND COALESCE(ls.is_completed, false) = false
            `,
            [plan.plan_id]
        );

        const detailRes = await query(
            `
                WITH latest_shipping AS (
                    SELECT DISTINCT ON (e.component_id)
                        e.component_id,
                        e.is_completed
                    FROM component_status_event e
                    WHERE e.status_type = 'shipping'
                    ORDER BY e.component_id, COALESCE(e.event_at, e.updated_at, e.created_at) DESC, e.event_id DESC
                )
                SELECT
                    c.component_no,
                    c.spec,
                    c.quantity,
                    c.weight,
                    (COALESCE(c.weight, 0) * c.quantity)::numeric(18,3) AS total_weight
                FROM component c
                LEFT JOIN latest_shipping ls ON ls.component_id = c.component_id
                WHERE c.plan_id = $1
                  AND COALESCE(ls.is_completed, false) = false
                ORDER BY total_weight DESC, c.component_no
                LIMIT 10
            `,
            [plan.plan_id]
        );

        const summary = summaryRes.rows[0] || { unshipped_components: 0, total_weight: '0.000' };
        if (!Number(summary.unshipped_components)) {
            return {
                intent: 'plan_unshipped_components',
                ok: true,
                replyText: `${plan.plan_name} 当前没有未发货构件。`
            };
        }

        const detailLines = detailRes.rows
            .slice(0, 5)
            .map(item => `${item.component_no || '未标记构件'}(${formatWeight(item.total_weight)}吨)`);

        return {
            intent: 'plan_unshipped_components',
            ok: true,
            replyText: `${plan.project_name} / ${plan.plan_name} 当前未发货构件 ${summary.unshipped_components} 项，合计 ${formatWeight(summary.total_weight)} 吨。${detailLines.length ? ` 示例：${detailLines.join('、')}` : ''}`
        };
    }
};
