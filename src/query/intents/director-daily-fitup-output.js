const { formatDateTime, formatInt, formatWeight } = require('../result-formatter');
const { fetchDailyFitupOutput } = require('./shared-fitup');

module.exports = {
    intent: 'director_daily_fitup_output',

    async execute(query, context) {
        if (!query.scope || !['director', 'workshop'].includes(query.scope.targetType)) {
            return {
                intent: 'director_daily_fitup_output',
                ok: false,
                replyText: '未识别到车间主任或装焊车间。'
            };
        }

        const now = new Date(context.now || new Date());
        const dateRange = query.dateRange || {
            kind: 'today',
            label: '今天',
            start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
            end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
        };

        const data = await fetchDailyFitupOutput(query.scope, dateRange);
        const summary = data.summary || {};
        const groupLines = data.groups.slice(0, 5).map(item => `${item.team_name}${formatWeight(item.total_weight)}吨`);

        if (!Number(summary.event_count)) {
            const historyText = data.lastHistoryEventAt
                ? `最近一次装焊完成记录时间为 ${formatDateTime(data.lastHistoryEventAt)}。`
                : '暂未找到历史装焊完成记录。';
            return {
                intent: 'director_daily_fitup_output',
                ok: true,
                replyText: `${query.scope.canonicalName}${dateRange.label}没有找到装焊完成记录。${historyText}`
            };
        }

        return {
            intent: 'director_daily_fitup_output',
            ok: true,
            replyText: `${query.scope.canonicalName}${dateRange.label}装焊完成 ${formatWeight(summary.total_weight)} 吨，${formatInt(summary.total_quantity)} 件，涉及 ${formatInt(summary.component_count)} 个构件。${groupLines.length ? ` 主要班组：${groupLines.join('、')}。` : ''} 最后完成时间 ${formatDateTime(summary.last_event_at)}。`
        };
    }
};
