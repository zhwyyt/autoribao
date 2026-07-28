/**
 * 项目列表【构件】API 冒烟测试（需登录凭据）。
 * node test/project-list-component-api.test.js [cloudProjectId]
 */
const assert = require('assert');
const config = require('../config/default.json');
const BrowserAutomation = require('../src/browser-automation');
const {
    fetchProjectBridgeBundle,
    mapArtifactRow,
    mapOrderRow
} = require('../src/project-list-component-api');

const PROJECT_ID = Number(process.argv[2]) || 163;

let token = '';

async function main() {
    const browser = new BrowserAutomation({ ...config, browser: { headless: true } });
    assert.ok(await browser.launchBrowser(), 'browser launch');
    assert.ok(await browser.login(), 'login');
    browser.page.on('request', req => {
        const t = req.headers().token || req.headers().Token;
        if (t) token = t;
    });
    await browser.page.goto('https://dwyunsc.ddwjzkj.com:22222/project/index');
    await browser.page.waitForTimeout(2000);
    assert.ok(token, 'token');

    const bundle = await fetchProjectBridgeBundle(browser.page, token, PROJECT_ID);
    assert.strictEqual(bundle.orders.ok, true, `getAllOrder: ${bundle.orders.msg}`);
    assert.strictEqual(bundle.artifacts.ok, true, `getProjectArtifacts: ${bundle.artifacts.msg}`);
    assert.strictEqual(bundle.plans.ok, true, `getPlans: ${bundle.plans.msg}`);
    assert.ok(bundle.orders.list.length > 0, 'orders not empty');
    assert.ok(bundle.artifacts.list.length > 0, 'artifacts not empty');
    assert.ok(bundle.plans.list.length > 0, 'plans not empty');
    assert.ok(bundle.schedulingToPlan.size > 0, 'scheduling map not empty');

    const order = mapOrderRow(bundle.orders.list[0]);
    const artifact = mapArtifactRow(bundle.artifacts.list[0]);
    assert.ok(order.order_id, 'order_id');
    assert.ok(artifact.dwyun_artifact_id, 'dwyun_artifact_id');
    assert.ok(artifact.order_id, 'artifact.order_id');
    assert.ok(artifact.scheduling_id, 'scheduling_id');
    assert.ok(artifact.component_guid, 'component_guid');

    const plan = bundle.schedulingToPlan.get(artifact.scheduling_id);
    assert.ok(plan && plan.plan_id, 'scheduling_id maps to plan_id');

    console.log(JSON.stringify({
        projectId: PROJECT_ID,
        orders: bundle.orders.list.length,
        artifacts: bundle.artifacts.list.length,
        plans: bundle.plans.list.length,
        schedulingMapSize: bundle.schedulingToPlan.size,
        sampleOrder: order,
        sampleArtifact: artifact,
        samplePlanMapping: plan
    }, null, 2));

    await browser.closeBrowser();
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
