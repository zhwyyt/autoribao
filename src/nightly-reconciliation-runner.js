const http = require('http');
const path = require('path');

const { runNightlyProcessReconciliation, buildPreviousDayRange, buildMonthlyBusinessRange } = require('./nightly-process-reconciliation');
const { runNightlyShippingAlignment } = require('./nightly-shipping-alignment');

const ONEBOT_API_PORT = 3000;
const ONEBOT_HOST = '127.0.0.1';
const TARGET_USER_ID = 584201119;

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i += 1) {
        const cur = argv[i];
        if (!cur.startsWith('--')) continue;
        const key = cur.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i += 1;
        } else {
            out[key] = true;
        }
    }
    return out;
}

function toFileUri(filePath) {
    const abs = path.resolve(filePath);
    const withSlashes = abs.replace(/\\/g, '/');
    const encoded = withSlashes.split('/').map(encodeURIComponent).join('/');
    return `file:///${encoded}`;
}

function callApi(endpoint, data) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data || {});
        const req = http.request({
            hostname: ONEBOT_HOST,
            port: ONEBOT_API_PORT,
            path: `/${endpoint}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                Connection: 'close'
            },
            agent: false
        }, res => {
            let body = '';
            res.on('data', chunk => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.status === 'failed') {
                        reject(new Error(parsed.message || `OneBot API 调用失败: ${endpoint}`));
                        return;
                    }
                    resolve(parsed.data);
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function sendPrivateMessage(userId, message) {
    return callApi('send_private_msg', {
        user_id: userId,
        message
    });
}

async function sendResultFile(userId, filePath, kind = 'file') {
    const uri = toFileUri(filePath);
    const base = path.basename(filePath);
    const cq = kind === 'image'
        ? `[CQ:image,file=${uri}]`
        : `[CQ:file,file=${uri},name=${base}]`;
    await sendPrivateMessage(userId, cq);
}

function resolveRange(rangeType, now = new Date()) {
    if (rangeType === 'monthly') {
        return buildMonthlyBusinessRange(now);
    }
    return buildPreviousDayRange(now);
}

async function runTask(taskType, range) {
    if (taskType === 'shipping') {
        return runNightlyShippingAlignment({ now: new Date(), range });
    }
    return runNightlyProcessReconciliation({ now: new Date(), range });
}

function buildStartMessage(taskType, rangeType, range) {
    const taskLabel = taskType === 'shipping' ? '发货对齐' : '工序校对';
    const rangeLabel = rangeType === 'monthly' ? '月度' : '每日';
    return `开始执行${rangeLabel}${taskLabel}：${range.label}`;
}

function buildNoMismatchMessage(taskType, rangeType, range) {
    const taskLabel = taskType === 'shipping' ? '发货对齐' : '工序校对';
    const rangeLabel = rangeType === 'monthly' ? '月度' : '每日';
    return `${rangeLabel}${taskLabel}已执行，${range.label} 无差异，无需报告。`;
}

async function notifyResult(taskType, rangeType, result) {
    const prefix = taskType === 'shipping'
        ? `⚠️ ${result.range.label} 发货数据发现差异，已按 API 完成对齐。`
        : `⚠️ ${result.range.label} 工序数据校对发现差异。`;
    await sendPrivateMessage(TARGET_USER_ID, `${prefix}\n\n${result.summaryText}`);
    if (result.reportPath) {
        await sendResultFile(TARGET_USER_ID, result.reportPath, 'file');
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const taskType = String(args.task || 'process').trim().toLowerCase();
    const rangeType = String(args.range || 'daily').trim().toLowerCase();
    if (!['process', 'shipping'].includes(taskType)) {
        throw new Error(`不支持的 task: ${taskType}`);
    }
    if (!['daily', 'monthly'].includes(rangeType)) {
        throw new Error(`不支持的 range: ${rangeType}`);
    }

    const range = resolveRange(rangeType, new Date());
    console.log(buildStartMessage(taskType, rangeType, range));

    const result = await runTask(taskType, range);
    console.log(JSON.stringify({
        taskType,
        rangeType,
        range,
        hasMismatch: result.hasMismatch,
        reportPath: result.reportPath || null
    }, null, 2));

    if (!result.hasMismatch) {
        console.log(buildNoMismatchMessage(taskType, rangeType, range));
        return;
    }

    await notifyResult(taskType, rangeType, result);
    console.log(`已发送${taskType === 'shipping' ? '发货' : '工序'}报告：${result.reportPath}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
