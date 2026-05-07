const http = require('http');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { handleNaturalLanguageQuery } = require('./query');
const { queryProjectComponentDetails } = require('./project-component-details');
const { parseProjectDetailCommand, handleProjectComponentDetailExport } = require('./project-component-details-db');
const { runNightlyProcessReconciliation, buildMonthlyBusinessRange } = require('./nightly-process-reconciliation');
const { runNightlyShippingAlignment } = require('./nightly-shipping-alignment');

// #region agent log
const DEBUG_ENDPOINT = 'http://127.0.0.1:7247/ingest/9bed5e42-9ce7-49e2-967a-4e718fb71c3d';
const DEBUG_LOG = (location, message, data, hypothesisId) => {
  try {
    const payload = JSON.stringify({ location, message, data: data || {}, timestamp: Date.now(), hypothesisId });
    if (typeof fetch === 'function') {
      fetch(DEBUG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {});
      return;
    }
    const u = new URL(DEBUG_ENDPOINT);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + (u.search || ''), method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => res.resume()
    );
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch (_) {}
};
// #endregion

console.log('🚀 启动QQ机器人 - NapCat OneBot协议版');

// WebSocket连接配置
const WS_URL = 'ws://127.0.0.1:3001';
let ws = null;

// OneBot HTTP API配置
const ONEBOT_API = 'http://127.0.0.1:3000';

// 从配置文件读取机器人QQ与授权用户（避免写死导致“无权限”）
const CONFIG_PATH = path.resolve(__dirname, '../config/qq-bot.json');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PEC_DEBUG_DIR = path.resolve(__dirname, '../logs/pec-qq-debug');
let BOT_QQ = 2162802443;
let AUTHORIZED_USERS = []; // 授权用户列表（空数组=所有人可用；可在 config/qq-bot.json 覆盖）
const NIGHTLY_RECONCILIATION_USER_ID = 584201119;
let nightlyReconciliationRunning = false;
let nightlyShippingAlignmentRunning = false;
const PEC_STATE = new Map();
const PEC_RUNNING_USERS = new Set();
const PEC_CONFIG = {
  unifiedAutomationRoot: 'I:\\autoweb\\unified-automation',
  runnerScript: 'I:\\autoweb\\unified-automation\\backend\\pec\\src\\qq-run-single-file.js',
  inputFolder: null
};
try {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  if (cfg && cfg.bot && typeof cfg.bot.qq === 'number') BOT_QQ = cfg.bot.qq;
  if (cfg && Array.isArray(cfg.authorizedUsers)) AUTHORIZED_USERS = cfg.authorizedUsers.filter((x) => typeof x === 'number');
  if (cfg && cfg.pec && typeof cfg.pec.unifiedAutomationRoot === 'string' && cfg.pec.unifiedAutomationRoot.trim()) {
    PEC_CONFIG.unifiedAutomationRoot = cfg.pec.unifiedAutomationRoot.trim();
  }
  if (cfg && cfg.pec && typeof cfg.pec.runnerScript === 'string' && cfg.pec.runnerScript.trim()) {
    PEC_CONFIG.runnerScript = cfg.pec.runnerScript.trim();
  }
  if (cfg && cfg.pec && typeof cfg.pec.inputFolder === 'string' && cfg.pec.inputFolder.trim()) {
    PEC_CONFIG.inputFolder = cfg.pec.inputFolder.trim();
  }
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:config:loaded', 'loaded config', { configPath: CONFIG_PATH, authorizedUsersCount: AUTHORIZED_USERS.length }, 'H8');
  // #endregion
} catch (e) {
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:config:error', 'failed to load config', { configPath: CONFIG_PATH, errorMessage: e.message }, 'H8');
  // #endregion
}

