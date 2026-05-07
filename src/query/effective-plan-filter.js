function buildEffectiveProjectFilter(projectAlias = 'p') {
    return `COALESCE(${projectAlias}.project_status::text, '') <> 'closed'`;
}

function buildEffectivePlanFilter(planAlias = 'pp') {
    return `(${planAlias}.plan_status IS NULL OR ${planAlias}.plan_status <> 'archived')`;
}

function buildEffectivePlanScopeFilter({ projectAlias = 'p', planAlias = 'pp' } = {}) {
    return `${buildEffectiveProjectFilter(projectAlias)} AND ${buildEffectivePlanFilter(planAlias)}`;
}

module.exports = {
    buildEffectiveProjectFilter,
    buildEffectivePlanFilter,
    buildEffectivePlanScopeFilter
};
