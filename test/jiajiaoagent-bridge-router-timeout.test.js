const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const childProcess = require('node:child_process');

test('handleJiajiaoagentBridgeRoute does not fall back when fast path succeeds after 4 seconds', async () => {
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const modulePath = require.resolve('../src/jiajiaoagent-bridge-router');
  delete require.cache[modulePath];

  let legacyCalls = 0;

  childProcess.spawnSync = () => ({ stdout: '', stderr: '', status: 0 });
  childProcess.spawn = () => {
    legacyCalls += 1;
    const handlers = {
      close: [],
      error: []
    };

    const stdout = {
      on(event, handler) {
        if (event === 'data') {
          setTimeout(() => handler(Buffer.from(JSON.stringify({
            ok: true,
            handled: true,
            replyText: 'Legacy reply'
          }))), 5);
        }
      }
    };

    const stderr = {
      on() {}
    };

    setTimeout(() => {
      for (const handler of handlers.close) {
        handler(0);
      }
    }, 10);

    return {
      stdout,
      stderr,
      on(event, handler) {
        if (handlers[event]) {
          handlers[event].push(handler);
        }
      }
    };
  };

  const { handleJiajiaoagentBridgeRoute } = require('../src/jiajiaoagent-bridge-router');

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/bridge/respond') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      assert.equal(parsed.text, 'hello');
      assert.equal(parsed.senderId, '497210274');

      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          handled: true,
          replyText: 'Fast reply'
        }));
      }, 4000);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const sentMessages = [];
  process.env.LLM_API_KEY = 'test-key';
  process.env.JIAJIAOAGENT_PIPELINE_MODE = 'auto';
  process.env.JIAJIAOAGENT_BACKEND_BASE_URL = `http://127.0.0.1:${port}`;
  delete process.env.JIAJIAOAGENT_FAST_TIMEOUT_MS;

  try {
    await handleJiajiaoagentBridgeRoute(497210274, 'hello', {
      debugLog: () => {},
      sendMessage: async (senderId, text, tag) => {
        sentMessages.push({ senderId, text, tag });
      },
      sendFile: async () => {}
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    childProcess.spawn = originalSpawn;
    childProcess.spawnSync = originalSpawnSync;
    delete require.cache[modulePath];
    delete process.env.LLM_API_KEY;
    delete process.env.JIAJIAOAGENT_PIPELINE_MODE;
    delete process.env.JIAJIAOAGENT_BACKEND_BASE_URL;
    delete process.env.JIAJIAOAGENT_FAST_TIMEOUT_MS;
  }

  assert.equal(legacyCalls, 0);
  assert.deepEqual(sentMessages, [
    { senderId: 497210274, text: 'Fast reply', tag: 'jiajiaoagent_reply' }
  ]);
});
