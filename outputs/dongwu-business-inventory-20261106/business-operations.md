# 业务操作清单

日期：2026-11-06。引用约定：`L01 /n` 简写表示新采集文件的 `/requests/n`（从 0 起）；多项区间表示分别查看这些请求。证据索引见 [系统资产清单](system-inventory.md#8-证据索引)，逐接口编号、字段与位置见 [API 映射](api-business-map.md)。**POST 不代表新增或修改**：本次 19 个 POST 均为只读查询。所有写能力均未在本次执行。

## 1. 可确认的查询与输出操作

| ID | 业务意图 | 输入 → 输出 / 已知规则 | 结论等级与证据 | 限制 |
|---|---|---|---|---|
| OP01 | 获取当前账号身份与授权声明 | {} → 用户、role、department、role_permission | 已验证；L01 /0，getInfo | 不能证明后端权限控制正确 |
| OP02 | 查询组织树 | {} → 16 个顶层节点及子节点；保留前三个顶层样本 | 已验证；L01 /1，getBranchs | 组织层级类型与生产标志业务含义待验证 |
| OP03 | 查询/选择项目 | keyword/code/page/size 或 {} → 项目列表/选择项 | 已验证；L01 /2..3，getList/getProjectSelect | 列表只取第一页；返回 count=133 是当前可见范围 |
| OP04 | 按项目查询订单与构件范围 | getAllOrder(project_id)、getProjectArtifacts(proj_id,order_id,keyword,production,type) | 已验证（历史请求与响应）；S13 /3..4；S05 L102..132 | 默认 type=2/production=0 的枚举含义待验证；逐单请求是本地超时规避 |
| OP05 | 查询订单主档和明细 | getList/getInfo(id)/getOrderArtifacts(id) → 订单及构件 | 已验证；L01 /10..12 | getOrderArtifacts.id 是订单 ID，不是项目/构件 ID |
| OP06 | 查询排产与配置 | getScheduling(id)、getSchedulingDesign(id) → 排产及 branchs/column | 已验证；L01 /7..8 | 输入 id 取已知 scheduling_id；未验证所有字段必填 |
| OP07 | 查询排产构件 | getProductionArtifacts(id=9504) → 10 条构件，保留前三条 | 已验证；L01 /9 | 工序文本是部门名，不应按计划视图的时间格式解析 |
| OP08 | 查询计划及执行构件 | getPlans/getPlan(id)/getPlanArtifacts(id) → 计划、动态列、构件节点执行 | 已验证；L01 /4..6 | 计划总数、明细数量和实体基数是不同概念 |
| OP09 | 查询任务视图 | getTasks(proj_id,keyword,page,size) → 与计划结构相似的记录 | 已验证；L01 /18 | 独立任务、接单行为和列表过滤待验证 |
| OP10 | 查询报检单 | getInspections → plan_id、检查/探伤字段、状态与过滤 map | 已验证；L01 /17 | 当前部门只见撤销单；不能代表没有正常流程 |
| OP11 | 查询包件及包内构件 | getPackageList/getPackageInfo(id)/getPackageArtifacts(id) | 已验证；L01 /13..15 | 包件计数与发运计数不同；成员唯一性未验证 |
| OP12 | 查询发运单 | getDeliverys(proj_id,keyword,code,page,size) → 单号、项目、车辆等 | 已验证；L01 /16 | 车辆值已脱敏；没有读取签收动作 |
| OP13 | 查询发货历史/已出库明细 | 页面选“已出库”后复用 getDeliveryHistory，历史 payload 含 type=3、日期 | 已验证（历史请求+本地代码）；S08 L352..405；logs/captured_shoufacun_apis_1777278732242.json /1 | type=3 的完整字典待验证；旧失败探测未填必要范围不能当成功证据 |
| OP14 | 查询装焊/工序统计 | 页面选钢结构厂、装焊报检、日期 → getStatisticalDays；返回动态 headers/list | 已验证（请求+本地解析）；S08 L280..330；同抓包文件 /0，process_id=42 | 此处入库是本地报表命名，未证明仓储记账动作 |
| OP15 | 生成/读取单据与二维码表示 | 计划编码包下载调用；/delivery/info?id 读取 PDF；其他输出见 S01 | 较高可信推断（代码/文档）；src/download-weekly-hujigangwan-plan-codes.js、S09 L264 | 文件生成可能有服务器日志副作用；本次未重新下载 |

## 2. 文档记载的维护、关联与状态操作

以下是**待验证**能力目录。语义来源于既有文档的业务说明或明确表格，不以 add/edit/del 的英文名称独立推断。未有逐接口说明的同组条目只认定“文档将其列在该业务段”，实际输入、事务、校验和状态变化保持未知。

| ID | 操作类别 / 候选业务意图 | 原接口 | 已有输入线索 | 结论等级与证据 | 待补的前置、后置与失败规则 |
|---|---|---|---|---|---|
| OP16 | 新增/修改/删除项目 | v1.project/add、edit、del | 项目字段在 S02 §6.1，逐接口 payload 缺失 | 待验证；S02 L130..156 | 编号唯一范围、关联保护、软删除/恢复、审批 |
| OP17 | 创建订单 | v1.order/add | S01 给 category/code/name/project_id/start_time/end_time 等示例 | 待验证；S01 L140..160 | 必填、单号唯一、日期、自动排产、失败补偿 |
| OP18 | 上传业务文件 | /file/upload | multipart/form-data 的旧参考说明 | 待验证；S01 L20..30 | 文件类型、版本、权限、大小、病毒检查、上传与入库分离 |
| OP19 | 提交订单构件 | v1.order/submitArtifacts | order_id、file_id | 待验证；S01 订单接口表；S02 §6.2 | 是导入构件、提交审批还是其他；重复导入与部分失败 |
| OP20 | 移除订单构件 | v1.order/removeArtifacts | 仅文档同组能力，成员参数未知 | 待验证；S02 L158..187 | 已排产/已包装/已发货是否能移除，是否留历史 |
| OP21 | 创建/修改/删除排产 | addScheduling、editScheduling、delScheduling | 旧说明称项目、名称、编号、日期、类型 | 待验证；S01 排产表；S02 §6.3 | 多单排产、拆合、日期约束、状态保护、影响计划 |
| OP22 | 把订单构件纳入排产 | submitSchedulingArtifacts | scheduling_id、order_id、artifacts_ids（逗号串示例） | 待验证；S01 L248 起 | 能否跨项目、重复占用、部分成功、幂等 |
| OP23 | 移除排产构件 | v1.production/removeArtifacts | 参数未给出；S02 排产段列示 | 待验证；S02 L189..223 | 是否删除生产构件，计划数量和历史如何变化 |
| OP24 | 分配/调整部门 | setDepartment、editDepartment | 无足够原始 payload | 待验证；S02 §6.3 | 构件级/节点级/计划级作用域、历史、已完工限制 |
| OP25 | 指定工艺 | setDesign | id、design_id 的文档说明 | 待验证；S01 排产表；L01 只验证读取到 design_info | 当前执行中变更是否允许、已有节点如何迁移 |
| OP26 | 下发生产 | sendProduce | id 的文档说明 | 待验证；S01、S02 §6.3 | 是否创建计划/任务/开始节点；前置部门/工艺/审批；重复下发 |
| OP27 | 生产文件同步 | syncProduction | scheduling_id、file_id 的文档说明 | 待验证；S01 排产表 | 是覆盖、合并还是增量；保留状态/关联的规则 |
| OP28 | 生产 Excel 解析/字段编辑 | v2.production/parserExcelData、editArtifactData | parserExcelData(file_id)；编辑 payload 未给出 | 待验证；S01、S02 §6.4 | 解析是否落库，字段校验、单位、修改范围 |
| OP29 | 过程推进/报工 | updateProcess | id、ids、status 的文档示例；其作用域未验证 | 待验证；S01 L260 起；S02 §6.5 | status=1 的语义、节点选择、幂等、扫码、报工人数/数量 |
| OP30 | 过程撤销 | cancelProcess | 参数未知；旧文档列为过程能力 | 待验证；S02 L275..317 | 能撤销哪个节点、下游回退、已发运保护、真实审计 |
| OP31 | 删除计划 | delPlan | 参数和实际效果未知 | 待验证；S02 §6.4 | 物理删除、撤销下发或归档；订单/排产回滚 |
| OP32 | 隐藏报检单 | hideInspection | 无 payload；仅报检段列示 | 待验证；S02 §6.6；L01 /17 已读到 hide=0 | 隐藏不等于删除或撤销；何种角色能见、可否恢复 |
| OP33 | 创建/删除包件 | createPackage、delPackage | 无足够请求样本 | 待验证；S02 §6.7 | 构件资格、项目/订单归属、包件编号和删除后的成员 |
| OP34 | 包件增删成员 | addPackageArtifacts、removePackageArtifacts | S01 记载已有外部项目抓包，但当前未持有其原始请求 | 待验证；S01 打包流程；S02 §6.7 | 互斥占用、已发运保护、同构件重入、空包 |
| OP35 | 新增/删除月度统计配置 | addStatisticalMonth、delStatisticalMonth | 无原始 payload；旧文档称统计模板 | 待验证；S02 §7.4 | 删除模板是否影响历史结果，统计重算和版本 |
| OP36 | 审核、驳回、复检、发运提交/撤回、签收 | **尚未取得可确认的写接口与操作证据** | 报检字段和已撤销状态只能证明数据存在 | 待验证；L01 /17、S02 §11 | 不把 updateProcess、submitArtifacts、sendProduce 或 hideInspection 直接解释成审批 |

## 3. 可从现有证据确认的规则与边界

| 规则/观察 | 等级 | 证据 | 属于哪一层 |
|---|---|---|---|
| API 可 HTTP 200 但业务 code=-1 | 已验证 | S14 /probeResults/1..5 | 接口协议；业务失败需看 code |
| 报检列表请求未显式传部门，响应仍含部门过滤 | 已验证 | L01 /17 /data/map | 账号可见性样本；完整授权规则待验证 |
| 同一构件编号可对应多 GUID | 已验证 | S15 /orders/0/samples/matched | 数据反例；不能建编号全局唯一规则 |
| 生产构件不同视图共享 id，且显式关联订单构件 | 已验证 | L01 /6、/9、/12 | 原平台身份关系样本 |
| 本仓构件数量<=0 时跳过；订单桥接歧义时拒绝 | 已验证 | S03 L400、S06 L121 | **本地采集规则**，不是源系统输入约束 |
| 本仓从状态文本提取时间、负责人标签并生成状态事件 | 已验证 | S03 L431..623 | **本地解释**，不能补齐真实报工操作 |
| 采集发现原已完成字段消失，可生成 API_MISSING_ROLLBACK | 已验证 | S03 L630..678 | **本地派生回退**，不证明原用户执行 cancelProcess |
| 月报采用上月26日至本月25日，分段直接取 API，失败停止 | 已验证 | S08、S19、STATUS.md | **本仓核算实现**，原平台全局财务月定义待验证 |
| “先质检再入库再包装再发运”“同一构件只能一个有效包”“已发货不可撤销” | 待验证 | S02 §6/§8 为建议约束，未有操作反例/错误码证据 | 不能当原系统已实现规则 |

## 4. 操作契约补采模板

下一阶段每个操作记录：操作人角色、页面入口/按钮、目标对象和 ID 命名空间、操作前完整状态、实际请求、HTTP/业务码、操作后各关联对象、可见副作用、撤销方式、幂等与并发结果、证据文件及采集时间。**待验证**的业务规则只有获得正例和反例后才能升级；浏览器只读观察无法确认写操作是否受服务端强制约束。
