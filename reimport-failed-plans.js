// 生成重新导入命令
const failedPlanIds = [
    5940, 4294, 240806, 3560, 2392, 3267, 2808, 2803, 2700, 2660, 
    2598, 2284, 2134, 2131, 2071, 2065, 1527, 688, 500, 534
];

console.log('=== 重新导入失败的计划 ===');
console.log(`共 ${failedPlanIds.length} 个计划需要重新导入`);

console.log('\n# 方案1：单个计划导入（推荐，更稳定）');
failedPlanIds.forEach(planId => {
    console.log(`node src/extract-production-plan.js --api --by-project --components --plan-id ${planId}`);
});

console.log('\n# 方案2：批量导入（分批执行）');
const batchSize = 5;
for (let i = 0; i < failedPlanIds.length; i += batchSize) {
    const batch = failedPlanIds.slice(i, i + batchSize);
    const planIds = batch.map(id => `--plan-id ${id}`).join(' ');
    console.log(`node src/extract-production-plan.js --api --by-project --components ${planIds}`);
}

console.log('\n# 方案3：全部一次性导入（可能不稳定）');
const allPlanIds = failedPlanIds.map(id => `--plan-id ${id}`).join(' ');
console.log(`node src/extract-production-plan.js --api --by-project --components ${allPlanIds}`);
