const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const JIAJIAOAGENT_REPO_ROOT = 'I:\\jiajiaoagent';
const JIAJIAOAGENT_BACKEND_ROOT = path.join(JIAJIAOAGENT_REPO_ROOT, 'backend');
const JIAJIAOAGENT_BACKEND_ENV_PATH = path.join(JIAJIAOAGENT_BACKEND_ROOT, '.env');
const JIAJIAOAGENT_BRIDGE_SOURCE = path.join(
  JIAJIAOAGENT_BACKEND_ROOT,
  'src',
  'bridge',
  'hermesTutorBridge.ts'
);
const JIAJIAOAGENT_BRIDGE_COMPILED = path.join(
  JIAJIAOAGENT_BACKEND_ROOT,
  'dist',
  'bridge',
  'hermesTutorBridge.js'
);
const JIAJIAOAGENT_TSX_CLI = path.join(
  JIAJIAOAGENT_BACKEND_ROOT,
  'node_modules',
  'tsx',
  'dist',
  'cli.mjs'
);
const DEFAULT_BACKEND_PORT = 8787;
const DEFAULT_FAST_TIMEOUT_MS = 12000;

let glmKeyCache;

function ensureApiKey() {
  if (process.env.LLM_API_KEY || process.env.GLM_API_KEY) {
    return;
  }
  if (glmKeyCache !== undefined) {
    if (glmKeyCache) {
      process.env.GLM_API_KEY = glmKeyCache;
    }
    return;
  }

  try {
    const result = spawnSync(
      'wsl.exe',
      ['-d', 'Ubuntu', 'bash', '-lc', "grep '^GLM_API_KEY=' ~/.hermes/.env | head -n 1 | cut -d= -f2-"],
      { encoding: 'utf8', stdio: 'pipe' }
    );
    const key = (result.stdout || '').trim();
    glmKeyCache = key || '';
    if (key) {
      process.env.GLM_API_KEY = key;
    }
  } catch (_) {
    glmKeyCache = '';
  }
}

function findEnvValueInFile(filePath, keys) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const key of keys) {
      const prefix = `${key}=`;
      const line = lines.find((item) => String(item || '').trim().startsWith(prefix));
      if (!line) {
        continue;
      }
      return line.trim().slice(prefix.length).replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) {}
  return '';
}

function resolveBackendBaseUrl() {
  const explicit = (
    process.env.JIAJIAOAGENT_BACKEND_BASE_URL ||
    findEnvValueInFile(JIAJIAOAGENT_BACKEND_ENV_PATH, ['JIAJIAOAGENT_BACKEND_BASE_URL'])
  || '').trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const portValue = (
    process.env.JIAJIAOAGENT_BACKEND_PORT ||
    process.env.PORT ||
    findEnvValueInFile(JIAJIAOAGENT_BACKEND_ENV_PATH, ['JIAJIAOAGENT_BACKEND_PORT', 'PORT'])
  || '').trim();
  const port = Number(portValue);
  const resolvedPort = Number.isFinite(port) && port > 0 ? port : DEFAULT_BACKEND_PORT;
  return `http://127.0.0.1:${resolvedPort}`;
}

function resolvePipelineMode() {
  const raw = (
    process.env.JIAJIAOAGENT_PIPELINE_MODE ||
    findEnvValueInFile(JIAJIAOAGENT_BACKEND_ENV_PATH, ['JIAJIAOAGENT_PIPELINE_MODE'])
  || 'auto').trim().toLowerCase();
  if (raw === 'legacy' || raw === 'fast') {
    return raw;
  }
  return 'auto';
}

function resolveFastTimeoutMs() {
  const raw = (
    process.env.JIAJIAOAGENT_FAST_TIMEOUT_MS ||
    findEnvValueInFile(JIAJIAOAGENT_BACKEND_ENV_PATH, ['JIAJIAOAGENT_FAST_TIMEOUT_MS'])
  || '').trim();
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 500) {
    return value;
  }
  return DEFAULT_FAST_TIMEOUT_MS;
}

function resolveBridgeLaunch() {
  const nodeBin = process.execPath || 'node';
  let scriptPath = JIAJIAOAGENT_BRIDGE_COMPILED;
  let args = [];

  const compiledExists = fs.existsSync(JIAJIAOAGENT_BRIDGE_COMPILED);
  const sourceExists = fs.existsSync(JIAJIAOAGENT_BRIDGE_SOURCE);
  const shouldUseSource =
    sourceExists &&
    (!compiledExists || fs.statSync(JIAJIAOAGENT_BRIDGE_SOURCE).mtimeMs > fs.statSync(JIAJIAOAGENT_BRIDGE_COMPILED).mtimeMs);

  if (shouldUseSource) {
    if (!fs.existsSync(JIAJIAOAGENT_TSX_CLI)) {
      throw new Error(`tsx CLI not found: ${JIAJIAOAGENT_TSX_CLI}`);
    }
    scriptPath = JIAJIAOAGENT_BRIDGE_SOURCE;
    args = [JIAJIAOAGENT_TSX_CLI, scriptPath];
  } else {
    if (!compiledExists) {
      throw new Error(`bridge script not found: ${JIAJIAOAGENT_BRIDGE_COMPILED}`);
    }
    args = [scriptPath];
  }

  return { command: nodeBin, args };
}

function buildBridgePayload(content, senderId) {
  return {
    text: content,
    senderId: String(senderId),
    source: 'qq',
    childId: 'trial-child-001'
  };
}

