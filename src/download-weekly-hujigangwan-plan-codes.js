const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ID = 163;
const PROJECT_NAME = '上海胡姬港湾';
const PLAN_PREFIX = '构件_';
const API_ORIGIN = 'https://dwyunsc.ddwjzkj.com:10086';
const OUTPUT_ROOT = path.join(__dirname, '..', 'downloads', 'weekly-yard-exports');
const STATE_PATH = path.join(OUTPUT_ROOT, 'production-plan-code-export-state.json');
const CHUNK_SIZE = 100;

function text(value) {
    return String(value == null ? '' : value).trim();
}

function sanitizeFileName(value) {
    return text(value).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ') || '未命名生产计划';
}

function dateOutputDir(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now).reduce((result, part) => {
        result[part.type] = part.value;
        return result;
    }, {});
    return path.join(OUTPUT_ROOT, parts.year, parts.month, parts.day, 'production-plan-codes');
}

function loadState(statePath = STATE_PATH) {
    if (!fs.existsSync(statePath)) {
        return { version: 1, project: PROJECT_NAME, downloadedPlans: {} };
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state || state.version !== 1 || !state.downloadedPlans || typeof state.downloadedPlans !== 'object') {
        throw new Error(`生产计划编码下载状态文件格式无效: ${statePath}`);
    }
    return state;
}

function saveState(state, plan, outputPath, artifactCount, statePath = STATE_PATH) {
    const downloadedAt = new Date().toISOString();
    state.downloadedPlans[String(plan.id)] = {
        planName: text(plan.name),
        artifactCount,
        downloadedAt,
        output: path.relative(OUTPUT_ROOT, outputPath).replace(/\\/g, '/')
    };
    state.updatedAt = downloadedAt;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tempPath = `${statePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, statePath);
}

function chunk(items, size = CHUNK_SIZE) {
    const result = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}

function runTar(args) {
    const result = spawnSync('tar.exe', args, { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
        throw new Error(`tar.exe ${args[0]} 失败: ${text(result.stderr || result.stdout)}`);
    }
}

function uniqueTargetPath(targetPath) {
    if (!fs.existsSync(targetPath)) return targetPath;
    const parsed = path.parse(targetPath);
    let index = 1;
    let candidate;
    do {
        candidate = path.join(parsed.dir, `${parsed.name}__dup${index}${parsed.ext}`);
        index += 1;
    } while (fs.existsSync(candidate));
    return candidate;
}

function mergeDirectory(sourceDir, targetDir) {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(targetPath, { recursive: true });
            mergeDirectory(sourcePath, targetPath);
        } else {
            const resolved = uniqueTargetPath(targetPath);
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
            fs.copyFileSync(sourcePath, resolved);
        }
    }
}

function removeStaging(stagingDir, outputDir) {
    const resolvedStaging = path.resolve(stagingDir);
    const resolvedOutput = path.resolve(outputDir);
    if (!resolvedStaging.startsWith(`${resolvedOutput}${path.sep}`) || !path.basename(resolvedStaging).endsWith('__codes_tmp')) {
        throw new Error(`拒绝清理非预期临时目录: ${resolvedStaging}`);
    }
    fs.rmSync(resolvedStaging, { recursive: true, force: true });
}

async function fetchPlans(postJson) {
    const payload = {
        code: '', create_user: 0, department: 0, end_time: 0, keyword: '',
        production_status: -1, proj_id: PROJECT_ID, start_time: 0, size: 200
    };
    const first = await postJson('/v1.production/getPlans', { ...payload, page: 1 });
    const all = [...(first.list || [])];
    const pages = Math.max(1, Math.ceil(Number(first.count || all.length) / Number(first.size || payload.size)));
    for (let page = 2; page <= pages; page += 1) {
        const next = await postJson('/v1.production/getPlans', { ...payload, page });
        all.push(...(next.list || []));
    }
    return all.filter(plan => text(plan.project_name) === PROJECT_NAME && text(plan.name).startsWith(PLAN_PREFIX));
}

async function downloadPlan(page, token, postJson, plan, outputDir) {
    const artifactData = await postJson('/v1.production/getPlanArtifacts', { id: Number(plan.id) });
    const artifacts = Array.isArray(artifactData) ? artifactData : (artifactData.list || []);
    const artifactIds = artifacts.map(item => Number(item.id)).filter(Number.isFinite);
    if (!artifactIds.length) throw new Error(`计划 ${plan.id} 没有可下载的构件`);

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${sanitizeFileName(plan.name)}.zip`);
    if (fs.existsSync(outputPath)) throw new Error(`目标文件已存在但状态未记录: ${outputPath}`);
    const stagingDir = path.join(outputDir, `.${plan.id}__codes_tmp`);
    const mergedDir = path.join(stagingDir, 'merged');
    fs.mkdirSync(mergedDir, { recursive: true });

    try {
        const groups = chunk(artifactIds);
        for (let index = 0; index < groups.length; index += 1) {
            const response = await page.request.post(`${API_ORIGIN}/v1.production/getPlanArtifactsCodes`, {
                data: { id: Number(plan.id), ids: groups[index].join(',') },
                headers: { Token: token, 'Content-Type': 'application/json;charset=utf-8' },
                timeout: 120000
            });
            const buffer = await response.body();
            if (!response.ok() || buffer.subarray(0, 4).toString('hex') !== '504b0304') {
                throw new Error(`编码接口未返回有效 ZIP: HTTP ${response.status()}`);
            }
            const chunkZip = path.join(stagingDir, `chunk-${String(index + 1).padStart(3, '0')}.zip`);
            const extractDir = path.join(stagingDir, `chunk-${String(index + 1).padStart(3, '0')}`);
            fs.writeFileSync(chunkZip, buffer);
            fs.mkdirSync(extractDir, { recursive: true });
            runTar(['-xf', chunkZip, '-C', extractDir]);
            mergeDirectory(extractDir, mergedDir);
        }
        const tempOutput = `${outputPath}.tmp.zip`;
        runTar(['-a', '-cf', tempOutput, '-C', mergedDir, '.']);
        fs.renameSync(tempOutput, outputPath);
        return { outputPath, artifactCount: artifactIds.length, chunkCount: groups.length };
    } finally {
        if (fs.existsSync(stagingDir)) removeStaging(stagingDir, outputDir);
    }
}

