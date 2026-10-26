# autoribao

东吴云生产数据自动化工具。项目通过 Playwright 获取平台数据，使用 PostgreSQL 保存项目、计划、构件和状态事件，并生成日报、收发存及校对报告。

## 主要功能

- 生产计划、构件、订单和项目桥接数据同步。
- 日报和月度收发存 Excel 生成。
- 月度收发存固定通过入库、出库 API 分三段取数；日报仍查询数据库。
- 入库、出库事件保存 API 时点快照，历史明细不受构件主数据后续变化影响。
- QQ/NapCat 消息查询与报表通知。
- PostgreSQL 备份、校验和 Windows 计划任务脚本。

## 环境

- Windows
- Node.js 18+
- PostgreSQL
- Chrome 或 Playwright Chromium

## 安装

```powershell
npm install
Copy-Item config/default.example.json config/default.json
```

编辑 `config/default.json`，填写平台地址、账号和数据库连接。真实配置文件已被 `.gitignore` 排除，不要提交凭据。

如需 Playwright 自带浏览器：

```powershell
npm run install-browsers
```

## 常用命令

```powershell
# 日报
npm run daily-report

# 7 月收发存，API 分段为 6/26—7/5、7/6—7/15、7/16—7/25
node src/main.js --shoufacun --month 2026-07

# API 只读校对；自动拆分为 26 日至 10 日、11 日至 25 日
npm run reconcile-shoufacun-api -- --month 2026-07

# 确认差异后显式同步数据库
npm run reconcile-shoufacun-api -- --month 2026-07 --sync

# 兼容旧参数：同样分三段取 API，输出带 _API 后缀的独立报表
node src/main.js --shoufacun --month 2026-07 --from-api

# QQ/NapCat 服务
npm run qq-bot-napcat
```

## 数据口径

- 月度收发存周期固定为上月 26 日至本月 25 日，使用 `Asia/Shanghai` 时区。
- 入库、出库均依次查询上月 26 日至本月 5 日、6 日至 15 日、16 日至 25 日；全部成功后合并生成。任一段失败或表头不一致时停止，不回退数据库或网页导出。
- 计划任务和普通 `--shoufacun` 命令输出 `YYYYMM收发存报表.xlsx`；上月结存仍从上月收发存文件读取，可用 `--last-month` 指定。
- 明细表保留 API 原始重量精度。
- 汇总表按项目换算为吨后四舍五入到三位。
- 月度入库、出库采用平台对应 API 对所选日期范围的返回口径；本地数据库查询另保留截止日状态判断。
- API 校对默认只读，只有 `--sync` 允许更新数据库快照或差异数据。

## 目录

- `src/`：采集、同步、查询、报表和机器人代码。
- `src/query/`：数据库查询意图和状态口径。
- `db/`、`sql/`：数据库结构及迁移。
- `scripts/`：备份、校验和维护脚本。
- `test/`：Node.js 测试。
- `docs/`：API 和业务说明。
- `config/*.example.json`：可公开的配置模板。

更多设计背景见 [DESIGN.md](DESIGN.md)，数据库结构见 [DB.md](DB.md)。
