const { createClient } = require('oicq');
const { spawnSync } = require('child_process');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// #region agent log
const DEBUG_ENDPOINT = 'http://127.0.0.1:7247/ingest/9bed5e42-9ce7-49e2-967a-4e718fb71c3d';
const DEBUG_LOG = (location, message, data, hypothesisId) => {
  try {
    const payload = JSON.stringify({ location, message, data: data || {}, timestamp: Date.now(), hypothesisId });
    if (typeof fetch === 'function') {
      fetch(DEBUG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {});
      return;
    }
    const u = new URL(DEBUG_ENDPOINT);
    const httpMod = u.protocol === 'https:' ? require('https') : require('http');
    const req = httpMod.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + (u.search || ''), method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => res.resume()
    );
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch (_) {}
};
// #endregion

// 配置文件
const CONFIG = {
  // 机器人QQ号
  botQQ: 2162802443, // 机器人QQ号
  // 授权用户QQ号列表（只有这些用户可以触发）
  authorizedUsers: [
    2162802443 // 默认允许机器人自己触发，可以添加你的手机QQ号
  ],
  // 项目根目录
  projectRoot: path.resolve(__dirname, '..'),
  // 日志文件
  logFile: path.join(__dirname, 'qq-bot.log')
};

// 状态管理
let isRunning = false;
let lastExecuteTime = '未执行';
let todayCount = 0;
let lastDate = '';

// 日志函数
function log(message) {
  const timestamp = new Date().toLocaleString('zh-CN');
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(CONFIG.logFile, logMessage + '\n');
}

// 创建QQ客户端
const client = createClient(CONFIG.botQQ, {
  platform: 5,  // 安卓手机
  ignore_self: false,  // 接收自己的消息
  brief: false,  // 显示详细信息
  log_level: 'info'  // 日志级别
});

// 登录事件
client.on('system.online', () => {
  // #region agent log
  DEBUG_LOG('qq-bot.js:system.online', 'oicq login success', { botQQ: CONFIG.botQQ }, 'H4');
  // #endregion
  log('QQ机器人已上线');
  broadcastStatus('🤖 QQ机器人已上线，可以开始使用指令了');
});

// 登录错误处理
client.on('system.login.error', (data) => {
  // #region agent log
  DEBUG_LOG('qq-bot.js:system.login.error', 'oicq login error', { code: data.code, message: data.message }, 'H4');
  // #endregion
  log(`登录失败: ${data.message}`);
  if (data.message.includes('二维码过期') || data.message.includes('timeout')) {
    log('二维码已过期，程序将重新生成二维码...');
    // 重新登录会生成新的二维码
    setTimeout(() => {
      client.login();
    }, 1000);
  } else {
    // 不中断进程，便于继续重试/观察设备锁与滑块事件
    log('登录失败（非二维码超时），2秒后尝试重新获取二维码...');
    setTimeout(() => {
      // #region agent log
      DEBUG_LOG('qq-bot.js:system.login.error:retry', 'retrying client.login()', {}, 'H4');
      // #endregion
      client.login();
    }, 2000);
  }
});

