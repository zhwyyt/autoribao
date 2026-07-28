# dwyunsc API 接口参考

本文档整理 autoribao 与 unified-automation 项目中已经实际使用或抓包确认过的 dwyunsc 平台接口，方便后续同步、查询、打包管理和自动化流程开发。

> 说明：本文不是平台官方全量接口文档。接口来自现有代码、抓包文档和自动化脚本，使用前仍建议结合当前页面抓包验证请求参数和返回字段。

## 基础信息

| 类型 | 地址 |
| --- | --- |
| Web 页面 | `https://dwyunsc.ddwjzkj.com:22222` |
| API 地址 | `https://dwyunsc.ddwjzkj.com:10086` |

多数业务接口使用 `POST`，请求头需要携带：

```http
Token: <登录后获取的 token>
Content-Type: application/json;charset=utf-8
```

文件上传接口使用 `multipart/form-data`，下载接口可能返回二进制文件流或下载地址。

## 认证与通用

| 接口 | 用途 | 当前使用位置 |
| --- | --- | --- |
| `POST /v1.user/login` | API 登录，返回 Token | unified-automation `api-client.js` |
| `POST /v1.user/getInfo` | 获取当前用户信息 | 打包/发运抓包 |
| `POST /v1.user/getBranchs` | 获取组织/分支信息 | 打包/发运抓包 |
| `POST /file/upload` | 上传 Excel 或同步文件 | unified-automation 建单、排产、下发流程 |

### `POST /v1.user/login`

常用请求体：

```json
{
  "account": "用户名",
  "password": "密码"
}
```

返回中的 Token 可能在 `data.token`、`token` 或 `data` 字段里，现有代码做了兼容。

## 项目接口

| 接口 | 用途 | 主要参数 |
| --- | --- | --- |
| `POST /v1.project/getList` | 项目列表，autoribao 定时同步项目 | `keyword`, `page`, `size` |
| `POST /v1.project/getProjectSelect` | 项目下拉，按项目名解析 `project_id` | 空对象 `{}` |
| `POST /v1.project/getProjectArtifacts` | 项目下订单构件，建立订单构件与排产构件桥接 | `proj_id`, `order_id`, `keyword`, `production`, `type` |

### `POST /v1.project/getList`

autoribao 用于同步 `project` 表。常用请求体：

```json
{
  "code": "",
  "keyword": "",
  "page": 1,
  "size": 200
}
```

常用返回字段：

- `data.list[]`
- `data.count`
- `data.page`
- `data.size`
- 项目字段通常包括 `id`, `name/project_name`, `code`, `head_person_name`, `is_delete`

### `POST /v1.project/getProjectArtifacts`

用于项目构件弹窗和订单-排产构件桥接。现有脚本建议按订单逐个请求，避免 `order_id=0` 全量时超时。

```json
{
  "proj_id": "云项目ID",
  "order_id": 12345,
  "keyword": "",
  "production": 0,
  "type": 2
}
```

常见返回字段：

- `id`：订单构件云端 ID
- `order_id`
- `scheduling_id`
- `scheduling_name`
- `order_name`
- `guid`

## 订单接口

| 接口 | 用途 | 主要参数 |
| --- | --- | --- |
| `POST /v1.order/getList` | 订单列表，同步订单或查重 | `proj_id`, `keyword`, `code`, `page`, `size` |
| `POST /v1.order/getAllOrder` | 某项目下订单列表 | `project_id` |
| `POST /v1.order/add` | 创建订单 | 订单名称、编号、项目、日期等 |
| `POST /v1.order/getInfo` | 订单详情 | `id` |
| `POST /v1.order/getOrderArtifacts` | 订单构件列表 | `id` |
| `POST /v1.order/submitArtifacts` | 将上传文件提交为订单构件 | `order_id`, `file_id` |
| `POST /v1.order/getUnArtifacts` | 获取订单中未挂到排产的构件 | `order_id` |
| `POST /v1.order/getDeliveryHistory` | 发货历史，autoribao 发货对齐 | 日期/筛选条件，来自页面抓包 |
| `POST /v1.order/downCodes` | 下载订单构件编码包 | `id` 或构件相关参数，来自抓包 |

