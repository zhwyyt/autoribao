const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { handleJiajiaoagentBridgeRoute } = require('../src/jiajiaoagent-bridge-router');

test('handleJiajiaoagentBridgeRoute sends follow-up messages after the main reply', async () => {
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

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        handled: true,
        replyText: 'Main reply',
        followUpMessages: [
          {
            kind: 'stage-change',
            replyText: 'Follow-up one',
            ttsText: '',
            shouldPlayTts: false
          },
          {
            kind: 'stage-change',
            replyText: 'Follow-up two',
            ttsText: '',
            shouldPlayTts: false
          }
        ]
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const sentMessages = [];
  process.env.JIAJIAOAGENT_PIPELINE_MODE = 'fast';
  process.env.JIAJIAOAGENT_BACKEND_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.JIAJIAOAGENT_FAST_TIMEOUT_MS = '2000';

  try {
    await handleJiajiaoagentBridgeRoute(497210274, 'hello', {
      debugLog: () => {},
      sendMessage: async (senderId, text, tag) => {
        sentMessages.push({ senderId, text, tag });
      },
      sendFile: async () => {}
    });
  } finally {
    server.close();
    delete process.env.JIAJIAOAGENT_PIPELINE_MODE;
    delete process.env.JIAJIAOAGENT_BACKEND_BASE_URL;
    delete process.env.JIAJIAOAGENT_FAST_TIMEOUT_MS;
  }

  assert.deepEqual(sentMessages, [
    { senderId: 497210274, text: 'Main reply', tag: 'jiajiaoagent_reply' },
    { senderId: 497210274, text: 'Follow-up one', tag: 'jiajiaoagent_follow_up_1' },
    { senderId: 497210274, text: 'Follow-up two', tag: 'jiajiaoagent_follow_up_2' }
  ]);
});
