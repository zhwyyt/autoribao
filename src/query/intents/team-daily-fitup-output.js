const { formatDateTime, formatInt, formatWeight } = require('../result-formatter');
const { fetchDailyFitupOutput } = require('./shared-fitup');

module.exports = {
    intent: 'team_daily_fitup_output',

    async execute(query, context) {
        if (!query.scope || query.scope.targetType !== 'team') {
            return {
                intent: 'team_daily_fitup_output',
                ok: false,
                replyText: '未识别到明确的装焊报检班组。若只查单个班组，请带“班组”二字。'
            };
        }

        const dateRange = query.dateRange || {
            kind: 'today',
            label: '今天',
            start: new Date(new Date(context.now).setHours(0, 0, 0, 0)),
            end: new Date(new Date(context.now).setHours(23, 59, 59, 999))
        };

        const data = await fetchDailyFitupOutput(query.scope, dateRange);
        const summary = data.summary || {};

        if (!Number(summary.event_count)) {
            const historyText = data.lastHistoryEventAt
                ? `最近一次装焊完成记录时间为 ${formatDateTime(data.lastHistoryEventAt)}。`
                : '暂未找到历史装焊完成记录。';
            return {
                intent: 'team_daily_fitup_output',
                ok: true,
                replyText: `${query.scope.canonicalName}${dateRange.label}没有找到装焊完成记录。${historyText}`
            };
        }

        return {
            intent: 'team_daily_fitup_output',
            ok: true,
            replyText: `${query.scope.canonicalName}${dateRange.label}装焊完成 ${formatWeight(summary.total_weight)} 吨，${formatInt(summary.total_quantity)} 件，涉及 ${formatInt(summary.component_count)} 个构件。最后完成时间 ${formatDateTime(summary.last_event_at)}。`
        };
    }
};
