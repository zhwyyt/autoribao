# STATUS

## Current Stage

收发存数据库生成与 API 校对已完成，当前进入稳定使用阶段。

## Completed

- Reviewed existing autoribao and unified-automation API usage around dwyunsc.
- Confirmed autoribao currently stores project, production plan, plan component, component status, order, and order-component bridge data.
- Added `docs/dwyunsc-api-reference.md` as a durable API reference for later development.
- 收发存默认直接查询数据库，显式 `--from-api` 时才从网页 API 生成。
- 月度 API 校对按 26 日至次月 10 日、11 日至 25 日分段执行；默认只读，显式 `--sync` 才写库。
- 入库、出库事件保存 API 时点快照；明细保留原始高精度重量，汇总按项目换算为吨后四舍五入到三位。
- 2026-07 入库已逐构件核对：20,547 行、19,673 个唯一项目+GUID、2,486,283.4722072646 kg，API 与数据库差异为 0。
- 数据库版出库已改为构件明细，并完成 20,461 条发货事件快照回填。

## In Progress

- 保持后续月份 API 校对，发现差异时先校对再显式同步。

## Blockers

- No blocker.

## Risks

- The API reference is based on project code and captured requests, not official platform documentation.
- Some endpoints reuse request bodies captured from pages; payload fields should be revalidated before new automation work.
- 工序通用校对仍存在少量“仅数据库”记录，收发存最终口径已独立逐构件校验通过；两种口径不要混为一谈。

## Next Steps

- 维持现有定时同步：生产计划构件（hourly）、订单 + `order_component` 桥接（daily 03:30）。
- 打包/发运创建与状态推进：由综合平台 `I:\dwyzonghe` 负责，autoribao 不再规划打包/发运表镜像或独立定时任务。
- 后续收发存统一执行 `node src/main.js --shoufacun --month YYYY-MM`；需要 API 校对时执行 `node src/shoufacun-api-reconciliation.js --month YYYY-MM`。
