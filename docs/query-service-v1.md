# QQ 自然语言查询服务 V1 设计

## 1. 目标

本设计用于当前项目的 QQ 机器人自然语言问答能力，原则如下：

- 同步链路继续使用现有网页 API + PostgreSQL，不依赖 GPT 才能运行。
- 查询层优先走规则解析和安全 SQL 模板，避免自由生成 SQL 直接查库。
- 组织范围优先使用班组对应表做归一化，再结合数据库中的真实事件名做补充匹配。
- 一条 QQ 消息允许拆成多个子查询，例如“查一下葛十军班组还有哪些未完成任务，以及今日装焊完成产量”。

## 2. 已确认的数据来源

### 2.1 生产业务数据库

当前项目数据库已具备以下主数据与事件数据：

- `project`
- `production_plan`
- `component`
- `component_status_event`

其中 `component_status_event` 实际已有以下查询关键字段：

- `status_type`
- `is_completed`
- `event_at`
- `team_name`
- `operator_name`
- `trace_operator_name`
- `raw_value`
- `updated_at`

### 2.2 班组对应表

来源文件：

- `I:\autoweb\unified-automation\backend\dingdan\team-files\班组质检对应表.xlsx`

实测首张表 `Sheet1` 共有 63 行，字段如下：

- `人`
- `钢构生产开始`
- `装焊报检`
- `装焊探伤`
- `装焊质检`
- `涂装`
- `车间`
- `装焊车间`
- `车间主任`

实测特征：

- `装焊报检` 唯一值约 57 个，是 V1 查询的核心班组字段。
- `装焊车间` 唯一值约 6 个，可用于“装焊二车间今日产量”这类范围查询。
- `车间主任` 唯一值约 6 个，可用于“葛十军下面还有哪些未完成任务”。
- `车间` 列当前样例值多为人名，例如 `姚德余`、`葛十军`，不像标准车间名。

因此 V1 建议：

- `装焊报检` 作为标准班组名。
- `装焊车间` 作为标准装焊车间名。
- `车间主任` 作为标准主任名。
- `车间` 先按原始字段保存为 `workshop_owner_name_raw`，不直接当作“车间名称”使用。

### 2.3 查询判定规则

- 用户文本中带 `班组`，优先按单个 `装焊报检` 班组查询。
- 用户文本中只有人名，且命中 `车间主任`，默认查询该主任名下所有 `装焊报检` 班组。
- 用户文本中只有人名，若未命中 `车间主任`，但能唯一映射到一个 `装焊报检` 班组，则按单班组查询。
- 例如：
- `葛十军班组` -> 只查 `装焊报检 = 葛十军班组`
- `葛十军` -> 查 `车间主任 = 葛十军` 名下所有装焊报检班组
- `韩祥玉` -> 因仅能唯一映射到 `韩祥玉班组`，所以按单班组查询

## 3. 方案总览

```text
QQ/NapCat 消息
-> src/query/index.js
-> 拆句 / 规则解析 / 组织范围归一化
-> 命中一个或多个查询意图
-> SQL 模板执行
-> 格式化中文结果
-> QQ 机器人回复
```

匹配顺序：

1. 固定命令：`日报`、`收发存`、`帮助`
2. 规则查询：关键词 + 日期解析 + 班组映射
3. 可选增强解析：GPT 或本地模型
4. 若仍无法识别，则返回可引导的提示语

## 4. 文件设计

### 4.1 新增模块目录

建议新增目录：

```text
src/query/
  index.js
  router.js
  splitters.js
  parser-rules.js
  parser-llm.js
  date-range.js
  team-directory-loader.js
  team-directory-normalize.js
  scope-resolver.js
  sql-runner.js
  result-formatter.js
  intents/
    org-lookup.js
    team-unfinished-tasks.js
    team-daily-fitup-output.js
    director-unfinished-tasks.js
    director-daily-fitup-output.js
    plan-unshipped-components.js
```

### 4.2 各文件职责

`src/query/index.js`

- 查询总入口。
- 暴露 `handleNaturalLanguageQuery()`。
- 给 QQ 机器人调用，不直接耦合 OneBot。

`src/query/router.js`

- 根据解析结果分派到具体意图处理器。
- 负责多子查询串联执行。

