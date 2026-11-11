"""Verify the core-model evidence and preservation without touching the application."""
import ast, collections, datetime, hashlib, json, pathlib, re, subprocess
P=pathlib.Path(__file__).resolve().parent;OUT=P.parent;ROOT=P.parents[2]
load=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
checks=[]
def check(name,ok,detail=None):checks.append({'name':name,'passed':bool(ok),'detail':detail})
def pointer(obj,path):
    for k in path.strip('/').split('/'):
        k=k.replace('~1','/').replace('~0','~');obj=obj[int(k)] if isinstance(obj,list) else obj[k]
    return obj
(P/'verification.json').write_text('{"status":"running"}',encoding='utf-8')
baseline=load(P/'baseline-hashes.json');changed=[k for k,v in baseline.items() if not (ROOT/k).is_file() or hashlib.sha256((ROOT/k).read_bytes()).hexdigest()!=v]
check('All 324 baseline files preserved',len(baseline)==324 and not changed,changed)
git=subprocess.run(['git','-c','core.quotepath=false','status','--porcelain=v1'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
check('Existing git status unchanged',git.returncode==0 and git.stdout.splitlines()==(P/'initial-git-status.txt').read_text(encoding='utf-8-sig').splitlines())
data={f.name:load(f) for f in P.glob('*.json')};check('All JSON parses',True,len(data))
index=data['request-index.json'];check('26 successful read responses across seven paths',len(index)==26 and len({x['apiPath'] for x in index})==7 and all(x['httpStatus']==200 and x['code']==0 and re.fullmatch(r'/v[12]\.[a-z]+/get[A-Za-z]+',x['apiPath']) for x in index))
check('Every request pointer matches recorded API and payload',all(pointer(data[x['file']],x['pointer'])['apiPath']==x['apiPath'] and pointer(data[x['file']],x['pointer'])['payload']==x['payload'] for x in index))
m=data['mapping.json']['requests'];orders=data['identity.json']['requests'];summary=data['analysis-summary.json']
check('454 production rows fully saved',sum(len(m[i]['data']['samples']) for i in [1,3,5,7,9,11])==454 and all(len(m[i]['data']['samples'])==m[i]['data']['totalReturned'] for i in [1,3,5,7,9,11]))
check('75 order rows fully saved',sum(len(r['data']['samples']) for r in orders)==75 and all(len(r['data']['samples'])==r['data']['totalReturned'] for r in orders))
joins=[]
for mi,oi in [(1,0),(3,1),(5,2),(9,3)]:
    req=orders[oi];target={x['id']:x for x in req['data']['samples']}
    for x in m[mi]['data']['samples']:
        if x['order_id']==req['payload']['id']:joins.append(x['order_artifacts_id'] in target and x['guid']==target[x['order_artifacts_id']]['guid'])
check('75 explicit source joins match GUID',len(joins)==75 and all(joins))
fxc=m[11]['data']['samples'];check('27 fxc rows complete coating without flaw completion',len(fxc)==27 and all(x['生产特征']=='fxc' and x['is_complete']==1 and any(n['name']=='涂装' and n.get('completed')==1 for n in x['process_items']) and any(n['name']=='装焊探伤' and n.get('completed')!=1 for n in x['process_items']) for x in fxc))
flaw=data['feature-pages.json']['requests'][1]['data'];check('Live flaw association completely excludes FXC',flaw['count']==len(flaw['list'])==4 and {x['code'] for x in flaw['list']}=={'GJG','lsx','zh','PEC'})
coat=data['feature-pages.json']['requests'][3]['data'];body=data['feature-pages.json']['pages'][1]['bodyText'];check('Coating partial JSON and complete page scope disclosed',coat['count']==coat['returnedListLength']==6 and len(coat['list'])==5 and all(code in body for code in ['GJG','lsx','zh','FXC','ZFJ','WX']))
cfg=data['configuration.json']['requests'];check('Process and feature catalogs fully retained',cfg[0]['data']['count']==len(cfg[0]['data']['list'])==8 and cfg[1]['data']['count']==len(cfg[1]['data']['list'])==9)
line=m[7]['data']['samples'];check('259 pipeline completions end at transfer not coating',len(line)==259 and all(x['is_complete']==1 and x['node_end']==45 and all(n['name']!='涂装' for n in x['process_items']) for x in line))
pending=m[1]['data']['samples'];check('20 nonempty coating display values are not completions',len(pending)==20 and all(x['is_complete']==0 and x['涂装'] and any(n['name']=='涂装' and not n.get('time') and n.get('completed')!=1 for n in x['process_items']) for x in pending))
zone=datetime.timezone(datetime.timedelta(hours=8));normal=[x for i in [3,5,11] for x in m[i]['data']['samples']]
check('29 normal completion times equal coating node times',len(normal)==29 and all(datetime.datetime.fromtimestamp(x['complete_time'],zone).strftime('%Y-%m-%d %H:%M:%S')==next(n['time'] for n in x['process_items'] if n['name']=='涂装') for x in normal))
check('Time mismatch points to actual one-second discrepancy',len(summary['timeMismatches'])==1 and pointer(data['mapping.json'],summary['timeMismatches'][0]['pointer'].split('#')[1])['id']==865391 and summary['timeMismatches'][0]['completeTimeAtUTC8']=='2024-08-22 09:29:33' and summary['timeMismatches'][0]['endNodeTime']=='2024-08-22 09:29:32')
old=load(ROOT/'outputs/dongwu-ontology-exploration-20261106/evidence/details.json')['requests'][13]['data']['samples'];check('87 legacy complete records have zero complete_time',len(old)==87 and all(x['is_complete']==1 and x['complete_time']==0 for x in old))
clar=data['user-clarifications.json'];check('Three clarification rules trace to two user statements',{x['id'] for x in clar['rules']}=={'BR-06','BR-07','BR-08'} and all(x['sourceId'] in {q['id'] for q in clar['quotes']} for x in clar['rules']))
check('Blocked supplement not counted as executed',not (P/'node-features.json').exists() and len(data['node-features-queries.json'])==4 and summary['blockedSupplement']['executedRequests']==0)
broken=[]
for file in OUT.glob('*.md'):
    for link in re.findall(r'\]\(([^)]+)\)',file.read_text(encoding='utf-8')):
        if not link.startswith(('http:','https:','#')) and not (file.parent/link.split('#')[0]).exists():broken.append([file.name,link])
check('All document file links resolve',not broken,broken)
text=(OUT/'review-status.md').read_text(encoding='utf-8');check('20 original verification IDs tracked',all('| VB-'+str(i).zfill(2)+' ' in text for i in range(1,21)))
assets=[a for name in ['configuration-pages.json','feature-pages.json'] for a in data[name]['assets']]
check('Captured frontend asset hashes match',all(hashlib.sha256((P/a['file']).read_bytes()).hexdigest()==a['sha256'] for a in assets))
for file in P.glob('*.py'):ast.parse(file.read_text(encoding='utf-8'))
node=subprocess.run(['node','--check',str(P/'collect.cjs')],capture_output=True,text=True);check('Analysis and collector syntax valid',node.returncode==0)
creds=load(ROOT/'config/default.json')['credentials'];leaks=[]
for file in OUT.rglob('*'):
    if file.is_file():
        txt=file.read_text(encoding='utf-8-sig')
        if any(value and len(value)>3 and value in txt for value in [creds['username'],creds['password']]):leaks.append(str(file.relative_to(OUT)))
check('Configured credentials absent from new files',not leaks,leaks)
result={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed' if all(x['passed'] for x in checks) else 'failed','checksPassed':sum(x['passed'] for x in checks),'checksTotal':len(checks),'checks':checks,
        'limits':['Business confirmations are not empirical verification of legacy write behavior.','No configuration save, production write, or database synchronization was performed.','Four optional supplement requests were not launched due to approval-review timeout.']}
(P/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':result['status'],'passed':result['checksPassed'],'total':len(checks),'failed':[x for x in checks if not x['passed']]},ensure_ascii=False));raise SystemExit(0 if result['status']=='passed' else 1)
