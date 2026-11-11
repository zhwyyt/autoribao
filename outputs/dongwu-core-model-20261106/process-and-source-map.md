# 工艺功能覆盖与源字段映射

日期：2026-11-06。本文区分业务机制已确认、页面配置已读取、写行为未实测三个层次。证据编号在文末，规则BR-01～08见[核心本体](core-business-model.md)。

## 1. 工艺部分实际已覆盖的内容

| 模块/功能 | 已读取内容与证据 | 等级及未验证边界 |
|---|---|---|
| 工艺流程列表 `/design/process` | 前轮getList返回5个工艺记录；读取31正式钢构、22流水线、30清库存定义 | 已验证〔读取〕H01/H02；未穷尽所有历史工艺 |
| 流程设计页 `/design/process/design?id=31` | getDesignMenu返回图及节点菜单；开始、过程、结束节点及连线可见 | 已验证〔页面/读取〕H03；保存流程、编辑连线后的影响未执行 |
| 工序管理 `/design/manage` | 本轮完整8条工序目录，字段含类型、quality、使用数、特征数；页面有特征管理/编辑/删除入口 | 已验证〔页面/目录〕C03/C05；编辑/删除及关联保护未执行 |
| 特征管理 `/design/feature` | 本轮完整9条特征，包含GJG/lsx/zh/FXC/ZFJ/PEC/qkc/xc/WX | 已验证〔页面/目录〕C03/C05；新增/修改代码、停用后的影响未执行 |
| 工序特征管理 `/design/manage/features?id=50` | 实际请求带id、keyword、exist=1、page、size；完整返回4条关联 | 已验证〔页面/读取〕C04 `/requests/1`；关联/解除关联操作未执行 |
| 工序特征管理 `id=25` | count=6；JSON保存前5条，页面显示6个码，包括WX | 已验证〔页面〕C04 `/pages/1`；JSON不是完整6行，不能以缺失第6条作不存在证据 |
| 计划内展开工艺 | plan.design_info含节点features_codes，构件process_items含执行信息 | 已验证〔响应结构〕C01；展开数据是否固定快照、配置修改是否回溯仍待验证 |
| 根据生产特征选适用工序 | 用户确认；FXC配置、27条执行记录与解释一致 | 已验证〔用户机制+样本〕U04/U05、C01/C04/C05；未验证服务器所有选路分支 |

以上已经覆盖工艺定义、工序目录、生产特征和关联配置的核心读取路径。写入接口出现或按钮可见，只证明入口存在，不证明保存后的业务效果。

## 2. 当前读取到的字典与关联

**已验证〔C05〕**：工序目录8条：1开始、25涂装、26成品库、36装焊质检、42装焊报检、43流水线报工、45转运、50装焊探伤。生产特征目录9条：GJG钢结构、lsx组焊上线、zh组焊不上线、FXC发现场散件、ZFJ直发件、PEC构件、qkc清库存、xc型材加工、WX外协。

目录包含某项不等于首期必须开发该业务，尤其流水线已由用户明确为半成品完成，排除成品入库映射。

| 节点 | 计划9097展开配置中的features_codes | 独立配置页面核对 |
|---|---|---|
| 1 开始 | GJG、lsx、zh、FXC、ZFJ、PEC、qkc、xc、WX | 本轮目录存在；独立关联页未补读 |
| 42 装焊报检 | GJG、lsx、zh、FXC、ZFJ、PEC | 本轮目录存在；独立关联页未补读 |
| 50 装焊探伤 | GJG、lsx、zh、PEC | 独立关联页完整4条，与展开配置一致，不含FXC |
| 36 装焊质检 | GJG、lsx、zh、FXC、PEC | 本轮目录存在；独立关联页未补读 |
| 25 涂装 | GJG、lsx、zh、FXC、ZFJ、WX | 独立关联页显示6条，与展开配置一致；API保留样本5条 |

表中配置值均为**已验证〔采集〕**：C01 `/requests/10/data/design_info` 解码后的nodeList；C04的两个页面与请求。不能据此声称已确认历史配置版本或所有特征的最终业务完工条件。PEC等特殊组合仍按配置解释，不另写猜测规则。

## 3. 关键字段映射与禁用捷径

| 目标概念 | 源字段/位置 | 可采用的解释与等级 | 不能直接采用的捷径 |
|---|---|---|---|
| 源构件身份 | 订单构件id、生产id、order_artifacts_id | 已验证：两套记录ID分离并可显式联结；C01/C02 | 编号相同就合并；GUID全局唯一 |
| 构件生产特征 | 明细“生产特征”；目录id/code/name | 已验证原值存在；fxc/FXC等大小写对照为较高可信映射 | 无条件将所有代码lower后认定等同；缺码时按GJG默认 |
| 工序适用性 | 工序关联配置、展开节点features_codes | 已验证机制及字段；结合用户规则解释 | 某节点无completed即视为可跳过 |
| 工序完成 | process_items[].completed/time | 已验证快照证据；须按节点与工艺解释 | state=success即完成；单凭中文显示列非空即完成 |
| 工艺内完成 | is_complete、node_end、node_current | 已验证：相同is_complete=1存在多个结束节点 | is_complete=1一律等于成品入库 |
| 目标成品入库 | 适用流程完成＋涂装完成；BR-04/07/08 | 已验证业务定义；源映射须限定工艺语境 | 把流水线转运完成计成成品入库；把装焊报检计成入库 |
| 入库业务时间 | 涂装执行时间、complete_time候选 | 正常涂装样本29/29与complete_time按UTC+8转换值相同，已验证样本；C01 | 把update_time直接当业务时间；把0当1970年；任意替换原始时间 |
| 原构件封存 | 当前未取得明确源字段/操作证据 | 已验证用户定义；源映射待验证 | status=1或change=0就解释成未封存；is_change=1就解释为重制 |
| 补制来源关联 | 当前候选仅能回到订单构件 | 明确order_artifacts_id是订单明细引用，已验证 | 将其误当“原构件ID”；从名称“补做”自动生成重制关系 |
| 质量结果 | 报检单status及成员inspection_status、质检/探伤字段组 | 前轮已验证不同结果快照 | 给不适用探伤的FXC伪造一条“探伤通过” |
| 包装/发运 | package_id、delivery_id及单头/成员计数 | 前轮已验证关系与不同计量层级 | artifacts_count直接当实物数；固定减1 |