`src/query/splitters.js`

- 把一条消息拆成多个子问题。
- 优先按 `以及`、`并且`、`顺便`、`，` 分段。

`src/query/parser-rules.js`

- 规则解析器。
- 从文本中提取：
  - 查询意图
  - 班组/主任/装焊车间/计划/项目
  - 日期范围
  - 指标类型

`src/query/parser-llm.js`

- 可选增强解析器。
- 仅在 `rule-only` 未命中且配置允许时启用。
- 输出仍然必须是受控 JSON，而不是 SQL。

`src/query/date-range.js`

- 统一处理 `今天`、`昨日`、`本周`、`本月`、`截至今天`。
- 输出标准日期范围对象。

`src/query/team-directory-loader.js`

- 读取 `班组质检对应表.xlsx`。
- 清洗空格、统一字段名。
- 生成内存字典和缓存文件。

`src/query/team-directory-normalize.js`

- 组织词归一化。
- 例如把 `葛十军班组`、`葛十军`、`装焊二车间（葛十军）` 归并到同一组织范围。

`src/query/scope-resolver.js`

- 将一个查询目标解析成实际 SQL 查询范围。
- 支持：
  - 单班组
  - 某主任下面全部班组
  - 某装焊车间下面全部班组

`src/query/sql-runner.js`

- 唯一允许执行 SQL 的模块。
- 只接受白名单意图和结构化参数。

`src/query/result-formatter.js`

- 将数据库结果转成 QQ 回复文本。
- 控制长度和口径说明。

`src/query/intents/*.js`

- 每个文件对应一个查询意图。
- 对外暴露：
  - `intent`
  - `matchHints`
  - `validate(input)`
  - `buildQuery(input)`
  - `format(rows, context)`

### 4.3 配置与数据文件

建议新增：

```text
config/query-service.example.json
src/data/team-directory-cache.json
```

`config/query-service.example.json`

- 查询模式配置。
- 班组对应表来源路径。
- 是否启用 LLM 增强。

`src/data/team-directory-cache.json`

- 由 Excel 导出的本地缓存。
- 避免每次 QQ 查询都读 Excel。

### 4.4 QQ 机器人接入点

改造文件：

- `src/qq-bot-napcat.js`

接法：

- 现有固定命令继续保留。
- `default` 分支不再直接回复“未知指令”。
- 优先调用 `handleNaturalLanguageQuery({ text, senderId, source: 'qq-private' })`。

## 5. 数据模型建议

V1 可先不加新表，直接：

- 从 Excel 读入内存缓存
- 从缓存计算查询范围
- 最终仍查现有 PostgreSQL 业务表

若要增强稳定性，建议 V1.1 增加两张维表：

### 5.1 `team_directory_member`

建议字段：

- `member_name`
- `steel_start_team_name`
- `fitup_team_name`
- `ndi_team_name`
- `qc_team_name`
- `paint_team_name`
- `workshop_owner_name_raw`
- `fitup_workshop_name`
- `workshop_director_name`
- `source_file`
- `source_sheet`
- `source_row_no`
- `is_active`
- `updated_at`

### 5.2 `team_alias`

建议字段：

- `alias_name`
- `alias_type`
- `canonical_type`
- `canonical_name`
- `confidence`
- `source`
- `updated_at`

用途：

- 存 Excel 中的标准名
- 存数据库里观察到的变体名
- 存人工确认过的别名

## 6. 模块接口定义

### 6.1 内部模块接口

#### `handleNaturalLanguageQuery(input)`

```json
{
  "text": "查一下葛十军班组还有哪些未完成任务，以及今日装焊完成的产量",
  "senderId": 123456789,
  "source": "qq-private",
  "now": "2026-04-02T10:00:00+08:00"
}
```

返回：

```json
{
  "ok": true,
  "mode": "rule-only",
  "subQueries": [
    {
      "intent": "team_unfinished_tasks",
      "scope": {
        "targetType": "team",
        "canonicalName": "葛十军班组",
        "fitupTeams": ["葛十军班组"]
      }
    },
    {
      "intent": "team_daily_fitup_output",
      "scope": {
        "targetType": "team",
        "canonicalName": "葛十军班组",
        "fitupTeams": ["葛十军班组"]
      },
      "dateRange": {
        "kind": "today",
        "start": "2026-04-02 00:00:00+08",
        "end": "2026-04-02 23:59:59+08"
      }
    }
  ],
  "replyText": "葛十军班组当前没有未完成装焊任务；今日装焊完成 0.000 吨。"
}
```

