# STATUS

## Current Stage

月度收发存已切换为三段 API 取数；日报和 QQbot 发货日期范围查询继续使用数据库。

## Completed

- Reviewed existing autoribao and unified-automation API usage around dwyunsc.
- Confirmed autoribao currently stores project, production plan, plan component, component status, order, and order-component bridge data.
- Added `docs/dwyunsc-api-reference.md` as a durable API reference for later development.
- 2026-10-26：收发存固定从入库、出库 API 取数，分上月 26 日至本月 5 日、6—15 日、16—25 日，全部成功后合并出表。HTTP/业务错误、缺少列表或分段表头不一致会中止；不回退数据库或网页导出。
- 普通命令和计划任务沿用标准报表名，旧 `--from-api` 参数保留 `_API.xlsx` 后缀。上月结存仍读取上月文件。
- 月度 API 校对按 26 日至次月 10 日、11 日至 25 日分段执行；默认只读，显式 `--sync` 才写库。
- 入库、出库事件保存 API 时点快照；明细保留原始高精度重量，汇总按项目换算为吨后四舍五入到三位。
- 2026-07 入库已逐构件核对：20,547 行、19,673 个唯一项目+GUID、2,486,283.4722072646 kg，API 与数据库差异为 0。
- 历史数据库版出库曾完成构件级明细和 20,461 条发货事件快照回填；此次移除月度报表的数据库取数入口，数据库同步和查询仍保留。
- QQbot 支持按任意起止日期生成发货信息 Excel，工作簿包含发货明细、按月份/项目汇总、月度合计和区间合计。

## In Progress

- 保持后续月份 API 校对，发现差异时先校对再显式同步。

## 本次交接（2026-10-26）

- 已完成三段 API 月报入口，变更集中在 `src/main.js`；新增模拟测试位于 `test/shoufacun-api-report.test.js`，README、DESIGN、TASKLIST 和 CHANGELOG 已同步。
- 验证：9 个离线测试文件独立运行，32 项通过（含本次新增 7 项）；语法检查、diff 空白检查和独立代码审查通过。项目文档检查确认沿用现有状态体系。
- 现有 `project-list-component-api.test.js` 是真实网页登录冒烟脚本，因沙箱禁止启动 Chrome（spawn EPERM）未完成；没有运行真实月报生成。当前月入库、出库原始 CSV 校验值未改变。
- 202610 报表由用户人工修改，不重生成。现有月报计划任务无需更改，下次调用原命令即走三段 API。

## Blockers

- No blocker.

## Risks

- The API reference is based on project code and captured requests, not official platform documentation.
- Some endpoints reuse request bodies captured from pages; payload fields should be revalidated before new automation work.
- 202610 原报表漏记 368 条出库，约 315.108 吨，用户自行修正；本次不重生成。宁国开关站重复 GUID 导致数据库发货同步中止的问题仍未修复，后续数据库查询需留意该缺口。
- 工序通用校对仍存在少量“仅数据库”记录，收发存最终口径已独立逐构件校验通过；两种口径不要混为一谈。

## Next Steps

- 维持现有定时同步：生产计划构件（hourly）、订单 + `order_component` 桥接（daily 03:30）。
- 打包/发运创建与状态推进：由综合平台 `I:\dwyzonghe` 负责，autoribao 不再规划打包/发运表镜像或独立定时任务。
- 后续收发存统一执行 `node src/main.js --shoufacun --month YYYY-MM`；需要 API 校对时执行 `node src/shoufacun-api-reconciliation.js --month YYYY-MM`。
