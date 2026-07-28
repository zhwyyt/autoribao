# TASKLIST

## Upcoming

- （无）打包/发运业务改由综合平台 `I:\dwyzonghe` 直接创建，autoribao 不再扩展打包/发运镜像同步。

## Cancelled（2026-06-01）

> **原因**：Phase 1/2 已在综合平台实现「创建打包 → 发货分配 → 发货单」闭环（`package_job`、`shipment_order` 等本仓表 + 东吴云 API），无需在 autoribao 再建一套打包/发运定时同步。

- [x] ~~Verify current dwyunsc package-management API payloads with fresh browser captures.~~
- [x] ~~Design autoribao tables for package, package artifact, delivery, and delivery artifact data.~~
- [x] ~~Decide whether package-management sync should run as a separate scheduled task or attach to existing order sync.~~
- [x] ~~Add implementation tests/check scripts after a package sync design is approved.~~

**autoribao 仍维护**：项目 / 生产计划 / 构件 / 状态流水 / 订单 / `order_component` 桥接（现有定时任务不变）。

## Done

- [x] Create a dwyunsc API reference document for later use.
- [x] 收发存默认改为数据库生成，出库输出构件明细。
- [x] 修正撤回/归档构件的截止日状态判断。
- [x] 增加入库与出库 API 时点快照，明细保留原始高精度重量。
- [x] API 校对按两个时段执行，默认只读、显式同步。
- [x] 重新生成并逐构件核对 2026 年 7 月收发存。
