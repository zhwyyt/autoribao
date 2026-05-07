# 数据库说明（PostgreSQL）

## 基本信息
- **数据库名**：`dwyunsc`
- **schema**：`public`（默认）
- **用途**：存储项目、生产计划、构件基础信息与构件生产状态流水；并支持脚本定时同步项目列表到数据库。

## 表关系总览
- `project`（项目）
  - 1:N → `production_plan`（生产计划）
- `production_plan`（生产计划）
  - 1:N → `component`（构件）
- `component`（构件）
  - 1:N → `component_status_event`（构件状态流水）

## 枚举（ENUM）

### `project_status`（项目状态）
- `building`：钢构在建
- `closed`：已完结
- `pipeline`：流水线项目

### `plan_status`（计划状态）
- `producing`：生产中
- `completed`：已完成

### `component_status_type`（构件状态类型）
- `steel_production_start`：钢构生产开始
- `fitup_weld_report`：装焊报检
- `fitup_weld_ndi`：装焊探伤
- `fitup_weld_qc`：装焊质检
- `pipeline_report_work`：流水线报工
- `painting`：涂装
- `shipping`：发货

## 表结构与字段说明

### `project`（项目）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `project_id` | `bigserial` | 是 | 项目ID（主键）。同步脚本会直接写入此值。 |
| `project_name` | `text` | 是 | 项目名称 |
| `project_status` | `project_status` | 是 | 项目状态（`building/closed/pipeline`） |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 更新时间（同步脚本会在变更时更新） |

**约束/索引**
- 主键：`project_id`

### `project_name_history`（项目名称变更历史）
用于记录项目名称的**每一次变更**，便于审计与排查“项目改名后是否仍是同一项目”。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `history_id` | `bigserial` | 是 | 主键 |
| `project_id` | `bigint` | 是 | 所属项目（外键 → `project.project_id`） |
| `old_name` | `text` | 是 | 变更前名称 |
| `new_name` | `text` | 是 | 变更后名称 |
| `changed_at` | `timestamptz` | 是 | 变更时间（默认 `now()`） |
| `source` | `text` | 否 | 变更来源（例如 `extract-project-list`） |

**约束/索引**
- 外键：`project_id` → `project(project_id)`（`ON DELETE CASCADE`）
- 索引：`idx_project_name_history_project_time(project_id, changed_at desc)`、`idx_project_name_history_changed_at(changed_at desc)`

### `production_plan`（生产计划）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_id` | `bigserial` | 是 | 计划ID（主键） |
| `project_id` | `bigint` | 是 | 所属项目（外键 → `project.project_id`） |
| `plan_name` | `text` | 是 | 生产计划名称 |
| `start_at` | `timestamptz` | 否 | 计划开始时间 |
| `end_at` | `timestamptz` | 否 | 计划结束时间 |
| `updated_at` | `timestamptz` | 是 | 更新时间（页面抽取） |
| `component_count` | `integer` | 是 | 构件数量（默认 `0`） |
| `plan_status` | `plan_status` | 是 | 计划状态（`producing/completed`） |
| `created_at` | `timestamptz` | 是 | 创建时间 |

**约束/索引**
- 外键：`project_id` → `project(project_id)`（`ON DELETE RESTRICT`）
- 索引：`idx_production_plan_project_id`、`idx_production_plan_project_time(project_id, start_at)`

### `component`（构件基础信息）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `component_id` | `bigserial` | 是 | 构件内部主键 |
| `plan_id` | `bigint` | 是 | 所属计划（外键 → `production_plan.plan_id`） |
| `component_no` | `text` | 否 | 构件编号（**不唯一**） |
| `component_guid` | `text` | 是 | 构件GUID（**同一计划内唯一**） |
| `model_id` | `text` | 否 | 模型ID |
| `spec` | `text` | 否 | 规格/型号 |
| `quantity` | `integer` | 是 | 数量（约束：`> 0`） |
| `weight` | `numeric(12,3)` | 否 | 重量 |
| `length` | `numeric(12,3)` | 否 | 长度 |
| `production_feature` | `text` | 否 | 生产特征 |
| `location` | `text` | 否 | 区域部位/所在楼层 |
| `current_status` | `component_status_type` | 否 | 当前状态快照（可选字段，便于快速过滤） |
| `current_status_at` | `timestamptz` | 否 | 当前状态时间（可选） |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 更新时间 |

