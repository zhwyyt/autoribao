// 测试日期修复逻辑的安全性
function testDateFix() {
    const problematicPlanIds = [455, 454, 453, 452, 450, 449, 448, 274, 273];
    
    // 测试用例
    const testCases = [
        // 问题日期（应该被修复）
        { planId: 455, date: '2023-04-70 16:49:52', expected: '2023-04-17 16:49:52' },
        { planId: 273, date: '2023-03-70 16:33:16', expected: '2023-03-17 16:33:16' },
        
        // 正常日期（不应该被修改）
        { planId: 1000, date: '2023-04-17 16:49:52', expected: '2023-04-17 16:49:52' },
        { planId: 1000, date: '2023-03-15 10:30:00', expected: '2023-03-15 10:30:00' },
        { planId: 1000, date: '2024-01-01 09:00:00', expected: '2024-01-01 09:00:00' },
        { planId: 1000, date: '2023-12-31 23:59:59', expected: '2023-12-31 23:59:59' },
        
        // 特定计划但正常日期（不应该被修改）
        { planId: 455, date: '2023-04-17 16:49:52', expected: '2023-04-17 16:49:52' },
        { planId: 273, date: '2023-03-15 10:30:00', expected: '2023-03-15 10:30:00' },
    ];
    
    console.log('=== 测试日期修复逻辑 ===');
    
    let allPassed = true;
    
    testCases.forEach((testCase, index) => {
        const { planId, date, expected } = testCase;
        
        // 模拟修复逻辑
        const timeRegex = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/;
        const timeMatch = date.match(timeRegex);
        const hasTime = !!timeMatch;
        
        if (problematicPlanIds.includes(Number(planId)) && hasTime) {
            let fixedTime = timeMatch[1].replace(/2023-(04|03)-70/g, '2023-$1-17');
            timeMatch[1] = fixedTime;
        }
        
        const result = hasTime ? timeMatch[1] : date;
        const passed = result === expected;
        
        console.log(`测试 ${index + 1}: ${passed ? '✅' : '❌'}`);
        console.log(`  计划ID: ${planId}`);
        console.log(`  原始日期: ${date}`);
        console.log(`  期望结果: ${expected}`);
        console.log(`  实际结果: ${result}`);
        console.log('');
        
        if (!passed) allPassed = false;
    });
    
    console.log(`=== 测试结果: ${allPassed ? '✅ 全部通过' : '❌ 有测试失败'} ===`);
}

testDateFix();