### `POST /v1.order/getList`

autoribao 用于同步 `sales_order`，unified-automation 用于创建前查重。

```json
{
  "proj_id": 0,
  "keyword": "",
  "code": "",
  "page": 1,
  "size": 50
}
```

常见返回字段会映射到 autoribao 的 `sales_order`：

- `id` -> `order_id`
- `project_name`
- `name` -> `order_name`
- `code` -> `order_code`
- `order_status`
- `order_status_name`
- `artifacts_count`
- `project_id` -> `cloud_project_id`
- `start_time`
- `end_time`
- `create_time`
- `update_time`

### `POST /v1.order/add`

unified-automation 用于创建订单。常用请求体：

```json
{
  "category": 2,
  "code": "任务单号",
  "name": "订单名称",
  "project_id": 123,
  "start_time": 1770000000,
  "end_time": 1770000000,
  "real_start_time": "",
  "real_end_time": "",
  "originator": "",
  "recipient": "",
  "recipient_address": "",
  "recipient_tel": "",
  "source": ""
}
```

### `POST /v1.order/getOrderArtifacts`

```json
{
  "id": 12345
}
```

autoribao 将返回构件写入 `order_component`，并尝试通过 `component_guid`、`scheduling_id`、`plan_id` 关联生产计划构件。

## 排产与生产计划接口

| 接口 | 用途 | 主要参数 |
| --- | --- | --- |
| `POST /v1.production/getSchedulings` | 排产列表/查重 | `department`, `proj_id`, `keyword`, `is_produce`, `start_time`, `end_time`, `code`, `page`, `size` |
| `POST /v1.production/addScheduling` | 创建排产 | 项目、名称、编号、日期、类型等 |
| `POST /v1.production/getScheduling` | 排产详情 | `id` |
| `POST /v1.production/getProductionArtifacts` | 排产构件 | `id` |
| `POST /v1.production/submitSchedulingArtifacts` | 将订单构件挂到排产 | `scheduling_id`, `order_id`, `artifacts_ids` |
| `POST /v1.production/setDesign` | 指定工艺流程 | `id`, `design_id` |
| `POST /v1.production/exportProduction` | 导出排产文件 | `id` |
| `POST /v1.production/syncProduction` | 同步排产文件 | `scheduling_id`, `file_id` |
| `POST /v1.production/sendProduce` | 下发生产 | `id` |
| `POST /v1.production/getPlans` | 生产计划列表，autoribao 同步计划 | `proj_id`, `page`, `size`, 筛选条件 |
| `POST /v1.production/getPlan` | 生产计划详情 | `id` |
| `POST /v1.production/getPlanArtifacts` | 计划构件详情，autoribao 同步构件 | `id` |
| `POST /v1.production/updateProcess` | 过程更新 | `id`, `ids`, `status` |
| `POST /v1.production/getPlanArtifactsCodes` | 下载计划构件编码包 | `id`, `ids` |
| `POST /v2.production/parserExcelData` | 解析上传的生产 Excel | `file_id` |
| `POST /v2.production/downTaskOrder` | 下载生产任务单 | `id` |

### `POST /v1.production/getPlans`

autoribao 用于同步 `production_plan`，也用于 `scheduling_id -> plan_id` 映射。

```json
{
  "code": "",
  "create_user": 0,
  "department": 0,
  "end_time": 0,
  "keyword": "",
  "production_status": -1,
  "proj_id": 123,
  "start_time": 0,
  "page": 1,
  "size": 200
}
```

常见返回字段：

- `id` -> `plan_id`
- `name` -> `plan_name`
- `project_name`
- `scheduling_id`
- `code`
- `plan_start_time`
- `plan_end_time`
- `update_time`
- `artifacts_count`
- `production_status_name`

