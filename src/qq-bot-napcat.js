const http = require('http');
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const WebSocket = require('ws');
const { handleJiajiaoagentBridgeRoute } = require('./jiajiaoagent-bridge-router');
const { handleJiajiaoagentQuickControl } = require('./jiajiaoagent-quick-router');
const {
  parseAssessmentCommand,
  handleAssessmentCommand,
  parseFanganCommand,
  handleAutowebfanganReportCommand
} = require('./autowebfangan-bridge-router');
const { handleNaturalLanguageQuery } = require('./query');
const { queryProjectComponentDetails } = require('./project-component-details');
const { parseProjectDetailCommand, handleProjectComponentDetailExport } = require('./project-component-details-db');
const { parseShippingRangeCommand, generateShippingRangeReport } = require('./shipping-range-report');
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
const JIAJIAOAGENT_VOICE_DEBUG_DIR = path.resolve(__dirname, '../logs/jiajiaoagent-voice-debug');
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
const AUTOWEBFANGAN_CONFIG = {
  repoRoot: 'I:\\autoweb\\autowebfangan'
};
const JIAJIAOAGENT_REPO_ROOT = 'I:\\jiajiaoagent';
const JIAJIAOAGENT_ROUTING_CONFIG_PATH = path.join(JIAJIAOAGENT_REPO_ROOT, 'config', 'napcat-routing.json');
const JIAJIAOAGENT_BACKEND_ENV_PATH = path.join(JIAJIAOAGENT_REPO_ROOT, 'backend', '.env');
const JIAJIAOAGENT_OPENAI_STT_BASE_URL = 'https://api.openai.com/v1';
const JIAJIAOAGENT_OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe';
const JIAJIAOAGENT_GPT_AUDIO_MODEL = 'gpt-4o-audio-preview';
const JIAJIAOAGENT_MIMO_AUDIO_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
const JIAJIAOAGENT_MIMO_AUDIO_MODEL = 'mimo-v2-omni';
const JIAJIAOAGENT_SILK_WASM_ENTRY = path.join(JIAJIAOAGENT_REPO_ROOT, 'backend', 'node_modules', 'silk-wasm', 'lib', 'index.mjs');
let QQ_WHITELIST_ROUTING = {
  defaultTarget: 'ignore',
  targets: {
    autoribao: { userIds: [] },
    jiajiaoagent: { userIds: [] }
  }
};
let jiajiaoagentSttApiKeyCache;
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
  if (cfg && cfg.autowebfangan && typeof cfg.autowebfangan.repoRoot === 'string' && cfg.autowebfangan.repoRoot.trim()) {
    AUTOWEBFANGAN_CONFIG.repoRoot = cfg.autowebfangan.repoRoot.trim();
  }
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:config:loaded', 'loaded config', { configPath: CONFIG_PATH, authorizedUsersCount: AUTHORIZED_USERS.length }, 'H8');
  // #endregion
} catch (e) {
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:config:error', 'failed to load config', { configPath: CONFIG_PATH, errorMessage: e.message }, 'H8');
  // #endregion
}

