const fs = require('fs');
const path = require('path');

const config = require('./config/default.json');
const BrowserAutomation = require('./src/browser-automation');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function gotoWithRelogin(browserAutomation, url) {
  const page = browserAutomation.page;
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  if (page.url().includes('/login')) {
    const ok = await browserAutomation.login();
    if (!ok) throw new Error(`重新登录失败：${url}`);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function clickControlNearText(page, labelText) {
  const candidates = [
    `xpath=//*[normalize-space()="${labelText}：" or normalize-space()="${labelText}:"]/following-sibling::*[1]`,
    `xpath=//*[contains(normalize-space(),"${labelText}：") or contains(normalize-space(),"${labelText}:")]/following-sibling::*[1]`,
    `xpath=//*[normalize-space()="${labelText}"]/following-sibling::*[1]`
  ];
  for (const selector of candidates) {
    const el = page.locator(selector).first();
    try {
      await el.waitFor({ state: 'visible', timeout: 3000 });
      await el.click({ force: true });
      return;
    } catch {}
  }
}

async function clickFormControlByLabel(page, labelText) {
  const label = page.locator(`.el-form-item__label:has-text("${labelText}")`).first();
  try {
    await label.waitFor({ state: 'visible', timeout: 2000 });
    const item = label.locator('..');
    const control = item.locator('.el-form-item__content').first();
    await control.click({ force: true });
  } catch {
    await clickControlNearText(page, labelText);
  }
}

async function selectDropdownOption(page, optionText) {
  const candidates = page.locator('.el-select-dropdown__item span').filter({ hasText: optionText });
  await candidates.first().waitFor({ state: 'attached', timeout: 15000 });
  const count = await candidates.count();
  for (let i = 0; i < count; i++) {
    const span = candidates.nth(i);
    if (await span.isVisible()) {
      await span.click({ force: true });
      return;
    }
  }
  const liFallback = page.locator('.el-select-dropdown__item').filter({ hasText: optionText }).first();
  await liFallback.waitFor({ state: 'visible', timeout: 15000 });
  await liFallback.click({ force: true });
}

async function selectCascaderCheckboxByText(page, optionText) {
  const labelSelector = '.el-cascader-panel .el-cascader-node__label';
  const nodeLabel = page.locator(labelSelector).filter({ hasText: new RegExp(`^\\s*${escapeRegExp(optionText)}\\s*$`) }).first();
  await nodeLabel.waitFor({ state: 'visible', timeout: 15000 });
  const node = nodeLabel.locator('xpath=ancestor::li[contains(@class,"el-cascader-node")][1]').first();
  const checkboxInner = node.locator('.el-checkbox__inner').first();
  try {
    await checkboxInner.waitFor({ state: 'visible', timeout: 2000 });
    await checkboxInner.click({ force: true });
  } catch {
    await nodeLabel.click({ force: true });
  }
}

async function setDateRangeByLabel(page, labelText, startYmd, endYmd) {
  const startInput = page.locator('input[placeholder="开始日期"]').first();
  const endInput = page.locator('input[placeholder="结束日期"]').first();
  try {
    await startInput.waitFor({ state: 'visible', timeout: 3000 });
    await endInput.waitFor({ state: 'visible', timeout: 3000 });
    for (const [input, value] of [[startInput, startYmd], [endInput, endYmd]]) {
      try {
        await input.fill(value);
      } catch {
        await page.evaluate(el => el.removeAttribute('readonly'), await input.elementHandle());
        await input.fill(value);
      }
    }
    await endInput.press('Enter');
    return;
  } catch {}

  await clickControlNearText(page, labelText);
  const inputs = page.locator('.el-date-editor input');
  for (const [idx, value] of [[0, startYmd], [1, endYmd]]) {
    const input = inputs.nth(idx);
    try {
      await input.fill(value);
    } catch {
      await page.evaluate(el => el.removeAttribute('readonly'), await input.elementHandle());
      await input.fill(value);
    }
  }
  await inputs.nth(1).press('Enter');
}

async function captureRequests(page, tag, action) {
  const logs = [];
  const onRequest = req => {
    try {
      const type = req.resourceType();
      if (!['xhr', 'fetch'].includes(type)) return;
      logs.push({
        tag,
        method: req.method(),
        url: req.url(),
        resourceType: type,
        headers: req.headers(),
        postData: req.postData()
      });
    } catch {}
  };
  page.on('request', onRequest);
  try {
    await action();
    await page.waitForTimeout(5000);
  } finally {
    page.off('request', onRequest);
  }
  return logs;
}

async function main() {
  const outDir = path.join(__dirname, 'logs');
  ensureDir(outDir);

  const browserAutomation = new BrowserAutomation(config);
  const started = await browserAutomation.launchBrowser();
  if (!started) throw new Error('浏览器启动失败');

  try {
    const ok = await browserAutomation.login();
    if (!ok) throw new Error('登录失败');
    const page = browserAutomation.page;
    const allLogs = [];

    const subworkUrl = config.website.subworkStatisticsUrl;
    await gotoWithRelogin(browserAutomation, subworkUrl);
    const subworkLogs = await captureRequests(page, 'subwork_statistics', async () => {
      await clickFormControlByLabel(page, '统计部门');
      await selectCascaderCheckboxByText(page, '钢结构厂');
      await page.keyboard.press('Escape');
      await clickFormControlByLabel(page, '工序');
      await selectDropdownOption(page, '装焊报检');
      await setDateRangeByLabel(page, '时间范围', '2026-03-26', '2026-04-25');
      const queryBtn = page.locator('button:has-text("查询")').first();
      await queryBtn.click();
    });
    allLogs.push(...subworkLogs);

    const orderUrl = config.website.orderHistoryUrl;
    await gotoWithRelogin(browserAutomation, orderUrl);
    const orderLogs = await captureRequests(page, 'order_history', async () => {
      await clickFormControlByLabel(page, '构件状态');
      await selectDropdownOption(page, '已出库');
      await setDateRangeByLabel(page, '日期范围', '2026-03-26', '2026-04-25');
      const queryBtn = page.locator('button:has-text("查询")').first();
      await queryBtn.click();
    });
    allLogs.push(...orderLogs);

    const savePath = path.join(outDir, `captured_shoufacun_apis_${Date.now()}.json`);
    fs.writeFileSync(savePath, JSON.stringify(allLogs, null, 2), 'utf8');
    console.log(savePath);
    console.log(JSON.stringify(allLogs.map(x => ({
      tag: x.tag,
      method: x.method,
      url: x.url
    })), null, 2));
  } finally {
    await browserAutomation.closeBrowser();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
