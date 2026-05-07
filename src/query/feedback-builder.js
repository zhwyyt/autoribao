const logger = require('../logger');
const { query, buildTeamScopeClause } = require('./sql-runner');
const { generateFeedbackWorkbook } = require('./feedback-exporter');
const { normalizeDisplay, normalizeText, stripFitupTeamSuffix } = require('./team-directory-normalize');
const { buildEffectiveProjectFilter, buildEffectivePlanFilter } = require('./effective-plan-filter');

const FITUP_INTENTS = new Set([
    'team_unfinished_tasks',
    'team_daily_fitup_output',
    'director_unfinished_tasks',
    'director_daily_fitup_output'
]);
const ACTIVE_PROJECT_FILTER = buildEffectiveProjectFilter('p');
const ACTIVE_PLAN_FILTER = buildEffectivePlanFilter('pp');

function isFitupQuery(queryInput) {
    return Boolean(
        queryInput &&
        FITUP_INTENTS.has(queryInput.intent) &&
        queryInput.scope &&
        (Array.isArray(queryInput.scope.fitupTeams) || Array.isArray(queryInput.scope.dbFallbackExactNames))
    );
}

function buildDefaultTodayRange(now = new Date()) {
    const current = new Date(now);
    return {
        kind: 'today',
        label: '今天',
        start: new Date(current.getFullYear(), current.getMonth(), current.getDate(), 0, 0, 0, 0),
        end: new Date(current.getFullYear(), current.getMonth(), current.getDate(), 23, 59, 59, 999)
    };
}

function buildTodayStart(now = new Date()) {
    const current = new Date(now);
    return new Date(current.getFullYear(), current.getMonth(), current.getDate(), 0, 0, 0, 0);
}

function buildScopeKey(scope) {
    if (!scope) return '';
    const fitupTeams = Array.isArray(scope.fitupTeams) ? [...scope.fitupTeams].sort() : [];
    return `${scope.targetType || 'unknown'}:${scope.canonicalName || ''}:${fitupTeams.join('|')}`;
}

function sanitizeFileName(value) {
    return String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, '')
        .slice(0, 80) || '装焊反馈表';
}

function formatDateStamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function pickFeedbackTarget(queries, now) {
    const fitupQueries = (queries || []).filter(isFitupQuery);
    if (fitupQueries.length === 0) {
        return { ok: false, reason: 'no-fitup-query' };
    }

    const uniqueScopeKeys = Array.from(new Set(fitupQueries.map(item => buildScopeKey(item.scope)).filter(Boolean)));
    if (uniqueScopeKeys.length > 1) {
        return {
            ok: false,
            reason: 'multiple-fitup-scopes',
            replyText: '这次消息里包含了多个班组或主任范围，暂时只自动导出单一范围的反馈表。'
        };
    }

    const primary = fitupQueries[0];
    const dated = fitupQueries.find(item => item.dateRange);
    return {
        ok: true,
        scope: primary.scope,
        dateRange: dated && dated.dateRange ? dated.dateRange : buildDefaultTodayRange(now),
        sourceIntents: fitupQueries.map(item => item.intent)
    };
}

function findWorkshopByTeamName(directory, teamName, scope) {
    const exact = directory.indexes.fitupTeamsByName.get(teamName);
    if (exact && exact.length > 0) {
        const names = Array.from(
            new Set(exact.map(item => normalizeDisplay(item.fitupWorkshopName)).filter(Boolean))
        );
        if (names.length > 0) {
            return names[0];
        }
    }

    const normalizedBase = normalizeText(stripFitupTeamSuffix(teamName));
    if (normalizedBase) {
        const candidates = directory.indexes.fitupTeamsByBaseNorm.get(normalizedBase) || [];
        if (candidates.length === 1) {
            const matched = directory.indexes.fitupTeamsByName.get(candidates[0]) || [];
            const names = Array.from(
                new Set(matched.map(item => normalizeDisplay(item.fitupWorkshopName)).filter(Boolean))
            );
            if (names.length > 0) {
                return names[0];
            }
        }
    }

    if (scope && Array.isArray(scope.fitupWorkshopNames) && scope.fitupWorkshopNames.length === 1) {
        return scope.fitupWorkshopNames[0];
    }
    if (scope && scope.targetType === 'workshop' && scope.canonicalName) {
        return scope.canonicalName;
    }
    return normalizeDisplay((scope && scope.fitupWorkshopNames && scope.fitupWorkshopNames[0]) || '') || '未标记车间';
}

