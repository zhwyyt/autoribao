"""Independent static checks for the delivered inventory; never calls remote services."""
import collections
import hashlib
import json
import re
import subprocess
from pathlib import Path

OUT=Path(__file__).resolve().parent.parent
ROOT=OUT.parent.parent
EV=OUT/'_evidence'
errors=[]
checks={}
def check(name, condition, detail=None):
    checks[name]={'passed':bool(condition),'detail':detail}
    if not condition:errors.append(name)

def read_json(path):return json.loads(path.read_text(encoding='utf-8-sig'))

required=['system-inventory.md','module-map.md','api-business-map.md','entity-catalog.md','entity-relationships.md','business-operations.md','state-machines.md','verification-backlog.md']
check('eight_deliverables',all((OUT/f).is_file() and (OUT/f).stat().st_size>1000 for f in required))
catalog=read_json(EV/'api-catalog.json')
occ=read_json(EV/'endpoint-occurrences.json')
counts=read_json(EV/'counts.json')
doc_paths={k for k,v in occ.items() if any(x['file'].endswith('.md') for x in v)}
src_paths={k for k,v in occ.items() if any(x['file'].startswith('src/') for x in v)}
expected=(doc_paths|src_paths)-{'/v1.order/savePackageArtifact'}
paths=[r['path'] for r in catalog]
check('path_coverage_exact',set(paths)==expected and len(paths)==len(set(paths))==92)
check('raw_path_reconciliation',len(occ)==113 and len(set(occ)-doc_paths-src_paths)==20 and 113==92+20+1)
check('module_counts',dict(collections.Counter(r['module'] for r in catalog))==counts['modules'] and sum(counts['modules'].values())==92)
check('coverage_counts',dict(collections.Counter(r['coverage'] for r in catalog))==counts['coverage'] and sum(counts['coverage'].values())==92)
check('api_table_has_every_id',all(f"| {r['id']} |" in (OUT/'api-business-map.md').read_text(encoding='utf-8') for r in catalog))
bad_refs=[]
for r in catalog:
    for e in r['evidence']:
        p=(OUT if e['file'].startswith('_evidence/') else ROOT)/e['file']
        if not p.is_file():bad_refs.append([r['id'],e,'missing']);continue
        if 'line' in e and not 1<=e['line']<=len(p.read_text(encoding='utf-8-sig').splitlines()):bad_refs.append([r['id'],e,'line'])
        if 'pointer' in e:
            try:
                v=read_json(p)
                for key in e['pointer'].strip('/').split('/'):
                    key=key.replace('~1','/').replace('~0','~')
                    v=v[int(key)] if isinstance(v,list) else v[key]
            except (KeyError,ValueError,IndexError,TypeError):bad_refs.append([r['id'],e,'pointer'])
check('api_evidence_targets',not bad_refs,bad_refs)
bad_occ=[]
line_cache={}
for path, refs in occ.items():
    for e in refs:
        p=ROOT/e['file']
        try:
            if e['file'] not in line_cache:line_cache[e['file']]=p.read_text(encoding='utf-8-sig',errors='replace').splitlines()
            line=line_cache[e['file']][e['line']-1]
        except (OSError,IndexError):bad_occ.append(e);continue
        if path.lstrip('/') not in line:bad_occ.append(e)
check('original_occurrence_lines',not bad_occ,{'references':sum(map(len,occ.values())),'failures':bad_occ[:10]})

bad_links=[]
for filename in required:
    s=(OUT/filename).read_text(encoding='utf-8')
    for link in re.findall(r'\]\(([^)]+)\)',s):
        dest=link.split('#')[0].strip('<>')
        if not dest or re.match(r'https?://',dest):continue
        if dest=='_evidence/verification.json':continue
        if not (OUT/dest).exists():bad_links.append((filename,link))
check('markdown_file_links',not bad_links,bad_links)

baseline=read_json(EV/'baseline-hashes.json')
changed=[f for f,h in baseline.items() if not (ROOT/f).exists() or hashlib.sha256((ROOT/f).read_bytes()).hexdigest()!=h]
check('original_source_document_hashes',not changed,{'files':len(baseline),'changed':changed})
preserved=read_json(EV/'preserved-uncommitted.json')
check('existing_untracked_docx_preserved',hashlib.sha256((ROOT/preserved['file']).read_bytes()).hexdigest()==preserved['sha256'])
status=subprocess.check_output(['git','status','--short'],cwd=ROOT,encoding='utf-8')
initial=(EV/'initial-git-status.txt').read_text(encoding='utf-8')
strip_own=lambda s: sorted(line for line in s.splitlines() if 'dongwu-business-inventory-20261106' not in line)
check('existing_git_status_preserved',strip_own(status)==strip_own(initial),strip_own(status))

live=read_json(EV/'live-readonly.json')
check('live_success',live['outcome']=='completed' and len(live['requests'])==19 and all(r.get('httpStatus')==200 and r.get('code')==0 for r in live['requests']))
check('live_business_queries_readonly',all(re.match(r'^/v1\.(user|project|production|order)/get[A-Z]',r['apiPath']) for r in live['requests']))
by={r['apiPath']:r['data'] for r in live['requests']}
pa=by['/v1.production/getPlanArtifacts']['samples'][0]
oa=by['/v1.order/getOrderArtifacts']['samples'][0]
sch=by['/v1.production/getScheduling'];plan=by['/v1.production/getPlan']
check('identity_chain',pa['order_artifacts_id']==oa['id'] and pa['guid']==oa['guid'] and pa['id']!=oa['id'] and pa['plan_id']==plan['id']==sch['plan_id'] and pa['scheduling_id']==sch['id']==plan['scheduling_id'])
check('node_success_is_not_completion',any(x.get('state')=='success' and not x.get('completed') for x in pa['process_items']))
check('task_plan_sample_identity',by['/v1.production/getTasks']['list'][0]['id']==plan['id'])
pkg=by['/v1.order/getPackageInfo'];de=by['/v1.order/getDeliverys']['list'][0];members=by['/v1.order/getPackageArtifacts']
check('package_delivery_sample',pkg['delivery_id']==de['id'] and members['totalReturned']==pkg['artifacts_count']==26 and de['artifacts_count']==27)
bad_secret=[]
def secrets(v,at=''):
    if isinstance(v,dict):
        for k,x in v.items():
            if re.search(r'token|password|mobile|recipient_tel|account|phone|tel$|address',k,re.I) and x!='[REDACTED]':bad_secret.append(at+'/'+k)
            secrets(x,at+'/'+k)
    elif isinstance(v,list):
        for i,x in enumerate(v):secrets(x,at+'/'+str(i))
secrets(live)
check('live_sensitive_fields_redacted',not bad_secret,bad_secret)
text_leaks=[]
for f in [*(OUT.glob('*.md')),EV/'live-readonly.json']:
    if re.search(r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+',f.read_text(encoding='utf-8')):text_leaks.append(f.name)
check('no_jwt_in_delivery',not text_leaks,text_leaks)
report={'passed':not errors,'checks':checks,'failedChecks':errors,'scope':'static evidence/document verification; no original project tests or remote writes executed'}
(EV/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':not errors,'checks':len(checks),'failedChecks':errors},ensure_ascii=False))
raise SystemExit(1 if errors else 0)
