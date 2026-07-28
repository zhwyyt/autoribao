const { runNightlyProcessReconciliation } = require('./nightly-process-reconciliation');
const { runNightlyShippingAlignment } = require('./nightly-shipping-alignment');

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const current = argv[i];
        if (!current || !current.startsWith('--')) continue;
        const key = current.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i++;
        } else {
            out[key] = true;
        }
    }
    return out;
}

function formatYmd(date) {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function buildMonthRange(monthKey, now = new Date()) {
    const value = String(monthKey || '').trim();
    const match = value.match(/^(\d{4})-(\d{2})$/);
    const year = match ? Number(match[1]) : now.getFullYear();
    const month = match ? Number(match[2]) : now.getMonth() + 1;
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        throw new Error(`无效月份: ${value}，期望格式 YYYY-MM`);
    }
    const start = new Date(year, month - 2, 26);
    const end = new Date(year, month - 1, 25);
    return {
        start: formatYmd(start),
        end: formatYmd(end),
        label: `${formatYmd(start)}至${formatYmd(end)}`
    };
}

function buildMonthSegments(monthKey, now = new Date()) {
    const fullRange = buildMonthRange(monthKey, now);
    const endMatch = fullRange.end.match(/^(\d{4})-(\d{2})-25$/);
    const year = Number(endMatch[1]);
    const month = Number(endMatch[2]);
    return [
        {
            start: fullRange.start,
            end: formatYmd(new Date(year, month - 1, 10)),
            label: `${fullRange.start}至${formatYmd(new Date(year, month - 1, 10))}`
        },
        {
            start: formatYmd(new Date(year, month - 1, 11)),
            end: fullRange.end,
            label: `${formatYmd(new Date(year, month - 1, 11))}至${fullRange.end}`
        }
    ];
}

function compactProcessResult(result) {
    return {
        hasMismatch: result.hasMismatch,
        reportPath: result.reportPath || null,
        before: (result.beforeResults || []).map(item => item.summary),
        after: (result.afterResults || []).map(item => item.summary)
    };
}

function compactShippingResult(result) {
    return {
        hasMismatch: result.hasMismatch,
        reportPath: result.reportPath || null,
        before: result.before ? result.before.summary : null,
        after: result.after ? result.after.summary : null,
        syncPreview: result.syncPreview || null
    };
}

const NUMERIC_SUMMARY_KEYS = [
    'apiRowCount', 'dbRowCount', 'apiWeightKg', 'dbWeightKg',
    'onlyApiCount', 'onlyDbCount', 'mismatchCount'
];

function addSummary(target, source) {
    for (const key of NUMERIC_SUMMARY_KEYS) {
        target[key] = Number(((target[key] || 0) + Number(source && source[key] || 0)).toFixed(3));
    }
    return target;
}

function aggregateSegments(segments) {
    const processByKey = new Map();
    const shipping = {};
    for (const segment of segments) {
        for (const summary of segment.process.after || []) {
            if (!processByKey.has(summary.key)) {
                processByKey.set(summary.key, {
                    key: summary.key,
                    processLabel: summary.processLabel,
                    departmentLabel: summary.departmentLabel
                });
            }
            addSummary(processByKey.get(summary.key), summary);
        }
        addSummary(shipping, segment.shipping.after);
    }
    return {
        process: Array.from(processByKey.values()),
        shipping
    };
}

async function runShoufacunApiReconciliation(options = {}) {
    const now = options.now || new Date();
    const fullRange = options.range || buildMonthRange(options.month, now);
    const ranges = options.range ? [options.range] : buildMonthSegments(options.month, now);
    const segments = [];
    for (const range of ranges) {
        const checkOnly = !options.sync;
        const processResult = await runNightlyProcessReconciliation({
            range, now, checkOnly, refreshSnapshots: Boolean(options.sync)
        });
        const shippingResult = await runNightlyShippingAlignment({
            range,
            now,
            checkOnly,
            refreshSnapshots: Boolean(options.sync)
        });
        segments.push({
            range,
            process: compactProcessResult(processResult),
            shipping: compactShippingResult(shippingResult)
        });
    }
    return {
        range: fullRange,
        segments,
        totals: aggregateSegments(segments)
    };
}

module.exports = {
    buildMonthRange,
    buildMonthSegments,
    aggregateSegments,
    runShoufacunApiReconciliation
};

if (require.main === module) {
    const args = parseArgs(process.argv);
    runShoufacunApiReconciliation({ month: args.month, sync: Boolean(args.sync) })
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(error && error.stack ? error.stack : String(error));
            process.exitCode = 1;
        });
}
