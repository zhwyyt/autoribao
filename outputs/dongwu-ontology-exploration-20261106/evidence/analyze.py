"""Reproduce read-only exploration findings. Writes only this evidence directory."""
import collections
import hashlib
import json
import pathlib
import re
from decimal import Decimal

HERE = pathlib.Path(__file__).resolve().parent
PREVIOUS = HERE.parents[1] / 'dongwu-business-inventory-20261106' / '_evidence'

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def rows(request):
    data = request['data']
    return data.get('samples', data.get('list', []))

phases = {name: read(HERE / (name + '.json')) for name in
          ['pages', 'details', 'remaining', 'detail-pages', 'followup', 'identity']}
d, r, f, identity = [phases[x]['requests'] for x in ['details', 'remaining', 'followup', 'identity']]
unique_requests, duplicates = [], []
for name, phase in phases.items():
    for index, request in enumerate(phase['requests']):
        # Original details capture repeated its last saved object on a local save error.
        if name == 'details' and index == 19:
            assert request == phase['requests'][18]
            duplicates.append({'file': 'details.json', 'pointer': '/requests/19', 'duplicateOf': '/requests/18'})
            continue
        unique_requests.append({'file': name + '.json', 'pointer': '/requests/' + str(index), **request})

joins = []
for index, order_request in zip([7, 9, 11, 13], identity):
    production = rows(d[index])
    order = rows(order_request)
    by_id = {str(x['id']): x for x in order}
    matched = [(x, by_id.get(str(x['order_artifacts_id']))) for x in production]
    joins.append({
        'planId': production[0]['plan_id'], 'orderId': order_request['payload']['id'],
        'productionPointer': f'details.json#/requests/{index}/data',
        'orderPointer': f'identity.json#/requests/{identity.index(order_request)}/data',
        'productionRows': len(production), 'orderRows': len(order),
        'orderReturned': order_request['data']['totalReturned'],
        'matchedByOrderArtifactId': sum(y is not None for x, y in matched),
        'sameGuid': sum(y is not None and x['guid'] == y['guid'] for x, y in matched),
        'sameProjectAndOrder': sum(y is not None and str(x['project_id']) == str(y['project_id']) and str(x['order_id']) == str(y['order_id']) for x, y in matched),
        'uniqueProductionIds': len({x['id'] for x in production}),
        'uniqueOrderArtifactRefs': len({x['order_artifacts_id'] for x in production}),
        'quantityDistribution': dict(collections.Counter(str(x['num']) for x in production)),
    })

all_rows, current, mine = rows(d[9]), rows(f[0]), rows(f[1])
ids = lambda xs: {x['id'] for x in xs}
task = {
    'planId': 9081, 'accountDepartment': phases['detail-pages']['requests'][0]['data']['department'],
    'planRows': len(all_rows), 'currentRows': len(current), 'myRows': len(mine),
    'currentSubsetOfMy': ids(current) <= ids(mine), 'mySubsetOfPlan': ids(mine) <= ids(all_rows),
    'currentEqualsDepartment68': ids(current) == ids([x for x in all_rows if x['department_current'] == 68]),
    'myEqualsDepartmentsContaining68': ids(mine) == ids([x for x in all_rows if '68' in str(x['departments']).split(',')]),
    'myCompletedRows': sum(x['is_complete'] == 1 for x in mine),
    'first50AllTasksSameIdsAsPlans': ids(d[0]['data']['list']) == ids(d[2]['data']['list']),
    'listCounts': {label: d[i]['data']['count'] for label, i in [('plans', 0), ('tasksOmitted', 1), ('tasksAll', 2), ('tasksCurrent', 3), ('tasksMy', 4)]},
}

inspections = []
for file, index, req in [('details.json', i, d[i]) for i in [14, 15, 16]] + [('followup.json', i, f[i]) for i in [2, 3]]:
    data = req['data']; head = data['inspection']; items = data['list']
    inspections.append({
        'pointer': f'{file}#/requests/{index}/data', 'id': head['id'], 'status': head['status'],
        'statusName': head['status_name'], 'headerPlanId': head['plan_id'],
        'memberPlans': dict(collections.Counter(str(x['plan_id']) for x in items)),
        'memberResults': dict(collections.Counter(str(x['inspection_status']) + ':' + x['inspection_status_name'] for x in items)),
        'count': head['artifact_count'], 'savedRows': len(items), 'returnedRows': data['returnedListLength'],
        'flawTime': head['flaw_time'], 'inspectionTime': head['inspection_time'],
    })

