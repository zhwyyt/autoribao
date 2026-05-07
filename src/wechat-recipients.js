const fs = require('fs');
const path = require('path');

function exists(p) {
    try {
        return p && fs.existsSync(p);
    } catch {
        return false;
    }
}

function normalizeName(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    // Filter common header strings if someone copied titles into cells.
    if (s === '姓名' || s === '联系人' || s === '接收人') return null;
    return s;
}

function uniq(list) {
    const out = [];
    const seen = new Set();
    for (const x of list) {
        const k = String(x);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(x);
    }
    return out;
}

function readRecipientsFromXlsx({ xlsxPath, sheetName }) {
    if (!exists(xlsxPath)) {
        return [];
    }

    let xlsx;
    try {
        xlsx = require('xlsx');
    } catch (e) {
        throw new Error(`缺少 xlsx 依赖，无法读取联系人表：${e && e.message ? e.message : String(e)}`);
    }

    const wb = xlsx.readFile(xlsxPath, { cellText: true, cellDates: false });
    const ws = wb.Sheets && wb.Sheets[sheetName];
    if (!ws) {
        return [];
    }

    // Use header: 1 to get a 2D array and just collect first column values.
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false });
    const names = [];
    for (const row of rows) {
        if (!row || row.length === 0) continue;
        const v = row[0];
        const name = normalizeName(v);
        if (name) names.push(name);
    }

    return uniq(names);
}

function resolveContactsXlsxPath(projectRoot) {
    const root = projectRoot && path.isAbsolute(projectRoot) ? projectRoot : path.join(__dirname, '..');
    return path.join(root, '消息联系人.xlsx');
}

function getWechatTargets(config, { kind, projectRoot }) {
    const notifyCfg = config && config.notify && config.notify.wechat;
    const fallback = notifyCfg && Array.isArray(notifyCfg.targets) ? notifyCfg.targets.map(String) : [];

    const xlsxPath = resolveContactsXlsxPath(projectRoot);
    const sheetName = kind === 'daily' ? '日报接收人' : (kind === 'shoufacun' ? '收发存接收人' : null);
    if (!sheetName) return fallback;

    try {
        const fromXlsx = readRecipientsFromXlsx({ xlsxPath, sheetName });
        if (fromXlsx.length > 0) {
            return fromXlsx;
        }
    } catch {
        // fallthrough
    }

    return fallback;
}

module.exports = {
    getWechatTargets,
    readRecipientsFromXlsx
};
