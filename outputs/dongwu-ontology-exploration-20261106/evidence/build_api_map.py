"""Build the API evidence delta, without treating declarations as verified behavior."""
import json
from pathlib import Path
P = Path(__file__).resolve().parent
load = lambda path: json.loads(path.read_text(encoding='utf-8-sig'))
summary = load(P / 'analysis-summary.json')
decl = load(P / 'frontend-declarations-all.json')
requests = load(P / 'request-index.json')
old = {x['path']: x for x in load(P.parents[1] / 'dongwu-business-inventory-20261106/_evidence/api-catalog.json')}
functions = {
 '/v1.design/getDesign': '工艺定义详情：主记录与序列化图',
 '/v1.design/getDesignMenu': '设计页面的工艺图与节点菜单',
 '/v1.design/getList': '工艺流程页面列表',
 '/v1.order/getDeliveryHistory': '历史页面的入库/出库范围明细',
 '/v1.order/getDeliverys': '发货页面列表及单头计数',
 '/v1.order/getOrderArtifacts': '订单构件明细；身份联结目标',
 '/v1.order/getPackageArtifacts': '包箱成员明细',
 '/v1.order/getPackageInfo': '包箱单头与发货引用',
 '/v1.order/getPackageList': '打包页面列表',
 '/v1.production/getInspectionInfo': '报检详情：单头、成员、结果和展示元数据',
 '/v1.production/getInspections': '报检列表与状态/范围筛选',
 '/v1.production/getPlan': '生产计划及任务页共同使用的计划头',
 '/v1.production/getPlanArtifacts': '完整计划构件明细',
 '/v1.production/getPlans': '生产计划列表',
 '/v1.production/getSchedulings': '排产列表，页面区分未下发/已下发',
 '/v1.production/getTaskArtifacts': '计划中当前任务/我的任务的构件子集',
 '/v1.production/getTasks': '任务列表，按 current/my/all 范围查询',
 '/v1.project/getProjectSelect': '项目筛选选项',
 '/v1.user/getBranchs': '页面部门筛选选项',
 '/v1.user/getInfo': '当前账号、部门及权限声明',
 '/v1.user/getInspectionUsers': '报检页面人员筛选选项',
 '/v1.user/getPlanUsers': '计划页面人员筛选选项',
}
lines = ['# API 发现增量与逐路径映射', '', '日期：2026-11-06。本文区分实际成功读取与前端路径声明。业务功能只在真实页面、参数和响应能够支持时标为已验证；其余保持旧证据等级或待验证。', '',
 '## 1. 统计口径', '',
 '| 范围 | 数量 | 含义 |', '|---|---:|---|',
 f'| 上一阶段保留路径 | {len(old)} | 历史证据分级清单，不都是成功调用 |',
 f'| 本轮前端声明路径 | {len(decl)} | 18份实际加载脚本中的不同字面路径 |',
 f'| 相对旧清单新增声明 | {len(set(decl)-set(old))} | 仅提供发现线索，不按名称补业务含义 |',
 f'| 旧清单与前端声明并集 | {len(set(old)|set(decl))} | 路径资产并集，不是可用API总数 |',
 f'| 本轮独立成功保留响应 | {summary["successfulCapturedRequests"]} | 84条记录排除1条重复；不含登录等准备请求 |',
 f'| 本轮成功不同路径 | {len(functions)} | HTTP200且code=0 |',
 f'| 成功路径中旧清单没有的路径 | {len(summary["successfulPathsNewToBaseline"])} | 3个工艺读取、2个人员筛选读取 |', '',
 '命名空间仅是接口技术分组，不等于业务模块；多个路径可能服务同一实体或视图。相同路径的不同参数范围不重复计为多个API。未执行写操作。', '',
 '## 2. 本轮成功读取与业务功能', '',
 '以下功能判断均为**已验证（指定页面/样本）**。响应字段并集包含展示字段和派生字段，不直接构成实体属性定义；参数以每次实际请求为准。', '',
 '| 路径 | 业务功能 | 本轮保留响应数 | 实际请求/响应位置 |', '|---|---|---:|---|']
for api, business in sorted(functions.items()):
    matches = [x for x in requests if x['apiPath'] == api]
    preferred = next((x for x in matches if x['file'] in ['followup.json', 'identity.json', 'remaining.json', 'details.json']), matches[0])
    lines.append(f'| `{api}` | {business} | {len(matches)} | [证据](evidence/{preferred["file"]}) `{preferred["pointer"]}`；全部见请求索引 |')
lines += ['', '完整请求参数、业务码与定位见 [request-index.json](evidence/request-index.json)。本轮读取不证明创建、审核、删除等同模块命令可用。', '',
 '## 3. 180个路径逐项对照', '',
 '“读取已验证”只覆盖本次列出的读取行为；“声明已验证/业务待验证”只证明代码出现该字面量。旧分类来自上一阶段，继承其证据边界，不是重新验证。偏移按Unicode字符从0起。', '',
 '| 路径 | 本轮等级 | 旧清单分类 / 新增 | 精确来源 |', '|---|---|---|---|']
for api in sorted(set(old) | set(decl)):
    status = '读取已验证' if api in functions else ('声明已验证／业务待验证' if api in decl else '沿用旧证据；本轮未验证')
    category = old[api]['module'] if api in old else '新增；业务归类待验证'
    if api in decl:
        occurrence = decl[api][0]
        ref = f'[脚本](evidence/{occurrence["file"]}) 字符{occurrence["offset"]}'
    else:
        ref = f'[旧目录](../dongwu-business-inventory-20261106/_evidence/api-catalog.json) {old[api]["id"]}'
    lines.append(f'| `{api}` | {status} | {category} | {ref} |')
lines += ['', '所有声明出现位置见 [frontend-declarations-all.json](evidence/frontend-declarations-all.json)。原始脚本 URL、加载页面和 SHA-256 见 pages.json/detail-pages.json 的 assets。先前 frontend-endpoints.json 是列表页阶段的中间索引，最终完整索引以本文件链接为准。', '',
 '## 4. 范围变化对接口使用的影响', '',
 '| 场景 | 已验证请求差异 | 使用限制 |', '|---|---|---|',
 '| 任务列表 | model=current/my/all；遗漏model本次与all同计数 | 不用默认遗漏参数代替页面实际范围 |',
 '| 任务详情 | getTaskArtifacts 用 type=current/my，id仍是计划ID | model与type不是同一个请求字段 |',
 '| 报检列表 | 真实页面 all=1、hide=1、status空串 | 不将早先省略参数的count=1视作全量 |',
 '| 报检状态筛选 | status=-1本次返回全部口径，响应-1另有撤销含义 | 哨兵值与业务状态分开解释 |',
 '| 排产列表 | is_produce=0返回0，1返回9068 | 页面默认空范围不证明模块不存在 |',
 '| 报检详情 | 单头plan_id可多值；list.plan_id逐条具体归属 | 不能从列表单值字段构造强制单计划关系 |',
 '| 历史列表 | type=2/3要求日期范围；保留秒级原始值 | 日期边界/时区未完全验证 |', '',
 '上述证据位置汇总见 [探索报告](exploration-report.md)。旧20个纯探测候选和明确否定路径不因本轮有更多声明就自动视为有效；需要逐个建立新的对应证据。', '']
(P.parent / 'api-discovery-delta.md').write_text('\n'.join(lines), encoding='utf-8')
print(f'Wrote {len(set(old)|set(decl))} path rows and {len(functions)} verified functional mappings.')
