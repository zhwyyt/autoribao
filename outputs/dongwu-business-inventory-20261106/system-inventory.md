# 东吴云业务系统资产清单与整体分析报告

日期：2026-11-06（北京时间）。本阶段只分析；所有新增文件位于本目录。未运行同步写库、建单、删除、审核、发运提交或状态推进。原程序、原文档和既有未提交改动保持原状，验证记录见 X04。

## 1. 整体结论

| 结论 | 等级 | 证据与边界 |
|---|---|---|
| 既有资料覆盖项目、订单、排产、计划、过程、报检、包装、发运、统计、身份组织和文件资源，整理为 10 个分析模块 | 已验证（资料覆盖）；模块划分为较高可信推断 | X01、X03；不是原系统菜单或全部业务边界 |
| 共发现 113 个路径字符串，保留 92 个已知资产路径，排除 20 个纯探测候选与 1 个旧文档否定路径 | 已验证（本次资料统计） | X01、X03；92 不能称为官方 API 总数或成功接口数 |
| 19 个接口在本次只读补采中均 HTTP 200 / code=0 | 已验证（本账号、本时点、所用 payload） | L01；新增、修改、删除、审核和状态转换没有被执行 |
| 订单构件和生产构件属于不同资源 ID 空间，生产构件有显式 order_artifacts_id | 已验证（样本） | L01 /requests/6、/9、/12；不能把本地 component_id 与任意云 id 混用 |
| 构件生产流程有 design_info 节点与边，并按 features_codes 描述适用特征；旧样本与新样本不同 | 已验证（定义结构）；适用/跳转执行规则待验证 | S12 /probeResults/3..4、L01 /requests/4..9 |
| “生产任务”未必是独立单据实体：本次任务视图与计划样本 ID 都是 9155，总量却不同 | 较高可信推断（存在视图复用）；独立性待验证 | L01 /requests/4、/18 |
| 本仓“装焊入库”取装焊报检统计；本地状态、回退事件和历史快照含采集端加工 | 已验证（代码）；等价于原系统业务规则待验证 | S03、S07、S08、S19；必须分清原始事实与本地解释 |
| 历史 489 构件桥接全通过不能代表全量可关联 | 已验证（样本边界与反证） | S15 /summary；S16 /summary：4126 条 db_missing_scheduling；S17 /summary：84572 missingOrderRow、4609 missingPlanMapping |
| 现有资料不足以确认原系统审批、互斥排产、删除级联、质检前置、发货撤回和全局唯一规则 | 待验证 | S02 的“必须校验”“建议状态约束”是重开发建议，不能移作原系统既有约束 |

## 2. 交付导航

| 文件 | 内容 |
|---|---|
| [module-map.md](module-map.md) | 10 个模块、边界、数据流与覆盖缺口 |
| [api-business-map.md](api-business-map.md) | 92 个路径逐项映射、参数/响应字段、21 个排除项 |
| [entity-catalog.md](entity-catalog.md) | 业务实体与资源投影的区别、字段/标识符目录 |
| [entity-relationships.md](entity-relationships.md) | 有证据的关系、样本连接链及待验证基数 |
| [business-operations.md](business-operations.md) | 查询、维护、关联、生产、报检、包装与输出操作 |
| [state-machines.md](state-machines.md) | 原生枚举样本、配置工艺图、本地派生状态及未知迁移 |
| [verification-backlog.md](verification-backlog.md) | 按优先级排序的浏览器/业务核验方案和本体建模门槛 |

## 3. 范围与可信度标准

- **已验证**：本次直接读到的源代码事实、保存的原始/摘要采集事实或本次成功响应；注明“代码/历史样本/本次样本”。读到字段不等于验证其约束；读到配置边不等于执行过迁移。
- **较高可信推断**：至少由字段联结、匹配代码、跨接口样本或已有带语境的功能说明支持，但没有完整业务操作闭环。记录推断依据与反例。
- **待验证**：只有文档叙述、探测候选、建议方案，或现有证据相互冲突。绝不以接口名字补齐业务定义。
- 时间边界：历史采集集中于 2026-04/05，抽查同步报告为 2026-10-27，本次补采为 2026-11-06。历史样本中的业务事件可能更早，不代表当时采集时间。
- 范围边界：只读取当前仓库与本次授权查询。旧文档提及的 unified-automation、I:\dwyzonghe 未跨仓核验；外部项目的“已抓包”陈述在本报告仍按二手证据处理。

## 4. 已有资产与检查覆盖

