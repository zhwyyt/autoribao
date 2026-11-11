"""Independently check preserved files, evidence pointers and report claims."""
import ast
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
from decimal import Decimal

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent
ROOT = HERE.parents[2]
load = lambda path: json.loads(path.read_text(encoding='utf-8-sig'))
checks = []

def check(name, result, detail=None):
    checks.append({'name': name, 'passed': bool(result), 'detail': detail})

def pointer(data, path):
    for segment in path.strip('/').split('/'):
        segment = segment.replace('~1', '/').replace('~0', '~')
        data = data[int(segment)] if isinstance(data, list) else data[segment]
    return data

(HERE / 'verification.json').write_text('{"status":"running"}', encoding='utf-8')
baseline = load(HERE / 'baseline-hashes.json')
changed = [name for name, sha in baseline.items() if not (ROOT / name).exists() or hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != sha]
check('All baseline source and prior deliverable hashes unchanged', not changed, {'files': len(baseline), 'changed': changed})
git = subprocess.run(['git', '-c', 'core.quotepath=false', 'status', '--porcelain=v1'], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
before = (HERE / 'initial-git-status.txt').read_text(encoding='utf-8-sig')
check('Existing tracked and untracked git state preserved', git.returncode == 0 and git.stdout.splitlines() == before.splitlines(), {'exitCode': git.returncode, 'preexistingInaccessibleDirectories': 'Permission denied' in git.stderr})
parsed = {p: load(p) for p in OUT.rglob('*.json')}
check('All evidence JSON parses', True, {'files': len(parsed)})

records = load(HERE / 'request-index.json')
check('All request pointers resolve to the stated API and payload', all(
    pointer(parsed[HERE / r['file']], r['pointer'])['apiPath'] == r['apiPath'] and
    pointer(parsed[HERE / r['file']], r['pointer'])['payload'] == r['payload'] for r in records), len(records))
check('All indexed responses succeeded', all(r['httpStatus'] == 200 and r['code'] == 0 for r in records), len(records))
check('Captured business requests use get-prefixed read operations', all(re.fullmatch(r'/v[12]\.[a-z]+/get[A-Za-z]+', r['apiPath']) for r in records))
summary = load(HERE / 'analysis-summary.json')
check('Request totals and distinct paths match', len(records) == 83 == summary['successfulCapturedRequests'] and len({r['apiPath'] for r in records}) == 22)
d = parsed[HERE / 'details.json']['requests']; f = parsed[HERE / 'followup.json']['requests']; r = parsed[HERE / 'remaining.json']['requests']
check('Known duplicate is identical and excluded once', len(d) == 20 and d[18] == d[19] and not any(x['file'] == 'details.json' and x['pointer'] == '/requests/19' for x in records))

total_matches = 0
for production_index, order_index in zip([7, 9, 11, 13], range(4)):
    prod = d[production_index]['data']['samples']; order_data = parsed[HERE / 'identity.json']['requests'][order_index]['data']; order = order_data['samples']
    assert len(prod) == d[production_index]['data']['totalReturned']
    assert len(order) == order_data['totalReturned']
    target = {str(x['id']): x for x in order}
    for item in prod:
        other = target[str(item['order_artifacts_id'])]
        assert item['guid'] == other['guid']
        assert str(item['project_id']) == str(other['project_id']) and str(item['order_id']) == str(other['order_id'])
        total_matches += 1
check('408 complete source-ID joins including GUID and scope', total_matches == 408, total_matches)
all_items = d[9]['data']['samples']; current = f[0]['data']['samples']; mine = f[1]['data']['samples']
ids = lambda rows: {x['id'] for x in rows}
check('Task subset counts verified from complete arrays', (len(all_items), len(current), len(mine)) == (167, 8, 68) and ids(current) <= ids(mine) <= ids(all_items))
check('Task sample department predicates match exactly', ids(current) == ids([x for x in all_items if x['department_current'] == 68]) and ids(mine) == ids([x for x in all_items if '68' in str(x['departments']).split(',')]))
check('My task sample contains 32 completed records', sum(x['is_complete'] == 1 for x in mine) == 32)
insp = d[14]['data']
check('Multi-plan inspection counterexample verified', insp['inspection']['plan_id'] == '8939,9016' and sorted(x['plan_id'] for x in insp['list']) == [8939]*4 + [9016])
check('Cross-order package counterexamples verified', all({x['order_id'] for x in r[i]['data']['samples']} == {'8903', '8905'} for i in [7, 9]))
check('Five inspection result states exist in actual details', {d[i]['data']['inspection']['status'] for i in [14, 15, 16]} | {f[i]['data']['inspection']['status'] for i in [2, 3]} == {0, 1, 2, 3, 4})
members = r[5]['data']['samples']; history = r[11]['data']['list']
check('Package and outgoing-history member IDs match completely', len(members) == len(history) == 26 and ids(members) == ids(history))
weight = sum((Decimal(x['weight']) for x in members), Decimal(0))
check('Package member weight equals history total', weight == Decimal(r[11]['data']['weight']) == Decimal('36201.21'))
delivery = parsed[HERE / 'pages.json']['requests'][18]['data']['list'][0]
check('Shipping discrepancy preserved rather than silently normalized', delivery['id'] == 8514 and delivery['artifacts_count'] == 27)

sources = {p.name: p.read_text(encoding='utf-8') for p in (HERE / 'frontend').glob('*.js')}
snippets = parsed[HERE / 'frontend-snippets.json']
check('All 15 original frontend excerpts and offsets resolve', len(snippets) == 15 and all(sources[pathlib.Path(x['file']).name][x['offset']:].startswith(x['term']) and x['text'] in sources[pathlib.Path(x['file']).name] for x in snippets))
declarations = parsed[HERE / 'frontend-declarations-all.json']
check('Every final declaration excerpt matches source offset', all(sources[pathlib.Path(x['file']).name][x['offset']:x['offset']+len(x['text'])] == x['text'] for occurrences in declarations.values() for x in occurrences))
assets = [asset for name in ['pages.json', 'detail-pages.json'] for asset in parsed[HERE / name]['assets']]
check('Downloaded frontend assets retain captured SHA-256', all(hashlib.sha256((HERE / x['file']).read_bytes()).hexdigest() == x['sha256'] for x in assets), {'captures': len(assets), 'distinctFiles': len(sources)})
old = load(ROOT / 'outputs/dongwu-business-inventory-20261106/_evidence/api-catalog.json'); oldpaths = {x['path'] for x in old}
check('API union and discovery counts independently match', len(oldpaths) == 92 and len(declarations) == 163 and len(set(declarations)-oldpaths) == 88 and len(set(declarations)|oldpaths) == 180)

broken = []; link_count = 0
for path in OUT.glob('*.md'):
    text = path.read_text(encoding='utf-8')
    for target in re.findall(r'\]\(([^)]+)\)', text):
        if target.startswith(('http:', 'https:', '#')):
            continue
        target = target.split('#', 1)[0]
        link_count += 1
        if not (path.parent / target).exists():
            broken.append({'file': path.name, 'target': target})
check('All Markdown file links resolve', not broken, {'links': link_count, 'broken': broken})
backlog = (OUT / 'verification-progress.md').read_text(encoding='utf-8')
check('All 20 original verification items are tracked', all(re.search(r'\| VB-' + str(i).zfill(2) + r'\b', backlog) for i in range(1, 21)))
for script in HERE.glob('*.py'):
    ast.parse(script.read_text(encoding='utf-8'), filename=str(script))
node = subprocess.run(['node', '--check', str(HERE / 'explore.cjs')], cwd=ROOT, capture_output=True, text=True)
check('Standalone analysis and collector syntax valid', node.returncode == 0, {'pythonScripts': len(list(HERE.glob('*.py'))), 'nodeExitCode': node.returncode})
config = load(ROOT / 'config/default.json')
secrets = [value for value in [config['credentials']['username'], config['credentials']['password']] if value and len(value) > 3]
leaks = []
for path in OUT.rglob('*'):
    if path.is_file():
        text = path.read_text(encoding='utf-8-sig')
        if any(secret in text for secret in secrets):
            leaks.append(str(path.relative_to(OUT)))
check('Configured credential values absent from all new outputs', not leaks, {'filesWithMatches': leaks})

result = {'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'status': 'passed' if all(x['passed'] for x in checks) else 'failed',
          'checksPassed': sum(x['passed'] for x in checks), 'checksTotal': len(checks), 'checks': checks,
          'limits': ['Does not validate backend write rules, global cardinalities, or uncollected records.',
                     'Credential check checks configured login values, not complete anonymization of business data.',
                     'Git status has preexisting permission warnings for two unrelated soffice directories.']}
(HERE / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'status': result['status'], 'passed': result['checksPassed'], 'total': len(checks), 'failed': [x for x in checks if not x['passed']]}, ensure_ascii=False))
raise SystemExit(0 if result['status'] == 'passed' else 1)