// HTTP请求函数
function callAPI(endpoint, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data || {});
    
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path: `/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
        'Content-Length': Buffer.byteLength(postData)
      },
      agent: false
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        // #region agent log
        try { DEBUG_LOG('qq-bot-napcat.js:callAPI:response', 'HTTP response', { endpoint, statusCode: res.statusCode, bodyLength: body.length, bodyPreview: body.slice(0, 200) }, 'H2'); } catch (_) {}
        // #endregion
        try {
          const result = JSON.parse(body);
          if (result.status === 'failed') {
            reject(new Error(result.message || 'API调用失败'));
          } else {
            resolve(result.data);
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      // #region agent log
      DEBUG_LOG('qq-bot-napcat.js:callAPI:requestError', 'HTTP request error', { endpoint, errorMessage: error.message, errorCode: error.code }, 'H1');
      // #endregion
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

function isTransientNetError(err) {
  const code = err && err.code;
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' || code === 'ETIMEDOUT';
}

async function callAPIWithRetry(endpoint, data, retries = 1) {
  try {
    return await callAPI(endpoint, data);
  } catch (err) {
    if (retries > 0 && isTransientNetError(err)) {
      // #region agent log
      DEBUG_LOG('qq-bot-napcat.js:callAPI:retry', 'retrying transient API error', { endpoint, errorCode: err.code }, 'H13');
      // #endregion
      return await callAPIWithRetry(endpoint, data, retries - 1);
    }
    throw err;
  }
}

// 发送私聊消息
async function sendPrivateMessage(userId, message) {
  return await callAPIWithRetry('send_private_msg', {
    user_id: userId,
    message: message
  }, 1);
}

async function safeSendPrivateMessage(userId, message, tag) {
  try {
    await sendPrivateMessage(userId, message);
    return true;
  } catch (e) {
    // #region agent log
    DEBUG_LOG('qq-bot-napcat.js:send:fail', 'send_private_msg failed', { tag, errorCode: e.code, errorMessage: e.message }, 'H14');
    // #endregion
    console.error(`发送消息失败(${tag}):`, e);
    return false;
  }
}

async function runNightlyReconciliationJob(trigger = 'cron', range = null) {
  if (nightlyReconciliationRunning) {
    console.log(`⏳ 夜间工序校对任务已在运行，跳过本次触发：${trigger}`);
    return;
  }

  nightlyReconciliationRunning = true;
  try {
    console.log(`🕛 开始执行夜间工序校对任务（触发方式：${trigger}）`);
    const result = await runNightlyProcessReconciliation({ now: new Date(), range: range || undefined });

    if (!result.hasMismatch) {
      console.log(`✅ ${result.range.label} 工序校对完成：API 与数据库一致，无需发送报告`);
      return;
    }

    await safeSendPrivateMessage(
      NIGHTLY_RECONCILIATION_USER_ID,
      `⚠️ ${result.range.label} 工序数据校对发现差异，正在发送报告。\n\n${result.summaryText}`,
      'nightly_reconciliation_summary'
    );

    if (result.reportPath) {
      await sendResultFileToUser(
        NIGHTLY_RECONCILIATION_USER_ID,
        result.reportPath,
        'nightly_reconciliation_report',
        'file'
      );
    }
  } catch (error) {
    console.error('夜间工序校对任务失败:', error);
    await safeSendPrivateMessage(
      NIGHTLY_RECONCILIATION_USER_ID,
      `❌ 夜间工序校对任务失败：${error.message}`,
      'nightly_reconciliation_error'
    );
  } finally {
    nightlyReconciliationRunning = false;
  }
}

async function runNightlyShippingAlignmentJob(trigger = 'cron', range = null) {
  if (nightlyShippingAlignmentRunning) {
    console.log(`⏳ 夜间发货对齐任务已在运行，跳过本次触发：${trigger}`);
    return;
  }

  nightlyShippingAlignmentRunning = true;
  try {
    console.log(`🕑 开始执行夜间发货对齐任务（触发方式：${trigger}）`);
    const result = await runNightlyShippingAlignment({ now: new Date(), range: range || undefined });

    if (!result.hasMismatch) {
      console.log(`✅ ${result.range.label} 发货数据已一致，无需对齐`);
      return;
    }

    await safeSendPrivateMessage(
      NIGHTLY_RECONCILIATION_USER_ID,
      `⚠️ ${result.range.label} 发货数据发现差异，已按 API 完成对齐。\n\n${result.summaryText}`,
      'nightly_shipping_alignment_summary'
    );

    if (result.reportPath) {
      await sendResultFileToUser(
        NIGHTLY_RECONCILIATION_USER_ID,
        result.reportPath,
        'nightly_shipping_alignment_report',
        'file'
      );
    }
  } catch (error) {
    console.error('夜间发货对齐任务失败:', error);
    await safeSendPrivateMessage(
      NIGHTLY_RECONCILIATION_USER_ID,
      `❌ 夜间发货对齐任务失败：${error.message}`,
      'nightly_shipping_alignment_error'
    );
  } finally {
    nightlyShippingAlignmentRunning = false;
  }
}

function toFileUri(p) {
  const abs = path.resolve(p);
  // windows path -> file:///C:/a/b
  const withSlashes = abs.replace(/\\/g, '/');
  const encoded = withSlashes.split('/').map(encodeURIComponent).join('/');
  return `file:///${encoded}`;
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function findFirstMatch(text, re) {
  if (!text) return null;
  const m = String(text).match(re);
  return m && m[1] ? m[1].trim() : null;
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || 'pec-task.xlsx')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return cleaned || 'pec-task.xlsx';
}