| 资产 | 本次检查 | 等级/限制 |
|---|---|---|
| 项目文件清点 | 排除第三方/备份等目录后共 3819 个文件；170 个 .js、17 个 .md、10 个 .sql、297 个 .json、176 个 .jsonl、783 个 .log、241 个 .csv、1074 个 .xlsx | 已验证（枚举）；不代表逐行阅读每一报表 |
| 文本接口发现 | 1452 个文本文件按 v1/v2 业务路径、/file/upload、/delivery/info 搜索；来源位置保存在 X01；单文件上限 30MB | 已验证（扫描）；动态拼接路径、其他版本/资源族可能遗漏 |
| API 代码与参考 | 阅读主采集器、订单/项目桥接、过程与发货对账、物流读取、字段映射、SQL 及参考文档；逐路径对照调用或说明 | 已验证（静态）；没有把本地 SQL 表当云端数据库 |
| 原始采集摘要 | 逐项检查 5 个接口/桥接 JSON 样本，核对 HTTP 与 code、请求参数、firstKeys/firstSample、错误探测 | 已验证（历史文件）；摘要不是完整响应全集 |
| 同步报告 | 读取两次 489 行桥接验收记录及 2026-10-27 两类同步报告；其他日志作为路径与异常线索索引 | 已验证（文件）；没有连接本地数据库运行补写 |
| CSV | 抽查 2026-10-25 两份 _API.csv 的表头和行数：装焊入库 15811、构件出库 16405（不含表头） | 已验证（文件行数）；不是独立构件数，也未重新生成报表 |
| Excel/Word/PDF/图片 | 清点为派生业务产物；已有重开发说明 Markdown 为可追溯文本来源；没有逐个解析 1074 份表格和 967 张图片 | 待验证：派生物不能替代原始 API 契约；本次不声称每个二进制文件内容均已审阅 |
| 旧建设方案/行业建议 | 识别为目标系统建议资料，未作为东吴云现实规则依据 | 已验证（文档用途）；防止把“应当”写成“已经” |
| 新补采 | 19 个查询接口；仅保存前三条顶层列表样本及计数，嵌套字段保留；无 Token/密码/手机号/收货地址值 | 已验证；不是全量备份，个人姓名等业务标签仍可能出现在工序文本 |

排除目录见 X02：.git、node_modules、NapCatOneKey、.agents、.cursor、backups、_qa_dongwu_docx 和本次新目录。真实配置只供已授权登录读取，不进入扫描成果或报告。未找到官方 OpenAPI/Swagger 定义；该结论仅限已扫描范围。

## 5. API 数量（互斥分类）

| 覆盖类型 | 数量 |
|---|---:|
| 本仓调用代码，未核验成功响应 | 4 |
| 仅文档能力记载/失败探测 | 66 |
| 历史成功响应 | 3 |
| 本次只读响应 | 19 |

| 业务分类 | API 路径数 |
|---|---:|
| M01 身份与组织 | 3 |
| M02 项目与设计资料 | 10 |
| M03 订单与构件范围 | 10 |
| M04 排产与工艺配置 | 13 |
| M05 生产计划与任务视图 | 11 |
| M06 过程执行 | 2 |
| M07 报检与质量 | 6 |
| M08 包装与发运 | 11 |
| M09 统计与报表 | 15 |
| M10 文件解析与输出 | 11 |

| 技术资源族 | API 路径数 |
|---|---:|
| `delivery` | 1 |
| `file` | 1 |
| `v1.order` | 21 |
| `v1.production` | 34 |
| `v1.project` | 10 |
| `v1.statistical` | 15 |
| `v1.user` | 3 |
| `v2.production` | 7 |

以上为已验证的本次目录统计；模块分类是分析视角。业务模块数与技术资源族数不要求相等，统计质量接口归 M09、实体语义仍属于质量领域。

## 6. 采集中的实质性限制

- **已验证**：原登录会话在输入凭据之前被 403 拦截，错误页显示 HeadlessChrome。临时会话仅替换该 User-Agent 标识后成功；失败证据见 [_evidence/live-login-failure.json](_evidence/live-login-failure.json)。未改原有浏览器程序。
- **已验证**：`logs/captured_shoufacun_api_responses_1777279019899.json` 的 subwork/delivery 都为 null，不能作为成功响应依据；另一个请求抓包文件只证明请求方法与参数。
- **已验证**：getInspections 的响应带部门过滤 map（部门 68、191）及 hide=0；count=1 是当前可见范围，不能外推公司没有其他报检单。
- **已验证**：原项目主状态、订单状态、排产状态、计划状态和节点状态是不同字段域。同一连接链中订单显示已排产、排产显示待开始、计划显示进行中，不能强行合并一个 status。
- **待验证**：发运单 8514 的 artifacts_count=27，而已查询包件 1622105 的明细为 26；另两个样本亦为 29/28、33/32。可能包含包件壳或其他明细，尚无证明，禁止自行加一解释。

## 7. 下一阶段业务本体建模建议（提案，待验证后定稿）

