const { chromium } = require('playwright');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

class BrowserAutomation {
    constructor(config) {
        this.config = config;
        this.browser = null;
        this.context = null;
        this.page = null;

        this.loginUrl = config.website.loginUrl;
        this.username = config.credentials.username;
        this.password = config.credentials.password;
        this.browserOptions = config.browser;
    }

    async launchBrowser() {
        try {
            logger.info('正在启动浏览器...');
            try {
                this.browser = await chromium.launch({
                    headless: this.browserOptions.headless,
                    slowMo: this.browserOptions.slowMo
                });
            } catch (error) {
                const msg = String(error && error.message ? error.message : error);
                const isMissingExecutable =
                    msg.includes('Executable doesn\'t exist') ||
                    msg.toLowerCase().includes('executable') ||
                    msg.toLowerCase().includes('browser') && msg.toLowerCase().includes('doesn\'t exist');

                if (!isMissingExecutable) {
                    throw error;
                }

                logger.warn('检测到 Playwright 自带 Chromium 未安装/不可用，尝试使用系统 Chrome 启动（channel=chrome）...');
                try {
                    this.browser = await chromium.launch({
                        channel: 'chrome',
                        headless: this.browserOptions.headless,
                        slowMo: this.browserOptions.slowMo
                    });
                } catch (chromeChannelErr) {
                    const pf = process.env.ProgramFiles || 'C:\\Program Files';
                    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
                    const lad = process.env.LOCALAPPDATA;
                    const launchByExecutable = async (candidates, browserName) => {
                        const existing = candidates.find(p => p && fs.existsSync(p));
                        if (!existing) return false;
                        logger.warn(`channel=${browserName.toLowerCase()} 启动失败，改用 executablePath 启动 ${browserName}: ${existing}`);
                        this.browser = await chromium.launch({
                            executablePath: existing,
                            headless: this.browserOptions.headless,
                            slowMo: this.browserOptions.slowMo
                        });
                        return true;
                    };

                    const chromeCandidates = [
                        path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                        path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe')
                    ];
                    if (lad) {
                        chromeCandidates.push(path.join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'));
                    }

                    if (!await launchByExecutable(chromeCandidates, 'Chrome')) {
                        logger.warn('Chrome 不可用，尝试使用系统 Edge 启动（channel=msedge）...');
                        try {
                            this.browser = await chromium.launch({
                                channel: 'msedge',
                                headless: this.browserOptions.headless,
                                slowMo: this.browserOptions.slowMo
                            });
                        } catch (edgeChannelErr) {
                            const edgeCandidates = [
                                path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                                path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
                            ];
                            if (!await launchByExecutable(edgeCandidates, 'Edge')) {
                                throw edgeChannelErr;
                            }
                        }
                    }
                }
            }

            this.context = await this.browser.newContext({
                acceptDownloads: true
            });

            this.page = await this.context.newPage();
            this.page.setDefaultTimeout(this.browserOptions.timeout);
            await this.page.setViewportSize({ width: 1920, height: 1080 });

            logger.success('浏览器启动成功');
            return true;
        } catch (error) {
            logger.error(`浏览器启动失败: ${error && error.message ? error.message : String(error)}`);
            if (error && error.stack) {
                logger.error(error.stack);
            }
            return false;
        }
    }

    async login() {
        try {
            if (!this.username || !this.password) {
                throw new Error('账号或密码为空，请先在 config/default.json 里填写 credentials');
            }

            logger.info(`正在访问登录页面: ${this.loginUrl}`);
            await this.page.goto(this.loginUrl);
            await this.page.waitForLoadState('networkidle');

            const usernameSelector = await this.findUsernameInput();
            if (!usernameSelector) {
                throw new Error('未找到用户名输入框');
            }

            const passwordSelector = await this.findPasswordInput();
            if (!passwordSelector) {
                throw new Error('未找到密码输入框');
            }

            logger.info('正在输入登录凭据...');
            await this.page.fill(usernameSelector, this.username);
            await this.page.fill(passwordSelector, this.password);

            const loginButtonSelector = await this.findLoginButton();
            if (loginButtonSelector) {
                logger.info('正在点击登录按钮...');
                await this.page.click(loginButtonSelector);
            } else {
                logger.info('未找到登录按钮，尝试按回车键提交表单...');
                await this.page.keyboard.press('Enter');
            }

            await this.waitForLogin();
            logger.success('登录成功');
            return true;
        } catch (error) {
            logger.error(`登录失败: ${error.message}`);
            return false;
        }
    }

    async findUsernameInput() {
        const selectors = [
            'input[name="account"]',
            'input[name="username"]',
            'input[name="user"]',
            'input[placeholder*="账号"]',
            'input[placeholder*="用户名"]',
            'input[type="text"]'
        ];

        for (const selector of selectors) {
            try {
                await this.page.waitForSelector(selector, { timeout: 2000 });
                logger.debug(`找到用户名输入框: ${selector}`);
                return selector;
            } catch {
                continue;
            }
        }
        return null;
    }

    async findPasswordInput() {
        const selectors = [
            'input[name="password"]',
            'input[name="pwd"]',
            'input[type="password"]',
            'input[placeholder*="密码"]'
        ];

        for (const selector of selectors) {
            try {
                await this.page.waitForSelector(selector, { timeout: 2000 });
                logger.debug(`找到密码输入框: ${selector}`);
                return selector;
            } catch {
                continue;
            }
        }
        return null;
    }

    async findLoginButton() {
        const selectors = [
            'button:has-text("登 录")',
            'button:has-text("登录")',
            'button:has-text("登陆")',
            'button:has-text("Login")',
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("确定")',
            'button:has-text("提交")',
            '.el-button--primary',
            '.login-btn',
            '#login-btn',
            '.btn-primary',
            '.btn-submit',
            '.submit-btn',
            '[onclick*="login"]',
            '[onclick*="submit"]',
            'form button',
            'input[value*="登录"]',
            'input[value*="提交"]',
            'input[value*="确定"]'
        ];

        for (const selector of selectors) {
            try {
                await this.page.waitForSelector(selector, { timeout: 2000 });
                logger.debug(`找到登录按钮: ${selector}`);
                return selector;
            } catch {
                continue;
            }
        }

        return null;
    }

    async waitForLogin() {
        try {
            await Promise.race([
                this.page.waitForURL('**/index*', { timeout: 30000 }),
                this.page.waitForURL('**/home*', { timeout: 30000 }),
                this.page.waitForURL('**/main*', { timeout: 30000 }),
                this.page.waitForURL('**/order/index*', { timeout: 30000 }),
                this.page.waitForSelector('.user-info', { timeout: 30000 }),
                this.page.waitForSelector('.logout', { timeout: 30000 })
            ]);

            await this.page.waitForLoadState('networkidle');
        } catch (error) {
            const errorMessage = await this.checkLoginError();
            if (errorMessage) {
                throw new Error(`登录失败: ${errorMessage}`);
            }
            throw error;
        }
    }

    async checkLoginError() {
        const errorSelectors = ['.error-message', '.alert-danger', '.login-error', '[class*="error"]'];

        for (const selector of errorSelectors) {
            try {
                const element = await this.page.$(selector);
                if (element) {
                    const text = await element.textContent();
                    if (text && text.trim()) {
                        return text.trim();
                    }
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    async closeBrowser() {
        try {
            if (this.browser) {
                await this.browser.close();
                logger.info('浏览器已关闭');
            }
        } catch (error) {
            logger.error(`关闭浏览器失败: ${error.message}`);
        }
    }
}

module.exports = BrowserAutomation;
