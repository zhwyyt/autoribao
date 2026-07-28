const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildLatestFitupStatusCte,
    buildLatestFitupEventCte
} = require('../src/query/latest-fitup-query');

test('current fitup status is selected globally by project and GUID', () => {
    const sql = buildLatestFitupStatusCte({ cteName: 'latest' });

    assert.match(sql, /DISTINCT ON \(p\.project_name, c\.component_guid\)/);
    assert.doesNotMatch(sql, /DISTINCT ON \(p\.project_name, pp\.plan_name, c\.component_guid\)/);
    assert.match(sql, /ORDER BY p\.project_name, c\.component_guid,/);
});

test('historical fitup events keep per-plan rows but require globally completed current state', () => {
    const sql = buildLatestFitupEventCte({
        cteName: 'latest',
        currentStateBeforeSql: '$2'
    });

    assert.match(sql, /latest_current_state AS/);
    assert.match(sql, /DISTINCT ON \(p\.project_name, c\.component_guid\)/);
    assert.match(sql, /DISTINCT ON \(p\.project_name, pp\.plan_name, c\.component_guid\)/);
    assert.match(sql, /current_state\.is_completed = true/);
    assert.equal((sql.match(/COALESCE\(e\.event_at, e\.updated_at, e\.created_at\) < \$2/g) || []).length, 2);
});
