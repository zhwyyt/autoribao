const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMonthRange, buildMonthSegments } = require('../src/shoufacun-api-reconciliation');
const { formatProcessRawValue } = require('../src/nightly-process-reconciliation');

test('buildMonthRange uses the factory month from previous 26th through current 25th', () => {
    assert.deepEqual(buildMonthRange('2026-07'), {
        start: '2026-06-26',
        end: '2026-07-25',
        label: '2026-06-26至2026-07-25'
    });
});

test('buildMonthRange rejects malformed months', () => {
    assert.throws(() => buildMonthRange('2026-13'), /无效月份/);
});

test('buildMonthSegments splits monthly API checks at the 10th and 11th', () => {
    assert.deepEqual(buildMonthSegments('2026-07'), [
        {
            start: '2026-06-26',
            end: '2026-07-10',
            label: '2026-06-26至2026-07-10'
        },
        {
            start: '2026-07-11',
            end: '2026-07-25',
            label: '2026-07-11至2026-07-25'
        }
    ]);
});

test('process API snapshot preserves original high precision weight', () => {
    const raw = formatProcessRawValue({
        project_name: '香港机场围栏',
        component_guid: 'GJ7',
        weight_kg: 226.378439,
        quantity: 1,
        event_date: '2026-07-22'
    });
    assert.match(raw, /^PROCESS_API_JSON:/);
    const snapshot = JSON.parse(raw.slice('PROCESS_API_JSON:'.length));
    assert.equal(snapshot.weight_kg, 226.378439);
});
