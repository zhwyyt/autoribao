const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const {
    parseShippingRangeCommand,
    buildMonthlySummaryRows,
    generateShippingRangeReport
} = require('../src/shipping-range-report');

function sampleRows() {
    return [
        {
            shippingAt: '2026-07-31 10:00:00',
            projectName: '项目A',
            planName: '计划A1',
            componentNo: 'A-1',
            componentGuid: 'GUID-A-1',
            spec: 'H400',
            location: '一层',
            quantity: 2,
            shippingWeightKg: 1200.123456,
            completedAt: '2026-07-30 09:00:00',
            operatorName: '操作员甲'
        },
        {
            shippingAt: '2026-07-31 11:00:00',
            projectName: '项目B',
            componentNo: 'B-1',
            quantity: 1,
            shippingWeightKg: 299.876544
        },
        {
            shippingAt: '2026-08-01 08:30:00',
            projectName: '项目A',
            componentNo: 'A-2',
            quantity: 3,
            shippingWeightKg: 750
        }
    ];
}

test('parseShippingRangeCommand accepts numeric and Chinese date ranges', () => {
    assert.deepEqual(
        parseShippingRangeCommand('发货明细 2026-07-01 至 2026-08-10'),
        {
            ok: true,
            raw: '发货明细 2026-07-01 至 2026-08-10',
            start: '2026-07-01',
            end: '2026-08-10'
        }
    );

    const chinese = parseShippingRangeCommand('查询2026年7月1日到2026年8月10日发货信息');
    assert.equal(chinese.ok, true);
    assert.equal(chinese.start, '2026-07-01');
    assert.equal(chinese.end, '2026-08-10');
});

test('parseShippingRangeCommand reports invalid ranges without intercepting alignment commands', () => {
    assert.equal(parseShippingRangeCommand('发货对齐'), null);
    assert.equal(parseShippingRangeCommand('计划A还有哪些未发货构件'), null);
    assert.match(parseShippingRangeCommand('发货明细 2026-02-30 至 2026-03-01').error, /日期无效/);
    assert.match(parseShippingRangeCommand('发货明细 2026-08-10 至 2026-07-01').error, /起始日期/);
});

test('buildMonthlySummaryRows groups projects and appends monthly and range totals', () => {
    const summary = buildMonthlySummaryRows(sampleRows());
    const julyA = summary.find(item => item.kind === 'project' && item.month === '2026-07' && item.projectName === '项目A');
    const julyTotal = summary.find(item => item.kind === 'monthTotal' && item.month === '2026-07');
    const augustTotal = summary.find(item => item.kind === 'monthTotal' && item.month === '2026-08');
    const overall = summary.find(item => item.kind === 'overallTotal');

    assert.deepEqual(
        { lines: julyA.detailLines, quantity: julyA.quantity, weightKg: julyA.weightKg, weightTon: julyA.weightTon },
        { lines: 1, quantity: 2, weightKg: 1200.123456, weightTon: 1.2 }
    );
    assert.equal(julyTotal.detailLines, 2);
    assert.equal(julyTotal.weightKg, 1500);
    assert.equal(julyTotal.weightTon, 1.5);
    assert.equal(augustTotal.quantity, 3);
    assert.equal(overall.detailLines, 3);
    assert.equal(overall.weightKg, 2250);
    assert.equal(overall.weightTon, 2.25);
});

test('generateShippingRangeReport writes one workbook with detail and monthly summary sheets', async t => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-range-report-'));
    t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

    const result = await generateShippingRangeReport({
        start: '2026-07-31',
        end: '2026-08-01',
        rows: sampleRows(),
        outputDir
    });

    assert.equal(result.detailCount, 3);
    assert.equal(result.monthCount, 2);
    assert.equal(result.projectCount, 2);
    assert.equal(fs.existsSync(result.outputPath), true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.outputPath);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['月度汇总', '发货明细']);
    assert.equal(workbook.views[0].activeTab, 0);
    assert.equal(workbook.getWorksheet('发货明细').rowCount, 4);
    assert.equal(workbook.getWorksheet('发货明细').getRow(2).getCell(3).value, '2026-07-31 10:00:00');
    assert.equal(workbook.getWorksheet('月度汇总').getRow(1).getCell(1).value, '月份');
    assert.equal(workbook.getWorksheet('月度汇总').getRow(2).getCell(1).value, '2026-07');
    assert.equal(workbook.getWorksheet('月度汇总').getRow(2).getCell(2).value, '项目A');
});