packages = []
for head_index, member_index in [(4, 5), (6, 7), (8, 9)]:
    head = r[head_index]['data']; members = rows(r[member_index])
    packages.append({'id': head['id'], 'deliveryId': head['delivery_id'], 'declaredCount': head['artifacts_count'],
                     'memberCount': len(members), 'memberOrders': dict(collections.Counter(x['order_id'] for x in members)),
                     'memberWeightSum': str(sum((Decimal(x['weight']) for x in members), Decimal(0))),
                     'memberQuantitySum': str(sum((Decimal(x['count']) for x in members), Decimal(0))),
                     'pointer': f'remaining.json#/requests/{member_index}/data'})
history = r[11]['data']; shipped = history['list']; package_members = rows(r[5])
shipping = {'packageId': 1622105, 'deliveryId': 8514, 'historySize': history['size'],
            'historySavedRows': len(shipped), 'historyReturnedRows': history['returnedListLength'],
            'historySameMemberIdsAsPackage': ids(shipped) == ids(package_members),
            'allHistoryRowsReferencePackage': all(x['package_id'] == 1622105 for x in shipped),
            'allHistoryRowsReferenceDelivery': all(x['delivery_id'] == 8514 for x in shipped),
            'historyIsPackageValues': sorted({x['is_package'] for x in shipped}),
            'historyWeight': history['weight'], 'memberWeightSum': packages[0]['memberWeightSum']}

designs = []
for plan_index, member_index in [(6, 7), (8, 9), (10, 11), (12, 13)]:
    plan = d[plan_index]['data']; graph = json.loads(plan['design_info']); members = rows(d[member_index])
    designs.append({'planId': plan['id'], 'designId': plan['design_id'],
                    'pointer': f'details.json#/requests/{plan_index}/data/design_info',
                    'nodes': [{k: node[k] for k in ['id', 'name', 'type', 'quality', 'features_codes'] if k in node} for node in graph['nodeList']],
                    'edges': [{k: edge[k] for k in ['from', 'to']} for edge in graph['lineList']],
                    'featureCounts': dict(collections.Counter(x.get('生产特征', '') for x in members)),
                    'successStateWithoutCompletionCount': sum(node.get('state') == 'success' and node.get('completed') != 1 for x in members for node in x['process_items'])})

old_catalog = read(PREVIOUS / 'api-catalog.json'); old_paths = {x['path'] for x in old_catalog}
declarations = {}
for path in sorted((HERE / 'frontend').glob('*.js')):
    source = path.read_text(encoding='utf-8')
    for match in re.finditer(r'url\s*:\s*[\"\'](/?(?:v[12]\.[A-Za-z]+|index)/[A-Za-z][A-Za-z0-9_/]*)[\"\']', source):
        api = '/' + match.group(1).lstrip('/')
        declarations.setdefault(api, []).append({'file': 'frontend/' + path.name,
                                                'offset': match.start(), 'text': source[match.start():match.start() + 190]})
write('frontend-declarations-all.json', declarations)
successful_paths = sorted({x['apiPath'] for x in unique_requests if x.get('httpStatus') == 200 and x.get('code') == 0})
summary = {
    'phaseOutcomes': {name: {'outcome': phase['outcome'], 'savedRequests': len(phase['requests']), 'startedAt': phase['startedAt'], 'finishedAt': phase.get('finishedAt')} for name, phase in phases.items()},
    'duplicatesExcluded': duplicates, 'savedRequestRecords': sum(len(x['requests']) for x in phases.values()),
    'independentCapturedRequests': len(unique_requests),
    'successfulCapturedRequests': sum(x.get('httpStatus') == 200 and x.get('code') == 0 for x in unique_requests),
    'successfulDistinctPaths': successful_paths,
    'successfulPathsNewToBaseline': sorted(set(successful_paths) - old_paths),
    'frontendDeclaredPathCount': len(declarations),
    'frontendDeclaredPathsNewToBaseline': sorted(set(declarations) - old_paths),
    'previousRetainedPathCount': len(old_paths),
    'unionPreviousAndFrontendPathCount': len(old_paths | set(declarations)),
    'taskComparison': task, 'identityJoins': joins, 'inspectionDetails': inspections,
    'packages': packages, 'shippingComparison': shipping, 'designs': designs,
}
write('analysis-summary.json', summary)
write('request-index.json', [{k: x[k] for k in ['file', 'pointer', 'apiPath', 'method', 'payload', 'httpStatus', 'code'] if k in x} for x in unique_requests])
print(json.dumps({k: summary[k] for k in ['independentCapturedRequests', 'successfulCapturedRequests', 'frontendDeclaredPathCount', 'previousRetainedPathCount', 'unionPreviousAndFrontendPathCount', 'successfulDistinctPaths', 'successfulPathsNewToBaseline', 'identityJoins', 'shippingComparison']}, ensure_ascii=False, indent=2))