1. 先建立术语与身份对照：项目、订单范围、物理构件、订单构件记录、生产构件记录、排产、计划、工艺定义、节点执行、报检、包件、发运单。为每一源标识增加“系统+资源类型+ID”的命名空间；GUID 仅作候选关联线索。
2. 以已核对的三组样本连接链作为本体例子，保留字段原值、来源接口、采集时间和可信度。先描述关系，不立即决定数据库表，也不强行把任务视图、包件壳、报表投影各建成独立业务实体。
3. 将状态拆成原生生命周期、工艺节点执行、物流状态、采集派生状态四类；工艺图保留 design_id 与定义快照。先通过 VB-01 至 VB-10 确认唯一性、基数、工艺适用、审批和撤销，再制定约束。
4. 核实“装焊报检”“成品库”“入库时间”“已出库”的术语和核算口径；重量/数量、业务日期、补录日期和历史快照分别建定义，不能将本地报表名称当成物理库存事件。
5. 输出下一阶段成果应是：版本化术语表、证据化关系图、状态字典、命令前置/后置条件、真实反例集和指标定义。完成这些前，不启动新平台实现。

## 8. 证据索引

其他文件中的 Sxx/L01/Xxx 均指下列来源；JSON Pointer 精确到请求/样本，代码行号精确到实现入口。完整逐路径来源见 X01。

| ID | 位置 | 能证明什么 |
|---|---|---|
| S01 | [docs/dwyunsc-api-reference.md](../../docs/dwyunsc-api-reference.md) L3 | 既有接口参考；明确非官方全量，含外部项目转述 |
| S02 | [东吴云生产管理平台_重开发数据流转说明.md](../../东吴云生产管理平台_重开发数据流转说明.md) L12 | 既有重开发说明；混有前端/响应记载与设计建议 |
| S03 | [src/extract-production-plan.js](../../src/extract-production-plan.js) L144 | 计划状态、构件映射、状态文本解析与本地回退 |
| S04 | [src/extract-order-sync.js](../../src/extract-order-sync.js) L190 | 订单字段映射与本地订单构件同步 |
| S05 | [src/project-list-component-api.js](../../src/project-list-component-api.js) L99 | 项目订单、项目构件、排产计划桥接 |
| S06 | [src/order-component-match.js](../../src/order-component-match.js) L121 | 关联匹配和歧义拒绝逻辑 |
| S07 | [src/extract-project-list.js](../../src/extract-project-list.js) L342 | 负责人文本映射本地项目状态 |
| S08 | [src/main.js](../../src/main.js) L280 | 装焊报检/已出库页面取数与列映射 |
| S09 | [src/export-logistics-vehicle-workbook.js](../../src/export-logistics-vehicle-workbook.js) L245 | 包件按 delivery_id 归集及发运单 PDF 读取 |
| S10 | [db/dwyunsc_schema.sql](../../db/dwyunsc_schema.sql) L29 | 本地 schema 基础定义，非原系统 schema |
| S11 | [db/order_sync_schema.sql](../../db/order_sync_schema.sql) L11 | 本地订单和构件关联表约束 |
| S12 | [logs/project_component_api_inspect_1779323231441.json](../../logs/project_component_api_inspect_1779323231441.json) | 历史结构样本；/probeResults/3 工艺图、/4 生产构件 |
| S13 | [logs/project_goujian_capture_1779324343063.json](../../logs/project_goujian_capture_1779324343063.json) | 历史页面请求；/capturedApis/3 项目订单、/4 项目构件 |
| S14 | [logs/order_api_inspect_1779260921983.json](../../logs/order_api_inspect_1779260921983.json) | 历史订单、包件和失败探测 |
| S15 | [logs/order_bridge_verify_1779261457316.json](../../logs/order_bridge_verify_1779261457316.json) | 5 单/489 构件的历史桥接成功样本 |
| S16 | [logs/order_sync_report_20261027193003.json](../../logs/order_sync_report_20261027193003.json) | 较新订单同步报告，存在缺失 |
| S17 | [logs/project_bridge_report_20261027193304.json](../../logs/project_bridge_report_20261027193304.json) | 较新项目桥接报告，存在缺失 |
| S18 | [STATUS.md](../../STATUS.md) L3 | 本地边界、遗留问题与现有运行结果陈述 |
| S19 | [DESIGN.md](../../DESIGN.md) L17 | 本地报表口径与历史快照设计 |
| L01 | [_evidence/live-readonly.json](_evidence/live-readonly.json) | 2026-11-06 新补采；19 个只读调用；脱敏、保留每列表前三条 |
| X01 | [_evidence/endpoint-occurrences.json](_evidence/endpoint-occurrences.json) | 既有文本中全部接口路径出现位置 |
| X02 | [_evidence/scan-manifest.json](_evidence/scan-manifest.json) | 扫描范围、文件类型计数及排除项 |
| X03 | [_evidence/api-catalog.json](_evidence/api-catalog.json) | 92 个保留路径的可复算明细 |
| X04 | [_evidence/verification.json](_evidence/verification.json) | 本次交付验证结果；由验证步骤生成 |

## 9. 复核方式

运行本目录 `_evidence/verify_inventory.py`：检查八份交付、92 路径完整且唯一、分类求和、JSON Pointer、源文件行号、文件链接、原有源码/文档哈希和既有未提交文件哈希。仅执行静态与文档验证，不运行会登录、下载、发消息或写数据库的项目测试。