function parseShoufacunCommand(text) {
  const content = String(text || '').trim();
  if (!content) return null;
  if (content === '收发存') {
    return { raw: content, monthKey: null };
  }

  const match = content.match(/^(\d{4})年(\d{1,2})月收发存$/);
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

function resolveUniqueFilePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);
  let index = 1;
  let candidate = targetPath;

  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}__dup${index}${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

function normalizeMessageSegments(message) {
  if (Array.isArray(message?.message)) {
    return message.message;
  }
  if (Array.isArray(message)) {
    return message;
  }
  return [];
}

function parseCqFileMessage(rawText) {
  const text = String(rawText || '');
  const match = text.match(/\[CQ:file,([^\]]+)\]/i);
  if (!match) {
    return null;
  }

  const attributes = {};
  const parts = match[1].split(',');
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    attributes[key] = value;
  }

  if (!attributes.file && !attributes.file_id) {
    return null;
  }

  return {
    fileId: attributes.file_id || null,
    fileHash: attributes.file_hash || attributes.hash || null,
    fileName: attributes.file || attributes.name || 'pec-task.xlsx',
    url: attributes.url || attributes.download_url || null
  };
}

function writePecDebugSnapshot(tag, payload) {
  try {
    fs.mkdirSync(PEC_DEBUG_DIR, { recursive: true });
    const filePath = path.join(
      PEC_DEBUG_DIR,
      `${Date.now()}_${tag}.json`
    );
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (_) {}
}

function extractIncomingFile(message) {
  const segments = normalizeMessageSegments(message);
  const fileSegment = segments.find(segment => segment && segment.type === 'file');
  if (fileSegment && fileSegment.data) {
    const data = fileSegment.data;
    return {
      fileId: data.file_id || data.id || null,
      fileHash: data.file_hash || data.hash || null,
      fileName: data.file || data.name || 'pec-task.xlsx',
      url: data.url || data.download_url || null
    };
  }

  return parseCqFileMessage(message?.raw_message || message?.message || '');
}

async function getMessageDetails(messageId) {
  if (!messageId) {
    return null;
  }

  try {
    return await callAPIWithRetry('get_msg', { message_id: messageId }, 1);
  } catch (_) {
    return null;
  }
}

function extractIncomingFileFromNotice(event) {
  const file = event?.file;
  if (!file) {
    return null;
  }

  return {
    fileId: file.file_id || file.id || null,
    fileHash: file.file_hash || file.hash || null,
    fileName: file.name || file.file || 'pec-task.xlsx',
    url: file.url || file.download_url || null
  };
}

function resolvePecInputFolder() {
  if (PEC_CONFIG.inputFolder) {
    return path.resolve(PEC_CONFIG.inputFolder);
  }

  const defaultConfigPath = path.join(PEC_CONFIG.unifiedAutomationRoot, 'backend', 'pec', 'config', 'default.json');
  const raw = fs.readFileSync(defaultConfigPath, 'utf8');
  const config = JSON.parse(raw);
  const folder = config?.files?.excelFolder;
  if (!folder) {
    throw new Error(`PEC 配置中缺少 files.excelFolder: ${defaultConfigPath}`);
  }

  return path.resolve(folder);
}

async function resolvePrivateFileDownloadUrl(userId, fileInfo) {
  if (fileInfo.url) {
    return fileInfo.url;
  }

  if (!fileInfo.fileId) {
    throw new Error('QQ 文件消息缺少 file_id，无法下载');
  }

  const requestBody = {
    user_id: userId,
    file_id: fileInfo.fileId
  };

  if (fileInfo.fileHash) {
    requestBody.file_hash = fileInfo.fileHash;
  }

  const result = await callAPIWithRetry('get_private_file_url', requestBody, 1);
  const downloadUrl = typeof result === 'string'
    ? result
    : result?.url || result?.download_url || result?.file_url || null;

  if (!downloadUrl) {
    throw new Error('NapCat 未返回可用的文件下载地址');
  }

  return downloadUrl;
}

async function downloadPrivateFileToPecInbox(userId, fileInfo) {
  const inputFolder = resolvePecInputFolder();
  fs.mkdirSync(inputFolder, { recursive: true });

  const fileName = sanitizeFileName(fileInfo.fileName);
  const targetPath = resolveUniqueFilePath(path.join(inputFolder, fileName));
  const downloadUrl = await resolvePrivateFileDownloadUrl(userId, fileInfo);

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`下载 QQ 文件失败: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, buffer);
  return targetPath;
}

function parsePecRunnerResult(outputText) {
  const resultLine = String(outputText || '')
    .split(/\r?\n/)
    .find(line => line.startsWith('QQ_PEC_RESULT='));

  if (!resultLine) {
    return null;
  }

  return JSON.parse(resultLine.slice('QQ_PEC_RESULT='.length));
}

function parsePecRunnerError(outputText) {
  const errorLine = String(outputText || '')
    .split(/\r?\n/)
    .find(line => line.startsWith('QQ_PEC_ERROR='));

  return errorLine ? errorLine.slice('QQ_PEC_ERROR='.length).trim() : null;
}

function runPecAutomationBridge(taskFilePath) {
  const runnerScript = path.resolve(PEC_CONFIG.runnerScript);
  const unifiedRoot = path.resolve(PEC_CONFIG.unifiedAutomationRoot);
  const result = spawnSync('node', [runnerScript, taskFilePath], {
    cwd: unifiedRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });

  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const parsedResult = parsePecRunnerResult(combined);
  if (result.status === 0 && parsedResult) {
    return parsedResult;
  }

  throw new Error(parsePecRunnerError(combined) || result.stderr || result.stdout || 'PEC 自动化执行失败');
}

async function handlePecFileMessage(senderId, fileInfo) {
  if (PEC_RUNNING_USERS.has(senderId)) {
    await safeSendPrivateMessage(senderId, '⏳ 当前已有 PEC 自动化正在执行，请稍候。', 'pec_running');
    return;
  }

  PEC_RUNNING_USERS.add(senderId);
  PEC_STATE.delete(senderId);

  try {
    const lowerName = String(fileInfo.fileName || '').toLowerCase();
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
      throw new Error('PEC 只支持 Excel 任务单文件（.xls / .xlsx）');
    }

    await safeSendPrivateMessage(senderId, `📥 已收到文件：${fileInfo.fileName}\n正在下载并投递到 PEC 输入目录...`, 'pec_file_received');
    const savedFilePath = await downloadPrivateFileToPecInbox(senderId, fileInfo);

    await safeSendPrivateMessage(senderId, '🚀 PEC 自动化已开始执行：导入 -> 生成 PEC/JFH -> 建单/排产 -> 编码下载', 'pec_started');
    const result = runPecAutomationBridge(savedFilePath);

    const zipPaths = Array.isArray(result.codeZipPaths) ? result.codeZipPaths.filter(Boolean) : [];
    const summaryLines = [
      '✅ PEC 自动化执行完成',
      result.taskNumber ? `任务单号: ${result.taskNumber}` : null,
      result.projectName ? `项目: ${result.projectName}` : null,
      `生成文件数: ${Array.isArray(result.exportFiles) ? result.exportFiles.length : 0}`,
      `编码包数: ${zipPaths.length}`
    ].filter(Boolean);

    await safeSendPrivateMessage(senderId, summaryLines.join('\n'), 'pec_completed');

    if (zipPaths.length === 0) {
      await safeSendPrivateMessage(senderId, '⚠️ 本次 PEC 流程未拿到编码压缩包路径，请到本机日志中核查。', 'pec_no_zip');
      return;
    }

    for (let index = 0; index < zipPaths.length; index += 1) {
      await sendResultFileToUser(senderId, zipPaths[index], `pec_zip_${index + 1}`, 'file');
    }
  } finally {
    PEC_RUNNING_USERS.delete(senderId);
  }
}

async function handleNoticeEvent(event) {
  const senderId = event?.user_id;
  if (!senderId) {
    return;
  }

  if (PEC_STATE.has(senderId)) {
    writePecDebugSnapshot('pec_waiting_notice', {
      source: 'notice',
      event
    });
  }

  const allowAll = AUTHORIZED_USERS.length === 0;
  const isAuthorized = allowAll || AUTHORIZED_USERS.includes(senderId);
  if (!isAuthorized) {
    return;
  }

  const incomingFile = extractIncomingFileFromNotice(event);
  if (!incomingFile) {
    return;
  }

  if (!PEC_STATE.has(senderId)) {
    await safeSendPrivateMessage(senderId, '📎 已收到文件通知，但当前没有等待中的 PEC 任务。请先发送“PEC”，再上传任务单 Excel。', 'pec_notice_without_command');
    return;
  }

  await handlePecFileMessage(senderId, incomingFile);
}

async function sendResultFileToUser(userId, filePath, tag, kind) {
  const st = statSafe(filePath);
  // #region agent log
  DEBUG_LOG(
    'qq-bot-napcat.js:result:fileCandidate',
    'candidate result file',
    { tag, kind, exists: !!st, size: st ? st.size : null, base: st ? path.basename(filePath) : path.basename(filePath) },
    'H20'
  );
  // #endregion
  if (!st || !st.isFile()) {
    await safeSendPrivateMessage(userId, `⚠️ 未找到生成文件：${filePath}`, `${tag}_missing`);
    return false;
  }

  const uri = toFileUri(filePath);
  const base = path.basename(filePath);

  // NapCat / OneBot V11: CQ 码形式发送本地文件（enableLocalFile2Url=true 时通常可用）
  const cq =
    kind === 'image'
      ? `[CQ:image,file=${uri}]`
      : `[CQ:file,file=${uri},name=${base}]`;

  const ok = await safeSendPrivateMessage(userId, cq, `${tag}_cq_${kind}`);
  if (ok) {
    await safeSendPrivateMessage(userId, `✅ 已通过QQ发送成果：${base}`, `${tag}_sent_tip`);
    return true;
  }

  // 兜底：发送路径，方便人工取文件
  await safeSendPrivateMessage(userId, `⚠️ 成果文件已生成但QQ发送失败，可在本机查看：${filePath}`, `${tag}_path_fallback`);
  return false;
}

// 连接WebSocket
function connectWebSocket() {
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:connectWebSocket:attempt', 'WS connect attempt', { url: WS_URL }, 'H3');
  // #endregion
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    // #region agent log
    DEBUG_LOG('qq-bot-napcat.js:connectWebSocket:open', 'WS connected', { url: WS_URL }, 'H3');
    // #endregion
    console.log('🔌 WebSocket连接已建立');
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.post_type === 'message' && message.message_type === 'private') {
        await handleMessage(message);
      } else if (message.post_type === 'notice') {
        await handleNoticeEvent(message);
      }
    } catch (error) {
      console.error('处理WebSocket消息时出错:', error);
    }
  });
  
  ws.on('close', (code, reason) => {
    // #region agent log
    DEBUG_LOG('qq-bot-napcat.js:connectWebSocket:close', 'WS closed', { code, reason: (reason && reason.toString()) || '' }, 'H3');
    // #endregion
    console.log('🔌 WebSocket连接已断开，尝试重连...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (error) => {
    // #region agent log
    DEBUG_LOG('qq-bot-napcat.js:connectWebSocket:error', 'WS error', { errorMessage: error.message }, 'H3');
    // #endregion
    console.error('WebSocket连接错误:', error);
  });
}

// 获取登录信息
async function getLoginInfo() {
  return await callAPI('get_login_info');
}

// 检查NapCat是否连接
async function checkConnection() {
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:checkConnection:entry', 'checkConnection called', { url: ONEBOT_API }, 'H1');
  // #endregion
  try {
    const info = await getLoginInfo();
    // #region agent log
    DEBUG_LOG('qq-bot-napcat.js:checkConnection:ok', 'getLoginInfo success', { nickname: info && info.nickname, user_id: info && info.user_id }, 'H2');
    // #endregion
    console.log(`✅ NapCat已连接 - 当前登录: ${info.nickname} (${info.user_id})`);
    return true;
  } catch (error) {
    // #region agent log
    DEBUG_LOG('qq-bot-napcat.js:checkConnection:fail', 'getLoginInfo failed', { errorMessage: error.message, errorCode: error.code }, 'H1');
    // #endregion
    console.log('❌ NapCat未连接，请先启动NapCat');
    console.log('💡 启动方法：运行 I:\\autoweb\\autoribao\\NapCatOneKey\\bootmain\\napcat.bat 或 napcat.quick.bat');
    return false;
  }
}

// 处理收到的消息
async function handleMessage(message) {
  console.log(`💬 收到消息: ${message.raw_message}`);
  
  const content = String(message.raw_message || '').trim();
  const senderId = message.sender.user_id;
  const incomingFile = extractIncomingFile(message);
  
  // 权限检查
  const allowAll = AUTHORIZED_USERS.length === 0;
  const isAuthorized = allowAll || AUTHORIZED_USERS.includes(senderId);
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:auth:check', 'auth check', { allowAll, authorizedUsersCount: AUTHORIZED_USERS.length, isAuthorized }, 'H9');
  // #endregion
  if (!isAuthorized) {
    await safeSendPrivateMessage(senderId, '❌ 无权限使用此机器人', 'unauthorized');
    return;
  }

  try {
    if (PEC_STATE.has(senderId)) {
      writePecDebugSnapshot('pec_waiting_event', {
        source: 'private_message',
        message
      });
    }

    if (incomingFile) {
      if (!PEC_STATE.has(senderId)) {
        await safeSendPrivateMessage(senderId, '📎 已收到文件，但当前没有等待中的 PEC 任务。请先发送“PEC”，再上传任务单 Excel。', 'pec_file_without_command');
        return;
      }

      await handlePecFileMessage(senderId, incomingFile);
      return;
    }

    if (!content) {
      return;
    }

    const shoufacunCommand = parseShoufacunCommand(content);
    if (shoufacunCommand) {
      const displayMonth = shoufacunCommand.monthKey ? shoufacunCommand.monthKey.replace('-', '年') + '月' : '本月';
      await safeSendPrivateMessage(senderId, `📊 正在生成${displayMonth}收发存...`, 'shoufacun_start');
      console.log(`📊 开始执行收发存脚本: ${shoufacunCommand.monthKey || 'default-current-month'}`);

      const shoufacunArgs = ['src/main.js', '--shoufacun'];
      if (shoufacunCommand.monthKey) {
        shoufacunArgs.push('--month', shoufacunCommand.monthKey);
      }

      DEBUG_LOG('qq-bot-napcat.js:spawn:shoufacun', 'spawning shoufacun report', { cwd: PROJECT_ROOT, args: shoufacunArgs }, 'H12');
      const result2 = spawnSync('node', shoufacunArgs, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      if (result2.status === 0) {
        await safeSendPrivateMessage(senderId, '✅ 收发存生成完成，正在把成果通过QQ发给你...', 'shoufacun_done');
        console.log('✅ 收发存执行成功');

        const combined2 = `${result2.stdout || ''}\n${result2.stderr || ''}`;
        const xlsxOut = findFirstMatch(combined2, /收发存报表已生成:\s*(.+?\.xlsx)/);
        DEBUG_LOG('qq-bot-napcat.js:shoufacun:parsedPaths', 'parsed output paths', { hasXlsx: !!xlsxOut }, 'H20');

        if (xlsxOut) {
          await sendResultFileToUser(senderId, xlsxOut, 'shoufacun_result_xlsx', 'file');
        } else {
          await safeSendPrivateMessage(senderId, '⚠️ 收发存已生成，但未能从输出中定位成果文件路径。可在本机归档目录查看。', 'shoufacun_path_not_found');
        }
      } else {
        const errorMsg = result2.stderr || result2.stdout || '未知错误';
        await safeSendPrivateMessage(senderId, `❌ 收发存生成失败：\n${errorMsg}`, 'shoufacun_fail');
        console.log(`❌ 收发存执行失败: ${errorMsg}`);
      }
      return;
    }

    const projectComponentDbCommand = parseProjectDetailCommand(content);
    if (projectComponentDbCommand) {
      await safeSendPrivateMessage(senderId, '📦 正在从数据库生成项目构件详情...', 'project_component_db_start');
      const projectComponentDbResult = await handleProjectComponentDetailExport(content);
      if (projectComponentDbResult.replyText) {
        await safeSendPrivateMessage(senderId, projectComponentDbResult.replyText, 'project_component_db_reply');
      }
      if (Array.isArray(projectComponentDbResult.files) && projectComponentDbResult.files.length > 0) {
        for (let i = 0; i < projectComponentDbResult.files.length; i += 1) {
          const file = projectComponentDbResult.files[i];
          if (!file || !file.path) continue;
          await sendResultFileToUser(senderId, file.path, `project_component_db_file_${i + 1}`, file.kind || 'file');
        }
      }
      return;
    }

    if (content.startsWith('项目构件详情')) {
      await safeSendPrivateMessage(senderId, '🔎 正在查询项目构件详情...', 'project_component_start');
      const projectComponentResult = await queryProjectComponentDetails(content);
      if (projectComponentResult && projectComponentResult.replyText) {
        await safeSendPrivateMessage(senderId, projectComponentResult.replyText, 'project_component_reply');
      }
      if (projectComponentResult && Array.isArray(projectComponentResult.files) && projectComponentResult.files.length > 0) {
        for (let i = 0; i < projectComponentResult.files.length; i += 1) {
          const file = projectComponentResult.files[i];
          if (!file || !file.path) continue;
          await sendResultFileToUser(senderId, file.path, `project_component_file_${i + 1}`, file.kind || 'file');
        }
      }
      return;
    }

    if (PEC_STATE.has(senderId) && message.message_id) {
      const detailedMessage = await getMessageDetails(message.message_id);
      if (detailedMessage) {
        writePecDebugSnapshot('pec_waiting_get_msg', {
          source: 'get_msg',
          messageId: message.message_id,
          detailedMessage
        });

        const detailedFile = extractIncomingFile(detailedMessage);
        if (detailedFile) {
          await handlePecFileMessage(senderId, detailedFile);
          return;
        }
      }
    }

    switch (content) {
      case '测试':
        await safeSendPrivateMessage(senderId, '✅ 机器人正常工作！', 'test_ok');
        console.log('✅ 已回复测试消息');
        break;

      case '工序校对':
      case '夜间校对':
        await safeSendPrivateMessage(senderId, '🔎 正在执行工序数据校对...', 'nightly_reconciliation_manual_start');
        runNightlyReconciliationJob(`manual:${senderId}`);
        break;

      case '月度工序校对':
        await safeSendPrivateMessage(senderId, '📅 正在执行月度工序数据校对...', 'monthly_reconciliation_manual_start');
        runNightlyReconciliationJob(`monthly-manual:${senderId}`, buildMonthlyBusinessRange(new Date()));
        break;

      case '发货对齐':
        await safeSendPrivateMessage(senderId, '🚚 正在执行发货数据对齐...', 'shipping_alignment_manual_start');
        runNightlyShippingAlignmentJob(`manual-shipping:${senderId}`);
        break;

      case '月度发货对齐':
        await safeSendPrivateMessage(senderId, '📦 正在执行月度发货数据对齐...', 'monthly_shipping_alignment_manual_start');
        runNightlyShippingAlignmentJob(`monthly-shipping-manual:${senderId}`, buildMonthlyBusinessRange(new Date()));
        break;

      case 'PEC':
        PEC_STATE.set(senderId, {
          mode: 'awaiting_pec_file',
          requestedAt: Date.now()
        });
        await safeSendPrivateMessage(senderId, '📄 请发送 PEC 任务单 Excel 文件，我会自动完成导入、运行 PEC 自动化，并把编码压缩包回传给你。', 'pec_waiting_file');
        console.log('📄 已进入 PEC 收文件等待状态');
        break;
        
      case '日报':
        await safeSendPrivateMessage(senderId, '📋 正在生成日报...', 'daily_start');
        console.log('📋 开始执行日报脚本');
        
        // 执行日报脚本
        // #region agent log
        DEBUG_LOG('qq-bot-napcat.js:spawn:daily', 'spawning daily report', { cwd: PROJECT_ROOT, args0: 'src/main.js' }, 'H12');
        // #endregion
        const result = spawnSync('node', ['src/main.js', '--daily'], {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        if (result.status === 0) {
          await safeSendPrivateMessage(senderId, '✅ 日报生成完成，正在把成果通过QQ发给你...', 'daily_done');
          console.log('✅ 日报执行成功');

          const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
          const xlsxPath = findFirstMatch(combined, /生成当日日报：\s*(.+?\.xlsx)/);
          const pngPath = findFirstMatch(combined, /导出日报图片：\s*(.+?\.png)/);
          // #region agent log
          DEBUG_LOG('qq-bot-napcat.js:daily:parsedPaths', 'parsed output paths', { hasXlsx: !!xlsxPath, hasPng: !!pngPath }, 'H20');
          // #endregion

          if (pngPath) await sendResultFileToUser(senderId, pngPath, 'daily_result_png', 'image');
          if (xlsxPath) await sendResultFileToUser(senderId, xlsxPath, 'daily_result_xlsx', 'file');

          if (!pngPath && !xlsxPath) {
            await safeSendPrivateMessage(senderId, '⚠️ 日报已生成，但未能从输出中定位成果文件路径。可在本机日报归档目录查看。', 'daily_path_not_found');
          }
        } else {
          const errorMsg = result.stderr || result.stdout || '未知错误';
          await safeSendPrivateMessage(senderId, `❌ 日报生成失败：\n${errorMsg}`, 'daily_fail');
          console.log(`❌ 日报执行失败: ${errorMsg}`);
        }
        break;
        
      case '帮助':
        const helpMsg = `🤖 QQ机器人使用指南：

📋 可用指令：
• 测试 - 测试机器人连接
• PEC - 上传 PEC 任务单 Excel，自动回传编码压缩包
• 日报 - 生成当日日报
• 收发存 - 生成本月收发存报表
• 2026年4月收发存 - 生成指定月份收发存报表
• 工序校对 - 立即执行一次工序 API 与数据库校对
• 月度工序校对 - 立即执行一次上个 26 至本月 25 的整月工序校对
• 发货对齐 - 立即执行一次发货 API 与数据库对齐
• 月度发货对齐 - 立即执行一次上个 26 至本月 25 的整月发货对齐
• 项目名+“的构件详情” - 从数据库生成该项目的构件详情 Excel
• 自然语言查询 - 例如“葛十军车间装焊查询”
• 自然语言查询 - 例如“韩祥玉班组装焊查询”
• 构件查计划 - 例如“T2-8ZCL-1属于哪个计划”
• 构件查计划 - 例如“构件编号 T2-8ZCL-1 属于哪个计划名称”
• 帮助 - 显示此帮助信息

⚡ 执行结果将通过QQ发给你
📎 班组/车间主任装焊查询会自动附带反馈表 Excel

🔒 仅授权用户可以使用此机器人`;
        await safeSendPrivateMessage(senderId, helpMsg, 'help');
        console.log('📋 已发送帮助信息');
        break;
        
      default:
        const naturalResult = await handleNaturalLanguageQuery({
          text: content,
          senderId,
          source: 'qq-private',
          now: new Date()
        });

        if (naturalResult && naturalResult.handled) {
          await safeSendPrivateMessage(senderId, naturalResult.replyText, 'natural_query');

          if (Array.isArray(naturalResult.files) && naturalResult.files.length > 0) {
            for (let i = 0; i < naturalResult.files.length; i += 1) {
              const file = naturalResult.files[i];
              if (!file || !file.path) continue;
              await sendResultFileToUser(senderId, file.path, `natural_query_file_${i + 1}`, file.kind || 'file');
            }
          }
        } else {
          await safeSendPrivateMessage(senderId, '❓ 未识别到可执行查询。试试“帮助”，或者直接发“T2-8ZCL-1属于哪个计划”。', 'unknown');
        }
    }
  } catch (error) {
    console.error('处理消息时出错:', error);
    await safeSendPrivateMessage(senderId, `❌ 处理消息时出错: ${error.message}`, 'handler_error');
  }
}

// 启动机器人
async function startBot() {
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:startBot:entry', 'startBot called', {}, 'H5');
  // #endregion
  console.log('🔍 检查NapCat连接状态...');

  const isConnected = await checkConnection();
  if (!isConnected) {
    // #region agent log
    DEBUG_LOG('qq-bot-napcat.js:startBot:exitFail', 'exiting: checkConnection false', {}, 'H1');
    // #endregion
    console.log('❌ 无法连接到NapCat，程序退出');
    process.exit(1);
  }
  
  console.log('🎉 QQ机器人启动成功！');
  console.log('📱 现在可以给机器人发消息了');
  console.log('📋 发送"帮助"查看所有可用指令');
  console.log('');
  
  // 启动WebSocket连接接收消息
  connectWebSocket();
  console.log('🔌 已启动WebSocket消息接收，等待消息...');
  console.log('🗓️ 夜间工序/发货定时任务已迁移到 Windows 任务计划程序；QQ机器人仅负责收发消息与手动触发。');
}

// 启动
startBot().catch(error => {
  console.error('启动机器人失败:', error);
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('👋 正在关闭QQ机器人...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});
