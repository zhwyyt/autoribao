const { Pool } = require('pg');
const config = require('./config/default.json');
const { chromium } = require('playwright');

async function debugPlanApi(planId) {
    const browser = await chromium.launch({ 
        headless: false,
        channel: 'chrome'
    });
    
    const page = await browser.newPage();
    
    try {
        // 登录
        await page.goto('https://dwyunsc.ddwjzkj.com:22222/');
        await page.fill('input[name="account"]', config.credentials.username);
        await page.fill('input[name="password"]', config.credentials.password);
        await page.click('button:has-text("登 录")');
        await page.waitForNavigation();
        
        // 获取 token - 先访问计划页面
        await page.goto('https://dwyunsc.ddwjzkj.com:22222/production/plan');
        await page.waitForTimeout(2000);
        
        // 调用 API
        const apiRes = await page.request.post('https://dwyunsc.ddwjzkj.com:10086/v1.production/getPlanArtifacts', {
            data: { planId: planId },
            headers: {
                'Origin': 'https://dwyunsc.ddwjzkj.com:22222',
                'Referer': 'https://dwyunsc.ddwjzkj.com:22222/'
            },
            timeout: 30000
        });
        
        if (apiRes.status() === 200) {
            const data = await apiRes.json();
            console.log(`\n=== 计划 ${planId} API 响应 ===`);
            console.log('Code:', data.code);
            console.log('Message:', data.msg);
            
            if (data.code === 0) {
                const list = Array.isArray(data.data) ? data.data : (data.data && Array.isArray(data.data.list) ? data.data.list : []);
                console.log('构件数量:', list.length);
                
                if (list.length > 0) {
                    console.log('\n前3个构件数据:');
                    list.slice(0, 3).forEach((item, index) => {
                        console.log(`构件 ${index + 1}:`);
                        console.log(`  GUID: ${item.guid || item['构件GUID']}`);
                        console.log(`  编号: ${item.dode || item.code || item['构件编号']}`);
                        console.log(`  数量: ${item.num || item['数量']}`);
                        console.log(`  重量: ${item.weight || item['重量']}`);
                        console.log(`  长度: ${item.length || item['长度']}`);
                    });
                    
                    // 检查数量异常
                    const invalidItems = list.filter(item => {
                        const qty = Number(String(item.num || item['数量'] || '').trim()) || 0;
                        return qty <= 0;
                    });
                    
                    if (invalidItems.length > 0) {
                        console.log(`\n⚠️ 发现 ${invalidItems.length} 个数量 <= 0 的构件:`);
                        invalidItems.slice(0, 3).forEach((item, index) => {
                            const qty = item.num || item['数量'];
                            const code = item.dode || item.code || item['构件编号'];
                            console.log(`  ${code}: 数量=${qty}`);
                        });
                    }
                } else {
                    console.log('❌ API 返回空数据');
                }
            } else {
                console.log('❌ API 返回错误:', data.msg);
            }
        } else {
            console.log('❌ API 请求失败:', apiRes.status());
        }
        
    } catch (error) {
        console.error('调试失败:', error.message);
    } finally {
        await browser.close();
    }
}

// 检查计划 2284
debugPlanApi(2284).catch(console.error);