try {
  const raw = fs.readFileSync(JIAJIAOAGENT_ROUTING_CONFIG_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  if (cfg && cfg.targets) {
    QQ_WHITELIST_ROUTING = cfg;
  }
  DEBUG_LOG(
    'qq-bot-napcat.js:routing:loaded',
    'loaded napcat whitelist routing config',
    { routingConfigPath: JIAJIAOAGENT_ROUTING_CONFIG_PATH, targets: Object.keys((QQ_WHITELIST_ROUTING && QQ_WHITELIST_ROUTING.targets) || {}) },
    'H21'
  );
} catch (e) {
  DEBUG_LOG(
    'qq-bot-napcat.js:routing:error',
    'failed to load napcat whitelist routing config',
    { routingConfigPath: JIAJIAOAGENT_ROUTING_CONFIG_PATH, errorMessage: e.message },
    'H21'
  );
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

function normalizeUserId(userId) {
  return String(userId || '').trim();
}

function resolveWhitelistTarget(userId) {
  const normalized = normalizeUserId(userId);
  const targets = (QQ_WHITELIST_ROUTING && QQ_WHITELIST_ROUTING.targets) || {};

  for (const [target, cfg] of Object.entries(targets)) {
    const list = Array.isArray(cfg && cfg.userIds) ? cfg.userIds.map((item) => String(item)) : [];
    if (list.includes(normalized)) {
      return target;
    }
  }

  return (QQ_WHITELIST_ROUTING && QQ_WHITELIST_ROUTING.defaultTarget) || 'ignore';
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

function parseCqAttributes(rawText, cqType) {
  const text = String(rawText || '');
  const match = text.match(new RegExp(`\\[CQ:${cqType},([^\\]]+)\\]`, 'i'));
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

  return attributes;
}

function firstStringValue(source, keys) {
  if (!source || typeof source !== 'object') {
    return '';
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function extractSegmentSpeechText(data) {
  return firstStringValue(data, [
    'text',
    'asr_text',
    'voice_text',
    'transcript',
    'transcription',
    'recognition',
    'recognition_text',
    'speech_text',
    'summary'
  ]);
}

function htmlDecodeBasic(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']');
}

function findEnvValueInFile(filePath, keys) {
  try {
    if (!fs.existsSync(filePath)) {
      return '';
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const key of keys) {
      const prefix = key + '=';
      const line = lines.find((item) => item.trim().startsWith(prefix));
      if (!line) {
        continue;
      }
      return line.trim().slice(prefix.length).replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) {}
  return '';
}

function findJiajiaoagentEnvValue(keys) {
  return findEnvValueInFile(JIAJIAOAGENT_BACKEND_ENV_PATH, keys);
}

function resolveJiajiaoagentSttApiKey() {
  if (jiajiaoagentSttApiKeyCache !== undefined) {
    return jiajiaoagentSttApiKeyCache;
  }

  jiajiaoagentSttApiKeyCache = (
    process.env.MIMO_API_KEY ||
    process.env.OPENAI_AUDIO_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GPT_API_KEY ||
    process.env.OPENAI_STT_API_KEY ||
    process.env.LLM_API_KEY ||
    findJiajiaoagentEnvValue(['MIMO_API_KEY', 'OPENAI_AUDIO_API_KEY', 'OPENAI_API_KEY', 'GPT_API_KEY', 'OPENAI_STT_API_KEY', 'LLM_API_KEY'])
  || '').trim();

  return jiajiaoagentSttApiKeyCache;
}

function resolveJiajiaoagentDedicatedTranscriptionBaseUrl() {
  return (
    process.env.OPENAI_STT_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    findJiajiaoagentEnvValue(['OPENAI_STT_BASE_URL', 'OPENAI_BASE_URL'])
  || '').trim();
}

function resolveJiajiaoagentLlmBaseUrl() {
  return (
    process.env.OPENAI_AUDIO_BASE_URL ||
    process.env.MIMO_BASE_URL ||
    process.env.LLM_BASE_URL ||
    findJiajiaoagentEnvValue(['OPENAI_AUDIO_BASE_URL', 'MIMO_BASE_URL', 'LLM_BASE_URL'])
  || '').trim();
}

function resolveJiajiaoagentTranscriptionModel() {
  return (
    process.env.OPENAI_STT_MODEL ||
    findJiajiaoagentEnvValue(['OPENAI_STT_MODEL']) ||
    JIAJIAOAGENT_OPENAI_STT_MODEL
  ).trim();
}

function resolveJiajiaoagentGptAudioModel() {
  return (
    process.env.OPENAI_AUDIO_MODEL ||
    process.env.MIMO_AUDIO_MODEL ||
    process.env.LLM_MODEL ||
    findJiajiaoagentEnvValue(['OPENAI_AUDIO_MODEL', 'MIMO_AUDIO_MODEL', 'LLM_MODEL']) ||
    JIAJIAOAGENT_GPT_AUDIO_MODEL
  ).trim();
}

function extractVoiceInputFromMessage(message) {
  const segments = normalizeMessageSegments(message);
  for (const segment of segments) {
    if (!segment || !segment.data || (segment.type !== 'record' && segment.type !== 'voice')) {
      continue;
    }
    const data = segment.data;
    return {
      file: htmlDecodeBasic(data.file || data.file_id || ''),
      path: htmlDecodeBasic(data.path || ''),
      url: htmlDecodeBasic(data.url || data.download_url || '')
    };
  }

  const rawText = String(message?.raw_message || message?.message || '').trim();
  const attrs = parseCqAttributes(rawText, 'record') || parseCqAttributes(rawText, 'voice') || {};
  return {
    file: htmlDecodeBasic(attrs.file || attrs.file_id || ''),
    path: htmlDecodeBasic(attrs.path || ''),
    url: htmlDecodeBasic(attrs.url || attrs.download_url || '')
  };
}

function resolveLocalVoicePath(voiceInput) {
  const candidates = [
    voiceInput && voiceInput.path,
    voiceInput && voiceInput.file
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizeOutboundFilePath(candidate);
    if (normalized && fs.existsSync(normalized)) {
      return normalized;
    }
  }

  return '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForLocalVoicePath(voiceInput, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const localPath = resolveLocalVoicePath(voiceInput);
    if (localPath) {
      return localPath;
    }
    await sleep(250);
  }
  return resolveLocalVoicePath(voiceInput);
}

async function downloadVoiceInputToTemp(voiceInput) {
  const url = voiceInput && voiceInput.url;
  if (!url || typeof fetch !== 'function') {
    return '';
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Voice download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const ext = path.extname(voiceInput.file || '') || '.amr';
  const fileName = `qq-voice-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function convertVoiceInputToWavWithNapCat(voiceInput) {
  if (!voiceInput || !voiceInput.file) {
    return '';
  }

  const record = await callAPIWithRetry('get_record', {
    file: voiceInput.file,
    out_format: 'wav'
  }, 1);
  const convertedPath = normalizeOutboundFilePath(record && (record.file || record.url || ''));
  if (convertedPath && fs.existsSync(convertedPath)) {
    return convertedPath;
  }

  if (record && typeof record.base64 === 'string' && record.base64) {
    const filePath = path.join(os.tmpdir(), `qq-voice-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
    fs.writeFileSync(filePath, Buffer.from(record.base64, 'base64'));
    return filePath;
  }

  return '';
}

async function prepareVoicePathForTranscription(localPath, voiceInput) {
  const ext = path.extname(localPath).toLowerCase();
  if (['.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm'].includes(ext)) {
    return localPath;
  }

  try {
    const wavPath = await convertVoiceInputToWavWithNapCat(voiceInput);
    if (wavPath) {
      return wavPath;
    }
  } catch (e) {
    writeJiajiaoagentVoiceDebugSnapshot('voice_convert_error', {
      localPath,
      voiceInput,
      errorMessage: e.message,
      errorCode: e.code
    });
  }

  return localPath;
}

function extractTranscriptFromSttResponse(bodyText) {
  try {
    const body = JSON.parse(bodyText || '{}');
    if (typeof body.text === 'string' && body.text.trim()) {
      return body.text.trim();
    }
    const choiceText = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (typeof choiceText === 'string' && choiceText.trim()) {
      return choiceText.trim();
    }
  } catch (_) {}
  return '';
}

function extractChatCompletionText(bodyText) {
  try {
    const body = JSON.parse(bodyText || '{}');
    const content = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => typeof part?.text === 'string' ? part.text : '')
        .join('')
        .trim();
    }
  } catch (_) {}
  return '';
}

function sanitizeVoiceTranscript(transcript) {
  const text = String(transcript || '').trim();
  if (!text) {
    return '';
  }
  if (/can[’']?t access (the )?audio|cannot access (the )?audio|unable to access (the )?audio|无法(访问|读取|听到).*音频|不能(访问|读取|听到).*音频/i.test(text)) {
    return '';
  }
  return text;
}

async function extractChatCompletionStreamText(response) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const chunk = extractChatCompletionStreamChunk(rawEvent);
      if (chunk === '[DONE]') {
        return content.trim();
      }
      content += chunk;
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  content += extractChatCompletionStreamChunk(buffer);
  return content.trim();
}

function extractChatCompletionStreamChunk(rawEvent) {
  const trimmed = String(rawEvent || '').trim();
  if (!trimmed) {
    return '';
  }
  const lines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  let result = '';
  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line === '[DONE]') {
      return '[DONE]';
    }
    try {
      const parsed = JSON.parse(line);
      for (const choice of parsed.choices || []) {
        result += choice.delta && typeof choice.delta.content === 'string' ? choice.delta.content : '';
      }
    } catch (_) {}
  }
  return result;
}

