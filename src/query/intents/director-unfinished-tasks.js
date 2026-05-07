const { getQueryConfig } = require('../config');
const { formatDateTime, formatWeight, shortTeamList } = require('../result-formatter');
const { fetchUnfinishedFitup } = require('./shared-fitup');

module.exports = {
    intent: 'director_unfinished_tasks',

    async execute(query) {
        if (!query.scope || !['director', 'workshop'].includes(query.scope.targetType)) {
            return {
                intent: 'director_unfinished_tasks',
                ok: false,
                replyText: '未识别到车间主任或装焊车间。'
            };
        }

        const config = getQueryConfig();
        const maxDetailRows = Number(config.query && config.query.maxDetailRows) || 20;
        const data = await fetchUnfinishedFitup(query.scope, maxDetailRows);
        const summary = data.summary || {};
        const groupLines = data.groups.slice(0, 5).map(item => `${item.team_name}${item.unfinished_components}项`);

        if (!Number(summary.unfinished_components)) {
            return {
                intent: 'director_unfinished_tasks',
                ok: true,
                replyText: `${query.scope.canonicalName} 范围内当前没有未完成装焊任务。已覆盖班组：${shortTeamList(query.scope.fitupTeams)}。`
            };
        }

        return {
            intent: 'director_unfinished_tasks',
            ok: true,
            replyText: `${query.scope.canonicalName} 范围内当前未完成装焊任务 ${summary.unfinished_components} 项，合计 ${formatWeight(summary.total_weight)} 吨。涉及班组 ${query.scope.fitupTeams.length} 个：${shortTeamList(query.scope.fitupTeams)}。${groupLines.length ? ` 当前主要分布：${groupLines.join('、')}。` : ''} 最近未完成记录时间 ${formatDateTime(summary.last_event_at)}。`
        };
    }
};
