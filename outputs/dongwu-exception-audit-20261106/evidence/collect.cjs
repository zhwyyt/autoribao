// Standalone read-only analysis session. Original application files are not modified.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../..');
const config=require(path.join(root,'config/default.json'));
const loggerPath=require.resolve(path.join(root,'src/logger.js'));
require.cache[loggerPath]={id:loggerPath,filename:loggerPath,loaded:true,exports:Object.fromEntries(['info','warn','error','success','debug'].map(k=>[k,()=>{}]))};
const Browser=require(path.join(root,'src/browser-automation.js'));
const phase=process.argv[2]||'pages';
const result={phase,startedAt:new Date().toISOString(),pages:[],requests:[],assets:[]};
const file=path.join(__dirname,phase+'.json');
const save=()=>{const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(result,null,2));fs.renameSync(temp,file);};
let token='';
function redact(v,k=''){
 if(/token|password|account|mobile|phone|tel$|address|recipient$|vehicle|construction_openid|avatar|introduce|director_name|inspection_user_name|flaw_user_name|responsible_name/i.test(k))return '[REDACTED]';
 if(Array.isArray(v))return v.map(x=>redact(x));
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([a,b])=>[a,redact(b,a)]));
 if(typeof v==='string'){
  for(const secret of [token,config.credentials.username,config.credentials.password])if(secret&&secret.length>3)v=v.split(secret).join('[REDACTED]');
  return v;
 }
 return v;
}
function compact(data,limit=20){
 if(Array.isArray(data))return {totalReturned:data.length,samples:redact(data.slice(0,limit))};
 if(data&&typeof data==='object'){
  const v={...data};if(Array.isArray(v.list)){v.returnedListLength=v.list.length;v.list=v.list.slice(0,limit);}return redact(v);
 }return redact(data);
}
async function main(){
 const b=new Browser({...config,browser:{...config.browser,headless:true,slowMo:0,timeout:20000}});
 const jobs=[];const seenAssets=new Set();let activeRoute='login';
 try{
  if(!await b.launchBrowser())throw Error('Browser launch failed');
  const ua=await b.page.evaluate(()=>navigator.userAgent);
  await b.context.close();b.context=await b.browser.newContext({userAgent:ua.replace('HeadlessChrome/','Chrome/')});b.page=await b.context.newPage();b.page.setDefaultTimeout(15000);
  b.page.on('request',r=>{if(r.url().includes('dwyunsc.ddwjzkj.com:10086'))token=r.headers().token||token;});
  if(!await b.login())throw Error('Login failed');
  await b.page.goto(new URL('/project/index',config.website.loginUrl).href,{waitUntil:'networkidle',timeout:30000});
  if(!token)throw Error('No API token');
  async function query(apiPath,payload,limit=20){
   if(!/^\/v[12]\.[a-z]+\/(get[A-Z]|search[A-Z])/.test(apiPath))throw Error('Query allowlist rejected '+apiPath);
   const r={apiPath,method:'POST',payload:redact(payload),capturedAt:new Date().toISOString()};
   try{
    const res=await b.page.request.post('https://dwyunsc.ddwjzkj.com:10086'+apiPath,{data:payload,headers:{Token:token},timeout:30000});r.httpStatus=res.status();
    const body=await res.json();r.code=body.code;r.msg=body.msg;r.data=compact(body.data,limit);
    if(phase==='catalog'&&body.data&&Array.isArray(body.data.list)){
     const fields=['id','project_id','scheduling_id','name','code','artifacts_count','production_status','production_status_name','state','status','state_name','category','type','is_change','design_id','create_time','update_time'];
     r.responseSha256=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
     r.projectionFields=fields;r.data={...body.data,list:body.data.list.map(x=>Object.fromEntries(fields.filter(k=>k in x).map(k=>[k,redact(x[k],k)]))),returnedListLength:body.data.list.length};
    }
    result.requests.push(r);save();console.log(apiPath,JSON.stringify(payload),'code',r.code);
    return body.code===0?body.data:null;
   }catch(e){r.error=redact(String(e.message).split('\n')[0]);if(!result.requests.includes(r))result.requests.push(r);save();return null;}
  }
  if(phase==='catalog'){
   const common={department:0,proj_id:0,keyword:'',production_status:-1,start_time:0,end_time:0,code:'',page:1,size:500};
   for(const [apiPath,extra] of [['/v1.production/getPlans',{create_user:0}],['/v1.production/getTasks',{model:'all'}]]){
    let seen=0;
    for(let page=1;page<=30;page++){
     const data=await query(apiPath,{...common,...extra,page},500);
     if(!data||!Array.isArray(data.list))throw Error('List query failed');
     seen+=data.list.length;if(!data.list.length||seen>=data.count)break;
     if(page===30)throw Error('Pagination cap reached');
    }
   }
  } else if(['pdfs','pdf-visuals'].includes(phase)){
   for(const id of [8514,8513,8512]){
    const url='https://dwyunsc.ddwjzkj.com:10086/delivery/info?id='+id;
    const res=await b.page.request.get(url,{headers:{Token:token},timeout:60000});
    const buf=await res.body();const entry={id,url,httpStatus:res.status(),contentType:res.headers()['content-type'],bytes:buf.length,sha256:crypto.createHash('sha256').update(buf).digest('hex')};
    if(buf.subarray(0,4).toString('ascii')==='%PDF'){
     const python=phase==='pdf-visuals'?'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe':'python';
     const args=[path.join(__dirname,'pdf_evidence.py')];if(phase==='pdf-visuals')args.push(__dirname,String(id));
     const extracted=require('child_process').spawnSync(python,args,{input:buf,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
     if(extracted.status!==0)throw Error('PDF extraction failed: '+extracted.stderr.slice(0,250));
     entry.extraction=redact(JSON.parse(extracted.stdout));
    }else entry.error='Response not PDF';
    result.requests.push(entry);save();console.log('PDF',id,entry.httpStatus,entry.bytes);
   }
  } else if(phase.endsWith('pages')){
   fs.mkdirSync(path.join(__dirname,'frontend'),{recursive:true});
   b.page.on('response',res=>{
    const url=res.url(),route=activeRoute;
    if(url.includes('dwyunsc.ddwjzkj.com:10086/v')&&/^\/v[12]\./.test(new URL(url).pathname)){
     jobs.push((async()=>{try{const body=await res.json();const req=res.request();let payload=req.postData();try{payload=JSON.parse(payload);}catch{}result.requests.push({route,apiPath:new URL(url).pathname,method:req.method(),payload:redact(payload),httpStatus:res.status(),code:body.code,msg:body.msg,data:compact(body.data,5)});save();}catch{}})());
    }
    if(url.startsWith(new URL(config.website.loginUrl).origin)&&/\.js(?:\?|$)/.test(url)&&!/(vendor|jquery|polyfill)/i.test(url)&&!seenAssets.has(url)){
     seenAssets.add(url);jobs.push((async()=>{try{const text=await res.text();const name=crypto.createHash('sha256').update(url).digest('hex').slice(0,12)+'.js';fs.writeFileSync(path.join(__dirname,'frontend',name),text);result.assets.push({url,file:'frontend/'+name,sha256:crypto.createHash('sha256').update(text).digest('hex'),route});save();}catch{}})());
    }
   });
   const routes=phase==='pages'?['/production/plan','/production/task','/production/index','/order/package','/order/delivery','/order/history','/process/inspection','/design/process']:JSON.parse(fs.readFileSync(path.join(__dirname,phase+'-routes.json'),'utf8'));
   for(const route of routes){
    activeRoute=route;const item={route,capturedAt:new Date().toISOString()};
    try{const res=await b.page.goto(new URL(route,config.website.loginUrl).href,{waitUntil:'networkidle',timeout:30000});item.httpStatus=res.status();item.finalUrl=b.page.url();item.title=await b.page.title();item.bodyText=redact((await b.page.locator('body').innerText()).slice(0,35000));item.inputs=await b.page.locator('input').evaluateAll(nodes=>nodes.map(x=>({type:x.type,placeholder:x.placeholder,value:x.type==='password'?'[REDACTED]':x.value})));item.buttons=await b.page.locator('button').allTextContents();}
    catch(e){item.error=String(e.message).split('\n')[0];}
    result.pages.push(item);save();console.log('PAGE',route,item.title||item.error);
   }
   await Promise.allSettled(jobs);
  } else {
   const jobsPath=path.join(__dirname,phase+'-queries.json');
   const queries=JSON.parse(fs.readFileSync(jobsPath,'utf8'));
   for(const q of queries)await query(q.apiPath,q.payload,q.limit||20);
  }
  result.outcome='completed';
 }catch(e){result.outcome='blocked';result.error=redact(String(e.message).split('\n')[0]);console.log(result.error);}
 finally{await b.closeBrowser();result.finishedAt=new Date().toISOString();save();}
}
main();
