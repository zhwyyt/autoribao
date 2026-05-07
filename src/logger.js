const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../logs');
        this.ensureLogDir();
        this._fallbackLogFile = null;
    }

    appendLogSafe(filePath, content) {
        if (this._fallbackLogFile) {
            try {
                fs.appendFileSync(this._fallbackLogFile, content);
                return;
            } catch {}
        }

        const maxRetries = 5;
        for (let i = 0; i < maxRetries; i++) {
            try {
                fs.appendFileSync(filePath, content);
                return;
            } catch (e) {
                const code = e && e.code ? String(e.code) : '';
                const retryable = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
                if (!retryable || i === maxRetries - 1) {
                    try {
                        const base = path.basename(filePath, '.log');
                        const ts = new Date().toISOString().replace(/[:.]/g, '-');
                        const alt = path.join(path.dirname(filePath), `${base}_${ts}.log`);
                        this._fallbackLogFile = alt;
                        fs.appendFileSync(alt, content);
                        console.warn(`[WARN] 日志文件被占用，已切换到备用日志: ${alt}`);
                        return;
                    } catch (e2) {
                        // last resort: do not crash the app because of logging
                        console.warn(`[WARN] 写日志失败（已忽略，不影响主流程）：${e2 && e2.message ? e2.message : String(e2)}`);
                        return;
                    }
                }
                // small blocking delay before retry
                const start = Date.now();
                while (Date.now() - start < 50) {}
            }
        }
    }

    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    formatTime() {
        const now = new Date();
        return now.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    log(message, level = 'INFO') {
        const timestamp = this.formatTime();
        const logMessage = `[${timestamp}] [${level}] ${message}`;
        console.log(logMessage);

        const logFile = path.join(this.logDir, `shoufacun_${new Date().toISOString().split('T')[0]}.log`);
        this.appendLogSafe(logFile, logMessage + '\n');
    }

    info(message) {
        this.log(message, 'INFO');
    }

    error(message) {
        this.log(message, 'ERROR');
    }

    warn(message) {
        this.log(message, 'WARN');
    }

    success(message) {
        this.log(message, 'SUCCESS');
    }

    debug(message) {
        this.log(message, 'DEBUG');
    }
}

module.exports = new Logger();
