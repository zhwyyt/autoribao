const { createClient } = require('oicq');

console.log('🚀 启动QQ机器人 - 超稳定版');

// 创建客户端
const client = createClient(2162802443, {
  platform: 5,  // Android协议
  log_level: 'info'  // 显示详细日志
});

let isLoginSuccess = false;

// 详细的事件监听
client.on('system.online', () => {
  isLoginSuccess = true;
  console.log('');
  console.log('🎉🎉🎉 QQ机器人登录成功！🎉🎉🎉');
  console.log('📱 现在可以给机器人发消息了');
  console.log('📋 发送"测试"来验证功能');
  console.log('');
  
  // 添加消息处理
  client.on('message.private', async (e) => {
    const msg = e.raw_message.trim();
    console.log(`💬 收到消息: ${msg}`);
    
    if (msg === '测试') {
      await e.reply('✅ 机器人正常工作！');
      console.log('✅ 已回复测试消息');
    } else if (msg === '日报') {
      await e.reply('📋 正在生成日报...');
      console.log('📋 开始执行日报脚本');
    } else if (msg === '帮助') {
      await e.reply('📋 可用指令：\n• 测试\n• 日报\n• 帮助');
      console.log('📋 已发送帮助信息');
    } else {
      await e.reply('❓ 未知指令，发送"帮助"查看可用指令');
    }
  });
});

client.on('system.login.error', (data) => {
  console.log('❌ 登录失败:', data.message);
  if (!isLoginSuccess) {
    console.log('🔄 10秒后重新尝试登录...');
    setTimeout(() => {
      console.log('🔄 重新生成二维码...');
      client.login();
    }, 10000);
  }
});

client.on('system.qrcode', (data) => {
  console.log('');
  console.log('📱📱📱 二维码已生成 📱📱📱');
  console.log(`💾 图片位置: ${data.image}`);
  console.log('⚠️  请立即用手机QQ扫描！');
  console.log('⏳ 扫描后请等待程序响应...');
  console.log('');
  
  // 自动打开二维码
  try {
    const { spawn } = require('child_process');
    spawn('start', [data.image], { shell: true });
    console.log('🖼️  已自动打开二维码图片');
  } catch (error) {
    console.log('⚠️  无法自动打开图片，请手动打开');
  }
  
  // 定时提醒
  let count = 0;
  const reminder = setInterval(() => {
    if (isLoginSuccess) {
      clearInterval(reminder);
      return;
    }
    count += 10;
    console.log(`⏰ 等待中... 已${count}秒，请确保已扫描二维码`);
    
    if (count >= 120) { // 2分钟超时
      clearInterval(reminder);
      console.log('⏰ 等待超时，重新生成二维码...');
      client.login();
    }
  }, 10000);
});

client.on('system.login.device', (data) => {
  console.log('');
  console.log('🔒 需要设备验证');
  console.log(`🌐 请在浏览器打开: ${data.url}`);
  console.log('✅ 完成验证后程序会自动继续');
  console.log('');
  
  // 自动打开验证页面
  try {
    const { spawn } = require('child_process');
    spawn('start', [data.url], { shell: true });
    console.log('🌐 已自动打开验证页面');
  } catch (error) {
    console.log('⚠️  请手动复制URL到浏览器');
  }
});

client.on('system.login.slider', (data) => {
  console.log('');
  console.log('🔒 需要滑块验证');
  console.log(`🌐 请在浏览器打开: ${data.url}`);
  console.log('✅ 完成验证后程序会自动继续');
  console.log('');
  
  // 自动打开验证页面
  try {
    const { spawn } = require('child_process');
    spawn('start', [data.url], { shell: true });
    console.log('🌐 已自动打开滑块验证页面');
  } catch (error) {
    console.log('⚠️  请手动复制URL到浏览器');
  }
});

// 防止程序意外退出
process.on('SIGINT', () => {
  console.log('');
  console.log('👋 正在关闭QQ机器人...');
  if (client.isOnline()) {
    client.logout();
    console.log('✅ 已安全退出');
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('');
  console.log('👋 收到终止信号，正在关闭...');
  if (client.isOnline()) {
    client.logout();
  }
  process.exit(0);
});

// 启动登录
console.log('📱 正在生成登录二维码...');
client.login();

console.log('');
console.log('⏳ 等待登录中...请勿关闭此窗口');
console.log('💡 提示：程序会一直运行直到登录成功');
console.log('');
