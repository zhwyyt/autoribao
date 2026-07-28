const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAssessmentCommand,
  parseAssessmentOutput,
  parseFanganCommand,
  parseReportOutput,
  getDefaultReportMonth,
  resolveOutputPath
} = require('../src/autowebfangan-bridge-router');

test('parseFanganCommand accepts default and month-specific commands', () => {
  assert.deepEqual(parseFanganCommand('技术方案'), { raw: '技术方案', monthKey: null });
  assert.deepEqual(parseFanganCommand('技术方案报告'), { raw: '技术方案报告', monthKey: null });
  assert.deepEqual(parseFanganCommand('2026年4月技术方案'), {
    raw: '2026年4月技术方案',
    monthKey: '2026-04'
  });
  assert.deepEqual(parseFanganCommand('2026年4月技术方案报告'), {
    raw: '2026年4月技术方案报告',
    monthKey: '2026-04'
  });
  assert.equal(parseFanganCommand('收发存'), null);
});

test('parseAssessmentCommand accepts explicit date ranges', () => {
  assert.deepEqual(parseAssessmentCommand('考核 覃祚威 2026-01-01 2026-05-31'), {
    raw: '考核 覃祚威 2026-01-01 2026-05-31',
    auditor: '覃祚威',
    startDate: '2026-01-01',
    endDate: '2026-05-31'
  });
  assert.deepEqual(parseAssessmentCommand('考核 覃祚威 2026年1月1日 2026年5月31日'), {
    raw: '考核 覃祚威 2026年1月1日 2026年5月31日',
    auditor: '覃祚威',
    startDate: '2026-01-01',
    endDate: '2026-05-31'
  });
});

test('parseAssessmentCommand accepts Chinese month ranges', () => {
  assert.deepEqual(parseAssessmentCommand('考核 覃祚威 2026年1月-5月'), {
    raw: '考核 覃祚威 2026年1月-5月',
    auditor: '覃祚威',
    startDate: '2026-01-01',
    endDate: '2026-05-31'
  });
  assert.deepEqual(parseAssessmentCommand('考核 张三 2026年4月'), {
    raw: '考核 张三 2026年4月',
    auditor: '张三',
    startDate: '2026-04-01',
    endDate: '2026-04-30'
  });
  assert.equal(parseAssessmentCommand('考核 覃祚威 2026年5月-1月'), null);
});

test('parseAssessmentOutput parses CLI result line', () => {
  const output = [
    'ASSESSMENT_RESULT={"ok":true,"auditor":"覃祚威","rowCount":30,"outputFile":"I:\\\\a.xlsx"}',
    'Excel: I:\\a.xlsx'
  ].join('\n');

  assert.deepEqual(parseAssessmentOutput(output), {
    ok: true,
    auditor: '覃祚威',
    rowCount: 30,
    outputFile: 'I:\\a.xlsx'
  });
});

test('parseReportOutput resolves relative excel and ppt paths', () => {
  const repoRoot = 'I:\\autoweb\\autowebfangan';
  const output = [
    '🎉 报告生成完成！',
    '📊 Excel: 月度统计报告_2026-04.xlsx',
    '📄 PPT: 月度统计报告_2026-04.pptx'
  ].join('\n');

  const parsed = parseReportOutput(repoRoot, output);
  assert.equal(parsed.excelPath, pathJoin(repoRoot, '月度统计报告_2026-04.xlsx'));
  assert.equal(parsed.pptPath, pathJoin(repoRoot, '月度统计报告_2026-04.pptx'));
});

test('resolveOutputPath ignores failure markers', () => {
  const repoRoot = 'I:\\autoweb\\autowebfangan';
  assert.equal(resolveOutputPath(repoRoot, '生成失败'), null);
});

test('getDefaultReportMonth uses previous calendar month', () => {
  assert.equal(getDefaultReportMonth(new Date('2026-06-04T12:00:00+08:00')), '2026-05');
  assert.equal(getDefaultReportMonth(new Date('2026-01-15T12:00:00+08:00')), '2025-12');
});

function pathJoin(root, name) {
  return require('path').join(root, name);
}