async function main() {
    const config = require('../config/default.json');
    const BrowserAutomation = require('./browser-automation');
    const state = loadState();
    const browser = new BrowserAutomation({ ...config, browser: { ...(config.browser || {}), headless: true } });
    if (!await browser.launchBrowser()) throw new Error('浏览器启动失败');
    const completed = [];
    const failed = [];
    try {
        if (!await browser.login()) throw new Error('平台登录失败');
        const page = browser.page;
        let token = '';
        page.on('request', request => {
            if (!request.url().includes('/v1.')) return;
            const headers = request.headers();
            token = headers.token || headers.Token || token;
        });
        await page.goto('https://dwyunsc.ddwjzkj.com:22222/production/plan');
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        if (!token) throw new Error('未获取到平台 Token');

        const postJson = async (apiPath, data) => {
            const response = await page.request.post(`${API_ORIGIN}${apiPath}`, {
                data, headers: { Token: token, 'Content-Type': 'application/json;charset=utf-8' }, timeout: 120000
            });
            const body = await response.json();
            if (!response.ok() || body.code !== 0) throw new Error(`${apiPath}: ${body.msg || response.status()}`);
            return body.data;
        };

        const plans = await fetchPlans(postJson);
        const pending = plans.filter(plan => !state.downloadedPlans[String(plan.id)]);
        if (!pending.length) {
            console.log(JSON.stringify({ ok: true, skipped: true, reason: '没有未下载的生产计划', matchedPlanCount: plans.length, downloadedPlanCount: Object.keys(state.downloadedPlans).length }));
            return;
        }
        const outputDir = dateOutputDir();
        for (const plan of pending) {
            try {
                const result = await downloadPlan(page, token, postJson, plan, outputDir);
                saveState(state, plan, result.outputPath, result.artifactCount);
                completed.push({ id: plan.id, name: plan.name, ...result });
            } catch (error) {
                failed.push({ id: plan.id, name: plan.name, error: error.message });
            }
        }
    } finally {
        await browser.closeBrowser();
    }
    console.log(JSON.stringify({ ok: failed.length === 0, skipped: false, completedCount: completed.length, failedCount: failed.length, completed, failed }));
    if (failed.length) throw new Error(`${failed.length} 个生产计划编码包下载失败`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.stack || error.message || error);
        process.exitCode = 1;
    });
}

module.exports = { sanitizeFileName, dateOutputDir, loadState, saveState, chunk, mergeDirectory, fetchPlans };
