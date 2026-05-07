const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildPlanSyncTargets,
    shouldCountForMismatch
} = require('../src/nightly-process-reconciliation');
const {
    buildGjgRollbackEvents
} = require('../src/extract-production-plan');

test('buildPlanSyncTargets deduplicates by task and plan_id while preserving source rows', () => {
    const rows = [
        {
            taskKey: 'fitup_qc',
            taskLabel: '装焊质检',
            sourceType: 'onlyDb',
            plan_id: 101,
            project_name: '项目A',
            plan_name: '计划1',
            component_guid: 'GUID-1'
        },
        {
            taskKey: 'fitup_qc',
            taskLabel: '装焊质检',
            sourceType: 'mismatch',
            plan_id: 101,
            project_name: '项目A',
            plan_name: '计划1',
            component_guid: 'GUID-1'
        },
        {
            taskKey: 'fitup_qc',
            taskLabel: '装焊质检',
            sourceType: 'onlyApi',
            plan_id: 102,
            project_name: '项目A',
            plan_name: '计划2',
            component_guid: 'GUID-2'
        },
        {
            taskKey: 'painting',
            taskLabel: '涂装',
            sourceType: 'onlyDb',
            plan_id: null,
            project_name: '项目B',
            plan_name: '计划3',
            component_guid: 'GUID-3'
        }
    ];

    assert.deepEqual(buildPlanSyncTargets(rows), [
        {
            taskKey: 'fitup_qc',
            taskLabel: '装焊质检',
            planId: 101,
            planName: '计划1',
            projectName: '项目A',
            sources: ['mismatch', 'onlyDb'],
            componentGuids: ['GUID-1']
        },
        {
            taskKey: 'fitup_qc',
            taskLabel: '装焊质检',
            planId: 102,
            planName: '计划2',
            projectName: '项目A',
            sources: ['onlyApi'],
            componentGuids: ['GUID-2']
        }
    ]);
});

test('shouldCountForMismatch ignores fitup_ndi and fitup_qc', () => {
    assert.equal(shouldCountForMismatch({ task: { key: 'fitup_report' } }), true);
    assert.equal(shouldCountForMismatch({ task: { key: 'painting' } }), true);
    assert.equal(shouldCountForMismatch({ task: { key: 'fitup_ndi' } }), false);
    assert.equal(shouldCountForMismatch({ task: { key: 'fitup_qc' } }), false);
});

test('buildGjgRollbackEvents adds rollback rows only for GJG latest-completed statuses missing in API', () => {
    const observedAt = new Date('2026-05-05T12:00:00+08:00');
    const rollbackRows = buildGjgRollbackEvents(
        9001,
        [
            { component_guid: 'GJG-1', production_feature: 'GJG' },
            { component_guid: 'GJG-2', production_feature: 'GJG' },
            { component_guid: 'X-1', production_feature: 'BH' }
        ],
        [
            { component_guid: 'GJG-2', status_type: 'fitup_weld_report', is_completed: true }
        ],
        [
            { component_guid: 'GJG-1', status_type: 'fitup_weld_report', is_completed: true },
            { component_guid: 'GJG-1', status_type: 'fitup_weld_qc', is_completed: false },
            { component_guid: 'GJG-2', status_type: 'fitup_weld_report', is_completed: true },
            { component_guid: 'X-1', status_type: 'fitup_weld_report', is_completed: true }
        ],
        observedAt
    );

    assert.deepEqual(rollbackRows, [
        {
            plan_id: 9001,
            component_guid: 'GJG-1',
            status_type: 'fitup_weld_report',
            event_at: observedAt,
            is_completed: false,
            team_name: null,
            operator_name: 'api-sync-rollback',
            trace_operator_name: null,
            observed_at: observedAt,
            raw_value: 'API_MISSING_ROLLBACK'
        }
    ]);
});