function createPcm16leWavBuffer(pcmBuffer, sampleRate) {
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function prepareAudioForOpenAiTranscription(localPath, audioBuffer) {
  const ext = path.extname(localPath).toLowerCase();
  if (['.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm'].includes(ext)) {
    return { buffer: audioBuffer, filename: path.basename(localPath), mimeType: ext === '.wav' ? 'audio/wav' : 'application/octet-stream' };
  }

  if (!fs.existsSync(JIAJIAOAGENT_SILK_WASM_ENTRY)) {
    return { buffer: audioBuffer, filename: path.basename(localPath), mimeType: 'application/octet-stream' };
  }

  const silk = await import(pathToFileURL(JIAJIAOAGENT_SILK_WASM_ENTRY).href);
  if (typeof silk.isSilk !== 'function' || typeof silk.decode !== 'function' || !silk.isSilk(audioBuffer)) {
    return { buffer: audioBuffer, filename: path.basename(localPath), mimeType: 'application/octet-stream' };
  }

  const sampleRate = Number(process.env.QQ_VOICE_SAMPLE_RATE || 24000);
  const decoded = await silk.decode(audioBuffer, sampleRate);
  const pcm = Buffer.from(decoded.data);
  const wavBuffer = createPcm16leWavBuffer(pcm, sampleRate);
  const wavName = path.basename(localPath, path.extname(localPath)) + '.wav';
  const debugWavPath = path.join(os.tmpdir(), wavName);
  try {
    fs.writeFileSync(debugWavPath, wavBuffer);
  } catch (_) {}
  return { buffer: wavBuffer, filename: wavName, mimeType: 'audio/wav', convertedFrom: localPath, debugWavPath };
}

async function transcribePreparedAudioWithTranscriptionsApi(apiKey, preparedAudio) {
  const form = new FormData();
  form.append('model', resolveJiajiaoagentTranscriptionModel());
  form.append('file', new Blob([preparedAudio.buffer], { type: preparedAudio.mimeType }), preparedAudio.filename);

  const baseUrl = (resolveJiajiaoagentDedicatedTranscriptionBaseUrl() || JIAJIAOAGENT_OPENAI_STT_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });
  const bodyText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    bodyText,
    transcript: response.ok ? sanitizeVoiceTranscript(extractTranscriptFromSttResponse(bodyText)) : '',
    baseUrl,
    method: 'audio_transcriptions'
  };
}

