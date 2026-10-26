const { buildTeamScopeClause } = require('./sql-runner');

function buildLatestFitupScopeClause(scope, options = {}) {
    const alias = options.alias || 'latest_fitup';
    const startingIndex = options.startingIndex || 1;
    return buildTeamScopeClause(`${alias}.team_name`, scope, startingIndex);
}

function buildLatestFitupStatusCte(options = {}) {
    const cteName = options.cteName || 'latest_fitup';
    return `
        WITH ${cteName} AS (
            SELECT DISTINCT ON (p.project_name, c.component_guid)
                e.component_id,
                trim(e.team_name) AS team_name,
                e.is_completed,
                COALESCE(e.event_at, e.updated_at, e.created_at) AS effective_at
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'fitup_weld_report'
            ORDER BY p.project_name, c.component_guid, COALESCE(e.event_at, e.updated_at, e.created_at) DESC, e.event_id DESC
        )
    `;
}

function buildLatestFitupEventCte(options = {}) {
    const cteName = options.cteName || 'latest_fitup';
    const currentStateCteName = options.currentStateCteName || `${cteName}_current_state`;
    const currentStateBeforeSql = options.currentStateBeforeSql || null;
    const currentStateBeforeClause = currentStateBeforeSql
        ? `\n              AND COALESCE(e.event_at, e.updated_at, e.created_at) < ${currentStateBeforeSql}`
        : '';
    return `
        WITH ${currentStateCteName} AS (
            SELECT DISTINCT ON (p.project_name, c.component_guid)
                p.project_name,
                c.component_guid,
                e.is_completed
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'fitup_weld_report'${currentStateBeforeClause}
            ORDER BY
                p.project_name ASC,
                c.component_guid ASC,
                COALESCE(e.event_at, e.updated_at, e.created_at) DESC,
                e.event_id DESC
        ),
        ${cteName} AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
                e.component_id,
                e.event_id,
                e.event_at,
                e.created_at,
                e.updated_at,
                e.raw_value,
                trim(e.team_name) AS team_name,
                trim(e.operator_name) AS operator_name,
                trim(e.trace_operator_name) AS trace_operator_name,
                e.is_completed
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            JOIN ${currentStateCteName} current_state
              ON current_state.project_name = p.project_name
             AND current_state.component_guid = c.component_guid
            WHERE e.status_type = 'fitup_weld_report'
              ${currentStateBeforeSql ? `AND COALESCE(e.event_at, e.updated_at, e.created_at) < ${currentStateBeforeSql}` : ''}
              AND current_state.is_completed = true
            ORDER BY
                p.project_name ASC,
                pp.plan_name ASC,
                c.component_guid ASC,
                COALESCE(e.event_at, e.updated_at, e.created_at) DESC,
                e.event_id DESC
        )
    `;
}

module.exports = {
    buildLatestFitupScopeClause,
    buildLatestFitupStatusCte,
    buildLatestFitupEventCte
};
