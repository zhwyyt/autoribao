const orgLookup = require('./intents/org-lookup');
const teamUnfinishedTasks = require('./intents/team-unfinished-tasks');
const teamDailyFitupOutput = require('./intents/team-daily-fitup-output');
const directorUnfinishedTasks = require('./intents/director-unfinished-tasks');
const directorDailyFitupOutput = require('./intents/director-daily-fitup-output');
const planUnshippedComponents = require('./intents/plan-unshipped-components');
const componentPlanLookup = require('./intents/component-plan-lookup');

const handlers = new Map([
    [orgLookup.intent, orgLookup],
    [teamUnfinishedTasks.intent, teamUnfinishedTasks],
    [teamDailyFitupOutput.intent, teamDailyFitupOutput],
    [directorUnfinishedTasks.intent, directorUnfinishedTasks],
    [directorDailyFitupOutput.intent, directorDailyFitupOutput],
    [planUnshippedComponents.intent, planUnshippedComponents],
    [componentPlanLookup.intent, componentPlanLookup]
]);

async function executeQueries(queries, context) {
    const results = [];
    for (const query of queries) {
        const handler = handlers.get(query.intent);
        if (!handler) {
            results.push({
                intent: query.intent,
                ok: false,
                replyText: `暂不支持查询意图：${query.intent}`
            });
            continue;
        }
        results.push(await handler.execute(query, context));
    }
    return results;
}

module.exports = {
    executeQueries
};
