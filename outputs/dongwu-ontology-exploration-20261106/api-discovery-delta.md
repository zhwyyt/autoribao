# API 发现增量与逐路径映射

日期：2026-11-06。本文区分实际成功读取与前端路径声明。业务功能只在真实页面、参数和响应能够支持时标为已验证；其余保持旧证据等级或待验证。

## 1. 统计口径

| 范围 | 数量 | 含义 |
|---|---:|---|
| 上一阶段保留路径 | 92 | 历史证据分级清单，不都是成功调用 |
| 本轮前端声明路径 | 163 | 18份实际加载脚本中的不同字面路径 |
| 相对旧清单新增声明 | 88 | 仅提供发现线索，不按名称补业务含义 |
| 旧清单与前端声明并集 | 180 | 路径资产并集，不是可用API总数 |
| 本轮独立成功保留响应 | 83 | 84条记录排除1条重复；不含登录等准备请求 |
| 本轮成功不同路径 | 22 | HTTP200且code=0 |
| 成功路径中旧清单没有的路径 | 5 | 3个工艺读取、2个人员筛选读取 |

命名空间仅是接口技术分组，不等于业务模块；多个路径可能服务同一实体或视图。相同路径的不同参数范围不重复计为多个API。未执行写操作。

## 2. 本轮成功读取与业务功能

以下功能判断均为**已验证（指定页面/样本）**。响应字段并集包含展示字段和派生字段，不直接构成实体属性定义；参数以每次实际请求为准。

| 路径 | 业务功能 | 本轮保留响应数 | 实际请求/响应位置 |
|---|---|---:|---|
| `/v1.design/getDesign` | 工艺定义详情：主记录与序列化图 | 3 | [证据](evidence/remaining.json) `/requests/1`；全部见请求索引 |
| `/v1.design/getDesignMenu` | 设计页面的工艺图与节点菜单 | 1 | [证据](evidence/detail-pages.json) `/requests/15`；全部见请求索引 |
| `/v1.design/getList` | 工艺流程页面列表 | 1 | [证据](evidence/pages.json) `/requests/27`；全部见请求索引 |
| `/v1.order/getDeliveryHistory` | 历史页面的入库/出库范围明细 | 2 | [证据](evidence/remaining.json) `/requests/10`；全部见请求索引 |
| `/v1.order/getDeliverys` | 发货页面列表及单头计数 | 1 | [证据](evidence/pages.json) `/requests/18`；全部见请求索引 |
| `/v1.order/getOrderArtifacts` | 订单构件明细；身份联结目标 | 4 | [证据](evidence/identity.json) `/requests/0`；全部见请求索引 |
| `/v1.order/getPackageArtifacts` | 包箱成员明细 | 4 | [证据](evidence/remaining.json) `/requests/5`；全部见请求索引 |
| `/v1.order/getPackageInfo` | 包箱单头与发货引用 | 4 | [证据](evidence/remaining.json) `/requests/4`；全部见请求索引 |
| `/v1.order/getPackageList` | 打包页面列表 | 1 | [证据](evidence/pages.json) `/requests/15`；全部见请求索引 |
| `/v1.production/getInspectionInfo` | 报检详情：单头、成员、结果和展示元数据 | 6 | [证据](evidence/details.json) `/requests/14`；全部见请求索引 |
| `/v1.production/getInspections` | 报检列表与状态/范围筛选 | 4 | [证据](evidence/details.json) `/requests/17`；全部见请求索引 |
| `/v1.production/getPlan` | 生产计划及任务页共同使用的计划头 | 7 | [证据](evidence/details.json) `/requests/6`；全部见请求索引 |
| `/v1.production/getPlanArtifacts` | 完整计划构件明细 | 5 | [证据](evidence/details.json) `/requests/7`；全部见请求索引 |
| `/v1.production/getPlans` | 生产计划列表 | 2 | [证据](evidence/details.json) `/requests/0`；全部见请求索引 |
| `/v1.production/getSchedulings` | 排产列表，页面区分未下发/已下发 | 2 | [证据](evidence/details.json) `/requests/5`；全部见请求索引 |
| `/v1.production/getTaskArtifacts` | 计划中当前任务/我的任务的构件子集 | 4 | [证据](evidence/followup.json) `/requests/0`；全部见请求索引 |
| `/v1.production/getTasks` | 任务列表，按 current/my/all 范围查询 | 5 | [证据](evidence/details.json) `/requests/1`；全部见请求索引 |
| `/v1.project/getProjectSelect` | 项目筛选选项 | 7 | [证据](evidence/pages.json) `/requests/1`；全部见请求索引 |
| `/v1.user/getBranchs` | 页面部门筛选选项 | 4 | [证据](evidence/pages.json) `/requests/4`；全部见请求索引 |
| `/v1.user/getInfo` | 当前账号、部门及权限声明 | 14 | [证据](evidence/pages.json) `/requests/0`；全部见请求索引 |
| `/v1.user/getInspectionUsers` | 报检页面人员筛选选项 | 1 | [证据](evidence/pages.json) `/requests/23`；全部见请求索引 |
| `/v1.user/getPlanUsers` | 计划页面人员筛选选项 | 1 | [证据](evidence/pages.json) `/requests/2`；全部见请求索引 |

