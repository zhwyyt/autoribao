const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_REPO_ROOT = 'I:\\autoweb\\autowebfangan';
const REPORT_SCRIPT = 'generate-report-manual.js';
const ASSESSMENT_SCRIPT = 'generate-assessment-report.js';

function resolveRepoRoot(configRoot) {
  const raw = (configRoot || process.env.AUTOWEBFANGAN_REPO_ROOT || DEFAULT_REPO_ROOT).trim();
  return path.resolve(raw);
}

function findFirstMatch(text, re) {
  if (!text) return null;
  const match = String(text).match(re);
  return match && match[1] ? match[1].trim() : null;
}

function resolveOutputPath(repoRoot, maybePath) {
  const raw = String(maybePath || '').trim();
  if (!raw || /生成失败/i.test(raw)) {
    return null;
  }
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

function getDefaultReportMonth(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastMonthYear = month === 1 ? year - 1 : year;
  return `${lastMonthYear}-${String(lastMonth).padStart(2, '0')}`;
}

function parseFanganCommand(text) {
  const content = String(text || '').trim();
  if (!content) return null;

  if (content === '技术方案' || content === '技术方案报告') {
    return { raw: content, monthKey: null };
  }

  const match = content.match(/^(\d{4})年(\d{1,2})月技术方案(?:报告)?$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    raw: content,
    monthKey: `${year}-${String(month).padStart(2, '0')}`
  };
}

function normalizeAssessmentDate(value) {
  const raw = String(value || '').trim();
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) {
    match = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  }
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getMonthEndDate(year, month) {
  const date = new Date(year, month, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseAssessmentMonthRange(rangeText) {
  const compact = String(rangeText || '').replace(/\s+/g, '');
  let match = compact.match(/^(\d{4})年(\d{1,2})月[-~至到](\d{1,2})月$/);
  if (match) {
    const year = Number(match[1]);
    const startMonth = Number(match[2]);
    const endMonth = Number(match[3]);
    if (startMonth >= 1 && startMonth <= 12 && endMonth >= startMonth && endMonth <= 12) {
      return {
        startDate: `${year}-${String(startMonth).padStart(2, '0')}-01`,
        endDate: getMonthEndDate(year, endMonth)
      };
    }
  }

  match = compact.match(/^(\d{4})年(\d{1,2})月$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) {
      return {
        startDate: `${year}-${String(month).padStart(2, '0')}-01`,
        endDate: getMonthEndDate(year, month)
      };
    }
  }

  return null;
}

function parseAssessmentCommand(text) {
  const content = String(text || '').trim();
  if (!content) return null;

  let match = content.match(/^考核\s+([^\s]+)\s+(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)\s+(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)$/);
  if (match) {
    const startDate = normalizeAssessmentDate(match[2]);
    const endDate = normalizeAssessmentDate(match[3]);
    if (!startDate || !endDate || startDate > endDate) {
      return null;
    }
    return { raw: content, auditor: match[1], startDate, endDate };
  }

  match = content.match(/^考核\s+([^\s]+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  const range = parseAssessmentMonthRange(match[2]);
  if (!range) {
    return null;
  }

  return {
    raw: content,
    auditor: match[1],
    startDate: range.startDate,
    endDate: range.endDate
  };
}

function parseReportOutput(repoRoot, combinedOutput) {
  const excelPath = resolveOutputPath(
    repoRoot,
    findFirstMatch(combinedOutput, /📊 Excel:\s*(.+?\.xlsx)/i)
      || findFirstMatch(combinedOutput, /Excel(?:报表)?已生成:\s*(.+?\.xlsx)/i)
  );
  const pptPath = resolveOutputPath(
    repoRoot,
    findFirstMatch(combinedOutput, /📄 PPT:\s*(.+?\.pptx)/i)
      || findFirstMatch(combinedOutput, /PPT(?:报告)?已生成:\s*(.+?\.pptx)/i)
  );

  return { excelPath, pptPath };
}

function runFanganReport(repoRoot, monthKey) {
  const scriptPath = path.join(repoRoot, REPORT_SCRIPT);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`未找到技术方案报告脚本：${scriptPath}`);
  }

  const args = [scriptPath];
  if (monthKey) {
    args.push(monthKey);
  }

  return spawnSync('node', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });
}

function parseAssessmentOutput(combinedOutput) {
  const raw = findFirstMatch(combinedOutput, /^ASSESSMENT_RESULT=(.+)$/m);
  if (!raw) {
    return null;
  }

  return JSON.parse(raw);
}

function runAssessmentReport(repoRoot, command) {
  const scriptPath = path.join(repoRoot, ASSESSMENT_SCRIPT);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`未找到技术方案考核脚本：${scriptPath}`);
  }

  return spawnSync('node', [scriptPath, command.auditor, command.startDate, command.endDate], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });
}