#### `loadTeamDirectory()`

输入：

```json
{
  "excelPath": "I:\\autoweb\\unified-automation\\backend\\dingdan\\team-files\\班组质检对应表.xlsx",
  "sheetName": "Sheet1",
  "useCache": true
}
```

输出：

```json
{
  "version": "2026-04-02T13:15:00+08:00",
  "members": [
    {
      "memberName": "葛十军",
      "fitupTeamName": "葛十军班组",
      "fitupWorkshopName": "装焊二车间",
      "workshopDirectorName": "葛十军"
    }
  ]
}
```

#### `resolveScope(targetText)`

输入：

```json
{
  "targetText": "葛十军班组"
}
```

输出：

```json
{
  "targetType": "team",
  "canonicalName": "葛十军班组",
  "matchedBy": "team-directory",
  "fitupTeams": [
    "葛十军班组"
  ],
  "fitupWorkshopNames": [
    "装焊二车间"
  ],
  "directorNames": [
    "葛十军"
  ]
}
```

说明：

- 当用户说“葛十军班组”时，系统按单个装焊报检班组查询。
- 当用户只说“葛十军”时，若命中 `车间主任`，系统默认扩成主任辖下班组范围。
- 当用户只说“韩祥玉”这类无歧义班组长姓名时，系统按唯一班组查询。

### 6.2 可选 HTTP 接口定义

如后续需要从多个入口复用，可加一个轻量 HTTP 层。

#### `POST /internal/query/ask`

请求：

```json
{
  "text": "查葛十军班组今日装焊产量",
  "source": "qq-private",
  "senderId": 123456789
}
```

响应：

```json
{
  "ok": true,
  "replyText": "葛十军对应装焊二车间，今日装焊完成 0.000 吨，0 件。",
  "subQueries": [
    {
      "intent": "director_daily_fitup_output"
    }
  ]
}
```

#### `POST /internal/query/parse`

用途：

- 调试解析器。
- 不执行数据库查询。

#### `POST /internal/query/team-directory/reload`

用途：

- 手动重载班组对应表。
- Excel 被替换后无需重启机器人。

#### `GET /internal/query/intents`

用途：

- 返回当前支持的查询意图清单。

## 7. 首批 6 个查询意图

### 7.1 `org_lookup`

用途：

- 回答“某人/某班组/某主任对应什么组织范围”。

示例问法：

- `葛十军对应哪个装焊车间`
- `葛十军下面有哪些班组`
- `郑斌班组属于哪个主任`

参数：

- `targetText`

输出重点：

- 标准班组
- 装焊车间
- 车间主任
- 同范围下的其他班组

### 7.2 `team_unfinished_tasks`

用途：

- 查询单班组的未完成装焊任务。

示例问法：

- `葛十军班组还有哪些未完成任务`
- `郑斌班组未完成装焊有哪些`

参数：

- `targetText`
- `statusType`，V1 固定为 `fitup_weld_report`

口径：

- 取该范围内最新一条 `fitup_weld_report` 事件
- 其中 `is_completed = false` 的构件视为未完成

返回字段：

- 构件编号
- 所属项目
- 所属计划
- 构件规格
- 重量
- 最近状态时间

### 7.3 `team_daily_fitup_output`

用途：

- 查询单班组今日装焊完成产量。

示例问法：

- `葛十军班组今日装焊完成多少`
- `郑斌班组今天做了多少吨`

参数：

- `targetText`
- `dateRange`

口径：

- `status_type = 'fitup_weld_report'`
- `is_completed = true`
- 时间按 `event_at` 落在指定日期范围
- 指标输出：
  - `sum(weight * quantity)` 作为重量
  - `sum(quantity)` 作为件数

### 7.4 `director_unfinished_tasks`

用途：

- 查询某车间主任辖下全部班组的未完成装焊任务。

示例问法：

- `葛十军下面还有哪些未完成任务`
- `装焊二车间还有哪些没做完`

