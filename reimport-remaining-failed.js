// 重新导入剩余失败的计划
const remainingFailedPlanIds = [
    2808, 2803, 2660, 2071, 2065,  // API 超时的计划
    2284, 1527, 688               // 约束错误的计划
];

console.log('=== 重新导入剩余失败的计划 ===');
console.log(`共 ${remainingFailedPlanIds.length} 个计划需要重新导入`);

console.log('\n# 单个计划导入（推荐）');
remainingFailedPlanIds.forEach(planId => {
    console.log(`node src/extract-production-plan.js --api --by-project --components --plan-id ${planId}`);
});

console.log('\n# 分批导入（每批 3 个）');
const batchSize = 3;
for (let i = 0; i < remainingFailedPlanIds.length; i += batchSize) {
    const batch = remainingFailedPlanIds.slice(i, i + batchSize);
    const planIds = batch.map(id => `--plan-id ${id}`).join(' ');
    console.log(`node src/extract-production-plan.js --api --by-project --components ${planIds}`);
}