function invokeLegacyBridge(content, senderId, debugLog) {
  ensureApiKey();

  const payloadBase64 = Buffer.from(JSON.stringify(buildBridgePayload(content, senderId)), 'utf8').toString('base64');
  const launch = resolveBridgeLaunch();
  const args = launch.args.concat(['--input-json-base64', payloadBase64]);

  debugLog(
    'jiajiaoagent-bridge-router:legacyInvoke',
    'invoking jiajiaoagent legacy bridge',
    { command: launch.command, argsPreview: args.slice(0, 4), senderId: String(senderId) },
    'H22'
  );

  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, args, {
      cwd: JIAJIAOAGENT_BACKEND_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ status: code, stdout, stderr });
    });
  });
}

async function invokeFastPath(content, senderId, debugLog) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is unavailable in current Node runtime');
  }

  const baseUrl = resolveBackendBaseUrl();
  const timeoutMs = resolveFastTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`fast path timeout after ${timeoutMs}ms`)), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}/api/bridge/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildBridgePayload(content, senderId)),
      signal: controller.signal
    });
    const bodyText = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(bodyText || '{}');
    } catch (error) {
      throw new Error(`fast path JSON parse failed: ${error.message}`);
    }

    debugLog(
      'jiajiaoagent-bridge-router:fastDone',
      'jiajiaoagent fast path finished',
      {
        senderId: String(senderId),
        baseUrl,
        durationMs: Date.now() - startedAt,
        status: response.status,
        ok: response.ok,
        handled: !!(payload && payload.handled)
      },
      'H22'
    );

    if (!response.ok) {
      throw new Error(`fast path HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchBridgePayload(senderId, payload, deps, options = {}) {
  const { sendMessage, sendFile } = deps;
  const allowUnhandledMessage = options.allowUnhandledMessage !== false;

  if (!payload || !payload.ok || !payload.handled) {
    if (allowUnhandledMessage) {
      await sendMessage(senderId, '⚠️ 家教陪练当前未处理这条消息。', 'jiajiaoagent_unhandled');
    }
    return false;
  }

  if (payload.replyText) {
    await sendMessage(senderId, payload.replyText, 'jiajiaoagent_reply');
  }

  if (Array.isArray(payload.files) && payload.files.length > 0) {
    for (let i = 0; i < payload.files.length; i += 1) {
      const file = payload.files[i];
      if (!file || !file.path) continue;
      await sendFile(senderId, file.path, 'jiajiaoagent_file_' + (i + 1), file.kind || 'file');
    }
  }

  if (Array.isArray(payload.followUpMessages) && payload.followUpMessages.length > 0) {
    for (let i = 0; i < payload.followUpMessages.length; i += 1) {
      const followUp = payload.followUpMessages[i];
      const replyText = String(followUp && followUp.replyText ? followUp.replyText : '').trim();
      if (!replyText) continue;
      await sendMessage(senderId, replyText, 'jiajiaoagent_follow_up_' + (i + 1));
    }
  }

  return true;
}

function parseLegacyPayload(stdout) {
  return JSON.parse(stdout || '{}');
}

async function runLegacyRoute(senderId, content, deps, reason) {
  const { debugLog, sendMessage } = deps;
  const startedAt = Date.now();
  const result = await invokeLegacyBridge(content, senderId, debugLog);

  debugLog(
    'jiajiaoagent-bridge-router:legacyDone',
    'jiajiaoagent legacy bridge finished',
    {
      senderId: String(senderId),
      durationMs: Date.now() - startedAt,
      status: result.status,
      fallbackReason: reason || ''
    },
    'H22'
  );

  if (result.status !== 0) {
    const errorMsg = result.stderr || result.stdout || '未知错误';
    await sendMessage(senderId, '❌ 家教陪练处理失败：\n' + errorMsg, 'jiajiaoagent_bridge_fail');
    return;
  }

  let payload = null;
  try {
    payload = parseLegacyPayload(result.stdout);
  } catch (error) {
    await sendMessage(
      senderId,
      '❌ 家教陪练返回格式异常：' + error.message,
      'jiajiaoagent_bridge_parse_fail'
    );
    return;
  }

  await dispatchBridgePayload(senderId, payload, deps);
}

async function handleJiajiaoagentBridgeRoute(senderId, content, deps) {
  const { debugLog } = deps;
  const mode = resolvePipelineMode();

  debugLog(
    'jiajiaoagent-bridge-router:routeStart',
    'routing jiajiaoagent message',
    {
      senderId: String(senderId),
      mode,
      fastBaseUrl: resolveBackendBaseUrl(),
      fastTimeoutMs: resolveFastTimeoutMs()
    },
    'H22'
  );

  if (mode !== 'legacy') {
    try {
      const payload = await invokeFastPath(content, senderId, debugLog);
      const handled = await dispatchBridgePayload(senderId, payload, deps, {
        allowUnhandledMessage: false
      });
      if (handled) {
        return;
      }
      await runLegacyRoute(senderId, content, deps, 'fast_path_unhandled');
      return;
    } catch (error) {
      debugLog(
        'jiajiaoagent-bridge-router:fastFail',
        'fast path failed, falling back to legacy bridge',
        {
          senderId: String(senderId),
          errorMessage: error && error.message ? error.message : String(error)
        },
        'H22'
      );
      await runLegacyRoute(senderId, content, deps, 'fast_path_failed');
      return;
    }
  }

  await runLegacyRoute(senderId, content, deps, 'legacy_mode');
}

module.exports = {
  handleJiajiaoagentBridgeRoute
};
