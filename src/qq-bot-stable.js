const { createClient } = require('oicq');
const { spawnSync } = require('child_process');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// 配置文件
const CONFIG = {
  // 机器人QQ号
  botQQ: 2162802443, // 机器人QQ号
  // 授权用户QQ号列表（只有这些用户可以触发）
  authorizedUsers: [
    2162802443 // 默认允许机器人自己触发，可以添加你的手机QQ号
  ],
  // 项目根目录
  projectRoot: __dirname,
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

// 创建QQ客户端 - 使用iPad协议，更稳定
const client = createClient(CONFIG.botQQ, {
  platform: 3,  // iPad协议，更稳定
  ignore_self: false,  // 接收自己的消息
  brief: false,  // 显示详细信息
  log_level: 'info'  // 日志级别
});

// 登录事件
client.on('system.online', () => {
  log('QQ机器人已上线');
  console.log('🎉 QQ机器人登录成功！');
  console.log('📱 现在可以用手机QQ给机器人发送指令了');
  console.log('📋 发送"帮助"查看所有可用指令');
});

// 登录错误处理 - 不退出，继续重试
client.on('system.login.error', (data) => {
  log(`登录失败: ${data.message}`);
  console.log('❌ 登录失败，正在重新生成二维码...');
  console.log('💡 提示：请立即扫描新的二维码');
  
  // 延迟2秒后重新登录
  setTimeout(() => {
    console.log('🔄 正在重新生成二维码...');
    client.login();
  }, 2000);
});

// 二维码事件
client.on('system.qrcode', (data) => {
  console.log('📱 请使用手机QQ扫描二维码登录');
  console.log(`💾 二维码已保存到: ${data.image}`);
  console.log('⏰ 二维码有效期约3分钟，请及时扫描');
  console.log('🔄 如果二维码过期，程序会自动生成新的');
  
  // 自动打开二维码图片
  try {
    const { spawn } = require('child_process');
    if (process.platform === 'win32') {
      spawn('start', [data.image], { shell: true });
    }
  } catch (error) {
    // 忽略错误，继续执行
  }
});

// 监听滑块验证码
client.on('system.login.device', (data) => {
  log(`需要设备验证: ${data.url}`);
  console.log('🔒 需要设备验证');
  console.log(`📋 请在浏览器中打开: ${data.url}`);
  console.log('✅ 完成验证后，程序会自动继续登录');
  console.log('⏳ 等待验证完成...');
  
  // 自动打开验证页面
  try {
    const { spawn } = require('child_process');
    if (process.platform === 'win32') {
      spawn('start', [data.url], { shell: true });
    }
  } catch (error) {
    // 忽略错误，继续执行
  }
});

// 监听验证码输入
client.on('system.login.captcha', (data) => {
  log(`需要验证码: ${data.url}`);
  console.log('🔢 需要图片验证码');
  console.log(`📋 请在浏览器中打开: ${data.url}`);
  console.log('✅ 查看验证码后，程序会自动继续');
  
  // 自动打开验证码页面
  try {
    const { spawn } = require('child_process');
    if (process.platform === 'win32') {
      spawn('start', [data.url], { shell: true });
    }
  } catch (error) {
    // 忽略错误，继续执行
  }
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
log('正在启动QQ机器人...');
console.log('🚀 正在启动QQ机器人...');
console.log('📱 请准备扫描二维码登录');

// 防止程序意外退出
process.on('SIGINT', () => {
  log('收到关闭信号，正在关闭机器人...');
  console.log('👋 正在关闭QQ机器人...');
  if (client.isOnline()) {
    broadcastStatus('👋 QQ机器人即将关闭，如有需要请手动重启').then(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// 启动登录
client.login();

// 保持程序运行
console.log('⏳ 等待登录中...');
console.log('💡 提示：程序不会自动关闭，请放心扫描二维码');
