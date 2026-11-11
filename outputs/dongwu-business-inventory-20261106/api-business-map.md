# API 与业务功能映射

日期：2026-11-06。主清单按**规范化路径**计数，查询参数、重复调用不增加 API 数量；未证明同路径多方法，所以不冒充 method+path 全量统计。

**已验证（资料盘点）**：扫描到 113 个路径字符串，保留 92 个资料可追溯路径，排除 20 个纯探测候选和 1 个文档否定路径。92 是已知资产覆盖，不是原平台 API 总数，也不是 92 个均可用。

证据等级仅针对“这一行写明的能力/样本”，不自动延伸到全部业务规则。原始引用的行号见下表；本次采集使用 JSON Pointer（数组下标从 0 开始）。

| 覆盖类型 | 数量 |
|---|---:|
| 本仓调用代码，未核验成功响应 | 4 |
| 仅文档能力记载/失败探测 | 66 |
| 历史成功响应 | 3 |
| 本次只读响应 | 19 |

## 全量映射

| ID | 业务模块 | 方法与路径 | 有证据支持的用途/边界 | 结论等级与覆盖 | 证据 |
|---|---|---|---|---|---|
| A001 | M10 文件解析与输出 | GET（代码） `/delivery/info` | 发运单 PDF 输出资源；不是第二个发运单实体 | 较高可信推断：本仓调用代码，未核验成功响应 | [src/export-logistics-vehicle-workbook.js](../../src/export-logistics-vehicle-workbook.js) L264 |
| A002 | M10 文件解析与输出 | POST（旧参考记载） `/file/upload` | 上传 Excel 或同步文件 | 待验证：仅文档能力记载/失败探测 | [docs/dwyunsc-api-reference.md](../../docs/dwyunsc-api-reference.md) L30 |
| A003 | M03 订单与构件范围 | POST（旧参考记载） `/v1.order/add` | 创建订单 | 待验证：仅文档能力记载/失败探测 | [docs/dwyunsc-api-reference.md](../../docs/dwyunsc-api-reference.md) L103 |
| A004 | M08 包装与发运 | POST（旧参考记载） `/v1.order/addPackageArtifacts` | 添加构件到包件 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L361 |
| A005 | M08 包装与发运 | 待验证 `/v1.order/createPackage` | 包装/发货章节列出的候选写能力；约束待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L357 |
| A006 | M08 包装与发运 | 待验证 `/v1.order/delPackage` | 包装/发货章节列出的候选写能力；约束待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L364 |
| A007 | M03 订单与构件范围 | 待验证 `/v1.order/downArtifacts` | 订单构件归集章节列出的候选能力；逐接口约束待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L170 |
| A008 | M03 订单与构件范围 | POST（旧参考记载） `/v1.order/downCodes` | 下载订单构件编码包 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L171 |
| A009 | M08 包装与发运 | POST（旧参考记载） `/v1.order/downPackageCodes` | 下载包件编码 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L363 |
| A010 | M03 订单与构件范围 | POST（旧参考记载） `/v1.order/getAllOrder` | 某项目下订单列表 | 已验证：历史成功响应 | [logs/project_goujian_capture_1779324343063.json](../../logs/project_goujian_capture_1779324343063.json) `/capturedApis/3`；[src/extract-project-order-bridge.js](../../src/extract-project-order-bridge.js) L5；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L165 |
| A011 | M08 包装与发运 | POST（历史请求） `/v1.order/getDeliveryHistory` | 发货历史，发货对齐使用 | 较高可信推断：本仓调用代码，未核验成功响应 | [logs/captured_shoufacun_apis_1777278732242.json](../../logs/captured_shoufacun_apis_1777278732242.json) `/1`；[src/main.js](../../src/main.js) L17；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L366 |
| A012 | M08 包装与发运 | POST `/v1.order/getDeliverys` | 发运单分页列表；含单号、项目、日期和车辆字段 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/16`；[src/export-logistics-vehicle-workbook.js](../../src/export-logistics-vehicle-workbook.js) L245；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L365 |
| A013 | M03 订单与构件范围 | POST `/v1.order/getInfo` | 订单详情与动态构件字段定义 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/11`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L164 |
| A014 | M03 订单与构件范围 | POST `/v1.order/getList` | 订单分页列表；含项目、分类、状态和构件数 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/10`；[src/extract-order-sync.js](../../src/extract-order-sync.js) L32；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L163 |
| A015 | M03 订单与构件范围 | POST `/v1.order/getOrderArtifacts` | 订单构件实例列表；含排产、包件和发运引用 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/12`；[src/extract-order-sync.js](../../src/extract-order-sync.js) L33；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L166 |
| A016 | M08 包装与发运 | POST `/v1.order/getPackageArtifacts` | 包内构件视图；数量字段为 count，规格为 specifications | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/15`；[src/export-logistics-vehicle-workbook.js](../../src/export-logistics-vehicle-workbook.js) L276；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L359 |
| A017 | M08 包装与发运 | POST `/v1.order/getPackageInfo` | 包件详情；含 delivery_id 与发货文本 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/14`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L358 |
| A018 | M08 包装与发运 | POST `/v1.order/getPackageList` | 包件分页视图；包件样本 is_package=1 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/13`；[src/export-logistics-vehicle-workbook.js](../../src/export-logistics-vehicle-workbook.js) L250；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L356 |
| A019 | M03 订单与构件范围 | POST（旧参考记载） `/v1.order/getUnArtifacts` | 获取订单中未挂到排产的构件 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L167 |
| A020 | M03 订单与构件范围 | 待验证 `/v1.order/removeArtifacts` | 订单构件归集章节列出的候选能力；逐接口约束待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L169 |
| A021 | M08 包装与发运 | POST（旧参考记载） `/v1.order/removePackageArtifacts` | 从包件移除构件 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L362 |
| A022 | M08 包装与发运 | POST（旧参考记载） `/v1.order/searchPackageArtifacts` | 搜索可加入包件的构件 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L360 |
| A023 | M03 订单与构件范围 | POST（旧参考记载） `/v1.order/submitArtifacts` | 将上传文件提交为订单构件 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L168 |
| A024 | M04 排产与工艺配置 | POST（旧参考记载） `/v1.production/addScheduling` | 创建排产 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L196 |
| A025 | M06 过程执行 | 待验证 `/v1.production/cancelProcess` | 过程状态章节列出的候选撤销能力；前后状态待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L281 |
| A026 | M05 生产计划与任务视图 | 待验证 `/v1.production/delPlan` | 生产计划/任务章节列出的候选视图或操作；实体边界待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L232 |
| A027 | M04 排产与工艺配置 | 待验证 `/v1.production/delScheduling` | 排产、部门、设计章节列出的候选能力；逐接口语义待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L198 |
| A028 | M07 报检与质量 | 待验证 `/v1.production/downloadInspection` | 报检/验收章节列出的候选查询、输出或隐藏能力；效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L327 |
| A029 | M07 报检与质量 | 待验证 `/v1.production/downloadInspections` | 报检/验收章节列出的候选查询、输出或隐藏能力；效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L328 |
| A030 | M04 排产与工艺配置 | 待验证 `/v1.production/editDepartment` | 排产、部门、设计章节列出的候选能力；逐接口语义待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L203 |
| A031 | M04 排产与工艺配置 | 待验证 `/v1.production/editScheduling` | 排产、部门、设计章节列出的候选能力；逐接口语义待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L197 |
| A032 | M10 文件解析与输出 | POST（旧参考记载） `/v1.production/exportProduction` | 导出排产文件 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L240 |
| A033 | M07 报检与质量 | 待验证 `/v1.production/getInspectionArtifactsCodes` | 报检/验收章节列出的候选查询、输出或隐藏能力；效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L326 |
| A034 | M07 报检与质量 | 待验证 `/v1.production/getInspectionInfo` | 报检/验收章节列出的候选查询、输出或隐藏能力；效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L325 |
| A035 | M07 报检与质量 | POST `/v1.production/getInspections` | 账号部门过滤后的报检单列表；本次只见撤销样本 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/17`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L324 |
| A036 | M05 生产计划与任务视图 | POST `/v1.production/getPlan` | 计划详情；含工艺列和动态构件列 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/5`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L231 |
| A037 | M05 生产计划与任务视图 | 待验证 `/v1.production/getPlanArtifactCode` | 生产计划/任务章节列出的候选视图或操作；实体边界待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L243 |
| A038 | M05 生产计划与任务视图 | POST `/v1.production/getPlanArtifacts` | 计划构件执行视图；含节点执行及订单构件引用 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/6`；[src/download-weekly-hujigangwan-plan-codes.js](../../src/download-weekly-hujigangwan-plan-codes.js) L122；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L233 |
| A039 | M05 生产计划与任务视图 | POST（代码） `/v1.production/getPlanArtifactsCodes` | 下载计划构件编码包 | 较高可信推断：本仓调用代码，未核验成功响应 | [src/download-weekly-hujigangwan-plan-codes.js](../../src/download-weekly-hujigangwan-plan-codes.js) L137；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L242 |
| A040 | M05 生产计划与任务视图 | 待验证 `/v1.production/getPlanUnCompleteArtifacts` | 生产计划/任务章节列出的候选视图或操作；实体边界待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L234 |
| A041 | M05 生产计划与任务视图 | POST `/v1.production/getPlans` | 生产计划分页视图；含排产引用和工艺定义 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/4`；[src/download-weekly-hujigangwan-plan-codes.js](../../src/download-weekly-hujigangwan-plan-codes.js) L111；[DB.md](../../DB.md) L238 |
| A042 | M04 排产与工艺配置 | POST `/v1.production/getProductionArtifacts` | 排产构件视图；与计划构件样本共享生产构件 ID | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/9`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L235 |
| A043 | M05 生产计划与任务视图 | 待验证 `/v1.production/getProductionTasks` | 生产计划/任务章节列出的候选视图或操作；实体边界待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L236 |
| A044 | M04 排产与工艺配置 | POST `/v1.production/getScheduling` | 排产详情；反向持有 plan_id | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/7`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L195 |
| A045 | M04 排产与工艺配置 | POST `/v1.production/getSchedulingDesign` | 返回 branchs 与 column 的配置投影，不能直接等同工艺主档 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/8`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L199 |
| A046 | M04 排产与工艺配置 | POST（旧参考记载） `/v1.production/getSchedulings` | 排产列表/查重 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L194 |
| A047 | M05 生产计划与任务视图 | 待验证 `/v1.production/getTaskArtifacts` | 生产计划/任务章节列出的候选视图或操作；实体边界待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L238 |
| A048 | M05 生产计划与任务视图 | 待验证 `/v1.production/getTaskArtifactsCodes` | 生产计划/任务章节列出的候选视图或操作；实体边界待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L239 |
| A049 | M05 生产计划与任务视图 | POST `/v1.production/getTasks` | 执行任务列表视图；样本 ID 与计划相同，不能先断定独立 Task 实体 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/18`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L237 |
| A050 | M07 报检与质量 | 待验证 `/v1.production/hideInspection` | 报检/验收章节列出的候选查询、输出或隐藏能力；效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L329 |
| A051 | M04 排产与工艺配置 | 待验证 `/v1.production/removeArtifacts` | 排产、部门、设计章节列出的候选能力；逐接口语义待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L201 |
| A052 | M04 排产与工艺配置 | POST（旧参考记载） `/v1.production/sendProduce` | 下发生产 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L205 |
| A053 | M04 排产与工艺配置 | 待验证 `/v1.production/setDepartment` | 排产、部门、设计章节列出的候选能力；逐接口语义待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L202 |
| A054 | M04 排产与工艺配置 | POST（旧参考记载） `/v1.production/setDesign` | 指定工艺流程 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L204 |
| A055 | M04 排产与工艺配置 | POST（旧参考记载） `/v1.production/submitSchedulingArtifacts` | 将订单构件挂到排产 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L200 |
| A056 | M10 文件解析与输出 | POST（旧参考记载） `/v1.production/syncProduction` | 同步排产文件 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L241 |
| A057 | M06 过程执行 | POST（旧参考记载） `/v1.production/updateProcess` | 过程更新 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L280 |
| A058 | M02 项目与设计资料 | 待验证 `/v1.project/add` | 项目/设计资料章节列出的候选能力；逐接口输入与效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L139 |
| A059 | M02 项目与设计资料 | 待验证 `/v1.project/del` | 项目/设计资料章节列出的候选能力；逐接口输入与效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L141 |
| A060 | M02 项目与设计资料 | 待验证 `/v1.project/downProjectDesign` | 项目/设计资料章节列出的候选能力；逐接口输入与效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L138 |
| A061 | M02 项目与设计资料 | 待验证 `/v1.project/edit` | 项目/设计资料章节列出的候选能力；逐接口输入与效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L140 |
| A062 | M02 项目与设计资料 | 待验证 `/v1.project/getInfo` | 项目/设计资料章节列出的候选能力；逐接口输入与效果待验证 | 已验证：历史成功响应 | [logs/project_component_api_inspect_1779323231441.json](../../logs/project_component_api_inspect_1779323231441.json) `/probeResults/1`；[src/export-logistics-vehicle-workbook.js](../../src/export-logistics-vehicle-workbook.js) L251；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L133 |
| A063 | M02 项目与设计资料 | POST `/v1.project/getList` | 项目分页列表；本次 count=133 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/3`；[src/extract-project-list.js](../../src/extract-project-list.js) L16；[DB.md](../../DB.md) L189 |
| A064 | M02 项目与设计资料 | POST（旧参考记载） `/v1.project/getProjectArtifacts` | 项目下订单构件，建立订单构件与排产构件桥接 | 已验证：历史成功响应 | [logs/project_goujian_capture_1779324343063.json](../../logs/project_goujian_capture_1779324343063.json) `/capturedApis/4`；[src/extract-project-order-bridge.js](../../src/extract-project-order-bridge.js) L6；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L137 |
| A065 | M02 项目与设计资料 | 待验证 `/v1.project/getProjectFiles` | 项目/设计资料章节列出的候选能力；逐接口输入与效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L135 |
| A066 | M02 项目与设计资料 | POST `/v1.project/getProjectSelect` | 项目选择投影；与项目列表共享项目 ID | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/2`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L26 |
| A067 | M02 项目与设计资料 | 待验证 `/v1.project/searchProjectFiles` | 项目/设计资料章节列出的候选能力；逐接口输入与效果待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L136 |
| A068 | M09 统计与报表 | 待验证 `/v1.statistical/addStatisticalMonth` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L443 |
| A069 | M09 统计与报表 | 待验证 `/v1.statistical/delStatisticalMonth` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L444 |
| A070 | M09 统计与报表 | 待验证 `/v1.statistical/getMonthList` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L442 |
| A071 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalArtifacts` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L411 |
| A072 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalArtifactsByOpenid` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L412 |
| A073 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalData` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L407 |
| A074 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalDay` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L446 |
| A075 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalDayInfo` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L448 |
| A076 | M09 统计与报表 | POST（历史请求） `/v1.statistical/getStatisticalDays` | 工序/日报统计，日报生成和工序对账使用 | 较高可信推断：本仓调用代码，未核验成功响应 | [logs/captured_shoufacun_apis_1777278732242.json](../../logs/captured_shoufacun_apis_1777278732242.json) `/0`；[src/main.js](../../src/main.js) L16；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L447 |
| A077 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalDelivery` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L28 |
| A078 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalMonth` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L445 |
| A079 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalQuality` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L330 |
| A080 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalQualityArtifacts` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L331 |
| A081 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalTeamArtifacts` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L409 |
| A082 | M09 统计与报表 | 待验证 `/v1.statistical/getStatisticalTeamData` | 统计章节列出的候选汇总、下钻或模板能力；逐接口口径待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L408 |
| A083 | M01 身份与组织 | POST `/v1.user/getBranchs` | 组织树；节点带父级、生产标志和负责人引用 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/1`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L27 |
| A084 | M01 身份与组织 | POST（本次）；历史页面请求方法单独保留 `/v1.user/getInfo` | 当前账号、部门、角色及权限声明 | 已验证：本次只读响应 | [_evidence/live-readonly.json](_evidence/live-readonly.json) `/requests/0`；[东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L25 |
| A085 | M01 身份与组织 | POST（旧参考记载） `/v1.user/login` | API 登录，返回 Token | 待验证：仅文档能力记载/失败探测 | [docs/dwyunsc-api-reference.md](../../docs/dwyunsc-api-reference.md) L27 |
| A086 | M10 文件解析与输出 | POST（旧参考记载） `/v2.production/downTaskOrder` | 下载生产任务单 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L252 |
| A087 | M10 文件解析与输出 | 待验证 `/v2.production/downTaskOrderQr` | 生产文件/任务单章节列出的候选解析、编辑或输出能力；参数待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L253 |
| A088 | M10 文件解析与输出 | 待验证 `/v2.production/downTaskOrders` | 生产文件/任务单章节列出的候选解析、编辑或输出能力；参数待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L254 |
| A089 | M10 文件解析与输出 | 待验证 `/v2.production/downTaskPlans` | 生产文件/任务单章节列出的候选解析、编辑或输出能力；参数待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L255 |
| A090 | M10 文件解析与输出 | 待验证 `/v2.production/editArtifactData` | 生产文件/任务单章节列出的候选解析、编辑或输出能力；参数待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L251 |
| A091 | M10 文件解析与输出 | 待验证 `/v2.production/getArtifactData` | 生产文件/任务单章节列出的候选解析、编辑或输出能力；参数待验证 | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L250 |
| A092 | M10 文件解析与输出 | POST（旧参考记载） `/v2.production/parserExcelData` | 解析上传的生产 Excel | 待验证：仅文档能力记载/失败探测 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L249 |

## 参数和响应字段索引

已验证字段＝在样本键或采集摘要键中出现；不等于必填、非空、不可变、外键或全局唯一。列表仅保存前三条样本，数组总数是响应计数；无字段证据处明确留空。完整来源和机器可读映射见 [api-catalog.json](_evidence/api-catalog.json)。

### A001 `/delivery/info`

- 结论：较高可信推断。请求字段：`id`。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A002 `/file/upload`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：unified-automation 建单、排产、下发流程。

### A003 `/v1.order/add`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：订单名称、编号、项目、日期等。

### A004 `/v1.order/addPackageArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：已抓包确认。

### A005 `/v1.order/createPackage`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A006 `/v1.order/delPackage`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A007 `/v1.order/downArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A008 `/v1.order/downCodes`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`id` 或构件相关参数，来自抓包。

### A009 `/v1.order/downPackageCodes`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：返回二进制或文件流。

### A010 `/v1.order/getAllOrder`

- 结论：已验证。请求字段：`project_id`。
- 响应字段：`category_name`、`code`、`construction_order_id`、`construction_project_id`、`id`、`name`、`order_status`、`order_status_name`、`originator_name`、`project_id`、`project_name`、`source_name`、`state_name`。
- 旧参考的参数/使用位置备注（待验证）：`project_id`。

### A011 `/v1.order/getDeliveryHistory`

- 结论：较高可信推断。请求字段：`proj_id`、`type`、`start_time`、`end_time`。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：日期/筛选条件，来自页面抓包。

### A012 `/v1.order/getDeliverys`

- 结论：已验证。请求字段：`proj_id`、`keyword`、`code`、`page`、`size`。
- 响应字段：`artifacts_count`、`code`、`create_time`、`create_user`、`create_user_name`、`date_str`、`id`、`name`、`project_id`、`project_name`、`serial_no`、`status`、`update_time`、`vehicle`。
- 旧参考的参数/使用位置备注（待验证）：抓包中使用的路径。

### A013 `/v1.order/getInfo`

- 结论：已验证。请求字段：`id`。
- 响应字段：`category`、`category_name`、`code`、`columns`、`construction_order_id`、`construction_project_id`、`create_time`、`create_user`、`end_time`、`headers`、`id`、`name`、`order_status`、`order_status_name`、`originator`、`originator_name`、`project_id`、`project_name`、`real_end_time`、`real_start_time`、`recipient`、`recipient_address`、`recipient_tel`、`source`、`source_name`、`start_time`、`state`、`state_name`、`status`、`update_time`、`weight_sync`。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A014 `/v1.order/getList`

- 结论：已验证。请求字段：`proj_id`、`keyword`、`code`、`page`、`size`。
- 响应字段：`artifacts_count`、`category`、`category_name`、`code`、`construction_order_id`、`construction_project_id`、`create_time`、`create_user`、`end_time`、`id`、`name`、`order_status`、`order_status_name`、`originator`、`originator_name`、`project_id`、`project_name`、`real_end_time`、`real_start_time`、`recipient`、`recipient_address`、`recipient_tel`、`scheduling_count`、`source`、`source_name`、`start_time`、`state`、`status`、`update_time`。
- 旧参考的参数/使用位置备注（待验证）：`proj_id`, `keyword`, `code`, `page`, `size`。

### A015 `/v1.order/getOrderArtifacts`

- 结论：已验证。请求字段：`id`。
- 响应字段：`complete_time`、`construction_artifact_id`、`construction_project_id`、`create_time`、`create_user`、`delivery_id`、`file_id`、`guid`、`id`、`install_time`、`is_complete`、`is_package`、`model_id`、`name`、`order_id`、`package_id`、`project_id`、`scheduling_id`、`status`、`体积`、`区域部位/所在楼层`、`所属布置图`、`数量`、`构件GUID`、`构件名称`、`构件类型编码`、`构件编号`、`模型ID`、`生产特征`、`规格/型号`、`轴线范围`、`重量`、`长度`。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A016 `/v1.order/getPackageArtifacts`

- 结论：已验证。请求字段：`id`。
- 响应字段：`characteristics`、`code`、`complete`、`count`、`delivery`、`delivery_id`、`guid`、`id`、`length`、`model_id`、`name`、`order_id`、`order_name`、`project_id`、`project_name`、`specifications`、`weight`。
- 旧参考的参数/使用位置备注（待验证）：后续同步包内构件优先用。

### A017 `/v1.order/getPackageInfo`

- 结论：已验证。请求字段：`id`。
- 响应字段：`artifacts_count`、`complete_time`、`construction_artifact_id`、`construction_project_id`、`create_time`、`create_user`、`create_user_name`、`data`、`delivery`、`delivery_id`、`file_id`、`guid`、`id`、`install_time`、`is_complete`、`is_package`、`model_id`、`name`、`order_id`、`package_id`、`project_id`、`project_name`、`scheduling_id`、`status`。
- 旧参考的参数/使用位置备注（待验证）：按包件 ID 查询。

### A018 `/v1.order/getPackageList`

- 结论：已验证。请求字段：`proj_id`、`keyword`、`code`、`page`、`size`。
- 响应字段：`artifacts_count`、`complete_time`、`construction_artifact_id`、`construction_project_id`、`create_time`、`create_user`、`create_user_name`、`data`、`delivery`、`delivery_id`、`file_id`、`guid`、`id`、`install_time`、`is_complete`、`is_package`、`model_id`、`name`、`order_id`、`package_id`、`project_id`、`project_name`、`scheduling_id`、`status`。
- 旧参考的参数/使用位置备注（待验证）：打包管理入口。

### A019 `/v1.order/getUnArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`order_id`。

### A020 `/v1.order/removeArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A021 `/v1.order/removePackageArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：已抓包确认。

### A022 `/v1.order/searchPackageArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：添加包内构件前使用。

### A023 `/v1.order/submitArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`order_id`, `file_id`。

### A024 `/v1.production/addScheduling`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：项目、名称、编号、日期、类型等。

### A025 `/v1.production/cancelProcess`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A026 `/v1.production/delPlan`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A027 `/v1.production/delScheduling`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A028 `/v1.production/downloadInspection`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A029 `/v1.production/downloadInspections`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A030 `/v1.production/editDepartment`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A031 `/v1.production/editScheduling`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A032 `/v1.production/exportProduction`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A033 `/v1.production/getInspectionArtifactsCodes`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A034 `/v1.production/getInspectionInfo`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A035 `/v1.production/getInspections`

- 结论：已验证。请求字段：`proj_id`、`keyword`、`page`、`size`。
- 响应字段：`artifact_count`、`code`、`create_time`、`create_time_text`、`create_user`、`create_user_name`、`date_idx`、`date_str`、`flaw_department`、`flaw_department_name`、`flaw_desc`、`flaw_sign`、`flaw_time`、`flaw_time_text`、`flaw_user`、`flaw_user_name`、`hide`、`id`、`inspection_department`、`inspection_department_name`、`inspection_desc`、`inspection_sign`、`inspection_time`、`inspection_time_text`、`inspection_user`、`inspection_user_name`、`plan_id`、`plan_name`、`project_id`、`project_name`、`status`、`status_name`、`submit_department`、`submit_department_name`、`submit_sign`。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A036 `/v1.production/getPlan`

- 结论：已验证。请求字段：`id`。
- 响应字段：`category`、`category_name`、`code`、`columns`、`create_time`、`create_user`、`create_user_name`、`departments`、`design_column`、`design_id`、`design_info`、`end_time`、`headers`、`id`、`is_change`、`name`、`production_process`、`production_status`、`production_status_name`、`project_id`、`project_name`、`recipient`、`recipient_address`、`recipient_tel`、`scheduling_id`、`start_time`、`state`、`state_name`、`status`、`type`、`update_time`。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A037 `/v1.production/getPlanArtifactCode`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A038 `/v1.production/getPlanArtifacts`

- 结论：已验证。请求字段：`id`。
- 响应字段：`change`、`code`、`complete_time`、`construction_artifact_id`、`construction_project_id`、`create_time`、`data_process`、`department_current`、`departments`、`file_id`、`guid`、`id`、`is_complete`、`is_deliver`、`is_print`、`length`、`length_all`、`model_id`、`name`、`node_current`、`node_end`、`node_start`、`num`、`order_artifacts_id`、`order_id`、`plan_id`、`process_items`、`project_id`、`remark`、`scheduling_id`、`status`、`update_time`、`volume`、`volume_all`、`weight`、`weight_all`、`体积`、`区域部位/所在楼层`、`所属布置图`、`数量`、`构件GUID`、`构件名称`、`构件类型编码`、`构件编号`、`模型ID`、`涂装`、`生产特征`、`装焊报检`、`装焊探伤`、`装焊质检`、`规格/型号`、`轴线范围`、`重量`、`钢构生产开始`、`长度`。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A039 `/v1.production/getPlanArtifactsCodes`

- 结论：较高可信推断。请求字段：`id`、`ids`。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`id`, `ids`。

### A040 `/v1.production/getPlanUnCompleteArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A041 `/v1.production/getPlans`

- 结论：已验证。请求字段：`proj_id`、`department`、`production_status`、`page`、`size`。
- 响应字段：`artifacts_count`、`category`、`category_name`、`code`、`create_time`、`create_user`、`create_user_name`、`departments`、`design_id`、`design_info`、`end_time`、`headers`、`id`、`is_change`、`name`、`plan_end_time`、`plan_start_time`、`production_process`、`production_status`、`production_status_name`、`project_id`、`project_name`、`recipient`、`recipient_address`、`recipient_tel`、`scheduling_id`、`start_time`、`state`、`state_name`、`status`、`type`、`update_time`。
- 旧参考的参数/使用位置备注（待验证）：`proj_id`, `page`, `size`, 筛选条件。

### A042 `/v1.production/getProductionArtifacts`

- 结论：已验证。请求字段：`id`。
- 响应字段：`change`、`code`、`complete_time`、`construction_artifact_id`、`construction_project_id`、`create_time`、`data_process`、`department_current`、`departments`、`file_id`、`guid`、`id`、`is_complete`、`is_print`、`length`、`length_all`、`model_id`、`name`、`node_current`、`node_end`、`node_start`、`num`、`order_artifacts_id`、`order_id`、`plan_id`、`process_items`、`project_id`、`remark`、`scheduling_id`、`status`、`update_time`、`volume`、`volume_all`、`weight`、`weight_all`、`体积`、`区域部位/所在楼层`、`所属布置图`、`数量`、`构件GUID`、`构件名称`、`构件类型编码`、`构件编号`、`模型ID`、`涂装`、`生产特征`、`装焊报检`、`装焊探伤`、`装焊质检`、`规格/型号`、`轴线范围`、`重量`、`钢构生产开始`、`长度`。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A043 `/v1.production/getProductionTasks`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A044 `/v1.production/getScheduling`

- 结论：已验证。请求字段：`id`。
- 响应字段：`category`、`category_name`、`code`、`columns`、`create_time`、`create_user`、`departments`、`design_column`、`design_id`、`design_info`、`end_time`、`headers`、`id`、`is_change`、`name`、`plan_id`、`project_id`、`project_name`、`real_end_time`、`real_start_time`、`recipient`、`recipient_address`、`recipient_tel`、`responsible`、`responsible_name`、`scheduling_status`、`scheduling_status_name`、`source`、`source_name`、`start_time`、`state`、`state_name`、`status`、`type`、`type_name`、`update_time`。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A045 `/v1.production/getSchedulingDesign`

- 结论：已验证。请求字段：`id`。
- 响应字段：`branchs`、`column`。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A046 `/v1.production/getSchedulings`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`department`, `proj_id`, `keyword`, `is_produce`, `start_time`, `end_time`, `code`, `page`, `size`。

### A047 `/v1.production/getTaskArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A048 `/v1.production/getTaskArtifactsCodes`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A049 `/v1.production/getTasks`

- 结论：已验证。请求字段：`proj_id`、`keyword`、`page`、`size`。
- 响应字段：`artifacts_count`、`category`、`category_name`、`code`、`create_time`、`create_user`、`create_user_name`、`departments`、`design_id`、`design_info`、`end_time`、`end_time_text`、`headers`、`id`、`is_change`、`name`、`production_process`、`production_status`、`project_id`、`project_name`、`recipient`、`recipient_address`、`recipient_tel`、`scheduling_id`、`start_time`、`start_time_text`、`state`、`state_name`、`status`、`type`、`update_time`。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A050 `/v1.production/hideInspection`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A051 `/v1.production/removeArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A052 `/v1.production/sendProduce`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A053 `/v1.production/setDepartment`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A054 `/v1.production/setDesign`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`id`, `design_id`。

### A055 `/v1.production/submitSchedulingArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`scheduling_id`, `order_id`, `artifacts_ids`。

### A056 `/v1.production/syncProduction`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`scheduling_id`, `file_id`。

### A057 `/v1.production/updateProcess`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`id`, `ids`, `status`。

### A058 `/v1.project/add`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A059 `/v1.project/del`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A060 `/v1.project/downProjectDesign`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A061 `/v1.project/edit`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A062 `/v1.project/getInfo`

- 结论：已验证。请求字段：`id`。
- 响应字段：`cover_path`、`plan_images_list`、`starts_data`、`confirmation_data`、`tasks_data`、`id`、`name`、`code`、`start_time`、`end_time`、`real_start_time`、`real_end_time`、`engineer_name`、`sort_name`、`head_person`、`size`、`nature`、`level`、`address`、`area`、`cover`、`plan_images`、`introduce`、`create_time`、`create_user`、`update_time`、`status`、`construction_openid`、`qr_title`、`category`、`completed`、`token`。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A063 `/v1.project/getList`

- 结论：已验证。请求字段：`keyword`、`code`、`page`、`size`。
- 响应字段：`address`、`area`、`artifacts_count`、`category`、`code`、`completed`、`confirmation_count`、`construction_openid`、`cover`、`cover_path`、`create_time`、`create_user`、`end_time`、`engineer_name`、`head_person`、`head_person_name`、`id`、`introduce`、`level`、`name`、`nature`、`plan_images`、`qr_title`、`real_end_time`、`real_start_time`、`size`、`sort_name`、`start_time`、`starts_count`、`status`、`status_name`、`tasks_count`、`time`、`token`、`update_time`。
- 旧参考的参数/使用位置备注（待验证）：`keyword`, `page`, `size`。

### A064 `/v1.project/getProjectArtifacts`

- 结论：已验证。请求字段：`proj_id`、`order_id`、`keyword`、`production`、`type`。
- 响应字段：`construction_artifact_id`、`construction_project_id`、`delivery_id`、`file_id`、`guid`、`id`、`model_id`、`name`、`order_id`、`order_name`、`package_id`、`project_id`、`scheduling_id`、`scheduling_name`、`构件GUID`、`模型ID`。
- 旧参考的参数/使用位置备注（待验证）：`proj_id`, `order_id`, `keyword`, `production`, `type`。

### A065 `/v1.project/getProjectFiles`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A066 `/v1.project/getProjectSelect`

- 结论：已验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：`address`、`area`、`category`、`code`、`completed`、`construction_openid`、`cover`、`create_time`、`create_user`、`end_time`、`engineer_name`、`head_person`、`id`、`introduce`、`label`、`level`、`name`、`nature`、`plan_images`、`qr_title`、`real_end_time`、`real_start_time`、`size`、`sort_name`、`start_time`、`status`、`token`、`update_time`、`value`。
- 旧参考的参数/使用位置备注（待验证）：空对象 `{}`。

### A067 `/v1.project/searchProjectFiles`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A068 `/v1.statistical/addStatisticalMonth`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A069 `/v1.statistical/delStatisticalMonth`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A070 `/v1.statistical/getMonthList`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A071 `/v1.statistical/getStatisticalArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A072 `/v1.statistical/getStatisticalArtifactsByOpenid`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A073 `/v1.statistical/getStatisticalData`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A074 `/v1.statistical/getStatisticalDay`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A075 `/v1.statistical/getStatisticalDayInfo`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A076 `/v1.statistical/getStatisticalDays`

- 结论：较高可信推断。请求字段：`types_id`、`process_id`、`start_time`、`end_time`、`departments`。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A077 `/v1.statistical/getStatisticalDelivery`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A078 `/v1.statistical/getStatisticalMonth`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A079 `/v1.statistical/getStatisticalQuality`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A080 `/v1.statistical/getStatisticalQualityArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A081 `/v1.statistical/getStatisticalTeamArtifacts`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A082 `/v1.statistical/getStatisticalTeamData`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A083 `/v1.user/getBranchs`

- 结论：已验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：`category`、`category_name`、`children`、`create_time`、`create_user`、`describe`、`director`、`director_name`、`id`、`is_production`、`label`、`name`、`pid`、`sort`、`status`、`update_time`、`user_count`、`value`。
- 旧参考的参数/使用位置备注（待验证）：打包/发运抓包。

### A084 `/v1.user/getInfo`

- 结论：已验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：`account`、`avatar`、`category`、`create_time`、`department`、`department_name`、`id`、`is_admin`、`mobile`、`name`、`operator`、`role`、`role_permission`、`status`、`token_version`、`update_time`、`work_number`。
- 旧参考的参数/使用位置备注（待验证）：打包/发运抓包。

### A085 `/v1.user/login`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：unified-automation `api-client.js`。

### A086 `/v2.production/downTaskOrder`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`id`。

### A087 `/v2.production/downTaskOrderQr`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A088 `/v2.production/downTaskOrders`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A089 `/v2.production/downTaskPlans`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A090 `/v2.production/editArtifactData`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A091 `/v2.production/getArtifactData`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：未给出逐接口说明。

### A092 `/v2.production/parserExcelData`

- 结论：待验证。请求字段：待验证（不能把文档中的示意参数视为已采集契约）。
- 响应字段：待验证；目前没有足够原始字段证据。
- 旧参考的参数/使用位置备注（待验证）：`file_id`。

## 不计入有效资产的路径

| 路径 | 结论 | 证据 |
|---|---|---|
| `/v1.order/getOrder` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-order-api.js](../../debug-inspect-order-api.js) L31 |
| `/v1.order/getOrderArtifact` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-order-api.js](../../debug-inspect-order-api.js) L34 |
| `/v1.order/getOrderDetail` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-order-api.js](../../debug-inspect-order-api.js) L32 |
| `/v1.order/getOrderList` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-order-api.js](../../debug-inspect-order-api.js) L29 |
| `/v1.order/getOrders` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-order-api.js](../../debug-inspect-order-api.js) L30 |
| `/v1.production/getPlanInfo` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L33 |
| `/v1.production/getProjectArtifacts` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-probe-project-artifact-apis.js](../../debug-probe-project-artifact-apis.js) L16 |
| `/v1.production/getProjectPlans` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L34 |
| `/v1.project/getArtifactList` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L22 |
| `/v1.project/getArtifacts` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L21 |
| `/v1.project/getComponent` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L24 |
| `/v1.project/getComponentList` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L23 |
| `/v1.project/getDetail` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L19 |
| `/v1.project/getOrderList` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L27 |
| `/v1.project/getOrders` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L28 |
| `/v1.project/getPlanList` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L25 |
| `/v1.project/getPlans` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L26 |
| `/v1.project/getProject` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L18 |
| `/v1.project/getScheduling` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L29 |
| `/v1.project/getSchedulingList` | 待验证：只在候选探测代码出现，不据此断言存在或不存在 | [debug-inspect-project-component-api.js](../../debug-inspect-project-component-api.js) L30 |
| `/v1.order/savePackageArtifact` | 待验证：旧参考明确否定，故本次不计入；未重新调用 | [docs/dwyunsc-api-reference.md](../../docs/dwyunsc-api-reference.md) L307 |

## 请求成功不等于规则成立

- **已验证**：历史 `searchPackageArtifacts` 多个试探 payload 返回 HTTP 200 / code=-1；缺参数失败不证明接口不存在。证据：`logs/order_api_inspect_1779260921983.json#/probeResults/1..5`。
- **已验证**：历史将 `project_id=163` 传给计划列表仍返回 project_id=162 的样本；原代码改用 `proj_id`。只能证明该次样本不能证明过滤生效。证据：`logs/project_component_api_inspect_1779323231441.json#/probeResults/3`；`src/project-list-component-api.js:139`。
- **已验证**：`getPlanArtifacts({id:163})` 返回的是计划 163 / 项目 45，`getOrderArtifacts({id:163})` 返回订单 163 / 项目 23。数字相同不能跨资源当外键。证据：同文件 `/probeResults/4`、`/probeResults/6`。
- **待验证**：`getTasks` 与 `getPlans` 的样本 ID 相同但总数不同（8479 vs 8432），过滤与任务语义需页面核验，不能仅因名称新增 Task 主表。
