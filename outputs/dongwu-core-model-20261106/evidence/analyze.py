"""Summarize existing and new read evidence for the core business model."""
from pathlib import Path
import collections, datetime, json, re
P=Path(__file__).resolve().parent;ROOT=P.parents[2]
load=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
def save(name,data):(P/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
mapping=load(P/'mapping.json');identity=load(P/'identity.json');config=load(P/'configuration.json');features=load(P/'feature-pages.json')
zone=datetime.timezone(datetime.timedelta(hours=8))
summaries=[];mismatches=[]
for i in range(0,len(mapping['requests']),2):
    head=mapping['requests'][i]['data'];data=mapping['requests'][i+1]['data'];rows=data['samples'];counts=collections.Counter()
    for j,x in enumerate(rows):
        nodes=x['process_items'];end=next((n for n in nodes if str(n['id'])==str(x['node_end'])),{})
        coating=next((n for n in nodes if n['name']=='涂装'),{})
        epoch=datetime.datetime.fromtimestamp(x['complete_time'],zone).strftime('%Y-%m-%d %H:%M:%S') if x['complete_time'] else None
        counts['isComplete']+=x['is_complete']==1;counts['coatingCompleted']+=coating.get('completed')==1
        counts['everyGraphNodeCompleted']+=all(n.get('completed')==1 for n in nodes)
        if x['complete_time'] and end.get('time'):
            counts['timedRows']+=1;counts['completionTimeEqualsEndNodeTime']+=epoch==end['time']
            if epoch!=end['time']:mismatches.append({'pointer':f'mapping.json#/requests/{i+1}/data/samples/{j}','id':x['id'],'completeTime':x['complete_time'],'completeTimeAtUTC8':epoch,'nodeEnd':x['node_end'],'endNodeTime':end['time']})
    summaries.append({'planId':head['id'],'designId':head['design_id'],'name':head['name'],'headerPointer':f'mapping.json#/requests/{i}/data',
                      'rowsPointer':f'mapping.json#/requests/{i+1}/data','returned':data['totalReturned'],'saved':len(rows),'counts':dict(counts),
                      'nodeEnds':dict(collections.Counter(str(x['node_end']) for x in rows)),
                      'features':dict(collections.Counter(x['生产特征'] for x in rows)),
                      'isChange':head['is_change'],'memberChangeValues':sorted({str(x['change']) for x in rows}),
                      'orderIds':dict(collections.Counter(str(x['order_id']) for x in rows))})
joins=[]
for mi,oi in [(1,0),(3,1),(5,2),(9,3)]:
    source=mapping['requests'][mi]['data']['samples'];order=identity['requests'][oi];target={x['id']:x for x in order['data']['samples']}
    selected=[x for x in source if x['order_id']==order['payload']['id']]
    joins.append({'productionPointer':f'mapping.json#/requests/{mi}/data','orderPointer':f'identity.json#/requests/{oi}/data',
                  'orderId':order['payload']['id'],'checkedRows':len(selected),'matchedIds':sum(x['order_artifacts_id'] in target for x in selected),
                  'matchedGuids':sum(x['order_artifacts_id'] in target and x['guid']==target[x['order_artifacts_id']]['guid'] for x in selected)})
old=load(ROOT/'outputs/dongwu-ontology-exploration-20261106/evidence/details.json')['requests'][13]['data']['samples']
legacy={'source':'outputs/dongwu-ontology-exploration-20261106/evidence/details.json#/requests/13/data','planId':163,'rows':len(old),
        'completed':sum(x['is_complete']==1 for x in old),'zeroCompleteTime':sum(x['complete_time']==0 for x in old),
        'coatingCompleted':sum(any(n['name']=='涂装' and n.get('completed')==1 for n in x['process_items']) for x in old)}
graph=json.loads(mapping['requests'][10]['data']['design_info'])
node_configs=[{'id':n['id'],'name':n['name'],'features_codes':n.get('features_codes',[])} for n in graph['nodeList']]
fresh={str(r['payload']['id']):{'pointer':f'feature-pages.json#/requests/{i}/data','count':r['data']['count'],'saved':len(r['data']['list']),
                              'savedCodes':[x['code'] for x in r['data']['list']], 'complete':len(r['data']['list'])==r['data']['count']} for i,r in enumerate(features['requests']) if r['apiPath']=='/v1.design/getManageFeatures'}
requests=[]
for name in ['mapping','identity','configuration-pages','feature-pages','configuration']:
    phase=load(P/(name+'.json'))
    for i,r in enumerate(phase['requests']):requests.append({'file':name+'.json','pointer':f'/requests/{i}',**{k:r[k] for k in ['apiPath','payload','httpStatus','code']}})
result={'newRequestCount':len(requests),'newDistinctPaths':sorted({r['apiPath'] for r in requests}),'plans':summaries,'timeMismatches':mismatches,
        'identityJoins':joins,'legacyCounterexample':legacy,'processCatalogCount':config['requests'][0]['data']['count'],
        'featureCatalogCount':config['requests'][1]['data']['count'],'plan9097FeatureConfiguration':node_configs,'liveNodeFeatureLists':fresh,
        'blockedSupplement':{'queriesFile':'node-features-queries.json','plannedRequests':4,'executedRequests':0,'reason':'Automatic permission approval review timed out twice; no process launched; no response file created.'}}
save('analysis-summary.json',result);save('request-index.json',requests)
print(json.dumps({k:result[k] for k in ['newRequestCount','newDistinctPaths','plans','timeMismatches','identityJoins','legacyCounterexample']},ensure_ascii=False,indent=2))
