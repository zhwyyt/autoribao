const { query, buildTeamScopeClause } = require('../sql-runner');
const { buildEffectiveProjectFilter, buildEffectivePlanFilter } = require('../effective-plan-filter');

const ACTIVE_PROJECT_FILTER = buildEffectiveProjectFilter('p');
const ACTIVE_PLAN_FILTER = buildEffectivePlanFilter('pp');

async function fetchUnfinishedFitup(scope, maxDetailRows = 20) {
    const scopeClause = buildTeamScopeClause('e.team_name', scope, 1);
    const detailLimitIndex = scopeClause.nextIndex;

    const cte = `
        WITH filtered AS (
            SELECT
                e.event_id,
                e.component_id,
                trim(e.team_name) AS team_name,
                e.is_completed,
                COALESCE(e.event_at, e.updated_at, e.created_at) AS effective_at
            FROM component_status_event e
            WHERE e.status_type = 'fitup_weld_report'
              AND ${scopeClause.sql}
        ),
        latest AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
                e.component_id,
                trim(e.team_name) AS team_name,
                e.is_completed,
                COALESCE(e.event_at, e.updated_at, e.created_at) AS effective_at
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'fitup_weld_report'
              AND ${scopeClause.sql}
            ORDER BY p.project_name, pp.plan_name, c.component_guid, COALESCE(e.event_at, e.updated_at, e.created_at) DESC, e.event_id DESC
        )
    `;

    const summarySql = `
        ${cte}
        SELECT
            count(*)::int AS unfinished_components,
            COALESCE(sum(COALESCE(c.weight, 0) * c.quantity), 0)::numeric(18,3) AS total_weight,
            max(latest.effective_at) AS last_event_at
        FROM latest
        JOIN component c ON c.component_id = latest.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE latest.is_completed = false
          AND ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
    `;

    const groupsSql = `
        ${cte}
        SELECT
            COALESCE(NULLIF(latest.team_name, ''), '未标记班组') AS team_name,
            count(*)::int AS unfinished_components,
            COALESCE(sum(COALESCE(c.weight, 0) * c.quantity), 0)::numeric(18,3) AS total_weight
        FROM latest
        JOIN component c ON c.component_id = latest.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE latest.is_completed = false
          AND ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
        GROUP BY COALESCE(NULLIF(latest.team_name, ''), '未标记班组')
        ORDER BY unfinished_components DESC, total_weight DESC, team_name
    `;

    const detailSql = `
        ${cte}
        SELECT
            p.project_name,
            pp.plan_id,
            pp.plan_name,
            c.component_no,
            c.spec,
            c.quantity,
            c.weight,
            (COALESCE(c.weight, 0) * c.quantity)::numeric(18,3) AS total_weight,
            COALESCE(NULLIF(latest.team_name, ''), '未标记班组') AS team_name,
            latest.effective_at
        FROM latest
        JOIN component c ON c.component_id = latest.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE latest.is_completed = false
          AND ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
        ORDER BY latest.effective_at DESC NULLS LAST, p.project_name, pp.plan_name, c.component_no
        LIMIT $${detailLimitIndex}
    `;

    const [summaryRes, groupsRes, detailRes] = await Promise.all([
        query(summarySql, scopeClause.params),
        query(groupsSql, scopeClause.params),
        query(detailSql, [...scopeClause.params, maxDetailRows])
    ]);

    return {
        summary: summaryRes.rows[0] || {
            unfinished_components: 0,
            total_weight: '0.000',
            last_event_at: null
        },
        groups: groupsRes.rows,
        details: detailRes.rows
    };
}

async function fetchDailyFitupOutput(scope, dateRange) {
    const scopeClause = buildTeamScopeClause('e.team_name', scope, 1);
    const startIndex = scopeClause.nextIndex;
    const endIndex = startIndex + 1;

    const latestCte = `
        WITH latest_fitup AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
                e.component_id,
                e.event_id,
                e.event_at,
                trim(e.team_name) AS team_name,
                e.is_completed
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'fitup_weld_report'
              AND ${scopeClause.sql}
            ORDER BY
                p.project_name ASC,
                pp.plan_name ASC,
                c.component_guid ASC,
                COALESCE(e.event_at, e.updated_at, e.created_at) DESC,
                e.event_id DESC
        )
    `;

    const summarySql = `
        ${latestCte}
        SELECT
            count(*)::int AS event_count,
            count(*)::int AS component_count,
            COALESCE(sum(COALESCE(c.weight, 0) * c.quantity), 0)::numeric(18,3) AS total_weight,
            COALESCE(sum(c.quantity), 0)::int AS total_quantity,
            max(latest_fitup.event_at) AS last_event_at
        FROM latest_fitup
        JOIN component c ON c.component_id = latest_fitup.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
          AND latest_fitup.is_completed = true
          AND latest_fitup.event_at IS NOT NULL
          AND latest_fitup.event_at >= $${startIndex}
          AND latest_fitup.event_at <= $${endIndex}
    `;

    const groupsSql = `
        ${latestCte}
        SELECT
            COALESCE(NULLIF(latest_fitup.team_name, ''), '未标记班组') AS team_name,
            count(*)::int AS event_count,
            count(*)::int AS component_count,
            COALESCE(sum(COALESCE(c.weight, 0) * c.quantity), 0)::numeric(18,3) AS total_weight,
            COALESCE(sum(c.quantity), 0)::int AS total_quantity,
            max(latest_fitup.event_at) AS last_event_at
        FROM latest_fitup
        JOIN component c ON c.component_id = latest_fitup.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
          AND latest_fitup.is_completed = true
          AND latest_fitup.event_at IS NOT NULL
          AND latest_fitup.event_at >= $${startIndex}
          AND latest_fitup.event_at <= $${endIndex}
        GROUP BY COALESCE(NULLIF(latest_fitup.team_name, ''), '未标记班组')
        ORDER BY total_weight DESC, total_quantity DESC, team_name
    `;

    const historySql = `
        SELECT max(e.event_at) AS last_history_event_at
        FROM component_status_event e
        JOIN component c ON c.component_id = e.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE e.status_type = 'fitup_weld_report'
          AND e.is_completed = true
          AND e.event_at IS NOT NULL
          AND ${scopeClause.sql}
          AND ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
    `;

    const params = [...scopeClause.params, dateRange.start, dateRange.end];
    const [summaryRes, groupsRes, historyRes] = await Promise.all([
        query(summarySql, params),
        query(groupsSql, params),
        query(historySql, scopeClause.params)
    ]);

    return {
        summary: summaryRes.rows[0] || {
            event_count: 0,
            component_count: 0,
            total_weight: '0.000',
            total_quantity: 0,
            last_event_at: null
        },
        groups: groupsRes.rows,
        lastHistoryEventAt: historyRes.rows[0] ? historyRes.rows[0].last_history_event_at : null
    };
}

module.exports = {
    fetchUnfinishedFitup,
    fetchDailyFitupOutput
};
