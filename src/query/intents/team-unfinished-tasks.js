const { getQueryConfig } = require('../config');
const { formatDateTime, formatWeight } = require('../result-formatter');
const { fetchUnfinishedFitup } = require('./shared-fitup');

module.exports = {
    intent: 'team_unfinished_tasks',

    async execute(query) {
        if (!query.scope || query.scope.targetType !== 'team') {
            return {
                intent: 'team_unfinished_tasks',
                ok: false,
                replyText: '未识别到明确的装焊报检班组。若只查单个班组，请带“班组”二字。'
            };
        }

        const config = getQueryConfig();
        const maxDetailRows = Number(config.query && config.query.maxDetailRows) || 20;
        const data = await fetchUnfinishedFitup(query.scope, maxDetailRows);
        const summary = data.summary || {};

        if (!Number(summary.unfinished_components)) {
            return {
                intent: 'team_unfinished_tasks',
                ok: true,
                replyText: `${query.scope.canonicalName} 当前没有未完成的装焊任务。`
            };
        }

        const detailLines = data.details.slice(0, 5).map(item => {
            const componentNo = item.component_no || '未标记构件';
            return `${item.project_name} / ${item.plan_name} / ${componentNo}`;
        });

        return {
            intent: 'team_unfinished_tasks',
            ok: true,
            replyText: `${query.scope.canonicalName} 当前未完成装焊任务 ${summary.unfinished_components} 项，合计 ${formatWeight(summary.total_weight)} 吨。最近未完成记录时间 ${formatDateTime(summary.last_event_at)}。${detailLines.length ? ` 例如：${detailLines.join('；')}` : ''}`
        };
    }
};