async function fetchTaskSummaryRows(scope) {
    const scopeClause = buildTeamScopeClause('e.team_name', scope, 1);
    const sql = `
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
        SELECT
            COALESCE(NULLIF(latest.team_name, ''), '未标记班组') AS team_name,
            p.project_name,
            COALESCE(NULLIF(trim(c.location), ''), '') AS area_name,
            pp.end_at AS planned_end_at,
            count(*) FILTER (WHERE latest.is_completed = true)::int AS completed_components,
            COALESCE(sum(CASE WHEN latest.is_completed = true THEN COALESCE(c.weight, 0) * c.quantity ELSE 0 END), 0)::numeric(18,3) AS completed_weight,
            count(*) FILTER (WHERE latest.is_completed = false)::int AS unfinished_components,
            COALESCE(sum(CASE WHEN latest.is_completed = false THEN COALESCE(c.weight, 0) * c.quantity ELSE 0 END), 0)::numeric(18,3) AS unfinished_weight,
            max(latest.effective_at) FILTER (WHERE latest.is_completed = true) AS last_completed_at
        FROM latest
        JOIN component c ON c.component_id = latest.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
        GROUP BY 1, 2, 3, 4
        ORDER BY p.project_name, area_name, team_name
    `;
    const res = await query(sql, scopeClause.params);
    return res.rows;
}

function buildHistoricalCompletedAreaSet(taskRows, todayStart) {
    const areaProgress = new Map();

    for (const row of taskRows || []) {
        const areaName = normalizeDisplay(row.area_name);
        const key = `${normalizeDisplay(row.project_name)}|${areaName}`;
        if (!areaProgress.has(key)) {
            areaProgress.set(key, {
                unfinishedComponents: 0,
                completedComponents: 0,
                lastCompletedAt: null
            });
        }

        const target = areaProgress.get(key);
        target.unfinishedComponents += Number(row.unfinished_components || 0);
        target.completedComponents += Number(row.completed_components || 0);

        const lastCompletedAt = row.last_completed_at ? new Date(row.last_completed_at) : null;
        if (lastCompletedAt && Number.isFinite(lastCompletedAt.getTime())) {
            if (!target.lastCompletedAt || lastCompletedAt > target.lastCompletedAt) {
                target.lastCompletedAt = lastCompletedAt;
            }
        }
    }

    return new Set(
        Array.from(areaProgress.entries())
            .filter(([, value]) =>
                value.completedComponents > 0 &&
                value.unfinishedComponents === 0 &&
                value.lastCompletedAt &&
                value.lastCompletedAt < todayStart
            )
            .map(([key]) => key)
    );
}

function filterTaskRowsByHistoricalCompletedAreas(taskRows, historicalCompletedAreas) {
    if (!historicalCompletedAreas || historicalCompletedAreas.size === 0) {
        return taskRows;
    }

    return (taskRows || []).filter(row => {
        const areaName = normalizeDisplay(row.area_name);
        const key = `${normalizeDisplay(row.project_name)}|${areaName}`;
        return !historicalCompletedAreas.has(key);
    });
}

