const { runNightlyProcessReconciliation } = require('./src/nightly-process-reconciliation');
const { runNightlyShippingAlignment } = require('./src/nightly-shipping-alignment');

function formatDate(date) {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

function* eachDay(start, end) {
  const cur = new Date(`${start}T00:00:00+08:00`);
  const last = new Date(`${end}T00:00:00+08:00`);
  while (cur <= last) {
    yield formatDate(cur);
    cur.setDate(cur.getDate() + 1);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const start = String(args.start || '').trim();
  const end = String(args.end || '').trim();
  if (!start || !end) {
    throw new Error('请传入 --start YYYY-MM-DD --end YYYY-MM-DD');
  }

  const results = [];
  for (const date of eachDay(start, end)) {
    const range = { start: date, end: date, label: date };
    const item = { date };
    try {
      const processResult = await runNightlyProcessReconciliation({ range, now: new Date(`${date}T12:00:00+08:00`) });
      item.process = {
        ok: true,
        hasMismatch: processResult.hasMismatch,
        reportPath: processResult.reportPath || null,
        summary: (processResult.results || []).map(r => r.summary)
      };
    } catch (error) {
      item.process = {
        ok: false,
        error: error && error.message ? error.message : String(error)
      };
    }

    try {
      const shippingResult = await runNightlyShippingAlignment({ range, now: new Date(`${date}T12:00:00+08:00`) });
      item.shipping = {
        ok: true,
        hasMismatch: shippingResult.hasMismatch,
        reportPath: shippingResult.reportPath || null,
        before: shippingResult.before ? shippingResult.before.summary : null,
        after: shippingResult.after ? shippingResult.after.summary : null,
        syncResult: shippingResult.syncResult || null
      };
    } catch (error) {
      item.shipping = {
        ok: false,
        error: error && error.message ? error.message : String(error)
      };
    }

    results.push(item);
  }

  console.log(JSON.stringify({ start, end, results }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
