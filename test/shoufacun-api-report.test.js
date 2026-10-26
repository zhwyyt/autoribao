const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Exercise main's real routing and CSV output without logging in, querying DB or sending messages.
function loadMain(t, argv = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoufacun-api-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const filename = path.resolve(__dirname, '../src/main.js');
    const source = fs.readFileSync(filename, 'utf8');
    const entry = source.lastIndexOf('\nmain().catch(');
    assert.ok(entry > 0);
    const realRequire = createRequire(filename);
    const reports = [];
    const messages = [];
    let closed = false;
    const config = {
        files: { downloadFolder: dir },
        browser: { headless: true },
        behavior: { skipDownloads: true },
        website: { subworkStatisticsUrl: 'https://example.test/inbound', orderHistoryUrl: 'https://example.test/outbound' }
    };
    const context = vm.createContext({
        __dirname: path.dirname(filename),
        process: { argv: ['node', filename, '--shoufacun', '--month', '2026-10', ...argv] },
        setTimeout,
        require(name) {
            if (name === '../config/default.json') return config;
            if (name === './logger') return Object.fromEntries(['info', 'warn', 'error', 'debug', 'success'].map(key => [key, msg => messages.push(msg)]));
            if (name === './query/sql-runner') return { query: () => { throw new Error('Unexpected DB query'); } };
            if (name === './browser-automation') return class {
                async launchBrowser() { return true; }
                async login() { return true; }
                async closeBrowser() { closed = true; }
            };
            if (name === './generate-shoufacun-report-exceljs') return {
                async generateShoufacunReport(options) {
                    reports.push(options);
                    return path.join(options.outDir, options.outputFileName);
                }
            };
            if (name === './wechat-recipients') return { getWechatTargets: () => [] };
            if (name === './wechat-notify') throw new Error('Unexpected notification');
            return realRequire(name);
        }
    });
    vm.runInContext(source.slice(0, entry), context, { filename });
    return { context, dir, reports, messages, isClosed: () => closed };
}

const plain = value => JSON.parse(JSON.stringify(value));

test('factory month segments cover every day exactly once, including year and February boundaries', t => {
    const { context } = loadMain(t);
    assert.equal(typeof context.buildShoufacunSegments, 'function');
    for (const month of ['2026-10', '2027-01', '2026-03', '2028-03']) {
        const range = context.getMonth26ToMonth25ByMonthKey(month);
        const segments = plain(context.buildShoufacunSegments(range));
        assert.deepEqual(segments, [
            { start: range.start, end: `${month}-05` },
            { start: `${month}-06`, end: `${month}-15` },
            { start: `${month}-16`, end: range.end }
        ]);
        const actual = segments.flatMap(({ start, end }) => {
            const days = [];
            for (let day = Date.parse(start); day <= Date.parse(end); day += 86400000) days.push(day);
            return days;
        });
        const expected = [];
        for (let day = Date.parse(range.start); day <= Date.parse(range.end); day += 86400000) expected.push(day);
        assert.deepEqual(actual, expected);
    }
});

test('merge keeps precision and repeated business events, accepts empty segments and renumbers rows', t => {
    const { context } = loadMain(t);
    assert.equal(typeof context.mergeApiTables, 'function');
    const headerNames = ['#', '项目名称', '重量'];
    const first = { headerNames, rows: [[1, '项目A', 226.378439]] };
    const result = context.mergeApiTables([first, { headerNames, rows: [] }, first]);
    assert.deepEqual(plain(result), { headerNames, rows: [[1, '项目A', 226.378439], [2, '项目A', 226.378439]] });
    assert.equal(first.rows[0][0], 1);
    assert.throws(() => context.mergeApiTables([first, { headerNames: ['#', '重量', '项目名称'], rows: [] }]), /表头/);
});

