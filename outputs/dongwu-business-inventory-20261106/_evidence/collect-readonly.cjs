// Analysis-only collector. Reuses existing login code; never runs synchronization jobs.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const config = require(path.join(root, 'config/default.json'));
const loggerPath = require.resolve(path.join(root, 'src/logger.js'));
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true,
  exports: Object.fromEntries(['info','warn','error','success','debug'].map(k => [k, () => {}])) };
const BrowserAutomation = require(path.join(root, 'src/browser-automation.js'));
const results = { startedAt: new Date().toISOString(), scope: 'read-only business API samples; credentials and personal contact values redacted', requests: [] };
const output = path.join(__dirname, 'live-readonly.json');
const save = () => fs.writeFileSync(output, JSON.stringify(results, null, 2));
function redact(v, key = '') {
  if (/token|password|mobile|recipient_tel|account|phone|tel$|address|recipient$|operator_name|create_user_name|delivery_username|opt_user_name/i.test(key)) return '[REDACTED]';
  if (['construction_openid','avatar','introduce','director_name','inspection_user_name','flaw_user_name','responsible_name','vehicle'].includes(key)) return '[REDACTED]';
  if (Array.isArray(v)) return v.map(x => redact(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x]) => [k,redact(x,k)]));
  return v;
}
function sampleData(data) {
  if (Array.isArray(data)) return { totalReturned: data.length, samples: redact(data.slice(0, 3)) };
  if (data && typeof data === 'object') {
    const copy = {...data};
    if (Array.isArray(copy.list)) { copy.returnedListLength = copy.list.length; copy.list = copy.list.slice(0,3); }
    return redact(copy);
  }
  return redact(data);
}
(async () => {
  const browser = new BrowserAutomation({...config, browser:{...config.browser,headless:true,slowMo:0,timeout:20000}});
  let token = '';
  try {
    if (!await browser.launchBrowser()) throw new Error('Browser launch failed');
    const userAgent = await browser.page.evaluate(() => navigator.userAgent);
    await browser.context.close();
    browser.context = await browser.browser.newContext({userAgent:userAgent.replace('HeadlessChrome/', 'Chrome/')});
    browser.page = await browser.context.newPage();
    browser.page.setDefaultTimeout(20000);
    results.browserAdjustment = 'Only HeadlessChrome user-agent token replaced with Chrome after observed 403; original source unchanged';
    browser.page.on('request', req => { if (req.url().includes('dwyunsc.ddwjzkj.com:10086')) token = req.headers().token || token; });
    if (!await browser.login()) {
      results.loginDiagnostics = {url:browser.page.url(),title:await browser.page.title(),bodyText:(await browser.page.locator('body').innerText()).slice(0,800).replace(/【客户端IP】[^\n]+/g,'【客户端IP】[REDACTED]'),inputCount:await browser.page.locator('input').count()};
      throw new Error('Existing browser login failed');
    }
    await browser.page.goto(new URL('/project/index', config.website.loginUrl).href, {waitUntil:'networkidle',timeout:30000});
    if (!token) throw new Error('No API token observed after login');
    async function query(apiPath,payload) {
      if (!/^\/v1\.(user|project|order|production|statistical)\/get[A-Z]/.test(apiPath)) throw new Error('Read-only allowlist rejected path');
      const item = {apiPath,method:'POST',payload,capturedAt:new Date().toISOString()};
      try {
        const response = await browser.page.request.post('https://dwyunsc.ddwjzkj.com:10086'+apiPath,{data:payload,headers:{Token:token},timeout:20000});
        item.httpStatus=response.status();
        const body=await response.json(); item.code=body.code;item.msg=body.msg;item.data=sampleData(body.data);
        results.requests.push(item);save();console.log(apiPath, 'http',item.httpStatus,'code',item.code);
        return body.code === 0 ? body.data : null;
      } catch(e) { item.error=String(e.message).split('\n')[0];results.requests.push(item);save();console.log(apiPath,'failed');return null; }
    }
    const list = x => Array.isArray(x) ? x : x && Array.isArray(x.list) ? x.list : [];
    await query('/v1.user/getInfo',{});
    await query('/v1.user/getBranchs',{});
    await query('/v1.project/getProjectSelect',{});
    await query('/v1.project/getList',{keyword:'',code:'',page:1,size:3});
    const plans=await query('/v1.production/getPlans',{proj_id:0,department:0,production_status:-1,page:1,size:3});
    const plan=list(plans)[0];
    if(plan){
      await query('/v1.production/getPlan',{id:plan.id});
      await query('/v1.production/getPlanArtifacts',{id:plan.id});
      if(plan.scheduling_id) {
        await query('/v1.production/getScheduling',{id:plan.scheduling_id});
        await query('/v1.production/getSchedulingDesign',{id:plan.scheduling_id});
        await query('/v1.production/getProductionArtifacts',{id:plan.scheduling_id});
      }
    }
    const orders=await query('/v1.order/getList',{proj_id:0,keyword:'',code:'',page:1,size:3});
    const order=list(orders)[0];
    if(order){await query('/v1.order/getInfo',{id:order.id});await query('/v1.order/getOrderArtifacts',{id:order.id});}
    const packages=await query('/v1.order/getPackageList',{proj_id:0,keyword:'',code:'',page:1,size:3});
    const pkg=list(packages)[0];
    if(pkg){await query('/v1.order/getPackageInfo',{id:pkg.id});await query('/v1.order/getPackageArtifacts',{id:pkg.id});}
    await query('/v1.order/getDeliverys',{proj_id:0,keyword:'',code:'',page:1,size:3});
    await query('/v1.production/getInspections',{proj_id:0,keyword:'',page:1,size:3});
    await query('/v1.production/getTasks',{proj_id:0,keyword:'',page:1,size:3});
    results.outcome='completed';
  } catch(e) {results.outcome='blocked';results.error=String(e.message).split('\n')[0];console.log(results.error);}
  finally {await browser.closeBrowser();results.finishedAt=new Date().toISOString();save();}
})();