完整请求参数、业务码与定位见 [request-index.json](evidence/request-index.json)。本轮读取不证明创建、审核、删除等同模块命令可用。

## 3. 180个路径逐项对照

“读取已验证”只覆盖本次列出的读取行为；“声明已验证/业务待验证”只证明代码出现该字面量。旧分类来自上一阶段，继承其证据边界，不是重新验证。偏移按Unicode字符从0起。

| 路径 | 本轮等级 | 旧清单分类 / 新增 | 精确来源 |
|---|---|---|---|
| `/delivery/info` | 沿用旧证据；本轮未验证 | M10 文件解析与输出 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A001 |
| `/file/upload` | 沿用旧证据；本轮未验证 | M10 文件解析与输出 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A002 |
| `/index/getMainPlans` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/b2567a125c38.js) 字符9721 |
| `/index/getMainProject` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/b2567a125c38.js) 字符9512 |
| `/index/getMainTeam` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/b2567a125c38.js) 字符9928 |
| `/index/getPlanArtifacts` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/b2567a125c38.js) 字符10134 |
| `/v1.design/addDesign` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符213153 |
| `/v1.design/addFeature` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符215248 |
| `/v1.design/addManage` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符214206 |
| `/v1.design/delDesign` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符213361 |
| `/v1.design/delFeature` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符214830 |
| `/v1.design/delManage` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符214622 |
| `/v1.design/delManageFeatures` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符216521 |
| `/v1.design/getAllManages` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符213569 |
| `/v1.design/getDesign` | 读取已验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符212524 |
| `/v1.design/getDesignMenu` | 读取已验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符212732 |
| `/v1.design/getDesigns` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符212315 |
| `/v1.design/getFeature` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符215667 |
| `/v1.design/getFeatures` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符215876 |
| `/v1.design/getList` | 读取已验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符212109 |
| `/v1.design/getManage` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符214414 |
| `/v1.design/getManageFeatures` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符216086 |
| `/v1.design/getManages` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符213997 |
| `/v1.design/getProcessAndType` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符213781 |
| `/v1.design/saveDesign` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符212944 |
| `/v1.design/saveFeature` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符215457 |
| `/v1.design/saveManage` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符215039 |
| `/v1.design/submitManageFeatures` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/770141483cd2.js) 字符216302 |
| `/v1.order/add` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符16277 |
| `/v1.order/addCalculate` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符23806 |
| `/v1.order/addPackageArtifacts` | 声明已验证／业务待验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符22697 |
| `/v1.order/addSubwork` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符19551 |
| `/v1.order/addTransfer` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符26723 |
| `/v1.order/completeCalculate` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符26086 |
| `/v1.order/completeSubwork` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符21362 |
| `/v1.order/createPackage` | 声明已验证／业务待验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符22009 |
| `/v1.order/del` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符16710 |
| `/v1.order/delCalculate` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符24257 |
| `/v1.order/delPackage` | 声明已验证／业务待验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符23583 |
| `/v1.order/delSubwork` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符20222 |
| `/v1.order/delTransfer` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符26947 |
| `/v1.order/downArtifacts` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符19164 |
| `/v1.order/downCodes` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符19356 |
| `/v1.order/downPackageCodes` | 声明已验证／业务待验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符23381 |
| `/v1.order/edit` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符16493 |
| `/v1.order/editCalculate` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符24031 |
| `/v1.order/editSubwork` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符19998 |
| `/v1.order/editTransfer` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符27171 |
| `/v1.order/exportCalculate` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符26316 |
| `/v1.order/exportSubwork` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符21590 |
| `/v1.order/exportTransfer` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符28077 |
| `/v1.order/getAllOrder` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符18087 |
| `/v1.order/getCalculate` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符24708 |
| `/v1.order/getCalculateAdd` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符25162 |
| `/v1.order/getCalculateInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符24933 |
| `/v1.order/getCalculates` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符24482 |
| `/v1.order/getDeliveryHistory` | 读取已验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符17856 |
| `/v1.order/getDeliverys` | 读取已验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符17631 |
| `/v1.order/getInfo` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符16926 |
| `/v1.order/getList` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符17411 |
| `/v1.order/getOrderArtifacts` | 读取已验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符18524 |
| `/v1.order/getPackageArtifacts` | 读取已验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符22929 |
| `/v1.order/getPackageInfo` | 读取已验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符22235 |
| `/v1.order/getPackageList` | 读取已验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符21782 |
| `/v1.order/getSubwork` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符17167 |
| `/v1.order/getSubworkInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符20445 |
| `/v1.order/getSubworks` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符19774 |
| `/v1.order/getTransfer` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符27397 |
| `/v1.order/getTransferInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符27622 |
| `/v1.order/getTransfers` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符27851 |
| `/v1.order/getUnArtifacts` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符18952 |
| `/v1.order/removeArtifacts` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符18739 |
| `/v1.order/removeCalculateInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符25854 |
| `/v1.order/removePackageArtifacts` | 声明已验证／业务待验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符23161 |
| `/v1.order/removeSubworkInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符21132 |
| `/v1.order/searchCalculateInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符25390 |
| `/v1.order/searchPackageArtifacts` | 声明已验证／业务待验证 | M08 包装与发运 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符22462 |
| `/v1.order/searchSubworkInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符20672 |
| `/v1.order/submitArtifacts` | 声明已验证／业务待验证 | M03 订单与构件范围 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符18311 |
| `/v1.order/submitCalculate` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符26510 |
| `/v1.order/submitCalculateInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符25622 |
| `/v1.order/submitSubworkInfo` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符20902 |
| `/v1.production/addScheduling` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符9161 |
| `/v1.production/cancelProcess` | 声明已验证／业务待验证 | M06 过程执行 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符12903 |
| `/v1.production/delPlan` | 声明已验证／业务待验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符14197 |
| `/v1.production/delScheduling` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符9624 |
| `/v1.production/downloadInspection` | 声明已验证／业务待验证 | M07 报检与质量 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符15924 |
| `/v1.production/downloadInspections` | 声明已验证／业务待验证 | M07 报检与质量 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符15702 |
| `/v1.production/editDepartment` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符12044 |
| `/v1.production/editScheduling` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符9392 |
| `/v1.production/exportProduction` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符14618 |
| `/v1.production/getInspectionArtifactsCodes` | 声明已验证／业务待验证 | M07 报检与质量 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符10733 |
| `/v1.production/getInspectionInfo` | 读取已验证 | M07 报检与质量 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符16145 |
| `/v1.production/getInspections` | 读取已验证 | M07 报检与质量 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符15485 |
| `/v1.production/getPlan` | 读取已验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符8512 |
| `/v1.production/getPlanArtifactCode` | 声明已验证／业务待验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符10511 |
| `/v1.production/getPlanArtifacts` | 读取已验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符10080 |
| `/v1.production/getPlanArtifactsCodes` | 声明已验证／业务待验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符10299 |
| `/v1.production/getPlanUnCompleteArtifacts` | 声明已验证／业务待验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符15256 |
| `/v1.production/getPlans` | 读取已验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符13986 |
| `/v1.production/getProductionArtifacts` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符9855 |
| `/v1.production/getProductionTasks` | 声明已验证／业务待验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符15035 |
| `/v1.production/getScheduling` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符8296 |
| `/v1.production/getSchedulingDesign` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符8722 |
| `/v1.production/getSchedulings` | 读取已验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符8944 |
| `/v1.production/getTaskArtifacts` | 读取已验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符10951 |
| `/v1.production/getTaskArtifactsCodes` | 声明已验证／业务待验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符11170 |
| `/v1.production/getTasks` | 读取已验证 | M05 生产计划与任务视图 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符14407 |
| `/v1.production/hideInspection` | 声明已验证／业务待验证 | M07 报检与质量 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符16365 |
| `/v1.production/removeArtifacts` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符11382 |
| `/v1.production/sendProduce` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符12473 |
| `/v1.production/setDepartment` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符11828 |
| `/v1.production/setDesign` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符12261 |
| `/v1.production/submitSchedulingArtifacts` | 声明已验证／业务待验证 | M04 排产与工艺配置 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符11600 |
| `/v1.production/syncProduction` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符14818 |
| `/v1.production/updateProcess` | 声明已验证／业务待验证 | M06 过程执行 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符12687 |
| `/v1.project/add` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符1368 |
| `/v1.project/addProjectFiles` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符3645 |
| `/v1.project/addProjectFolder` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符3414 |
| `/v1.project/confirmProjectDocument` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符5040 |
| `/v1.project/del` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符1805 |
| `/v1.project/delProjectFile` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符3875 |
| `/v1.project/downProjectDesign` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符2949 |
| `/v1.project/edit` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符1586 |
| `/v1.project/editProjectFile` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符4104 |
| `/v1.project/getInfo` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符2023 |
| `/v1.project/getList` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符2266 |
| `/v1.project/getProjectArtifacts` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符5277 |
| `/v1.project/getProjectFiles` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符2719 |
| `/v1.project/getProjectSelect` | 读取已验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符2488 |
| `/v1.project/refreshProjectToken` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符4806 |
| `/v1.project/removeProjectDocument` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符4570 |
| `/v1.project/searchProjectFiles` | 声明已验证／业务待验证 | M02 项目与设计资料 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符3181 |
| `/v1.project/submitProjectDocument` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/002dd9cc0ed4.js) 字符4334 |
| `/v1.statistical/addStatisticalMonth` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A068 |
| `/v1.statistical/delStatisticalMonth` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A069 |
| `/v1.statistical/getMonthList` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A070 |
| `/v1.statistical/getStatisticalArtifacts` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A071 |
| `/v1.statistical/getStatisticalArtifactsByOpenid` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A072 |
| `/v1.statistical/getStatisticalData` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A073 |
| `/v1.statistical/getStatisticalDay` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A074 |
| `/v1.statistical/getStatisticalDayInfo` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A075 |
| `/v1.statistical/getStatisticalDays` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A076 |
| `/v1.statistical/getStatisticalDelivery` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A077 |
| `/v1.statistical/getStatisticalMonth` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A078 |
| `/v1.statistical/getStatisticalQuality` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A079 |
| `/v1.statistical/getStatisticalQualityArtifacts` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A080 |
| `/v1.statistical/getStatisticalTeamArtifacts` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A081 |
| `/v1.statistical/getStatisticalTeamData` | 沿用旧证据；本轮未验证 | M09 统计与报表 | [旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) A082 |
| `/v1.user/addBranch` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符75758 |
| `/v1.user/addRole` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符76643 |
| `/v1.user/addUser` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符73986 |
| `/v1.user/banBranch` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符76422 |
| `/v1.user/banUser` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符77520 |
| `/v1.user/delBranch` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符76201 |
| `/v1.user/delRole` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符77082 |
| `/v1.user/delUser` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符77301 |
| `/v1.user/editBranch` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符75979 |
| `/v1.user/editRole` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符76862 |
| `/v1.user/editUser` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符74205 |
| `/v1.user/getAllRole` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符78178 |
| `/v1.user/getBranch` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符74644 |
| `/v1.user/getBranchs` | 读取已验证 | M01 身份与组织 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符74865 |
| `/v1.user/getInfo` | 读取已验证 | M01 身份与组织 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符73665 |
| `/v1.user/getInspectionUsers` | 读取已验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符75311 |
| `/v1.user/getList` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符73767 |
| `/v1.user/getPlanUsers` | 读取已验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符75087 |
| `/v1.user/getRole` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符77739 |
| `/v1.user/getRoles` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符77958 |
| `/v1.user/getUser` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符74425 |
| `/v1.user/getUserSelect` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符75540 |
| `/v1.user/login` | 声明已验证／业务待验证 | M01 身份与组织 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符73513 |
| `/v1.user/logout` | 声明已验证／业务待验证 | 新增；业务归类待验证 | [脚本](evidence/frontend/68bf3ebfc358.js) 字符73592 |
| `/v2.production/downTaskOrder` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符13119 |
| `/v2.production/downTaskOrderQr` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符13335 |
| `/v2.production/downTaskOrders` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符13553 |
| `/v2.production/downTaskPlans` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符13770 |
| `/v2.production/editArtifactData` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符17018 |
| `/v2.production/getArtifactData` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符16800 |
| `/v2.production/parserExcelData` | 声明已验证／业务待验证 | M10 文件解析与输出 | [脚本](evidence/frontend/1fb81bb1f119.js) 字符16582 |