for (const legacyFlag of [false, true]) {
    test(`monthly entry fetches six API tables and merges CSV before generating (${legacyFlag ? 'legacy flag' : 'default'})`, async t => {
        const { context, dir, reports, isClosed } = loadMain(t, legacyFlag ? ['--from-api'] : []);
        const calls = [];
        for (const [name, kind] of [['fetchSubworkStatisticsTable', '入库'], ['fetchOrderHistoryTable', '出库']]) {
            context[name] = async (_browser, options) => {
                calls.push([kind, options.range.start, options.range.end]);
                assert.equal(reports.length, 0);
                assert.equal(fs.existsSync(path.join(dir, '2026/10/25/2026-10_构件出库_API.csv')), false);
                return { headerNames: ['#', '项目名称', '重量'], rows: [[1, '测试,"项目\nA', 226.378439]] };
            };
        }
        await context.main();
        assert.deepEqual(calls, [
            ['入库', '2026-09-26', '2026-10-05'], ['出库', '2026-09-26', '2026-10-05'],
            ['入库', '2026-10-06', '2026-10-15'], ['出库', '2026-10-06', '2026-10-15'],
            ['入库', '2026-10-16', '2026-10-25'], ['出库', '2026-10-16', '2026-10-25']
        ]);
        assert.equal(reports.length, 1);
        assert.equal(reports[0].outputFileName, legacyFlag ? '202610收发存报表_API.xlsx' : '202610收发存报表.xlsx');
        for (const file of [reports[0].inboundCsv, reports[0].outboundCsv]) {
            const text = fs.readFileSync(file, 'utf8');
            assert.equal((text.match(/226\.378439/g) || []).length, 3);
            assert.match(text, /"3","测试,""项目\nA","226\.378439"/);
            assert.equal((text.match(/项目名称/g) || []).length, 1);
        }
        assert.equal(isClosed(), true);
    });
}

test('failed second segment stops report generation without replacing existing monthly CSV', async t => {
    const { context, dir, reports, isClosed } = loadMain(t);
    const archive = path.join(dir, '2026/10/25');
    fs.mkdirSync(archive, { recursive: true });
    const file = path.join(archive, '2026-10_构件出库_API.csv');
    fs.writeFileSync(file, 'previous complete data');
    let inboundCalls = 0;
    context.fetchSubworkStatisticsTable = async () => {
        inboundCalls++;
        if (inboundCalls === 2) throw new Error('API timeout');
        return { headerNames: ['#', '重量'], rows: [[1, 123]] };
    };
    context.fetchOrderHistoryTable = async () => ({ headerNames: ['#', '重量'], rows: [[1, 123]] });
    await assert.rejects(context.main(), /2026-10-06.*2026-10-15.*API timeout/);
    assert.equal(reports.length, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), 'previous complete data');
    assert.equal(fs.readdirSync(archive).length, 1);
    assert.equal(isClosed(), true);
});

test('API replay rejects HTTP and business errors, including errors with a list', async t => {
    const { context } = loadMain(t);
    for (const [ok, body, expected] of [[false, {}, /HTTP 504/], [true, { code: 401, data: { list: [] } }, /401/]]) {
        const page = {
            context: () => ({ cookies: async () => [] }),
            request: { post: async () => ({ ok: () => ok, status: () => 504, json: async () => body }) }
        };
        await assert.rejects(context.replayCapturedApiRequest(page, { url: 'https://example.test', headers: { token: 'test-only' } }), expected);
    }
});

test('both API readers reject absent lists but accept successful empty lists', async t => {
    const { context } = loadMain(t);
    assert.equal(typeof context.fetchSubworkStatisticsTable, 'function');
    assert.equal(typeof context.fetchOrderHistoryTable, 'function');
    for (const name of ['gotoWithRelogin', 'clickFormControlByLabel', 'selectCascaderCheckboxByText', 'selectDropdownOption', 'setDateRangeByLabel']) context[name] = async () => {};
    context.captureApiRequest = async () => ({});
    const browser = { page: {
        url: () => 'https://example.test',
        keyboard: { press: async () => {} },
        waitForTimeout: async () => {},
        locator: () => ({ first: () => ({ waitFor: async () => {}, click: async () => {} }) })
    } };
    const options = { range: { start: '2026-10-06', end: '2026-10-15' } };
    context.replayCapturedApiRequest = async () => ({ code: 0, data: {} });
    await assert.rejects(context.fetchSubworkStatisticsTable(browser, options), /API.*(headers|表头|list)/);
    await assert.rejects(context.fetchOrderHistoryTable(browser, options), /API.*list/);
    context.replayCapturedApiRequest = async () => ({ code: 0, data: [{ headers: [{ headerName: '重量', field: 'weight' }], list: [] }] });
    assert.deepEqual(plain((await context.fetchSubworkStatisticsTable(browser, options)).rows), []);
    context.replayCapturedApiRequest = async () => ({ code: 0, data: { list: [] } });
    assert.deepEqual(plain((await context.fetchOrderHistoryTable(browser, options)).rows), []);
});