### `POST /v1.production/getPlanArtifacts`

autoribao 用于同步 `component` 和 `component_status_event`。

```json
{
  "id": 6891
}
```

常见构件字段：

- `id`：计划构件/生产构件 ID
- `guid`
- `name` / `artifact_name`
- `spec`
- `length`
- `weight`
- `quantity`
- `model_id`
- `location`
- `production_feature`
- 工序状态字段，如 `is_report`, `is_ndi`, `is_qc`, `is_paint`, `is_deliver`

### `POST /v1.production/submitSchedulingArtifacts`

```json
{
  "scheduling_id": 123,
  "order_id": 456,
  "artifacts_ids": "1,2,3"
}
```

用于把订单构件挂到排产。

### `POST /v1.production/updateProcess`

```json
{
  "id": 789,
  "ids": "1,2,3",
  "status": 1
}
```

用于推进生产计划构件的过程状态。

## 统计与发货

| 接口 | 用途 |
| --- | --- |
| `POST /v1.statistical/getStatisticalDays` | 工序/日报统计，日报生成和工序对账使用 |
| `POST /v1.order/getDeliveryHistory` | 发货历史，发货对齐使用 |

这两类接口目前多通过页面抓包复用请求体，建议后续改动时先在页面触发一次请求，确认 payload 字段。

## 打包与发运管理接口

这些接口在 unified-automation 的打包/发运抓包文档和测试中出现，autoribao 当前还没有对应入库表。

| 接口 | 用途 | 备注 |
| --- | --- | --- |
| `POST /v1.order/getPackageList` | 打包列表 | 打包管理入口 |
| `POST /v1.order/getPackageInfo` | 打包详情 | 按包件 ID 查询 |
| `POST /v1.order/getPackageArtifacts` | 包内构件列表 | 后续同步包内构件优先用 |
| `POST /v1.order/searchPackageArtifacts` | 搜索可加入包件的构件 | 添加包内构件前使用 |
| `POST /v1.order/addPackageArtifacts` | 添加构件到包件 | 已抓包确认 |
| `POST /v1.order/removePackageArtifacts` | 从包件移除构件 | 已抓包确认 |
| `POST /v1.order/downPackageCodes` | 下载包件编码 | 返回二进制或文件流 |
| `POST /v1.order/getDeliverys` | 发运/配送列表 | 抓包中使用的路径 |

### 打包构件添加流程

已抓包确认的大致流程：

1. `POST /v1.order/getPackageInfo` 获取包件详情。
2. `POST /v1.order/getPackageArtifacts` 获取已打包构件。
3. `POST /v1.order/getAllOrder` 获取项目下订单下拉。
4. `POST /v1.order/searchPackageArtifacts` 搜索可添加构件。
5. `POST /v1.order/addPackageArtifacts` 添加构件。

注意：此前推测的 `/v1.order/savePackageArtifact` 不存在，正确路径是 `/v1.order/addPackageArtifacts`。

## autoribao 当前同步边界

autoribao 当前已经入库的数据：

- 项目：`project`
- 生产计划：`production_plan`
- 生产计划构件：`component`
- 构件状态流水：`component_status_event`
- 订单：`sales_order`
- 订单构件与计划构件桥接：`order_component`

autoribao 当前未单独入库的数据：

- 打包列表
- 包件详情
- 包内构件
- 发运单/配送单明细
- unified-automation 的本地任务、文件级状态、失败重试记录

## 后续建议

如果要把打包管理纳入 autoribao，建议新增独立表，避免混入现有订单/生产计划主数据：

- `package`
- `package_artifact`
- `delivery`
- `delivery_artifact`
- `api_sync_run`

关键关联字段建议保留：

- `package_id`
- `order_id`
- `dwyun_artifact_id`
- `component_guid`
- `component_id`
- `plan_id`
- `scheduling_id`
- `synced_at`
- `raw_json`

这样可以把平台事实数据、包件关系和后续发运状态分开维护，查询和回溯都会清楚很多。
