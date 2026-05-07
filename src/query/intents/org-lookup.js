const { shortTeamList } = require('../result-formatter');

module.exports = {
    intent: 'org_lookup',

    async execute(query) {
        const scope = query.scope;
        if (!scope) {
            return {
                intent: 'org_lookup',
                ok: false,
                replyText: '没有识别到班组、装焊车间或车间主任。'
            };
        }

        if (scope.targetType === 'team') {
            return {
                intent: 'org_lookup',
                ok: true,
                replyText: `${scope.canonicalName} 属于 ${scope.fitupWorkshopNames.join('、') || '未知装焊车间'}，车间主任是 ${scope.directorNames.join('、') || '未知'}。`
            };
        }

        if (scope.targetType === 'director') {
            return {
                intent: 'org_lookup',
                ok: true,
                replyText: `${scope.canonicalName} 对应 ${scope.fitupWorkshopNames.join('、') || '未知装焊车间'}，名下共有 ${scope.fitupTeams.length} 个装焊报检班组：${shortTeamList(scope.fitupTeams)}。`
            };
        }

        return {
            intent: 'org_lookup',
            ok: true,
            replyText: `${scope.canonicalName} 下面共有 ${scope.fitupTeams.length} 个装焊报检班组，相关车间主任为 ${scope.directorNames.join('、') || '未知'}：${shortTeamList(scope.fitupTeams)}。`
        };
    }
};
