// 重新导入缺少状态时间的计划
const missingTimePlanIds = [
    7847, 7846, 7845, 7844, 7843, 7842, 7841, 7840, 7839, 7838,
    7837, 7836, 7835, 7834, 7833, 7832, 7831, 7830, 7829, 7828,
    7827, 7826, 7825, 7824, 7823, 7822, 7821, 7820, 7819, 7818,
    7817, 7815, 7814, 7813, 7812, 7811, 7810, 7809, 7808, 7807,
    7806, 7805, 7804, 7803, 7802, 7801, 7800, 7799, 7798, 7797
];

console.log('=== 重新导入缺少状态时间的计划 ===');
console.log(`共 ${missingTimePlanIds.length} 个计划需要重新导入`);

console.log('\n# 分批导入（每批 5 个，推荐）');
const batchSize = 5;
for (let i = 0; i < missingTimePlanIds.length; i += batchSize) {
    const batch = missingTimePlanIds.slice(i, i + batchSize);
    const planIds = batch.map(id => `--plan-id ${id}`).join(' ');
    console.log(`node src/extract-production-plan.js --api --by-project --components ${planIds}`);
}

console.log('\n# 分批导入（每批 10 个，较快）');
const batchSize10 = 10;
for (let i = 0; i < missingTimePlanIds.length; i += batchSize10) {
    const batch = missingTimePlanIds.slice(i, i + batchSize10);
    const planIds = batch.map(id => `--plan-id ${id}`).join(' ');
    console.log(`node src/extract-production-plan.js --api --by-project --components ${planIds}`);
}
