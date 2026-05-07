const { createClient } = require('oicq');

// 尝试不同的登录协议
const protocols = [
  { platform: 5, name: 'Android' },  // 安卓手机
  { platform: 3, name: 'iPad' },     // iPad
  { platform: 1, name: 'PC' }        // PC客户端
];

async function tryLogin() {
  for (const protocol of protocols) {
    console.log(`🔄 尝试使用 ${protocol.name} 协议登录...`);
    
    const client = createClient(2162802443, {
      platform: protocol.platform,
      ignore_self: false,
      brief: false,
      log_level: 'warn'  // 减少日志输出
    });
    
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.logout();
          reject(new Error('登录超时'));
        }, 30000); // 30秒超时
        
        client.on('system.online', () => {
          clearTimeout(timeout);
          console.log(`✅ ${protocol.name} 协议登录成功！`);
          resolve(client);
        });
        
        client.on('system.login.error', (data) => {
          clearTimeout(timeout);
          console.log(`❌ ${protocol.name} 协议登录失败: ${data.message}`);
          client.logout();
          reject(new Error(data.message));
        });
        
        client.on('system.qrcode', (data) => {
          console.log(`📱 ${protocol.name} 协议二维码已生成`);
          console.log(`💾 保存位置: ${data.image}`);
          
          // 自动打开二维码
          try {
            const { spawn } = require('child_process');
            if (process.platform === 'win32') {
              spawn('start', [data.image], { shell: true });
            }
          } catch (error) {
            // 忽略错误
          }
        });
        
        client.login();
      });
      
      return client; // 登录成功，返回客户端
      
    } catch (error) {
      console.log(`⚠️ ${protocol.name} 协议不可用，尝试下一个...`);
      continue;
    }
  }
  
  throw new Error('所有协议都无法登录');
}

// 启动登录
console.log('🚀 开始尝试多种协议登录...');
tryLogin().then(client => {
  console.log('🎉 登录成功！机器人已就绪');
  
  // 这里可以添加消息处理逻辑
  client.on('message.private', async (e) => {
    console.log(`收到消息: ${e.raw_message}`);
    await e.reply('机器人已连接，功能开发中...');
  });
  
}).catch(error => {
  console.error('❌ 所有登录尝试都失败了:', error.message);
  console.log('💡 建议：');
  console.log('1. 检查网络连接');
  console.log('2. 确认QQ号正确');
  console.log('3. 稍后再试');
});
