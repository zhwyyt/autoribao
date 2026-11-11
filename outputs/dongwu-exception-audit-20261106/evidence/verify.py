"""Independent checks of evidence completeness, preservation, and claims."""
import ast, collections, datetime, hashlib, json, pathlib, re, subprocess
from decimal import Decimal
P=pathlib.Path(__file__).resolve().parent;OUT=P.parent;ROOT=P.parents[2]
load=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
checks=[]
def check(name,ok,details=None):checks.append({'name':name,'passed':bool(ok),'details':details})
def ptr(obj,path):
    for part in path.strip('/').split('/'):
        part=part.replace('~1','/').replace('~0','~');obj=obj[int(part)] if isinstance(obj,list) else obj[part]
    return obj
(P/'verification.json').write_text('{"status":"running"}',encoding='utf-8')
baseline=load(P/'baseline-hashes.json')
changed=[k for k,v in baseline.items() if not (ROOT/k).is_file() or hashlib.sha256((ROOT/k).read_bytes()).hexdigest()!=v]
check('Original baseline files and both prior deliverables preserved',not changed,{'count':len(baseline),'changed':changed})
git=subprocess.run(['git','-c','core.quotepath=false','status','--porcelain=v1'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
check('Preexisting git status preserved',git.returncode==0 and git.stdout.splitlines()==(P/'initial-git-status.txt').read_text(encoding='utf-8-sig').splitlines(),{'preexistingPermissionWarnings':'Permission denied' in git.stderr})
for file in OUT.rglob('*.json'):load(file)
check('All output JSON parses',True,len(list(OUT.rglob('*.json'))))
summary=load(P/'analysis-summary.json');catalog=load(P/'catalog.json');detail=load(P/'exceptions.json');pages=load(P/'scope-pages.json')
requests=catalog['requests']+detail['requests']+pages['requests']
check('55 JSON responses succeeded across nine read paths',len(requests)==55 and len({r['apiPath'] for r in requests})==9 and all(r['httpStatus']==200 and r['code']==0 for r in requests))
check('Collected JSON business paths are reads',all(re.fullmatch(r'/v[12]\.[a-z]+/get[A-Za-z]+',r['apiPath']) for r in requests))
sets={}
for method,total in [('getPlans',8432),('getTasks',8479)]:
    rr=[r for r in catalog['requests'] if r['apiPath'].endswith(method)]
    rows=[x for r in rr for x in r['data']['list']];sets[method]=rows
    check(method+' pagination complete with unique IDs',len(rr)==17 and [r['payload']['page'] for r in rr]==list(range(1,18)) and len(rows)==len({x['id'] for x in rows})==total and {r['data']['count'] for r in rr}=={total} and all(len(r['data']['list'])==r['data']['returnedListLength'] for r in rr))
    check(method+' projections declared and preserved',all(set(x)<=set(r['projectionFields']) for r in rr for x in r['data']['list']))
a={x['id'] for x in sets['getPlans']};b={x['id'] for x in sets['getTasks']};diff=[x for x in sets['getTasks'] if x['id'] not in a]
check('47 extra tasks and zero plan-only IDs',a<=b and len(b-a)==47)
check('Difference composition matches classification evidence',collections.Counter(x['category'] for x in diff)=={1:40,0:6,2:1} and [x['id'] for x in diff if x['is_change']==1]==[7962])
check('Ordinary plans equal category2 nonchange task set',a=={x['id'] for x in sets['getTasks'] if x['category']==2 and x['is_change']==0})
check('All 8479 current scheduling references are unique',len({x['scheduling_id'] for x in sets['getTasks']})==8479)
check('All 47 row evidence pointers resolve',all(ptr(catalog,x['evidence'].split('#')[1])['id']==x['id'] for x in summary['scopeComparison']['tasksOnly']))
change=pages['requests'][4]
check('Real change page uses is_change=1 and returns7962',change['payload']['is_change']==1 and change['data']['count']==1 and change['data']['list'][0]['id']==7962)
check('PC and unknown labels come from actual details',detail['requests'][0]['data']['category_name']=='PC订单' and detail['requests'][4]['data']['category_name']=='PC订单' and detail['requests'][8]['data']['category_name']=='')
pdf=load(P/'pdfs.json')['requests'];visual=load(P/'pdf-visuals.json')['requests']
check('Six PDF fetches succeeded and extracted two pages each',len(pdf)==len(visual)==3 and all(x['httpStatus']==200 and x['extraction']['pageCount']==2 for x in pdf+visual))
check('PDF page text differs only in whitespace across two extractors',all(re.sub(r'\s+','',u['text'])==re.sub(r'\s+','',v['text']) for x,y in zip(pdf,visual) for u,v in zip(x['extraction']['pages'],y['extraction']['pages'])),{'comparison':'All non-whitespace characters must match; table quantities also visually inspected.'})
check('All six table crop hashes match',all(hashlib.sha256((P/c['file']).read_bytes()).hexdigest()==c['sha256'] for r in visual for c in r['extraction']['tableCrops']))
oldroot=ROOT/'outputs/dongwu-ontology-exploration-20261106/evidence';old=load(oldroot/'remaining.json')['requests'];oldheads=load(oldroot/'pages.json')['requests'][18]['data']['list']
for index,(member_index,expected_rows,expected_qty) in enumerate([(5,23,26),(7,28,28),(9,25,32)]):
    rec=summary['shippingReconciliation'][index];members=old[member_index]['data']['samples'];table=rec['rows']
    check(f"PDF {rec['deliveryId']} groups cover each member once",len(table)==expected_rows and len(members)==expected_qty and sorted(x['id'] for x in members)==sorted(i for row in table for i in row['memberIds']))
    counts={x['id']:Decimal(x['count']) for x in members}
    check(f"PDF {rec['deliveryId']} group quantities reconcile",sum(row['quantity'] for row in table)==expected_qty and all(sum(counts[i] for i in row['memberIds'])==row['quantity'] for row in table) and rec['mainTableQuantity']==1 and rec['listArtifactsCount']==expected_qty+1)
quantity_total=0
for q in summary['sourceQuantitySamples']:
    data=ptr(detail,q['evidence'].split('#')[1]);quantity_total+=len(data['samples'])
    assert len(data['samples'])==data['totalReturned']
    assert all(Decimal(str(x[q['field']]))==1 for x in data['samples'])
check('All 1315 quantity sample records saved without truncation and equal1',quantity_total==1315)
source=load(P/'source-excerpts.json')
check('Source excerpts exactly match preserved local code',all(x['text'] in (ROOT/x['file']).read_text(encoding='utf-8') and hashlib.sha256((ROOT/x['file']).read_bytes()).hexdigest()==x['fileSha256'] for x in source))
broken=[];links=0
for file in OUT.glob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)',file.read_text(encoding='utf-8')):
        if target.startswith(('https:','http:','#')):continue
        links+=1
        if not (file.parent/target.split('#')[0]).exists():broken.append([file.name,target])
check('All document and image links resolve',not broken,{'links':links,'broken':broken})
backlog=(OUT/'verification-progress.md').read_text(encoding='utf-8')
check('All 20 original verification IDs remain tracked',all('| VB-'+str(i).zfill(2)+' ' in backlog for i in range(1,21)))
for file in P.glob('*.py'):ast.parse(file.read_text(encoding='utf-8'))
node=subprocess.run(['node','--check',str(P/'collect.cjs')],capture_output=True,text=True)
check('Standalone scripts syntax passes',node.returncode==0)
secrets=load(ROOT/'config/default.json')['credentials'];leaks=[]
for file in OUT.rglob('*'):
    if file.is_file() and file.suffix!='.png':
        text=file.read_text(encoding='utf-8-sig')
        if any(s and len(s)>3 and s in text for s in [secrets['username'],secrets['password']]):leaks.append(str(file.relative_to(OUT)))
check('Configured credentials absent from text outputs',not leaks,leaks)
check('No unredacted raw PDF persisted in output directory',not list(OUT.rglob('*.pdf')))
result={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed' if all(x['passed'] for x in checks) else 'failed','checksPassed':sum(x['passed'] for x in checks),'checksTotal':len(checks),'checks':checks,
        'limits':['Read-only snapshots do not prove backend write rules or universal lifecycle constraints.','Complete pagination is within this account and collection window, not a transactional database snapshot.','Original PDFs were processed in memory; retained evidence is redacted text, table crops and source metadata.','Business identifiers and names are retained; credential checking is not complete anonymization.']}
(P/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':result['status'],'passed':result['checksPassed'],'total':len(checks),'failed':[x for x in checks if not x['passed']]},ensure_ascii=False))
raise SystemExit(0 if result['status']=='passed' else 1)
