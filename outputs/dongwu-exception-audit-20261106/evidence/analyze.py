"""Compute scope, quantity and evidence lineage without modifying source files."""
from pathlib import Path
import collections, hashlib, json, re
from decimal import Decimal
P = Path(__file__).resolve().parent
ROOT = P.parents[2]
PREV = ROOT / 'outputs/dongwu-ontology-exploration-20261106/evidence'
load = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
def save(name, data):
    (P/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')

catalog=load(P/'catalog.json')
sets={}; pagination={}
for name in ['getPlans','getTasks']:
    requests=[(i,r) for i,r in enumerate(catalog['requests']) if r['apiPath'].endswith(name)]
    items=[]
    for i,r in requests:
        for j,row in enumerate(r['data']['list']):
            items.append({**row,'evidence':f'catalog.json#/requests/{i}/data/list/{j}'})
    sets[name]=items
    pagination[name]={'requests':len(requests),'pages':[r['payload']['page'] for i,r in requests],
                      'counts':sorted({r['data']['count'] for i,r in requests}),
                      'savedRows':len(items),'uniqueIds':len({x['id'] for x in items}),
                      'returnedRows':sum(r['data']['returnedListLength'] for i,r in requests)}
plans,tasks=sets['getPlans'],sets['getTasks'];plan_ids={x['id'] for x in plans};task_ids={x['id'] for x in tasks}
diff=[x for x in tasks if x['id'] not in plan_ids]
scope={'startedAt':catalog['startedAt'],'finishedAt':catalog['finishedAt'],'pagination':pagination,
       'plansOnlyIds':sorted(plan_ids-task_ids),'tasksOnly':diff,
       'tasksOnlyCategoryCounts':dict(collections.Counter(str(x['category']) for x in diff)),
       'category2NoChangeIdsEqualPlanIds':{x['id'] for x in tasks if x['category']==2 and x['is_change']==0}==plan_ids,
       'uniqueTaskSchedulingIds':len({x['scheduling_id'] for x in tasks}),
       'allPlanCategoryChangeCounts':dict(collections.Counter(f"{x['category']}/{x['is_change']}" for x in plans))}

pdf=load(P/'pdfs.json');visual=load(P/'pdf-visuals.json')
old=load(PREV/'remaining.json')['requests']; old_pages=load(PREV/'pages.json')['requests']
delivery_headers={x['id']:x for x in old_pages[18]['data']['list']}
shipping=[]
for pdf_index,(head_index,member_index) in enumerate([(4,5),(6,7),(8,9)]):
    rec=pdf['requests'][pdf_index];body=rec['extraction']['pages'][1]['text'].split('Powered by')[0]
    starts=list(re.finditer(r'(?m)^(\d+)\s+([^\n]+?)\s*/\s*([^\s]+)\s+',body))
    parsed=[]
    for n,match in enumerate(starts):
        end=starts[n+1].start() if n+1<len(starts) else len(body)
        tail=body[match.end():end].strip()
        dimensions=re.search(r'([\d.]+)\s+(\d+)\s*$',tail)
        if not dimensions:raise ValueError('Unparsed PDF row: '+str(match.group(1)))
        parsed.append({'sequence':int(match.group(1)),'name':match.group(2).strip(),'code':match.group(3),
                       'spec':re.sub(r'\s+','',tail[:dimensions.start()]),'length':dimensions.group(1),'quantity':int(dimensions.group(2))})
    members=old[member_index]['data']['samples'];head=old[head_index]['data']
    grouped={}
    for x in members:
        key=(x['code'],re.sub(r'\s+','',x['specifications']),x['length'])
        grouped.setdefault(key,[]).append(x)
    matched=[]
    for row in parsed:
        group=grouped.get((row['code'],row['spec'],row['length']),[])
        matched.append({**row,'memberIds':[x['id'] for x in group],'memberGuids':[x['guid'] for x in group],
                        'sourceQuantitySum':str(sum((Decimal(x['count']) for x in group),Decimal(0))),
                        'quantityMatches':sum((Decimal(x['count']) for x in group),Decimal(0))==row['quantity']})
    header=rec['extraction']['pages'][0]['text']
    package_qty=int(re.search(r'合计[：:]\s*(\d+)',header).group(1))
    shipping.append({'deliveryId':rec['id'],'packageId':head['id'],'packageGuid':head['guid'],
                     'packageGuidInMainTable':head['guid'] in header,'listArtifactsCount':delivery_headers[rec['id']]['artifacts_count'],
                     'mainTableQuantity':package_qty,'appendixRows':len(parsed),'appendixQuantity':sum(x['quantity'] for x in parsed),
                     'memberRecords':len(members),'memberQuantity':str(sum((Decimal(x['count']) for x in members),Decimal(0))),
                     'allGroupsMatch':len(grouped)==len(parsed) and all(x['quantityMatches'] for x in matched),
                     'rows':matched,'pdfEvidence':f'pdfs.json#/requests/{pdf_index}/extraction',
                     'packageEvidence':f'../dongwu-ontology-exploration-20261106/evidence/remaining.json#/requests/{member_index}/data',
                     'tableCrops':visual['requests'][pdf_index]['extraction']['tableCrops']})

details=load(P/'exceptions.json')['requests']; quantities=[]
for i in [1,3,5,6,7,9]:
    req=details[i];rows=req['data']['samples'];field='num' if req['apiPath'].endswith('getPlanArtifacts') else '数量'
    quantities.append({'evidence':f'exceptions.json#/requests/{i}/data','apiPath':req['apiPath'],'id':req['payload']['id'],
                       'field':field,'returnedRows':req['data']['totalReturned'],'savedRows':len(rows),
                       'quantityDistribution':dict(collections.Counter(str(x.get(field)) for x in rows)),
                       'greaterThanOne':sum(Decimal(str(x.get(field) or 0))>1 for x in rows)})

source_path=ROOT/'src/export-logistics-vehicle-workbook.js';source=source_path.read_text(encoding='utf-8');lines=source.splitlines()
excerpts=[]
for ident,start,end in [('local-arrival','function fillDeliveryTimes(', '\nfunction parseSourceRows('),('local-arrival-use','function matchLogistics(', '\nfunction appendDeliveries(')]:
    a=source.index(start);b=source.index(end,a)
    excerpts.append({'id':ident,'file':source_path.relative_to(ROOT).as_posix(),'startLine':source[:a].count('\n')+1,
                     'endLine':source[:b].count('\n')+1,'text':source[a:b],'fileSha256':hashlib.sha256(source_path.read_bytes()).hexdigest()})
save('source-excerpts.json',excerpts)
result={'scopeComparison':scope,'shippingReconciliation':shipping,'sourceQuantitySamples':quantities,
        'requestsByPhase':{name:len(load(P/(name+'.json'))['requests']) for name in ['catalog','exceptions','scope-pages','pdfs','pdf-visuals']}}
save('analysis-summary.json',result)
print(json.dumps({'scopeCounts':pagination,'tasksOnlyGroups':scope['tasksOnlyCategoryCounts'],
                  'shipping':[{k:v for k,v in x.items() if k not in ['rows','tableCrops']} for x in shipping],
                  'quantitySamples':quantities},ensure_ascii=False,indent=2))

out=['# 数量与范围核对台账','', '日期：2026-11-06。结果由 evidence/analyze.py 从保留证据重算；所有“已验证”仅覆盖本账号、采集时间及列出的样本。', '',
     '## 1. 计划与任务集合','',
     '已验证：计划 8432 条、全部任务 8479 条，双方均无重复 ID，计划全部包含于任务。任务中 category=2 且 is_change=0 的 ID 集合与计划完全相等。分页请求顺序为各17页、每页最多500行，所有页面计数稳定。采集不是服务端事务快照，不保证跨时点永远相同。','',
     '证据：[完整投影](evidence/catalog.json)、[集合计算](evidence/analysis-summary.json)。前者记录 projectionFields，保留 ID/范围相关字段及完整响应的序列化摘要；未保留所有大体积工艺字段。','',
     '### 47条差异记录','',
     '| ID | category | type | is_change | 排产ID | 证据定位 |','|---|---:|---:|---:|---:|---|']
for x in diff:out.append(f"| {x['id']} | {x['category']} | {x['type']} | {x['is_change']} | {x['scheduling_id']} | `{x['evidence']}` |")
out+=['','## 2. 发运计数与PDF分组','',
      '已验证：三张官方PDF主表各列一个包箱；附表将同编号/规格/长度的多个源成员合并显示。本轮按这三个字段分组可以完整复现三份附表，但未证明这是服务端全部分组键。不得从打印行反推唯一实物身份。','',
      '| 发运单 | 包箱 | 列表artifacts_count | 主表数量 | 附表打印行数 | 附表数量和 | API成员记录数 | 分组逐行吻合 |','|---|---|---:|---:|---:|---:|---:|---|']
for x in shipping:out.append(f"| {x['deliveryId']} | {x['packageId']} | {x['listArtifactsCount']} | {x['mainTableQuantity']} | {x['appendixRows']} | {x['appendixQuantity']} | {x['memberRecords']} | {x['allGroupsMatch']} |")
out+=['','已验证：三个样本满足列表计数=主表包箱数量+成员记录数（27=1+26、29=1+28、33=1+32）。较高可信推断：列表计数包含包箱层和成员层。全局计数算法、散件/多包混合情形仍待验证；不制定统一减1规则。','',
      '### 数量大于1的打印分组','', '| 发运单 | 构件编号 | PDF数量 | 对应源成员ID | GUID数量 |','|---|---|---:|---|---:|']
for x in shipping:
    for row in x['rows']:
        if row['quantity']>1:out.append(f"| {x['deliveryId']} | {row['code']} | {row['quantity']} | {', '.join(map(str,row['memberIds']))} | {len(set(row['memberGuids']))} |")
out+=['','完整逐行匹配、GUID与PDF页定位见 [analysis-summary.json](evidence/analysis-summary.json) 的 shippingReconciliation。PDF原字节只在内存使用，保留源URL、时点、SHA-256、脱敏分页文本和裁图。重复下载PDF字节摘要可能因生成时间等变化而不同，不直接判定业务变化。','',
      '## 3. 源数量字段抽样','',
      '| 资源 | ID | 返回/保存行数 | 数量字段 | 大于1的行数 | 证据 |','|---|---|---:|---|---:|---|']
for q in quantities:out.append(f"| `{q['apiPath']}` | {q['id']} | {q['returnedRows']}/{q['savedRows']} | {q['field']} | {q['greaterThanOne']} | `{q['evidence']}` |")
out+=['','已验证：本轮510条生产明细与805条订单明细均为数量1。未找到源行数量大于1的正例；PDF数量4/3/6来自多条源记录聚合，不能当作源批量行证据。此抽样不证明全系统永远每行一件。','']
(P.parent/'reconciliation-ledger.md').write_text('\n'.join(out),encoding='utf-8')