// 扫码登录二维码事件（oicq v2 使用 system.login.qrcode）
client.on('system.login.qrcode', (data) => {
  // #region agent log
  DEBUG_LOG('qq-bot.js:system.login.qrcode', 'oicq QR code required', { hasImage: !!data.image }, 'H4');
  // #endregion
  log('请使用手机QQ扫描二维码登录（程序会自动检测扫码/确认状态）');
  try {
    // data.image 是 Buffer，直接打印会很乱；这里只提示已收到二维码
    log('二维码已生成（如需保存图片，请后续加保存逻辑）');
  } catch (_) {}
  const startedAt = Date.now();
  let lastRetcode = null;
  const poll = async (source) => {
    try {
      const r = await client.queryQrcodeResult();
      if (r.retcode !== lastRetcode) {
        lastRetcode = r.retcode;
        // #region agent log
        DEBUG_LOG('qq-bot.js:qrcode:state', 'qrcode state changed', { retcode: r.retcode, uin: r.uin }, 'H4');
        // #endregion
      }
      if (r.retcode === 48) {
        log('二维码状态：等待扫码...');
        return false;
      }
      if (r.retcode === 53) {
        log('二维码状态：已扫码，等待在手机QQ确认登录...');
        return false;
      }
      if (r.retcode === 0) {
        log('二维码状态：已确认，开始登录...');
        // #region agent log
        DEBUG_LOG('qq-bot.js:qrcode:confirmed', 'retcode=0; calling qrcodeLogin()', { uin: r.uin }, 'H4');
        // #endregion
        try {
          await client.qrcodeLogin();
          // #region agent log
          DEBUG_LOG('qq-bot.js:qrcode:login_called', 'qrcodeLogin resolved', {}, 'H4');
          // #endregion
        } catch (e) {
          // #region agent log
          DEBUG_LOG('qq-bot.js:qrcode:login_reject', 'qrcodeLogin rejected', { errorMessage: e.message }, 'H4');
          // #endregion
          log(`qrcodeLogin异常：${e.message}`);
        }
        return true;
      }
      if (r.retcode === 17) {
        log('二维码状态：超时，正在重新获取二维码...');
        // #region agent log
        DEBUG_LOG('qq-bot.js:qrcode:timeout', 'retcode=17; refreshing login()', {}, 'H4');
        // #endregion
        client.login();
        return true;
      }
      if (r.retcode === 54) {
        log('二维码状态：已取消，正在重新获取二维码...');
        // #region agent log
        DEBUG_LOG('qq-bot.js:qrcode:canceled', 'retcode=54; refreshing login()', {}, 'H4');
        // #endregion
        client.login();
        return true;
      }
      log(`二维码状态：未知(retcode=${r.retcode})，正在重新获取二维码...`);
      client.login();
      return true;
    } catch (e) {
      // #region agent log
      DEBUG_LOG('qq-bot.js:qrcode:poll_error', 'queryQrcodeResult failed', { errorMessage: e.message }, 'H4');
      // #endregion
      log(`二维码状态查询失败：${e.message}`);
      return false;
    } finally {
      if (Date.now() - startedAt > 120000) {
        log('二维码状态：2分钟仍未完成登录，请重新运行或检查手机端是否弹出确认/设备锁/滑块。');
      }
    }
  };

  // 每2秒轮询一次状态，直到触发登录或刷新二维码
  const timer = setInterval(async () => {
    const done = await poll('interval');
    if (done) clearInterval(timer);
  }, 2000);
  // 允许按回车立即查询一次（不会盲目 login）
  process.stdin.once('data', async () => {
    // #region agent log
    DEBUG_LOG('qq-bot.js:system.login.qrcode:stdin', 'stdin received; polling once', {}, 'H4');
    // #endregion
    log('已收到回车，立即查询二维码状态...');
    const done = await poll('stdin');
    if (done) clearInterval(timer);
  });
});

// 设备锁验证
client.on('system.login.device', (data) => {
  // #region agent log
  DEBUG_LOG('qq-bot.js:system.login.device', 'oicq device lock', { phone: data.phone, hasUrl: !!data.url }, 'H4');
  // #endregion
  log(`设备锁验证：绑定手机尾号 ${data.phone}，请在手机QQ按提示确认登录`);
  if (data.url) log(`设备锁验证URL：${data.url}`);
});

// 滑块验证
client.on('system.login.slider', (data) => {
  // #region agent log
  DEBUG_LOG('qq-bot.js:system.login.slider', 'oicq slider required', { hasUrl: !!data.url }, 'H4');
  // #endregion
  log('需要滑块验证，请打开链接完成验证后再重试登录');
  if (data.url) log(`滑块验证URL：${data.url}`);
});

// 监听私聊消息
client.on('message.private', async (e) => {
  const sender = e.sender;
  const message = e.raw_message.trim();
  
  log(`收到消息来自 ${sender.nickname}(${sender.user_id}): ${message}`);
  
  // 权限检查
  const allowAll = CONFIG.authorizedUsers.length === 0;
  if (!allowAll && !CONFIG.authorizedUsers.includes(sender.user_id)) {
    await e.reply('❌ 无权限使用此机器人');
    log(`未授权用户 ${sender.user_id} 尝试使用机器人`);
    return;
  }
  
  // 处理指令
  await handleCommand(e, message, sender);
});

// 处理指令
async function handleCommand(context, message, sender) {
  switch (message) {
    case '日报':
      await executeDailyReport(context);
      break;
    case '收发存':
      await executeShoufacunReport(context);
      break;
    case '状态':
      await sendStatus(context);
      break;
    case '帮助':
      await sendHelp(context);
      break;
    default:
      if (message.startsWith('日报 ')) {
        const date = message.split(' ')[1];
        await executeDailyReport(context, date);
      } else {
        await context.reply('❓ 未知指令，发送"帮助"查看可用指令');
      }
  }
}

