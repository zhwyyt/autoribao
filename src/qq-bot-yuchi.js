const { createClient } = require('@oicq/yuchi');

console.log('🚀 启动QQ机器人 - Yuchi协议版');

// 使用Yuchi协议，更稳定
const client = createClient(2162802443, {
  platform: 2,  // aPad协议
  log_level: 'warn'
});

// 登录成功处理
client.on('system.online', () => {
  console.log('');
  console.log('🎉🎉🎉 QQ机器人登录成功！🎉🎉🎉');
  console.log('📱 现在可以给机器人发消息了');
  console.log('📋 发送"测试"验证功能');
  console.log('');
  
  // 消息处理
  client.on('message.private', async (e) => {
    const msg = e.raw_message.trim();
    console.log(`💬 收到消息: ${msg}`);
    
    switch(msg) {
      case '测试':
        await e.reply('✅ 机器人正常工作！');
        console.log('✅ 已回复测试消息');
        break;
      case '日报':
        await e.reply('📋 正在生成日报...');
        console.log('📋 开始执行日报脚本');
        // 这里可以调用你的日报脚本
        break;
      case '帮助':
        await e.reply('📋 可用指令：\n• 测试\n• 日报\n• 帮助');
        console.log('📋 已发送帮助信息');
        break;
      default:
        await e.reply('❓ 未知指令，发送"帮助"查看可用指令');
    }
  });
});

// 登录失败处理
client.on('system.login.error', (data) => {
  console.log('❌ 登录失败:', data.message);
});

// 二维码处理
client.on('system.qrcode', (data) => {
  console.log('');
  console.log('📱 二维码已生成');
  console.log(`💾 位置: ${data.image}`);
  console.log('⚠️  请立即扫描！');
  console.log('');
  
  // 自动打开二维码
  try {
    const { spawn } = require('child_process');
    spawn('start', [data.image], { shell: true });
  } catch (error) {
    // 忽略错误
  }
});

// 设备验证
client.on('system.login.device', (data) => {
  console.log('🔒 需要设备验证');
  console.log(`🌐 请打开: ${data.url}`);
  
  try {
    const { spawn } = require('child_process');
    spawn('start', [data.url], { shell: true });
  } catch (error) {
    // 忽略错误
  }
});

// 防止退出
process.on('SIGINT', () => {
  console.log('👋 正在关闭...');
  if (client.isOnline()) {
    client.logout();
  }
  process.exit(0);
});

// 启动
console.log('📱 正在生成二维码...');
client.login();

console.log('⏳ 等待登录...');
