const { query } = require('../sql-runner');
const { buildEffectivePlanScopeFilter } = require('../effective-plan-filter');

const EFFECTIVE_PLAN_SCOPE_FILTER = buildEffectivePlanScopeFilter({ projectAlias: 'p', planAlias: 'pp' });

function formatCandidate(item) {
    const projectName = item.project_name || '未命名项目';
    const planName = item.plan_name || '未命名计划';
    const componentNo = item.component_no || '未标记构件';
    const duplicateCount = Number(item.component_count || 0);
    const duplicateSuffix = duplicateCount > 1 ? `，该计划下匹配 ${duplicateCount} 条` : '';
    return `${projectName} / ${planName}（计划ID ${item.plan_id}，构件编号 ${componentNo}${duplicateSuffix}）`;
}

module.exports = {
    intent: 'component_plan_lookup',

    async execute(queryInput) {
        const selector = queryInput && queryInput.componentSelector;
        const componentNo = selector && selector.componentNo ? String(selector.componentNo).trim() : '';

        if (!componentNo) {
            return {
                intent: 'component_plan_lookup',
                ok: false,
                replyText: '没有识别到要查询的构件编号。'
            };
        }

        const exactRes = await query(
            `
                SELECT
                    pp.plan_id,
                    pp.plan_name,
                    p.project_name,
                    c.component_no,
                    count(*)::int AS component_count,
                    max(c.updated_at) AS latest_component_updated_at,
                    max(pp.updated_at) AS latest_plan_updated_at
                FROM component c
                JOIN production_plan pp ON pp.plan_id = c.plan_id
                JOIN project p ON p.project_id = pp.project_id
                WHERE regexp_replace(coalesce(c.component_no, ''), '\\s+', '', 'g')
                      = regexp_replace($1, '\\s+', '', 'g')
                  AND ${EFFECTIVE_PLAN_SCOPE_FILTER}
                GROUP BY pp.plan_id, pp.plan_name, p.project_name, c.component_no
                ORDER BY latest_plan_updated_at DESC NULLS LAST, latest_component_updated_at DESC NULLS LAST, pp.plan_id DESC
                LIMIT 10
            `,
            [componentNo]
        );

        if (exactRes.rows.length === 0) {
            return {
                intent: 'component_plan_lookup',
                ok: false,
                replyText: `没有找到构件编号“${componentNo}”对应的生产计划。`
            };
        }

        if (exactRes.rows.length === 1) {
            const row = exactRes.rows[0];
            return {
                intent: 'component_plan_lookup',
                ok: true,
                replyText: `构件编号 ${componentNo} 属于 ${row.project_name} / ${row.plan_name}（计划ID ${row.plan_id}）。`
            };
        }

        const lines = exactRes.rows
            .slice(0, 5)
            .map((item, index) => `${index + 1}. ${formatCandidate(item)}`);

        return {
            intent: 'component_plan_lookup',
            ok: true,
            replyText: `构件编号 ${componentNo} 匹配到多个生产计划，请结合项目或计划再确认：\n${lines.join('\n')}`
        };
    }
};
