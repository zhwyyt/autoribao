const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSyncRows, formatShippingRawValue } = require('../src/nightly-shipping-alignment');

function apiRow(overrides = {}) {
    return {
        project_name: '项目A',
        component_guid: 'GUID-1',
        component_no: 'C-1',
        spec: '报废不发货',
        location: '一层',
        delivery_time_text: '2026-07-20 10:00:00',
        complete_time_text: '2026-07-10 09:00:00',
        delivery_username: '操作员',
        key: '项目A|GUID-1|C-1|报废不发货|一层',
        ...overrides
    };
}

test('buildSyncRows uniquely matches shipping rows when only spec has drifted', () => {
    const result = buildSyncRows([apiRow()], [{
        component_id: 101,
        project_name: '项目A',
        component_guid: 'GUID-1',
        component_no: 'C-1',
        spec: 'PIP950x22',
        location: '一层'
    }]);

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].component_id, 101);
    assert.equal(result.skipped.missingComponentCount, 0);
    assert.equal(result.skipped.ambiguousComponentCount, 0);
});

test('buildSyncRows refuses a relaxed match when project and GUID remain ambiguous', () => {
    const matches = [101, 102].map(componentId => ({
        component_id: componentId,
        project_name: '项目A',
        component_guid: 'GUID-1',
        component_no: 'C-1',
        spec: `规格${componentId}`,
        location: '一层'
    }));
    const result = buildSyncRows([apiRow()], matches);

    assert.equal(result.rows.length, 0);
    assert.equal(result.skipped.ambiguousComponentCount, 1);
});

test('formatShippingRawValue preserves the API shipping snapshot', () => {
    const rawValue = formatShippingRawValue(apiRow({ weight_kg: 123.456, quantity: 2 }));
    assert.match(rawValue, /^SHIPPING_API_JSON:/);
    const snapshot = JSON.parse(rawValue.slice('SHIPPING_API_JSON:'.length));
    assert.equal(snapshot.spec, '报废不发货');
    assert.equal(snapshot.weight_kg, 123.456);
    assert.equal(snapshot.quantity, 2);
    assert.equal(snapshot.delivery_time_text, '2026-07-20 10:00:00');
});