**约束/索引**
- 外键：`plan_id` → `production_plan(plan_id)`（`ON DELETE RESTRICT`）
- 唯一约束：`UNIQUE(plan_id, component_guid)`
- 索引：`idx_component_plan_id`、`idx_component_guid`、`idx_component_current_status`

### `component_status_event`（构件状态流水）
用于记录构件各状态的**多次发生**（允许重复），并仅关注是否完成与发生时间。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `event_id` | `bigserial` | 是 | 主键 |
| `component_id` | `bigint` | 是 | 所属构件（外键 → `component.component_id`） |
| `status_type` | `component_status_type` | 是 | 状态类型 |
| `is_completed` | `boolean` | 是 | 是否完成（默认 `true`） |
| `event_at` | `timestamptz` | 是 | 发生时间（默认 `now()`） |
| `created_at` | `timestamptz` | 是 | 入库时间（默认 `now()`） |

**约束/索引**
- 外键：`component_id` → `component(component_id)`（`ON DELETE CASCADE`）
- 索引：`idx_component_status_event_component_time(component_id, event_at desc)`、`idx_component_status_event_type_time(status_type, event_at desc)`

## 常用查询示例

### 1) 查询某个项目状态
- 按项目ID：

```sql
SELECT project_id, project_name, project_status, updated_at
FROM project
WHERE project_id = 123;
```

- 按项目名称关键字（不区分大小写）：

```sql
SELECT project_id, project_name, project_status, updated_at
FROM project
WHERE project_name ILIKE '%江苏宝鑫%';
```

### 2) 查看某项目下的所有计划

```sql
SELECT p.project_id, p.project_name, pl.plan_id, pl.plan_name, pl.plan_status, pl.start_at, pl.end_at
FROM project p
JOIN production_plan pl ON pl.project_id = p.project_id
WHERE p.project_id = 123
ORDER BY pl.plan_id DESC;
```

### 3) 查看某计划下构件数量

```sql
SELECT plan_id, count(*) AS component_count, sum(quantity) AS total_quantity
FROM component
WHERE plan_id = 456
GROUP BY plan_id;
```

### 4) 查询某构件的状态流水（最新在前）

```sql
SELECT e.status_type, e.is_completed, e.event_at
FROM component_status_event e
WHERE e.component_id = 789
ORDER BY e.event_at DESC, e.event_id DESC;
```

### 5) 查询某项目的改名历史（最新在前）

```sql
SELECT h.project_id, h.old_name, h.new_name, h.changed_at, h.source
FROM project_name_history h
WHERE h.project_id = 123
ORDER BY h.changed_at DESC, h.history_id DESC;
```

## `extract-project-list.js` 同步规则

### 写入表
- 写入 `project` 表

### API 模式（推荐）
- **开启方式**：运行时增加 `--api`
- **数据来源**：后端接口（固定）
  - `POST https://dwyunsc.ddwjzkj.com:10086/v1.project/getList`
  - Header：`Token: <JWT>`（脚本会在网页登录后从真实请求头/Storage 获取）
  - Request Payload（示例）：`{ code: "", keyword: "", page: 1, size: 10 }`
  - Response：`data.list / data.count / data.size / data.page`
- **状态映射字段**：API 返回的 `head_person_name` 字段与页面“项目负责人”语义一致（包含“钢构在建/流水线/完结库存0”等关键字），用于映射到 `project_status`。
- **严格正确性**：
  - 若接口返回 `data.count` 与实际聚合得到的 `list.length` 不一致：脚本直接报错并终止（不写库）

**命令示例**