## 4. 完成与时间的正反例

| 样本 | 已验证事实 | 映射结论 |
|---|---|---|
| 计划5984、7097，合计2条 | end=25，涂装完成，所有节点均有完成；complete_time与涂装时间一致 | 本轮普通工艺的正例；不证明名称“补做/补充”就是已确认重制 |
| 计划9097，27条 | 原始特征fxc，end=25，涂装完成；探伤无完成记录；is_complete=1 | 已验证；与用户“发现场不需探伤”和配置相符，不能要求每个图节点都完成 |
| 计划9154，20条 | 涂装中文列只有部门标签，无完成时间；is_complete=0 | 已验证反例：显示列非空并不表示工序已完成 |
| 计划8819，259条 | end=45转运，is_complete=1，无涂装节点 | 已验证采集；用户确认这是半成品完成，排除成品入库映射 |
| 计划4362，146条 | 清库存工艺，end=26成品库，无涂装节点；is_complete=1 | 已验证旧数据；历史/库存调整映射待验证，不自动编造涂装完成 |
| 同计划构件865391 | complete_time转换为09:29:33，结束节点时间09:29:32，相差1秒 | 已验证：时间字段并非总是字面相等，保留各自来源；不擅自定义容差 |
| 历史计划163，87条 | is_complete=1且涂装已完成，但complete_time全部为0 | 已验证前轮样本；不得仅靠complete_time判是否完成 |

本轮6个计划共454条明细全部保存，4个订单75条明细全部保存。以上计算可由 [analysis-summary.json](evidence/analysis-summary.json) 重算。

## 5. 补件、重制、封存的检索边界

**已验证检索事实**：对前轮8479条去重计划/任务名称搜索，“补件、重制、返工、封存”无命中；“补做”2条、“补充”13条、“补料”1条。见 [candidate-search.json](evidence/candidate-search.json)。这只是名称范围的查找，不证明系统没有相关业务。

**已验证候选明细**：9154、5984、7097均is_change=0，22条生产明细的change均为0，通过order_artifacts_id能对应各自订单构件，GUID也一致。未取得“原件→新件”或“原生产状态封存”的明确字段、动作响应或时间序列。

因此，补制新身份/原状态封存继续作为**已验证〔用户规则〕**；源系统承载方式仍为**待验证**。不能把含“补做”的计划名称、change字段或订单明细引用当作替代证据。

## 6. 证据索引

| 编号 | 文件/位置 | 用途 |
|---|---|---|
| C01 | [mapping.json](evidence/mapping.json) | 6个计划头及454条完整构件明细，索引0～11 |
| C02 | [identity.json](evidence/identity.json) | 4个订单75条完整构件明细及身份对照 |
| C03 | [configuration-pages.json](evidence/configuration-pages.json) | 工序管理/特征管理两个页面及4条实际请求 |
| C04 | [feature-pages.json](evidence/feature-pages.json) | 探伤/涂装关联页面；exist=1为实际页面参数 |
| C05 | [configuration.json](evidence/configuration.json) | 完整8条工序、9条特征目录 |
| C06 | [analysis-summary.json](evidence/analysis-summary.json) | 数量、时间、身份与配置核对结果 |
| H01 | [前轮列表页](../dongwu-ontology-exploration-20261106/evidence/pages.json) `/requests/27` | 工艺流程列表 |
| H02 | [前轮定义查询](../dongwu-ontology-exploration-20261106/evidence/remaining.json) `/requests/1..3` | 工艺31/22/30定义 |
| H03 | [前轮设计页](../dongwu-ontology-exploration-20261106/evidence/detail-pages.json) `/requests/15`、`/pages/5` | 工艺图、节点菜单与页面功能 |
| H04 | [历史计划样本](../dongwu-ontology-exploration-20261106/evidence/details.json) `/requests/13` | 87条complete_time为0的已完成记录 |

数组索引从0起；JSON字符串design_info需先解码。流程节点编号在本样本中与工序目录id对应；跨租户/跨系统唯一性未验证。

## 7. 补采限制

26条实际成功读取已留存，涉及7个不同路径，详见 [request-index.json](evidence/request-index.json)。另外计划补读1/25/36/42四个工序的关联列表，自动审批审核两次超时，进程未启动，未计入成功请求。已有计划展开配置和两页直接关联配置仍保留各自证据等级；没有把未执行请求写成已完成。