async function transcribePreparedAudioWithGptAudio(apiKey, preparedAudio) {
  const baseUrl = (resolveJiajiaoagentLlmBaseUrl() || resolveJiajiaoagentDedicatedTranscriptionBaseUrl() || JIAJIAOAGENT_OPENAI_STT_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: resolveJiajiaoagentGptAudioModel(),
      messages: [
        {
          role: 'system',
          content: 'Transcribe the child voice message. Return only the spoken words, with no explanation.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Please transcribe this audio exactly. If it is English, keep it English. If it is Chinese, keep it Chinese.'
            },
            {
              type: 'input_audio',
              input_audio: {
                data: preparedAudio.buffer.toString('base64'),
                format: 'wav'
              }
            }
          ]
        }
      ],
      temperature: 0,
      max_completion_tokens: 300,
      stream: true
    })
  });
  const transcript = response.ok ? sanitizeVoiceTranscript(await extractChatCompletionStreamText(response)) : '';
  const bodyText = transcript || await response.text();
  return {
    ok: response.ok,
    status: response.status,
    bodyText,
    transcript,
    baseUrl,
    method: 'chat_audio'
  };
}

async function transcribeJiajiaoagentVoiceMessage(message, senderId) {
  const apiKey = resolveJiajiaoagentSttApiKey();
  const voiceInput = extractVoiceInputFromMessage(message);

  if (!apiKey || typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    writeJiajiaoagentVoiceDebugSnapshot('voice_stt_skipped', {
      senderId: String(senderId),
      hasApiKey: !!apiKey,
      hasFetch: typeof fetch === 'function',
      voiceInput,
      localPath: ''
    });
    return '';
  }

  let localPath = await waitForLocalVoicePath(voiceInput);
  let downloadedPath = '';
  try {
    if (!localPath) {
      downloadedPath = await downloadVoiceInputToTemp(voiceInput);
      localPath = downloadedPath;
    }

    if (!localPath) {
      writeJiajiaoagentVoiceDebugSnapshot('voice_stt_skipped', {
        senderId: String(senderId),
        hasApiKey: !!apiKey,
        hasLocalPath: false,
        hasFetch: typeof fetch === 'function',
        voiceInput,
        localPath
      });
      return '';
    }

    const originalLocalPath = localPath;
    localPath = await prepareVoicePathForTranscription(localPath, voiceInput);
    const audio = fs.readFileSync(localPath);
    const preparedAudio = await prepareAudioForOpenAiTranscription(localPath, audio);
    const dedicatedBaseUrl = resolveJiajiaoagentDedicatedTranscriptionBaseUrl();
    const result = dedicatedBaseUrl
      ? await transcribePreparedAudioWithTranscriptionsApi(apiKey, preparedAudio)
      : await transcribePreparedAudioWithGptAudio(apiKey, preparedAudio);
    const transcript = result.transcript;

    writeJiajiaoagentVoiceDebugSnapshot(transcript ? 'voice_stt_ok' : 'voice_stt_empty', {
      senderId: String(senderId),
      status: result.status,
      localPath,
      originalLocalPath,
      downloadedPath,
      size: preparedAudio.buffer.length,
      originalSize: audio.length,
      filename: preparedAudio.filename,
      convertedFrom: preparedAudio.convertedFrom || '',
      debugWavPath: preparedAudio.debugWavPath || '',
      baseUrl: result.baseUrl,
      method: result.method,
      transcript,
      bodyPreview: result.bodyText.slice(0, 500)
    });

    return transcript;
  } catch (e) {
    writeJiajiaoagentVoiceDebugSnapshot('voice_stt_error', {
      senderId: String(senderId),
      localPath,
      downloadedPath,
      errorMessage: e.message,
      errorCode: e.code
    });
    return '';
  }
}

