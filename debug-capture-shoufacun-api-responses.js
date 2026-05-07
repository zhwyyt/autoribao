const fs = require('fs');
const path = require('path');

const config = require('./config/default.json');
const BrowserAutomation = require('./src/browser-automation');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
}

async function captureResponse(page, urlPart, action) {
  let captured = null;
  const handler = async (response) => {
    try {
      const url = response.url();
      if (!url.includes(urlPart)) return;
      const req = response.request();
      let body = null;
      try {
        body = await response.json();
      } catch {
        try {
          body = await response.text();
        } catch {
          body = null;
        }
      }
      captured = {
        url,
        status: response.status(),
        method: req.method(),
        postData: req.postData(),
        body
      };
    } catch {}
  };
  page.on('response', handler);
  try {
    await action();
    const start = Date.now();
    while (!captured && Date.now() - start < 15000) {
      await page.waitForTimeout(250);
    }
    return captured;
  } finally {
    page.off('response', handler);
  }
}

async function main() {
  ensureDir(path.join(__dirname, 'logs'));
  const browserAutomation = new BrowserAutomation(config);
  const started = await browserAutomation.launchBrowser();
  if (!started) throw new Error('浏览器启动失败');
  try {
    const ok = await browserAutomation.login();
    if (!ok) throw new Error('登录失败');
    const page = browserAutomation.page;

    await gotoWithRelogin(browserAutomation, config.website.subworkStatisticsUrl);
    const subwork = await captureResponse(page, '/v1.statistical/getStatisticalDays', async () => {
      await clickFormControlByLabel(page, '统计部门');
      await selectCascaderCheckboxByText(page, '钢结构厂');
      await page.keyboard.press('Escape');
      await clickFormControlByLabel(page, '工序');
      await selectDropdownOption(page, '装焊报检');
      await setDateRangeByLabel(page, '时间范围', '2026-03-26', '2026-04-25');
      await page.locator('button:has-text("查询")').first().click();
    });

    await gotoWithRelogin(browserAutomation, config.website.orderHistoryUrl);
    const delivery = await captureResponse(page, '/v1.order/getDeliveryHistory', async () => {
      await clickFormControlByLabel(page, '构件状态');
      await selectDropdownOption(page, '已出库');
      await setDateRangeByLabel(page, '日期范围', '2026-03-26', '2026-04-25');
      await page.locator('button:has-text("查询")').first().click();
    });

    const out = { subwork, delivery };
    const savePath = path.join(__dirname, 'logs', `captured_shoufacun_api_responses_${Date.now()}.json`);
    fs.writeFileSync(savePath, JSON.stringify(out, null, 2), 'utf8');
    console.log(savePath);
    console.log(JSON.stringify({
      subwork: subwork ? {
        status: subwork.status,
        postData: subwork.postData,
        bodyKeys: subwork.body && typeof subwork.body === 'object' ? Object.keys(subwork.body) : null
      } : null,
      delivery: delivery ? {
        status: delivery.status,
        postData: delivery.postData,
        bodyKeys: delivery.body && typeof delivery.body === 'object' ? Object.keys(delivery.body) : null
      } : null
    }, null, 2));
  } finally {
    await browserAutomation.closeBrowser();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