async function fetchDailyCompletedRows(scope, dateRange) {
    const scopeClause = buildTeamScopeClause('e.team_name', scope, 1);
    const startIndex = scopeClause.nextIndex;
    const endIndex = startIndex + 1;
    const params = [...scopeClause.params, dateRange.start, dateRange.end];

    const summarySql = `
        WITH filtered AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
                e.component_id,
                trim(e.team_name) AS team_name,
                e.event_at,
                e.is_completed
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'fitup_weld_report'
              AND ${scopeClause.sql}
            ORDER BY p.project_name, pp.plan_name, c.component_guid, COALESCE(e.event_at, e.updated_at, e.created_at) DESC, e.event_id DESC
        )
        SELECT
            COALESCE(NULLIF(filtered.team_name, ''), '未标记班组') AS team_name,
            p.project_name,
            COALESCE(NULLIF(trim(c.location), ''), '') AS area_name,
            count(*)::int AS completed_components,
            COALESCE(sum(COALESCE(c.weight, 0) * c.quantity), 0)::numeric(18,3) AS completed_weight
        FROM filtered
        JOIN component c ON c.component_id = filtered.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
          AND filtered.is_completed = true
          AND filtered.event_at IS NOT NULL
          AND filtered.event_at >= $${startIndex}
          AND filtered.event_at <= $${endIndex}
        GROUP BY 1, 2, 3
        ORDER BY p.project_name, area_name, team_name
    `;

    const detailSql = `
        WITH filtered AS (
            SELECT DISTINCT ON (p.project_name, pp.plan_name, c.component_guid)
                e.component_id,
                trim(e.team_name) AS team_name,
                e.event_at,
                e.is_completed
            FROM component_status_event e
            JOIN component c ON c.component_id = e.component_id
            JOIN production_plan pp ON pp.plan_id = c.plan_id
            JOIN project p ON p.project_id = pp.project_id
            WHERE e.status_type = 'fitup_weld_report'
              AND ${scopeClause.sql}
            ORDER BY p.project_name, pp.plan_name, c.component_guid, COALESCE(e.event_at, e.updated_at, e.created_at) DESC, e.event_id DESC
        )
        SELECT
            COALESCE(NULLIF(filtered.team_name, ''), '未标记班组') AS team_name,
            p.project_name,
            COALESCE(NULLIF(trim(c.location), ''), '') AS area_name,
            c.component_no,
            c.quantity,
            (COALESCE(c.weight, 0) * c.quantity)::numeric(18,3) AS total_weight,
            filtered.event_at
        FROM filtered
        JOIN component c ON c.component_id = filtered.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
          AND filtered.is_completed = true
          AND filtered.event_at IS NOT NULL
          AND filtered.event_at >= $${startIndex}
          AND filtered.event_at <= $${endIndex}
        ORDER BY filtered.event_at DESC, p.project_name, area_name, c.component_no
    `;

    const [summaryRes, detailRes] = await Promise.all([
        query(summarySql, params),
        query(detailSql, params)
    ]);

    return {
        summaryRows: summaryRes.rows,
        detailRows: detailRes.rows
    };
}

async function fetchUnfinishedDetailRows(scope) {
    const scopeClause = buildTeamScopeClause('e.team_name', scope, 1);
    const sql = `
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
        SELECT
            COALESCE(NULLIF(latest.team_name, ''), '未标记班组') AS team_name,
            p.project_name,
            COALESCE(NULLIF(trim(c.location), ''), '') AS area_name,
            c.component_no,
            c.quantity,
            (COALESCE(c.weight, 0) * c.quantity)::numeric(18,3) AS total_weight,
            pp.end_at AS planned_end_at,
            latest.effective_at
        FROM latest
        JOIN component c ON c.component_id = latest.component_id
        JOIN production_plan pp ON pp.plan_id = c.plan_id
        JOIN project p ON p.project_id = pp.project_id
        WHERE latest.is_completed = false
          AND ${ACTIVE_PROJECT_FILTER}
          AND ${ACTIVE_PLAN_FILTER}
        ORDER BY latest.effective_at DESC NULLS LAST, p.project_name, area_name, c.component_no
    `;
    const res = await query(sql, scopeClause.params);
    return res.rows;
}

function aggregateWorkshopTaskRows(taskRows, workshopByTeam) {
    const map = new Map();
    for (const row of taskRows) {
        const workshopName = workshopByTeam.get(row.team_name) || '未标记车间';
        const key = [workshopName, row.project_name, row.area_name, row.planned_end_at || ''].join('|');
        if (!map.has(key)) {
            map.set(key, {
                车间: workshopName,
                项目名称: row.project_name,
                工程区域: row.area_name,
                已完构件数量: 0,
                已完构件重量: 0,
                未完构件数量: 0,
                未完构件重量: 0,
                计划完成日期: row.planned_end_at || ''
            });
        }
        const target = map.get(key);
        target['已完构件数量'] += Number(row.completed_components || 0);
        target['已完构件重量'] += Number(row.completed_weight || 0);
        target['未完构件数量'] += Number(row.unfinished_components || 0);
        target['未完构件重量'] += Number(row.unfinished_weight || 0);
    }
    return Array.from(map.values());
}