function extractMessageContentForJiajiaoagent(message) {
  const segments = normalizeMessageSegments(message);
  const textParts = [];

  for (const segment of segments) {
    if (!segment || !segment.data) {
      continue;
    }

    if (segment.type === 'text') {
      const text = firstStringValue(segment.data, ['text']);
      if (text) {
        textParts.push(text);
      }
      continue;
    }

    if (segment.type === 'record' || segment.type === 'voice') {
      const speechText = extractSegmentSpeechText(segment.data);
      if (speechText) {
        textParts.push(speechText);
      }
    }
  }

  if (textParts.length > 0) {
    return textParts.join(' ').trim();
  }

  const rawText = String(message?.raw_message || message?.message || '').trim();
  const recordAttrs = parseCqAttributes(rawText, 'record') || parseCqAttributes(rawText, 'voice');
  const cqSpeechText = extractSegmentSpeechText(recordAttrs);
  if (cqSpeechText) {
    return cqSpeechText;
  }

  return rawText;
}

function isVoiceOnlyMessageWithoutText(message, content) {
  const rawText = String(message?.raw_message || message?.message || '').trim();
  if (!rawText || String(content || '').trim() !== rawText) {
    return false;
  }

  const segments = normalizeMessageSegments(message);
  if (segments.some(segment => segment && segment.type === 'text' && firstStringValue(segment.data, ['text']))) {
    return false;
  }

  if (segments.some(segment => segment && (segment.type === 'record' || segment.type === 'voice'))) {
    return true;
  }

  return /^\[CQ:(record|voice),/i.test(rawText);
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

function writeJiajiaoagentVoiceDebugSnapshot(tag, payload) {
  try {
    fs.mkdirSync(JIAJIAOAGENT_VOICE_DEBUG_DIR, { recursive: true });
    const filePath = path.join(
      JIAJIAOAGENT_VOICE_DEBUG_DIR,
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

function normalizeOutboundFilePath(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    return raw;
  }

  const mntMatch = raw.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!mntMatch) {
    return raw;
  }

  const drive = mntMatch[1].toUpperCase();
  const rest = mntMatch[2].replace(/\//g, '\\');
  return drive + ':\\' + rest;
}

async function sendResultFileToUser(userId, filePath, tag, kind) {
  const normalizedPath = normalizeOutboundFilePath(filePath);
  const st = statSafe(normalizedPath);
  // #region agent log
  DEBUG_LOG(
    'qq-bot-napcat.js:result:fileCandidate',
    'candidate result file',
    { tag, kind, exists: !!st, size: st ? st.size : null, base: st ? path.basename(normalizedPath) : path.basename(normalizedPath), originalPath: filePath, normalizedPath },
    'H20'
  );
  // #endregion
  if (!st || !st.isFile()) {
    await safeSendPrivateMessage(userId, `⚠️ 未找到生成文件：${normalizedPath}`, `${tag}_missing`);
    return false;
  }

  const uri = toFileUri(normalizedPath);
  const base = path.basename(normalizedPath);

  // NapCat / OneBot V11: CQ 码形式发送本地文件（enableLocalFile2Url=true 时通常可用）
  const cq =
    kind === 'image'
      ? `[CQ:image,file=${uri}]`
      : kind === 'voice'
        ? `[CQ:record,file=${uri}]`
        : `[CQ:file,file=${uri},name=${base}]`;

  const ok = await safeSendPrivateMessage(userId, cq, `${tag}_cq_${kind}`);
  if (ok) {
    const shouldSendSuccessTip = kind !== 'voice';
    if (shouldSendSuccessTip) {
      await safeSendPrivateMessage(userId, `✅ 已通过QQ发送成果：${base}`, `${tag}_sent_tip`);
    }
    return true;
  }

  // 兜底：发送路径，方便人工取文件
  await safeSendPrivateMessage(userId, `⚠️ 成果文件已生成但QQ发送失败，可在本机查看：${normalizedPath}`, `${tag}_path_fallback`);
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
  
  const rawContent = String(message.raw_message || '').trim();
  let content = extractMessageContentForJiajiaoagent(message);
  const senderId = message.sender.user_id;
  const incomingFile = extractIncomingFile(message);
  const routedTarget = resolveWhitelistTarget(senderId);

  DEBUG_LOG(
    'qq-bot-napcat.js:routing:resolved',
    'resolved user route target',
    { senderId: String(senderId), routedTarget },
    'H23'
  );

  if (routedTarget === 'ignore') {
    return;
  }

  if (routedTarget === 'jiajiaoagent') {
    if (!content) {
      return;
    }

    if (isVoiceOnlyMessageWithoutText(message, content)) {
      const transcript = await transcribeJiajiaoagentVoiceMessage(message, senderId);
      if (transcript) {
        content = transcript;
      } else {
        let getMsgResult = null;
        let getMsgError = null;
        if (message && message.message_id != null) {
          try {
            getMsgResult = await callAPIWithRetry('get_msg', { message_id: message.message_id }, 1);
          } catch (e) {
            getMsgError = { errorCode: e.code, errorMessage: e.message };
          }
        }
        writeJiajiaoagentVoiceDebugSnapshot('voice_without_transcript', {
          source: 'private_message',
          senderId: String(senderId),
          rawContent,
          extractedContent: content,
          message,
          getMsgResult,
          getMsgError
        });
        DEBUG_LOG(
          'qq-bot-napcat.js:jiajiaoagent:voiceNoTranscript',
          'received voice message without STT transcript; not forwarding CQ record to tutor',
          { senderId: String(senderId), messageId: message && message.message_id, hasGetMsgResult: !!getMsgResult, getMsgError, rawPreview: rawContent.slice(0, 240) },
          'H24'
        );
        await safeSendPrivateMessage(
          senderId,
          '我收到语音了，但这次语音识别没有成功。你再发一遍短一点的英文，我会继续带读。',
          'jiajiaoagent_voice_no_transcript'
        );
        return;
      }
    }

    if (await handleJiajiaoagentQuickControl(senderId, content, safeSendPrivateMessage)) {
      return;
    }

    await handleJiajiaoagentBridgeRoute(senderId, content, {
      debugLog: DEBUG_LOG,
      sendMessage: safeSendPrivateMessage,
      sendFile: sendResultFileToUser
    });
    return;
  }
  
  // 权限检查
  const allowAll = AUTHORIZED_USERS.length === 0;
  const isAuthorized = routedTarget === 'autoribao' ? true : allowAll || AUTHORIZED_USERS.includes(senderId);
  // #region agent log
  DEBUG_LOG('qq-bot-napcat.js:auth:check', 'auth check', { allowAll, authorizedUsersCount: AUTHORIZED_USERS.length, isAuthorized, routedTarget }, 'H9');
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

    const assessmentCommand = parseAssessmentCommand(content);
    if (assessmentCommand) {
      await handleAssessmentCommand(senderId, assessmentCommand, {
        debugLog: DEBUG_LOG,
        sendMessage: safeSendPrivateMessage,
        sendFile: sendResultFileToUser
      }, {
        repoRoot: AUTOWEBFANGAN_CONFIG.repoRoot
      });
      return;
    }

    const fanganCommand = parseFanganCommand(content);
    if (fanganCommand) {
      await handleAutowebfanganReportCommand(senderId, fanganCommand, {
        debugLog: DEBUG_LOG,
        sendMessage: safeSendPrivateMessage,
        sendFile: sendResultFileToUser
      }, {
        repoRoot: AUTOWEBFANGAN_CONFIG.repoRoot
      });
      return;
    }

    const shippingRangeCommand = parseShippingRangeCommand(content);
    if (shippingRangeCommand) {
      if (!shippingRangeCommand.ok) {
        await safeSendPrivateMessage(senderId, `❓ ${shippingRangeCommand.error}`, 'shipping_range_invalid');
        return;
      }

      const { start, end } = shippingRangeCommand;
      await safeSendPrivateMessage(senderId, `📦 正在查询 ${start} 至 ${end} 的发货信息...`, 'shipping_range_start');
      DEBUG_LOG(
        'qq-bot-napcat.js:shippingRange:start',
        'generating shipping range report',
        { senderId: String(senderId), start, end },
        'H25'
      );

      const report = await generateShippingRangeReport({ start, end });
      await safeSendPrivateMessage(
        senderId,
        `✅ 发货信息报表已生成：${report.detailCount} 条明细，覆盖 ${report.monthCount} 个月、${report.projectCount} 个项目。`,
        'shipping_range_done'
      );
      await sendResultFileToUser(senderId, report.outputPath, 'shipping_range_result_xlsx', 'file');
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
• 发货明细 2026-07-01 至 2026-08-10 - 生成日期范围明细和月度汇总 Excel
• 技术方案 - 生成上月技术方案统计报告（Excel + PPT）
• 2026年4月技术方案 - 生成指定月份技术方案统计报告
• 考核 覃祚威 2026-01-01 2026-05-31 - 生成指定审核人技术方案考核 Excel
• 考核 覃祚威 2026年1月-5月 - 生成指定月份区间技术方案考核 Excel
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
