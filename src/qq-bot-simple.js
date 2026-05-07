const { createClient } = require('oicq');
const fs = require('fs');
const path = require('path');

console.log('🚀 启动QQ机器人 - 简化版');

// 使用最稳定的配置
const client = createClient(2162802443, {
  platform: 1,  // PC协议，通常最稳定
  log_level: 'warn'  // 减少日志干扰
});

let loginSuccess = false;

// 登录成功
client.on('system.online', () => {
  loginSuccess = true;
  console.log('🎉 QQ机器人登录成功！');
  console.log('📱 现在可以给机器人发消息了');
  
  // 简单的消息处理
  client.on('message.private', async (e) => {
    const msg = e.raw_message.trim();
    console.log(`收到消息: ${msg}`);
    
    if (msg === '测试') {
      await e.reply('✅ 机器人正常工作！');
    } else if (msg === '日报') {
      await e.reply('📋 正在生成日报...');
      // 这里可以调用你的日报脚本
    } else if (msg === '帮助') {
      await e.reply('📋 可用指令：\n• 测试\n• 日报\n• 帮助');
    } else {
      await e.reply('❓ 未知指令，发送"帮助"查看可用指令');
    }
  });
});

// 登录失败处理
client.on('system.login.error', (data) => {
  console.log('❌ 登录失败:', data.message);
  if (!loginSuccess) {
    console.log('🔄 5秒后重新尝试...');
    setTimeout(() => {
      client.login();
    }, 5000);
  }
});

// 二维码显示
client.on('system.qrcode', (data) => {
  console.log('📱 二维码已生成');
  console.log(`💾 位置: ${data.image}`);
  console.log('⚠️  请立即扫描！有效期很短！');
  
  // 自动打开二维码
  try {
    const { spawn } = require('child_process');
    spawn('start', [data.image], { shell: true });
  } catch (error) {
    // 忽略错误
  }
  
  // 每10秒提醒一次
  let reminder = 0;
  const interval = setInterval(() => {
    if (loginSuccess) {
      clearInterval(interval);
      return;
    }
    reminder += 10;
    console.log(`⏰ 已等待 ${reminder} 秒，请尽快扫描二维码...`);
    if (reminder >= 60) {
      clearInterval(interval);
      console.log('⏰ 等待超时，重新生成二维码...');
      client.login();
    }
  }, 10000);
});

// 设备验证
client.on('system.login.device', (data) => {
  console.log('🔒 需要设备验证');
  console.log(`📋 请打开: ${data.url}`);
  
  // 自动打开验证页面
  try {
    const { spawn } = require('child_process');
    spawn('start', [data.url], { shell: true });
  } catch (error) {
    // 忽略错误
  }
});

// 启动登录
console.log('📱 正在生成二维码...');
client.login();

// 防止程序退出
process.on('SIGINT', () => {
  console.log('👋 正在关闭...');
  if (client.isOnline()) {
    client.logout();
  }
  process.exit(0);
});

console.log('⏳ 等待登录中...');