所有声明出现位置见 [frontend-declarations-all.json](evidence/frontend-declarations-all.json)。原始脚本 URL、加载页面和 SHA-256 见 pages.json/detail-pages.json 的 assets。先前 frontend-endpoints.json 是列表页阶段的中间索引，最终完整索引以本文件链接为准。

## 4. 范围变化对接口使用的影响

| 场景 | 已验证请求差异 | 使用限制 |
|---|---|---|
| 任务列表 | model=current/my/all；遗漏model本次与all同计数 | 不用默认遗漏参数代替页面实际范围 |
| 任务详情 | getTaskArtifacts 用 type=current/my，id仍是计划ID | model与type不是同一个请求字段 |
| 报检列表 | 真实页面 all=1、hide=1、status空串 | 不将早先省略参数的count=1视作全量 |
| 报检状态筛选 | status=-1本次返回全部口径，响应-1另有撤销含义 | 哨兵值与业务状态分开解释 |
| 排产列表 | is_produce=0返回0，1返回9068 | 页面默认空范围不证明模块不存在 |
| 报检详情 | 单头plan_id可多值；list.plan_id逐条具体归属 | 不能从列表单值字段构造强制单计划关系 |
| 历史列表 | type=2/3要求日期范围；保留秒级原始值 | 日期边界/时区未完全验证 |

上述证据位置汇总见 [探索报告](exploration-report.md)。旧20个纯探测候选和明确否定路径不因本轮有更多声明就自动视为有效；需要逐个建立新的对应证据。
