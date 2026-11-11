# 业务实体目录

日期：2026-11-06。引用约定：`L01 /n` 简写表示新采集文件的 `/requests/n`（从 0 起）；多项区间表示分别查看这些请求。证据索引见 [系统资产清单](system-inventory.md#8-证据索引)。本目录区分“现实业务概念”“源系统记录/关系”“接口视图”“本地采集对象”。实体存在、字段存在、唯一性和关系基数分别判断。

## 1. 实体与资源对象

| ID | 对象及分类 | 身份依据 / 主要字段 | 结论等级与证据 | 不能直接采用的假定 |
|---|---|---|---|---|
| E01 | 项目：业务实体 | 云 id；code/name；计划/实际日期；status/completed；head_person | 已验证（本次样本）；L01 /requests/2..3 | code 全局唯一、负责人必为自然人、status=业务完结 |
| E02 | 订单：业务单据 | id、project_id、code、name、category/source、order_status、日期 | 已验证（记录）；L01 /requests/10..11。订单的商业合同含义待验证 | 一定等于销售订单；0 一定表示未开始；scheduling_count 等于实际排产数 |
| E03 | 物理构件：企业业务概念候选 | 编号、规格、模型标识、数量、尺寸、重量、部位；跨资源 GUID 线索 | 较高可信推断；L01 /requests/6、/12、/15 与 S06 | 每行必为一件实物；GUID 全局唯一；跨计划重复必为同一件实物 |
| E04 | 订单构件记录：业务明细/范围关系 | id、order_id、project_id、guid、scheduling_id、package_id、delivery_id | 已验证；L01 /requests/12、S14 /probeResults/0 | 与生产构件 id 相同；is_package=1 的包件壳应计为实物 |
| E05 | 排产：生产组织单据 | id、project_id、plan_id、design_id、departments、scheduling_status | 已验证；L01 /requests/7 | 排产与计划永久一对一；待开始表示尚无生产计划 |
| E06 | 生产计划：执行单据 | id、scheduling_id、project_id、design_id、production_status、计划/执行日期 | 已验证；L01 /requests/4..5 | 计划状态可替代每个构件状态；所有计划相同工艺 |
| E07 | 生产构件记录：计划内执行记录 | id、plan_id、scheduling_id、order_id、order_artifacts_id、guid、process_items | 已验证；L01 /requests/6、/9 | 必须独立于物理构件建新实体；和订单构件共享 ID |
| E08 | 工艺定义：业务配置 | plan/scheduling.design_id；design_info.name/nodeList/lineList | 已验证（嵌入定义）；L01 /requests/4..7、S12 /probeResults/3 | design_id 是图纸文件 ID；存在不可变版本号；所有定义边都是必经边 |
| E09 | 工序节点：工艺定义组成部分 | id/name/type/quality/features_codes；lineList.from/to | 已验证（结构）；L01 /requests/4、S12 /probeResults/3 | 节点 id 在所有工艺全局唯一；quality 数字就是检查结果 |
| E10 | 节点执行事实：构件工序快照 | process_items[].completed/time/department/opt_user；node_current | 已验证（快照）；L01 /requests/6。完整事件流水为待验证 | API 已提供不可变事件日志；state=success 即完成 |
| E11 | 组织单元：业务实体 | id、pid、children、name、is_production、director、category | 已验证；L01 /requests/1 | 树的每一层固定等于厂/车间/班组；is_production=1 才能被分配 |
| E12 | 人员/系统用户：业务参与者与账号记录 | user.id、department、role、account/mobile、is_admin | 已验证（账号样本）；L01 /requests/0。自然人与账号一对一待验证 | operator、create_user、director 均指同一账号资源且无外部人员 |
| E13 | 报检单：质量业务单据 | id/code、plan_id/project_id、status、submit/inspection/flaw 字段、artifact_count | 已验证；L01 /requests/17 | 只存在当前可见 1 条；状态 -1 的前置状态或撤销权限已确定 |
| E14 | 包件：物流归组实体 | id、guid、is_package=1、delivery_id、artifacts_count | 已验证；L01 /requests/13..14 | 包件必须属于单个订单；order_id=0 表示数据错误 |
| E15 | 发运单：物流业务单据 | id/code/name、project_id、vehicle、date_str/serial_no、artifacts_count | 已验证；L01 /requests/16 | 已发货=已签收；artifacts_count 直接等于包内实物数 |
| E16 | 文件/设计资料：信息资产候选 | file_id、headers、columns；上传及解析接口为文档记载 | 较高可信推断（文件引用）；L01 /requests/6、/12、S01/S02 §6.1 | 每个 file_id 是工艺图纸；版本和导入批次语义已确认 |
| E17 | 生产任务：实体身份待定 | getTasks 返回计划风格 id、scheduling_id、design_info | 待验证（独立实体性）；已验证视图存在。L01 /requests/18 | 必须新增独立 task_id 或计划下必然一对多任务 |
| E18 | 质量检查结果：实体或报检属性待定 | inspection_user/time/desc、flaw_user/time/desc/sign | 待验证（独立实体）；已验证字段存在。L01 /requests/17 | inspection 与 flaw 是同一个状态轴；通过/不通过枚举已知 |
| E19 | 角色/权限：授权配置 | role、role_permission 路由及动作标识 | 已验证（声明）；L01 /requests/0。角色目录、授权关系待验证 | 菜单可见即后端允许；is_admin 绕过所有部门过滤 |
| E20 | 统计模板/月统计：配置/投影候选 | 旧文档月→日→部门下钻说明，未见稳定字段样本 | 待验证；S02 §7.4 | 每份报表都是业务单据；月度结果一定保存快照 |

## 2. 不作为独立企业业务实体的资源

| 对象 | 判断 | 等级 / 证据 |
|---|---|---|
| getProjectSelect、项目/订单/包件列表项 | 已有实体的选择或列表表示 | 已验证（同 id）；L01 /requests/2..3、/10..11、/13..14 |
| getProjectArtifacts | 项目范围下订单构件与排产的组合视图 | 已验证（字段）；S13 /capturedApis/4 |
| getProductionArtifacts/getPlanArtifacts | 同一生产构件记录的不同投影 | 已验证（本次样本 id=1605231 相同）；L01 /requests/6、/9 |
| headers、columns、design_column、branchs | 展示/配置元数据，不能作为物理构件或生产单据 | 已验证（返回位置）；L01 /requests/5、/8、/11 |
| 下单/计划二维码包、PDF、Excel 下载 | 单据或构件的输出表示 | 较高可信推断（说明与读取代码）；S01、S09 |
| Token、分页 count/page/size、query/map | 会话/协议/查询上下文 | 已验证（响应结构）；L01。map 可能揭示过滤，但不是企业单据 |
| 本地 order_component、component_status_event、project_name_history | 本地桥接、派生状态、审计记录；不证明原系统也有同名表 | 已验证（本地 schema/同步代码）；S03、S10、S11 |
| API_MISSING_ROLLBACK、PROCESS_API_JSON、SHIPPING_API_JSON | 采集端事件标记/快照编码 | 已验证（代码）；S03 L630、src/nightly-process-reconciliation.js、src/nightly-shipping-alignment.js |

## 3. 标识符与字段字典

下表“格式”是观察到的表示，不是正式字段类型。所有外键、必填、单位、唯一约束如无额外证据仍为待验证。完整按接口字段集合见 [API 映射](api-business-map.md#参数和响应字段索引)。

| 对象 / 字段 | 观察格式 | 有证据的含义与关联 | 等级 / 证据 |
|---|---|---|---|
| project.id / project_id / proj_id | 响应数字或数字字符串；请求字段依接口不同 | 项目引用；getAllOrder 使用 project_id，getProjectArtifacts 使用 proj_id | 已验证；L01 /2..3、S05 L102、L120 |
| project.code / name / engineer_name / sort_name | 字符串 | 编码/显示名称等；不同名称字段是否同义待验证 | 已验证字段；L01 /2..3 |
| project.head_person / head_person_name | 数字 / 文本 | 本次 head_person_name 为“钢构在建项目”，本地用它判状态 | 已验证；L01 /3、S07 L342 |
| project.status / status_name / completed | 1 / 正常 / 0 的样本 | 原生字段存在；生命周期字典待验证 | 已验证样本；L01 /3 |
| order.id / code / name | 数字 / 字符串 | 订单记录与单号；样本 id=9207，code=ZH-2448 | 已验证；L01 /10..11 |
| order.category / category_name / source / originator | 数字及配套名称 | 样本 category=2、钢构订单；来源/发起类型 | 已验证样本；L01 /10..11；全量枚举待验证 |
| order.order_status / order_status_name | 0 / 已排产 | 不使用通用“0=未开始”解释 | 已验证；L01 /10..11 |
| order.state / status / state_name | 1 / 1 / 正常 | 与 order_status 为不同字段 | 已验证；L01 /11；启停/删除含义待验证 |
| order.artifacts_count / scheduling_count | 整数 | 样本有明细 10，scheduling_count=0 却可关联排产 9504 | 已验证差异；L01 /7、/10、/12；计数定义待验证 |
| order.recipient / recipient_tel / recipient_address | 字符串，交付已脱敏 | 收货相关属性存在；不是已证明的客户实体 | 已验证字段；L01 /11 |
| order construction_order_id / construction_project_id | 数字，样本多为 0 | 外部系统关联线索 | 待验证语义；L01 /10..12、S12 /4 |
| order artifact.id | 数字 | 订单构件资源 ID；样本 1622126 | 已验证；L01 /12 |
| production artifact.id | 数字 | 生产构件资源 ID；样本 1605231 | 已验证；L01 /6、/9 |
| production.order_artifacts_id | 数字 | 样本指向订单构件 1622126，GUID 同值 | 已验证（样本联结）；L01 /6、/12 |
| artifact.guid / 构件GUID | 任意字符串，含前缀/时间/序号/扩展段 | 跨表示识别线索；不是标准 UUID 保证 | 已验证；L01 /6、/12；db/alter_component_guid_to_text.sql |
| code / 构件编号 / dode | 文本 | code/中文编号在样本对应；dode 只为本地兼容读取 | 已验证样本/代码；L01 /6、S03 L386。编号唯一性待验证 |
| name / 构件名称 | 文本 | 资源 name 可能是构件或归组名称，按资源解释 | 已验证字段；L01 /6、/12、/14 |
| model_id / 模型ID | 数字字符串，可为 0 | 模型引用线索，稳定性/外部模型版本未明 | 待验证关系；L01 /6、/12 |
| spec / 规格/型号 / specifications | 文本 | 本次包内构件用 specifications，生产/订单中文列用规格/型号；spec 见兼容代码 | 已验证表示差异；L01 /6、/12、/15、S03 L388 |
| num / 数量 / count | 数字或数字字符串 | 生产、订单、包内投影的数量字段 | 已验证字段；L01 /6、/12、/15；单件/批量语义待验证 |
| weight / 重量 / weight_all | 十进制字符串 | 主值与总值可不同；历史 43.37125 vs 43.37100 | 已验证差异；S12 /probeResults/4。单位 kg 为本地使用口径，原契约待验证 |
| length / length_all / 长度 | 数字或字符串 | 尺寸与累计字段，不能盲目求和/相乘 | 已验证字段；L01 /6；单位/计算方式待验证 |
| volume / volume_all / 体积 | 小数文本 | 当前属性字段；零值不代表无体积 | 已验证字段；L01 /6；公式待验证 |
| 生产特征 / production_feature / characteristics | GJG 等文本代码 | 样本和配置 features_codes 关联线索；并非工程构件类型的唯一分类 | 已验证字段；L01 /4、/6、/15；适用规则较高可信推断 |
| 区域部位/所在楼层 / location | 文本 | 本地对照的空间位置标签 | 已验证；L01 /6、S03 L396 |
| 轴线范围 / axis_range、构件类型编码 / component_type_code、所属布置图 | 文本，可空 | 源属性/本地映射；图纸引用是否结构化待验证 | 已验证；L01 /6、S03 L397..398 |
| scheduling.id / plan_id | 数字 | 样本排产 9504→计划 9155 | 已验证；L01 /7 |
| plan.id / scheduling_id | 数字 | 样本计划 9155→排产 9504 | 已验证；L01 /4..5 |
| design_id / design_info | 数字 / JSON 字符串 | 工艺定义引用与嵌入图；样本 design_id=31 | 已验证；L01 /4..7 |
| departments / department_current | 逗号串 / 数字 | 分配组织集合与当前组织；样本当前 240 | 已验证字段；L01 /6..7；权限/可达条件待验证 |
| node_start / node_current / node_end | 数字 | 工艺节点引用；样本 1/42/25 | 已验证字段联结；L01 /6、/4 |
| node.id / name / type / quality / features_codes | 字符串/数字/数组 | 工序定义；type=start/process/end；quality 含 0/1/2/3 | 已验证；L01 /4；quality 非检查结果字典 |
| process_items[].completed / time / opt_user / department | 部分节点有 1/时间/ID；部分字段缺失 | 节点执行快照与参与者引用 | 已验证；L01 /6。缺字段≠已撤销，历史事件不完整 |
| process_items[].state | success 文本 | 未完成节点也为 success，不能用它判完成 | 已验证反例；L01 /6 |
| data_process | JSON 字符串 | 工序信息的另一序列化表示 | 已验证字段；L01 /6；与 process_items 同步策略待验证 |
| 钢构生产开始/装焊报检/装焊探伤/装焊质检/涂装 | 人可读文本 | 计划视图含时间与括号标签，排产视图可仅部门名 | 已验证；L01 /6、/9 |
| is_deliver | “未发货”或日期+操作人文本 | 不是稳定布尔字段 | 已验证；L01 /6、S12 /4 |
| is_complete / complete_time | 0/1、0 或时间戳 | 完成标记/时间线索；包件、订单构件、生产构件须分开解释 | 已验证字段；L01 /6、/12、/14；统一含义待验证 |
| inspection.id/code/plan_id/project_id/status | 数字/字符串；-1 与已撤销 | 报检单归属与状态样本 | 已验证；L01 /17 |
| submit_department/sign；inspection_department/user/time/sign/desc；flaw_department/user/time/sign/desc | ID、时间、文本、0/null | 提交、质检、探伤的独立字段组 | 已验证字段；L01 /17；sign 资源语义待验证 |
| inspection.hide / artifact_count / map | 数字/整数/查询表达式 | 隐藏标记、构件计数、账号部门过滤条件 | 已验证；L01 /17 |
| package.id / guid / is_package | 数字 / B 开头文本 / 1 | 包件资源身份与类型标签 | 已验证；L01 /13..14；B 前缀完整规范待验证 |
| package.order_id / delivery_id | “0” / 8514 | 包件可能未绑定单个订单；已关联发运 | 已验证（样本）；L01 /14；跨订单规则待验证 |
| delivery.id/code/date_str/serial_no/vehicle | 数字/文本 | 单据身份、日期/序号和车辆信息字段 | 已验证字段；L01 /16、S09；车辆主档实体未证明 |
| create_time/update_time/start_time/end_time/real_start_time/real_end_time | 日期文本、Unix 秒、0 混用 | 多种时钟和空值约定；同名字段依资源解释 | 已验证；L01 /3..16；完整时间语义待验证 |

## 4. 本地模型的明确边界

**已验证（代码）**：本地 `component_id` 是数据库生成键；`order_component.dwyun_artifact_id` 保存订单构件云 ID；本地 `(plan_id, component_guid)` 唯一约束及 `(order_id, dwyun_artifact_id)` 唯一约束由本地 SQL 定义（S10、S11）。这些约束不证明原平台的全局唯一性。

**已验证（代码）**：本仓排除 `head_person_name` 含 PC 的项目，并跳过无法映射负责人分类的项目；数量非正的构件被同步器跳过（S07 L350、S03 L400）。所以本地库是有筛选、转换和缺失的镜像，不能充当原平台全部业务对象集合。

**待验证**：材料牌号/材质、焊缝、质量缺陷、合同金额、计价、安装部位层级等是否存在独立实体或字段。本次发现的 `process_welder` 内含 subwork_id/calculate_id/calculate_amount 只是线索（S12 /probeResults/4），不足以推导完整分包/结算实体。
