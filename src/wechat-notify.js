const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const logger = require('./logger');

function exists(p) {
    try {
        return p && fs.existsSync(p);
    } catch {
        return false;
    }
}

function findAutoHotkeyExe(config) {
    const explicit = config && config.notify && config.notify.wechat && config.notify.wechat.ahkExe;
    if (exists(explicit)) return explicit;

    const candidates = [];
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    candidates.push(path.join(pf, 'AutoHotkey', 'AutoHotkey.exe'));
    candidates.push(path.join(pf, 'AutoHotkey', 'v2', 'AutoHotkey64.exe'));
    candidates.push(path.join(pf, 'AutoHotkey', 'v2', 'AutoHotkey.exe'));
    candidates.push(path.join(pfx86, 'AutoHotkey', 'AutoHotkey.exe'));
    candidates.push(path.join(pfx86, 'AutoHotkey', 'v2', 'AutoHotkey64.exe'));
    candidates.push(path.join(pfx86, 'AutoHotkey', 'v2', 'AutoHotkey.exe'));

    for (const c of candidates) {
        if (exists(c)) return c;
    }

    try {
        const r = spawnSync('where', ['AutoHotkey.exe'], { encoding: 'utf8' });
        if (r.status === 0) {
            const line = String(r.stdout || '').split(/\r?\n/).map(x => x.trim()).find(Boolean);
            if (exists(line)) return line;
        }
    } catch {
        // ignore
    }

    return null;
}

function sendWechatFile(config, { targetName, filePath, message }) {
    const enabled = Boolean(config && config.notify && config.notify.wechat && config.notify.wechat.enabled);
    if (!enabled) return { skipped: true, reason: 'notify.wechat.enabled=false' };

    if (!targetName) throw new Error('sendWechatFile: targetName is required');
    if (!filePath) throw new Error('sendWechatFile: filePath is required');
    if (!exists(filePath)) throw new Error(`sendWechatFile: file not found: ${filePath}`);

    const ahkExe = findAutoHotkeyExe(config);
    if (!ahkExe) {
        throw new Error('未找到 AutoHotkey 可执行文件，请在 config/default.json 里配置 notify.wechat.ahkExe');
    }

    const scriptPath = path.join(__dirname, 'wechat-send.ahk');
    if (!exists(scriptPath)) throw new Error(`wechat-send.ahk not found: ${scriptPath}`);

    logger.info(`微信发送：目标=${targetName} 文件=${filePath}`);

    const wechatExe = config && config.notify && config.notify.wechat && config.notify.wechat.wechatExe;
    const inputClick = config && config.notify && config.notify.wechat && config.notify.wechat.inputClick;
    const xRatio = inputClick && typeof inputClick.xRatio === 'number' ? inputClick.xRatio : null;
    const yRatio = inputClick && typeof inputClick.yRatio === 'number' ? inputClick.yRatio : null;
    const args = [scriptPath, targetName, filePath];
    const needTailArgs = Boolean(wechatExe) || (xRatio != null && yRatio != null);
    if (message) {
        args.push(message);
    } else if (needTailArgs) {
        args.push('');
    }
    if (wechatExe) args.push(String(wechatExe));
    if (xRatio != null && yRatio != null) {
        args.push(String(xRatio));
        args.push(String(yRatio));
    }

    const r = spawnSync(ahkExe, args, { stdio: 'inherit' });
    if (r.status !== 0) {
        throw new Error(`微信发送失败，退出码=${r.status}`);
    }

    return { ok: true };
}

function sendWechatFileBatch(config, { targets, filePath, message }) {
    const enabled = Boolean(config && config.notify && config.notify.wechat && config.notify.wechat.enabled);
    if (!enabled) return { skipped: true, reason: 'notify.wechat.enabled=false' };

    const list = Array.isArray(targets) ? targets.map(x => String(x).trim()).filter(Boolean) : [];
    if (list.length === 0) throw new Error('sendWechatFileBatch: targets is required');
    if (!filePath) throw new Error('sendWechatFileBatch: filePath is required');
    if (!exists(filePath)) throw new Error(`sendWechatFileBatch: file not found: ${filePath}`);

    const ahkExe = findAutoHotkeyExe(config);
    if (!ahkExe) {
        throw new Error('未找到 AutoHotkey 可执行文件，请在 config/default.json 里配置 notify.wechat.ahkExe');
    }

    const scriptPath = path.join(__dirname, 'wechat-send-batch.ahk');
    if (!exists(scriptPath)) throw new Error(`wechat-send-batch.ahk not found: ${scriptPath}`);

    const targetsRaw = list.join('|');
    logger.info(`微信发送(批量)：目标=${targetsRaw} 文件=${filePath}`);

    const wechatExe = config && config.notify && config.notify.wechat && config.notify.wechat.wechatExe;
    const inputClick = config && config.notify && config.notify.wechat && config.notify.wechat.inputClick;
    const xRatio = inputClick && typeof inputClick.xRatio === 'number' ? inputClick.xRatio : null;
    const yRatio = inputClick && typeof inputClick.yRatio === 'number' ? inputClick.yRatio : null;

    const args = [scriptPath, targetsRaw, filePath];
    const needTailArgs = Boolean(wechatExe) || (xRatio != null && yRatio != null);
    if (message) {
        args.push(message);
    } else if (needTailArgs) {
        args.push('');
    }
    if (wechatExe) args.push(String(wechatExe));
    if (xRatio != null && yRatio != null) {
        args.push(String(xRatio));
        args.push(String(yRatio));
    }

    const r = spawnSync(ahkExe, args, { stdio: 'inherit' });
    if (r.status !== 0) {
        throw new Error(`微信发送失败，退出码=${r.status}`);
    }

    return { ok: true };
}

function exportXlsxToPng({ inputXlsx, outputPng, sheetName }) {
    const ps1 = path.join(__dirname, 'export-excel-screenshot.ps1');
    if (!exists(ps1)) throw new Error(`export-excel-screenshot.ps1 not found: ${ps1}`);
    if (!exists(inputXlsx)) throw new Error(`InputXlsx not found: ${inputXlsx}`);

    const args = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ps1,
        '-InputXlsx',
        inputXlsx,
        '-OutputPng',
        outputPng
    ];

    if (sheetName) {
        args.push('-SheetName', sheetName);
    }

    const r = spawnSync('powershell.exe', args, { encoding: 'utf8' });
    const stdout = String(r.stdout || '').trim();
    const stderr = String(r.stderr || '').trim();
    if (stdout) logger.debug(`[export-xlsx stdout] ${stdout}`);
    if (stderr) logger.warn(`[export-xlsx stderr] ${stderr}`);

    if (r.status !== 0) {
        throw new Error(`导出日报图片失败，退出码=${r.status}`);
    }

    if (!exists(outputPng)) {
        throw new Error(`导出日报图片失败：未生成文件 ${outputPng}`);
    }

    return outputPng;
}

module.exports = {
    sendWechatFile,
    sendWechatFileBatch,
    exportXlsxToPng
};
