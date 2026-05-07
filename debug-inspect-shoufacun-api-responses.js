const config = require('./config/default.json');
const BrowserAutomation = require('./src/browser-automation');

const API_ORIGIN = 'https://dwyunsc.ddwjzkj.com:10086';
const API_SUBWORK = `${API_ORIGIN}/v1.statistical/getStatisticalDays`;
const API_DELIVERY = `${API_ORIGIN}/v1.order/getDeliveryHistory`;

async function getTokenFromPage(page) {
  try {
    const token = await page.evaluate(() => {
      return (
        window.localStorage.getItem('Token') ||
        window.localStorage.getItem('token') ||
        window.sessionStorage.getItem('Token') ||
        window.sessionStorage.getItem('token') ||
        ''
      );
    });
    return String(token || '').trim();
  } catch {
    return '';
  }
}

async function callApi(page, url, payload) {
  const token = await getTokenFromPage(page);
  if (!token) throw new Error('无法获取 Token');
  const cookies = await page.context().cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const res = await page.request.post(url, {
    data: payload,
    headers: {
      Token: token,
      'Content-Type': 'application/json;charset=utf-8',
      ...(cookieStr ? { Cookie: cookieStr } : {})
    },
    timeout: 60000
  });
  const json = await res.json();
  return { status: res.status(), json };
}

async function main() {
  const browserAutomation = new BrowserAutomation(config);
  const started = await browserAutomation.launchBrowser();
  if (!started) throw new Error('浏览器启动失败');
  try {
    const ok = await browserAutomation.login();
    if (!ok) throw new Error('登录失败');
    const page = browserAutomation.page;

    const subworkPayload = {
      types_id: 0,
      process_id: 42,
      start_time: 1774454400,
      end_time: 1777046400,
      departments: '1,4,60,240,61,96,97,99,146,156,161,249,63,100,101,102,117,127,236,237,239,11,40,131,184,64,247,65,248,69,250,198,38,104,105,106,107,108,109,110,111,112,113,114,115,116,128,130,132,134,135,137,147,166,170,171,179,180,206,207,208,212,214,244,245,246,220,241,242,122,204,243'
    };
    const deliveryPayload = {
      proj_id: 0,
      type: 3,
      start_time: 1774454400,
      end_time: 1777046400
    };

    const [subwork, delivery] = await Promise.all([
      callApi(page, API_SUBWORK, subworkPayload),
      callApi(page, API_DELIVERY, deliveryPayload)
    ]);

    const summarize = ({ status, json }) => {
      const data = json && json.data;
      const list = Array.isArray(data?.list) ? data.list : (
        Array.isArray(data?.data) ? data.data : (
          Array.isArray(data) ? data : []
        )
      );
      return {
        status,
        code: json && json.code,
        msg: json && json.msg,
        dataKeys: data && typeof data === 'object' ? Object.keys(data) : null,
        listCount: list.length,
        firstItemKeys: list[0] && typeof list[0] === 'object' ? Object.keys(list[0]) : null,
        firstItem: list[0] || null
      };
    };

    console.log(JSON.stringify({
      subwork: summarize(subwork),
      delivery: summarize(delivery)
    }, null, 2));
  } finally {
    await browserAutomation.closeBrowser();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