function aggregateDailyWorkshopRows(summaryRows, workshopByTeam) {
    const map = new Map();
    for (const row of summaryRows) {
        const workshopName = workshopByTeam.get(row.team_name) || '未标记车间';
        const key = [workshopName, row.project_name, row.area_name].join('|');
        if (!map.has(key)) {
            map.set(key, {
                车间: workshopName,
                项目名称: row.project_name,
                工程区域: row.area_name,
                今日已完构件数量: 0,
                今日已完构件重量: 0
            });
        }
        const target = map.get(key);
        target['今日已完构件数量'] += Number(row.completed_components || 0);
        target['今日已完构件重量'] += Number(row.completed_weight || 0);
    }
    return Array.from(map.values());
}

async function buildFeedbackWorkbookForQueries(options = {}) {
    const queries = Array.isArray(options.queries) ? options.queries : [];
    const directory = options.directory;
    const now = options.now || new Date();

    if (!directory) {
        return { ok: false, reason: 'missing-directory' };
    }

    const target = pickFeedbackTarget(queries, now);
    if (!target.ok) {
        return target;
    }

    const { scope, dateRange } = target;
    const [taskRows, dailyData, unfinishedDetailRows] = await Promise.all([
        fetchTaskSummaryRows(scope),
        fetchDailyCompletedRows(scope, dateRange),
        fetchUnfinishedDetailRows(scope)
    ]);
    const historicalCompletedAreas = buildHistoricalCompletedAreaSet(taskRows, buildTodayStart(now));
    const activeTaskRows = filterTaskRowsByHistoricalCompletedAreas(taskRows, historicalCompletedAreas);

    const workshopByTeam = new Map();
    const allTeamNames = new Set([
        ...activeTaskRows.map(item => item.team_name),
        ...dailyData.summaryRows.map(item => item.team_name),
        ...dailyData.detailRows.map(item => item.team_name),
        ...unfinishedDetailRows.map(item => item.team_name)
    ]);

    for (const teamName of allTeamNames) {
        workshopByTeam.set(teamName, findWorkshopByTeamName(directory, teamName, scope));
    }

    const teamTasks = activeTaskRows.map(row => ({
        车间: workshopByTeam.get(row.team_name) || '未标记车间',
        项目名称: row.project_name,
        工程区域: row.area_name,
        装焊班组: row.team_name,
        已完构件数量: Number(row.completed_components || 0),
        已完构件重量: Number(row.completed_weight || 0),
        未完构件数量: Number(row.unfinished_components || 0),
        未完构件重量: Number(row.unfinished_weight || 0),
        计划完成日期: row.planned_end_at || ''
    }));

    const dailyTeamDetails = dailyData.detailRows.map(row => ({
        车间: workshopByTeam.get(row.team_name) || '未标记车间',
        项目名称: row.project_name,
        工程区域: row.area_name,
        构件编号: row.component_no || '',
        数量: Number(row.quantity || 0),
        重量: Number(row.total_weight || 0)
    }));

    const unfinishedDetails = unfinishedDetailRows.map(row => ({
        车间: workshopByTeam.get(row.team_name) || '未标记车间',
        项目名称: row.project_name,
        工程区域: row.area_name,
        装焊班组: row.team_name,
        构件编号: row.component_no || '',
        数量: Number(row.quantity || 0),
        重量: Number(row.total_weight || 0),
        计划完成日期: row.planned_end_at || ''
    }));

    const payload = {
        workshopTasks: aggregateWorkshopTaskRows(activeTaskRows, workshopByTeam),
        teamTasks,
        dailyTeamSummary: aggregateDailyWorkshopRows(dailyData.summaryRows, workshopByTeam),
        dailyTeamDetails,
        unfinishedDetails,
        outputFileName: `${sanitizeFileName(scope.canonicalName)}_${formatDateStamp(now)}_装焊反馈表.xlsx`
    };

    const outputPath = await generateFeedbackWorkbook(payload);
    logger.info(`已为 ${scope.canonicalName} 生成装焊反馈表：${outputPath}`);

    return {
        ok: true,
        scope,
        dateRange,
        outputPath,
        payloadStats: {
            workshopTasks: payload.workshopTasks.length,
            teamTasks: payload.teamTasks.length,
            dailyTeamSummary: payload.dailyTeamSummary.length,
            dailyTeamDetails: payload.dailyTeamDetails.length,
            unfinishedDetails: payload.unfinishedDetails.length
        },
        replyText: `已按${scope.canonicalName}生成装焊反馈表，包含车间任务、班组任务、当日完成汇总/详情和未完构件明细。`
    };
}

module.exports = {
    buildFeedbackWorkbookForQueries
};