async function handleAutowebfanganReportCommand(senderId, command, deps, options = {}) {
  const { sendMessage, sendFile, debugLog } = deps;
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const monthKey = command.monthKey || getDefaultReportMonth();
  const displayMonth = monthKey.replace('-', '年') + '月';

  await sendMessage(senderId, `📊 正在生成${displayMonth}技术方案报告...`, 'fangan_start');
  if (typeof debugLog === 'function') {
    debugLog('autowebfangan-bridge-router:spawn', 'spawning fangan report', { repoRoot, monthKey }, 'H22');
  }

  const result = runFanganReport(repoRoot, command.monthKey);
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;

  if (/该月份暂无数据|暂无审核通过的数据/i.test(combined)) {
    await sendMessage(senderId, `⚠️ ${displayMonth}暂无技术方案统计数据，请确认数据库已采集。`, 'fangan_no_data');
    return { ok: true, handled: true, monthKey, noData: true };
  }

  if (result.status !== 0) {
    const errorMsg = result.stderr || result.stdout || '未知错误';
    await sendMessage(senderId, `❌ 技术方案报告生成失败：\n${errorMsg}`, 'fangan_fail');
    return { ok: false, handled: true, monthKey, error: errorMsg };
  }

  await sendMessage(senderId, '✅ 技术方案报告生成完成，正在把成果通过QQ发给你...', 'fangan_done');

  const { excelPath, pptPath } = parseReportOutput(repoRoot, combined);
  if (typeof debugLog === 'function') {
    debugLog('autowebfangan-bridge-router:parsedPaths', 'parsed output paths', { hasExcel: !!excelPath, hasPpt: !!pptPath }, 'H22');
  }

  if (excelPath) {
    await sendFile(senderId, excelPath, 'fangan_result_xlsx', 'file');
  }
  if (pptPath) {
    await sendFile(senderId, pptPath, 'fangan_result_pptx', 'file');
  }

  if (!excelPath && !pptPath) {
    await sendMessage(
      senderId,
      '⚠️ 技术方案报告已生成，但未能从输出中定位成果文件路径。可在 autowebfangan 项目目录查看。',
      'fangan_path_not_found'
    );
  }

  return { ok: true, handled: true, monthKey, excelPath, pptPath };
}

async function handleAssessmentCommand(senderId, command, deps, options = {}) {
  const { sendMessage, sendFile, debugLog } = deps;
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const label = `${command.auditor} ${command.startDate} 至 ${command.endDate}`;

  await sendMessage(senderId, `📊 正在生成技术方案考核数据：${label}...`, 'assessment_start');
  if (typeof debugLog === 'function') {
    debugLog('autowebfangan-bridge-router:assessment:spawn', 'spawning assessment report', { repoRoot, command }, 'H25');
  }

  const result = runAssessmentReport(repoRoot, command);
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;

  if (result.status !== 0) {
    const errorMsg = findFirstMatch(combined, /^ASSESSMENT_ERROR=(.+)$/m) || result.stderr || result.stdout || '未知错误';
    await sendMessage(senderId, `❌ 技术方案考核数据生成失败：\n${errorMsg}`, 'assessment_fail');
    return { ok: false, handled: true, error: errorMsg };
  }

  const parsed = parseAssessmentOutput(combined);
  if (!parsed || !parsed.outputFile) {
    await sendMessage(senderId, '⚠️ 考核数据已生成，但未能从输出中定位 Excel 文件路径。可在 autowebfangan 项目目录查看。', 'assessment_path_not_found');
    return { ok: true, handled: true, parsed };
  }

  const monthText = parsed.monthlyCounts
    ? Object.keys(parsed.monthlyCounts).sort().map(key => `${key}:${parsed.monthlyCounts[key]}`).join('，')
    : '';
  const summary = `✅ 技术方案考核数据生成完成：${parsed.auditor}，${parsed.startDate} 至 ${parsed.endDate}，共 ${parsed.rowCount} 条。${monthText ? `\n月份分布：${monthText}` : ''}\n正在把 Excel 通过QQ发给你...`;
  await sendMessage(senderId, summary, 'assessment_done');
  await sendFile(senderId, parsed.outputFile, 'assessment_result_xlsx', 'file');

  return { ok: true, handled: true, parsed };
}

module.exports = {
  DEFAULT_REPO_ROOT,
  parseAssessmentCommand,
  parseAssessmentOutput,
  parseFanganCommand,
  parseReportOutput,
  resolveOutputPath,
  getDefaultReportMonth,
  handleAssessmentCommand,
  handleAutowebfanganReportCommand
};