```bash
node src/extract-project-list.js --api
```

### 字段映射
- 页面“项目列表”表格中：
  - **项目ID** → `project.project_id`
  - **项目名称** → `project.project_name`
  - **项目负责人** → `project.project_status`（按关键字映射）

### 状态映射逻辑
项目负责人字段文本：
- 包含 **“钢构在建”** → `building`（钢构在建）
- 包含 **“流水线”** → `pipeline`（流水线项目）
- 包含 **“完结库存0”** 或 **“已完结”** → `closed`（已完结）
- 其他/空值 → 不写入数据库（跳过）

### 过滤规则
- 项目负责人字段文本包含 **`PC`** 的行：**不写入数据库**（直接跳过）

### “有变化才更新”
同步使用 UPSERT：
- 若 `project_id` 不存在 → 插入
- 若已存在且 **`project_name` 或 `project_status` 变化** → 更新并刷新 `updated_at`
- 若无变化 → 不更新（统计为“无变化”）

### 项目改名历史（自动记录）
- 数据库通过触发器在 `project.project_name` 发生变化时，自动写入 `project_name_history`
- 同步脚本会设置会话变量 `app.sync_source = 'extract-project-list'`，因此历史记录的 `source` 字段会标记为 `extract-project-list`

## `extract-production-plan.js` 同步规则

### 两种模式
- **全量模式**（默认）：抓取所有页、导出 Excel、全量 UPSERT；缺失的 `plan_id` 全表删除
- **按项目增量模式**（`--by-project`）：仅同步活跃项目（`project_status IN ('building','pipeline')`）；按项目选择下拉 → 点击查询 → 分页抓取；缺失的 `plan_id` 仅在该 `project_id` 范围内删除

### API 模式（推荐，权威数据源）
- **开启方式**：在按项目增量模式下增加 `--api`
- **数据来源**：后端接口（固定）
  - `POST https://dwyunsc.ddwjzkj.com:10086/v1.production/getPlans`
  - Header：`Token: <JWT>`（脚本会在网页登录后从真实请求头/Storage 获取）
  - Response：`data.list / data.count / data.size / data.page`
- **优势**：不依赖 DOM 渲染/分页组件，避免“页面未渲染完全导致抓取条数不足”。
- **严格正确性**：
  - 若接口返回 `data.count` 与实际聚合得到的 `list.length` 不一致：脚本直接报错并终止（不写库）
  - 入库前仍执行一致性校验：`expectedTotalItems(count)` 与按 `plan_id` 去重后的数量不一致时，禁止任何数据库写入（新增/更新/删除都不执行）

**命令示例**
- 跑全部活跃项目（API 模式）：

```bash
node src/extract-production-plan.js --api --by-project
```

- 仅跑指定项目（API 模式）：

```bash
node src/extract-production-plan.js --api --by-project --project-name "H钢智能线报工"
```

### 按项目增量模式
- **项目来源**：`project` 表中 `project_status IN ('building','pipeline')`
- **入库规则**：以 `plan_id` 为唯一键 UPSERT；仅当 `(updated_at, component_count)` 变化时更新
- **删除规则**：`DELETE FROM production_plan WHERE project_id = ? AND plan_id NOT IN (本次抓到的 plan_ids)`
- **命令**：`npm run extract-production-plan-by-project` 或 `node src/extract-production-plan.js --by-project`

## 定时任务（Windows 任务计划）
- **任务名**：`DongwuProjectListSync`
- **时间**：每天 `16:30`
- **入口**：`run_project_list.cmd`
- **日志**：`logs/project_list_sync.log`

- **任务名**：`DongwuProductionPlanComponentsSync`
- **时间**：每天 `08:00`–`18:00` 整点各一次（每小时）
- **入口**：`run_production_plan_components_changed.cmd`（`--api --by-project --components-changed-only`）
- **日志**：`logs/production_plan_components_sync.log`
- **注册脚本**：以管理员运行 `create_production_plan_components_task.ps1`