参数：

- `targetText`

组织解析：

- 若命中 `车间主任`，扩成该主任名下全部 `装焊报检` 班组
- 若命中 `装焊车间`，扩成该车间名下全部 `装焊报检` 班组

输出重点：

- 总未完成数
- 按班组分组的未完成数
- 前 10 个构件明细

### 7.5 `director_daily_fitup_output`

用途：

- 查询某主任或某装焊车间今日装焊完成产量。

示例问法：

- `葛十军今日装焊完成产量`
- `装焊二车间今天做了多少吨`

参数：

- `targetText`
- `dateRange`

输出重点：

- 总重量
- 总件数
- 按班组分组的重量/件数

### 7.6 `plan_unshipped_components`

用途：

- 回答计划维度的待发货问题。

示例问法：

- `某某计划还有哪些没发货`
- `三厂箱型线那个计划还有哪些构件未发货`

参数：

- `planName` 或 `planId`

口径：

- 查该计划下构件最新 `shipping` 状态
- `is_completed = false` 或无发货完成事件视为未发货

输出重点：

- 未发货构件数
- 总重量
- 前 20 个构件明细

## 8. 规则解析建议

### 8.1 目标词识别优先级

1. 命中 Excel `车间主任`
2. 命中 Excel `装焊车间`
3. 命中 Excel `装焊报检`
4. 命中 Excel `人`
5. 命中数据库中 `team_name`

### 8.2 日期词解析

支持：

- `今天`
- `昨日`
- `前天`
- `本周`
- `本月`
- `2026-04-02`

### 8.3 拆句规则

以下词优先拆为多个子查询：

- `以及`
- `并且`
- `顺便`
- `，`

示例：

`查一下葛十军班组，还有哪些未完成的任务，以及今日装焊完成的产量`

拆成：

1. `team_unfinished_tasks(target=葛十军班组)`
2. `team_daily_fitup_output(target=葛十军班组, date=today)`

## 9. V1 回复模板

### 9.1 单查询

示例：

`葛十军对应装焊二车间，名下共 8 个装焊班组。当前未完成装焊任务 11 项，主要集中在装焊二车间（葛十军）。`

### 9.2 多查询

示例：

`葛十军对应装焊二车间。当前未完成装焊任务 11 项；今日装焊完成 0.000 吨、0 件。`

### 9.3 无数据

示例：

`已按“葛十军”对应的班组范围查询，今天没有找到装焊完成记录。最近一次装焊完成记录时间为 2025-11-05。`

## 10. V1 开发顺序

1. `team-directory-loader.js`
2. `team-directory-normalize.js`
3. `date-range.js`
4. `team_unfinished_tasks`
5. `team_daily_fitup_output`
6. `director_unfinished_tasks`
7. `director_daily_fitup_output`
8. `plan_unshipped_components`
9. 接入 `src/qq-bot-napcat.js`

## 11. 风险与注意事项

- `车间` 列当前数据像人名，不要误当标准车间名直接展示。
- 数据库中的真实 `team_name` 可能与 Excel 标准班组名不完全一致，需要别名表或模糊匹配。
- 现有 `component_status_event` 中部分未完成记录 `event_at` 为空，未完成统计要使用“最新事件”口径，不能直接按事件条数累加。
- 第一版必须坚持“结构化意图 -> SQL 模板”，不要让模型直接自由写 SQL。


## 12. 反馈表模板

查询班组或车间主任装焊情况时，后续可按项目根目录模板文件导出反馈表：

- `I:\\autoweb\\autoribao\\车间构件情况反馈表.xlsx`

模板共 5 个工作表：

- `车间任务情况`
- `班组任务情况`
- `每日班组完成汇总`
- `每日班组完成详情`
- `未完构件详情`

当前已新增导出模块：

- `src/query/feedback-exporter.js`

该模块负责：

- 读取反馈表模板
- 清空表头以下旧数据
- 将查询结果按 5 个 sheet 分别写入
- 输出到 `downloads/query-feedback/` 目录

建议后续对接方式：

- 班组查询：填 `班组任务情况`、`每日班组完成汇总`、`每日班组完成详情`、`未完构件详情`
- 主任或车间查询：额外填 `车间任务情况`