// 执行日报
async function executeDailyReport(context, customDate = null) {
  if (isRunning) {
    await context.reply('⏳ 正在执行中，请稍候...');
    return;
  }
  
  isRunning = true;
  await context.reply('📋 收到指令，开始生成日报...');
  
  try {
    log('开始执行日报脚本');
    const args = customDate ? ['src/main.js', '--daily', '--date', customDate] : ['src/main.js', '--daily'];
    
    const result = spawnSync('node', args, {
      cwd: CONFIG.projectRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    if (result.status === 0) {
      await context.reply('✅ 日报生成完成！');
      updateExecuteStatus();
      log('日报执行成功');
    } else {
      const errorMsg = result.stderr || result.stdout || '未知错误';
      await context.reply(`❌ 日报生成失败：\n${errorMsg}`);
      log(`日报执行失败: ${errorMsg}`);
    }
  } catch (error) {
    await context.reply(`❌ 执行异常：${error.message}`);
    log(`日报执行异常: ${error.message}`);
  } finally {
    isRunning = false;
  }
}

// 执行收发存
async function executeShoufacunReport(context) {
  if (isRunning) {
    await context.reply('⏳ 正在执行中，请稍候...');
    return;
  }
  
  isRunning = true;
  await context.reply('📊 收到指令，开始生成收发存...');
  
  try {
    log('开始执行收发存脚本');
    const result = spawnSync('node', ['src/main.js', '--shoufacun'], {
      cwd: CONFIG.projectRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    if (result.status === 0) {
      await context.reply('✅ 收发存生成完成！');
      updateExecuteStatus();
      log('收发存执行成功');
    } else {
      const errorMsg = result.stderr || result.stdout || '未知错误';
      await context.reply(`❌ 收发存生成失败：\n${errorMsg}`);
      log(`收发存执行失败: ${errorMsg}`);
    }
  } catch (error) {
    await context.reply(`❌ 执行异常：${error.message}`);
    log(`收发存执行异常: ${error.message}`);
  } finally {
    isRunning = false;
  }
}

// 发送状态信息
async function sendStatus(context) {
  const now = new Date();
  const today = now.toDateString();
  
  // 重置每日计数
  if (today !== lastDate) {
    todayCount = 0;
    lastDate = today;
  }
  
  const status = `📊 系统状态：
- 机器人状态：${isRunning ? '🟡 执行中' : '🟢 空闲'}
- 最后执行：${lastExecuteTime}
- 今日执行次数：${todayCount}
- 授权用户数：${CONFIG.authorizedUsers.length}
- 系统时间：${now.toLocaleString('zh-CN')}`;
  
  await context.reply(status);
}

// 发送帮助信息
async function sendHelp(context) {
  const help = `🤖 QQ机器人使用指南：

📋 可用指令：
• 日报 - 生成当日日报
• 日报 YYYY-MM-DD - 生成指定日期日报
• 收发存 - 生成收发存报表
• 状态 - 查看系统状态
• 帮助 - 显示此帮助信息

⚡ 执行结果将通过QQ发给你

🔒 仅授权用户可以使用此机器人`;
  
  await context.reply(help);
}

// 更新执行状态
function updateExecuteStatus() {
  lastExecuteTime = new Date().toLocaleString('zh-CN');
  todayCount++;
}

// 广播状态给所有授权用户
async function broadcastStatus(message) {
  for (const userId of CONFIG.authorizedUsers) {
    try {
      await client.sendPrivateMsg(userId, message);
    } catch (error) {
      log(`向用户 ${userId} 广播消息失败: ${error.message}`);
    }
  }
}

// 定时任务
cron.schedule('0 9 * * *', async () => {
  // 每天早上9点检查机器人状态
  log('定时任务：状态检查');
  await broadcastStatus('🌅 早安！QQ机器人正常运行中');
});

cron.schedule('0 17 * * *', async () => {
  // 每天下午5点提醒可以生成日报
  log('定时任务：日报提醒');
  await broadcastStatus('⏰ 下午5点，记得生成日报哦！');
});

// 错误处理
client.on('system.error', (data) => {
  log(`系统错误: ${data.message}`);
});

process.on('uncaughtException', (error) => {
  log(`未捕获异常: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`未处理的Promise拒绝: ${reason}`);
});

// 启动机器人
// #region agent log
DEBUG_LOG('qq-bot.js:client.login', 'oicq login() called', { botQQ: CONFIG.botQQ }, 'H4');
// #endregion
log('正在启动QQ机器人...');
// #region agent log
DEBUG_LOG(
  'qq-bot.js:startup:env',
  'startup env snapshot',
  {
    node: process.version,
    hasHttpProxy: !!process.env.HTTP_PROXY || !!process.env.http_proxy,
    hasHttpsProxy: !!process.env.HTTPS_PROXY || !!process.env.https_proxy,
    hasAllProxy: !!process.env.ALL_PROXY || !!process.env.all_proxy,
  },
  'H21'
);
// #endregion
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY) {
  log('检测到系统代理环境变量（HTTP(S)_PROXY/ALL_PROXY），扫码登录可能失败；如遇登录失败建议临时关闭代理后重试。');
}
client.login();

// 优雅关闭
process.on('SIGINT', () => {
  log('收到关闭信号，正在关闭机器人...');
  broadcastStatus('👋 QQ机器人即将关闭，如有需要请手动重启').then(() => {
    process.exit(0);
  });
});
