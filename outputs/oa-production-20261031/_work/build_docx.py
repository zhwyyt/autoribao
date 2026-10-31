import json, copy, hashlib
from pathlib import Path
from collections import OrderedDict
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFont

WORK=Path(__file__).resolve().parent; OUT=WORK.parent
spec=json.loads((WORK/'spec.json').read_text(encoding='utf-8'))
ref=Path(r'I:\OA生产平台开发\OA项目管理平台建设与应用方案20250918.docx')
source_hash=hashlib.sha256(ref.read_bytes()).hexdigest()
d=Document(ref)
body=d._element.body
last=copy.deepcopy(body.sectPr)
for el in list(body): body.remove(el)
body.append(last)
s=d.sections[0]
s.page_width=Cm(21);s.page_height=Cm(29.7)
s.top_margin=Cm(2.54);s.bottom_margin=Cm(2.54);s.left_margin=Cm(2.8);s.right_margin=Cm(2.8)
s.header_distance=Cm(1.2);s.footer_distance=Cm(1.2)
s.different_first_page_header_footer=True
for part in [s.header,s.footer,s.first_page_header,s.first_page_footer]:
 for el in list(part._element):part._element.remove(el)
 part.add_paragraph('')
for name in ['Normal','Title','Heading 1','Heading 2','Heading 3','List Paragraph']:
 st=d.styles[name];st.font.name='宋体';st.font.color.rgb=RGBColor(0,0,0)
 st._element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'),'宋体')
 st.paragraph_format.first_line_indent=Cm(0);st.paragraph_format.left_indent=Cm(0)
 st.paragraph_format.space_before=Pt(0);st.paragraph_format.space_after=Pt(6)
 st.paragraph_format.line_spacing=1.15
 # Remove legacy automatic numbering and paragraph borders from source roles.
 ppr=st._element.find(qn('w:pPr'))
 if ppr is not None:
  for tag in ['numPr','pBdr','tabs']:
   el=ppr.find(qn('w:'+tag))
   if el is not None:ppr.remove(el)
d.styles['Normal'].font.size=Pt(11)
d.styles['Title'].font.size=Pt(24);d.styles['Title'].font.bold=True
for name,size in [('Heading 1',17),('Heading 2',14),('Heading 3',12)]:
 st=d.styles[name];st.font.size=Pt(size);st.font.bold=True;st.paragraph_format.keep_with_next=True
 st.paragraph_format.space_before=Pt(10)
d.styles['Heading 1'].paragraph_format.page_break_before=True
hp=s.header.paragraphs[0];hp.text='浙江大东吴建筑科技有限公司    OA生产管理平台';hp.alignment=WD_ALIGN_PARAGRAPH.CENTER
for r in hp.runs:r.font.size=Pt(9)
fp=s.footer.paragraphs[0];fp.alignment=WD_ALIGN_PARAGRAPH.CENTER
fp.add_run('第 ')
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');fp._p.append(fld)
fp.add_run(' 页')

def p(text='',boldlead=None):
 x=d.add_paragraph()
 if boldlead:
  x.add_run(boldlead+'：').bold=True;x.add_run(text)
 else:x.add_run(text)
 return x
def h(text,level=1):return d.add_heading(text,level)
def table(headers,rows,widths=None):
 t=d.add_table(rows=1,cols=len(headers));t.autofit=False
 for c,v in zip(t.rows[0].cells,headers):c.text=str(v)
 for row in rows:
  for c,v in zip(t.add_row().cells,row):c.text=str(v)
 pr=t._tbl.tblPr
 bd=OxmlElement('w:tblBorders')
 for e in ['top','left','bottom','right','insideH','insideV']:
  x=OxmlElement('w:'+e);x.set(qn('w:val'),'single');x.set(qn('w:sz'),'4');x.set(qn('w:color'),'D9D9D9');bd.append(x)
 pr.append(bd)
 for ri,row in enumerate(t.rows):
  # Rows may move as a whole, but never clip text.
  trpr=row._tr.get_or_add_trPr();no=OxmlElement('w:cantSplit');trpr.append(no)
  if ri==0:
   repeat=OxmlElement('w:tblHeader');trpr.append(repeat)
  for ci,c in enumerate(row.cells):
   if widths:c.width=Cm(widths[ci])
   tcpr=c._tc.get_or_add_tcPr();m=OxmlElement('w:tcMar')
   for edge in ['top','bottom','left','right']:
    e=OxmlElement('w:'+edge);e.set(qn('w:w'),'75');e.set(qn('w:type'),'dxa');m.append(e)
   tcpr.append(m)
   shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'E4E4E4' if ri==0 else 'FFFFFF');tcpr.append(shade)
   for para in c.paragraphs:
    para.paragraph_format.space_after=Pt(2);para.paragraph_format.line_spacing=1.05
    for run in para.runs:
     run.font.size=Pt(9);run.bold=ri==0
 return t

# Reference-derived cover and five-part structure; all original business body is replaced.
p('浙江大东吴建筑科技有限公司').alignment=WD_ALIGN_PARAGRAPH.CENTER
p('\n\n')
title=d.add_paragraph('OA生产管理平台',style='Title');title.alignment=WD_ALIGN_PARAGRAPH.CENTER
title=d.add_paragraph('建设与应用方案',style='Title');title.alignment=WD_ALIGN_PARAGRAPH.CENTER
p('\n')
table(['版本','编制日期','方案状态'],[[spec['version'],spec['date'],'供业务讨论与开发范围确认']],[5,5,5.4])
p('建设定位：从零建设，完整承接现有东吴云生产管理业务并实施替代。')
p('配套文件：OA生产管理平台_页面表单与报表模板.xlsx。')
p('本方案说明业务、页面、数据关系和验收要求，不限定 OA 产品、版本或开发技术。实际审批岗位、现有系统未核实口径列在附录中，不以推测冒充已确认事实。')
p('编制／确认／审批人员：由建设单位在定稿时填写。')

h('阅读指引')
p('本方案沿用原 OA 项目管理方案的五部分结构，并补充数据口径、替代切换与验收附录。第三部分的页面编号与 Excel 工作表前缀一致。读者可先看整体流程，再按模块查看功能和相应页面模板。')
table(['部分','主要内容'],[
['第一部分 建设方案概述','建设目标、范围、阶段、总体架构和业务流程'],
['第二部分 基础档案方案','从零建立组织、人员、角色、字典、构件身份及计量规则'],
['第三部分 功能需求及应用方案','10个模块、40个业务页面；界面字段、操作、取数、流向和校验'],
['第四部分 确认审批与异常处理','保存、确认、审批、生效；撤销更正与跨模块影响'],
['第五部分 系统权限','角色动作、项目部门数据范围、日志与导出权限'],
['附录A 数据关系与统计口径','数据对象、时间定义、指标公式和补录撤销示例'],
['附录B 替代切换与验收','初始化、历史交接、试运行、切换、对账与验收场景'],
['附录C 待定稿事项与依据','未核实旧行为、本版暂定规则和功能证据对照']],[5,10.4])
p('Excel 共44个工作表，其中40个业务页面，另有页面目录、320项表头字段说明、统计口径示例及10项定稿确认事项。Excel 内“自动生成”“选择”“填写”等文字表示拟建页面行为，不代表工作簿已经连接生产数据。')

h('第一部分 建设方案概述')
h('1 建设目标',2)
p('建设覆盖项目构件、订单、排产、任务、生产执行、质量检验、成品库存、包装发货和统计的生产管理平台。新平台自行维护业务数据和组织权限，承接东吴云的日常操作与查询能力，切换后成为生产业务的正式记录来源。')
p('通过构件的统一身份和业务单据关联，实现数据一次录入、多处引用；通过实际发生时间和操作记录区分生产事实与录入行为；通过汇总下钻和数量重量校验，使项目、计划、班组、质量和发货报表可核对。')
h('2 建设范围',2)
table(['纳入本期','边界说明'],[
['组织、用户、角色、字典','不假设已有 OA 基础可复用，从零建立基础数据与权限。'],
['项目、图纸和构件','登记、文件管理、Excel解析导入、构件维护与查询。'],
['订单、排产、计划与任务','构件分配、部门设计、下发、执行任务、任务单及二维码。'],
['生产与质量','报工、工序记录、报检、结果登记、查询导出和受控更正。'],
['成品库存、包装与发货','明确入库业务入口、库存查询、包装清单、发运和历史。'],
['统计、日志与切换','综合、班组、构件、质量、发货、月日报及配套收发存；操作日志、数据交接和验收。']],[5,10.4])
p('本期不扩展完整采购财务 ERP、原材料及余料管理、自动套料、智能排程、安装齐套、现场签收或设备联网。此前行业优化意见不自动计入本期。为使替代系统独立运行而补齐的入库入口、操作日志和报表留版在各页标明依据。')
h('3 建设阶段',2)
table(['阶段','工作及交付','完成条件'],[
['业务定稿','确认页面、字典、工序、时间、单位、权限和例外规则','40页模板与方案逐项签认，未决事项有负责人'],
['平台搭建','完成基础档案、主链业务及查询报表','按同一构件走通订单至发货'],
['初始化及交接','基础数据装载、未完任务与库存期初交接','切换清单数量重量与旧系统核对'],
['测试试运行','功能、权限、并发、导出、异常与统计验证','附录B场景通过，差异说明闭合'],
['正式替代','确定切换时点、旧系统只读、新系统正式记账','责任人签认切换结果与回退条件']],[3,6.4,6])
p('具体日期和资源由建设单位与实施方排定，本方案不沿用旧项目管理方案的实施日期，也不预设开发工期。')
h('4 总体架构与业务流程',2)
p('基础层：组织、用户、角色、字典、项目和构件；业务层：订单、排产、任务、报工、报检、入库、包装和发货；查询层：业务台账、构件履历、统计报表及日志。业务层产生事实，查询层按统一规则取数。')
table(['步骤','业务动作','新增或传递的数据'],[
['1','项目登记、资料上传、构件导入','项目标识、文件版本、构件标识、数量与重量'],
['2','形成生产订单','订单主档、订单构件范围与需求日期'],
['3','编制排产并分配下发','排产明细、生产部门、设计版本、生产计划来源'],
['4','分派任务与报工','班组、适用工序、计划时间、实际完成记录'],
['5','报检与检验','报检明细、检验时间、数量、结果与复检关系'],
['6','成品入库、包装、发货','库存流水、包内构件、实际发货及对应出库'],
['7','统计查询与穿透','按项目、部门、工序和时间汇总，保留明细依据']],[1.2,5.3,8.9])
p('上述是主业务方向，不代表所有工序必须严格串行。各构件适用工序及前置条件分别配置；生产、质量、库存和发运状态独立维护，按业务规则相互约束。统计读取各环节事实，不要求全部发货后才形成报表。')

h('第二部分 基础档案方案')
h('1 基础资料清单',2)
table(['档案','主要内容','维护与引用'],[
['组织与班组','公司、工厂、车间、部门、班组、负责人、生产标识','B01维护；用于任务分配及班组统计'],
['用户与角色','账号、姓名、归属、角色、数据范围、启停','B02维护；用于操作与授权'],
['项目分类与区域','项目类别、区域、项目状态','B03维护；P01引用'],
['构件及材料分类','构件类别、规格描述、材质、计量单位','B03维护；P04导入校验'],
['工序与前置条件','工序编码、适用品类、前置关系、完成判定、统计顺序','生产负责人确认；任务与报工引用'],
['检验与结果','检验类别、结果代码、复检关联规则','质检负责人维护；Q01—Q03引用'],
['库存地点','仓库或堆场名称、启停、位置说明','仓管维护；W01、W02引用'],
['统计模板','部门、项目、工序列、单位、规则版本','R06维护；R07—R09引用']],[3,6.1,6.3])
p('枚举字典保留唯一编码、名称、启用状态和排序。初稿中的类别或工序文字属于候选值，定稿时录入企业实际清单；停用不删除历史引用。完整客商准入、合同采购和财务科目不作为本期基础模块。')
h('2 构件身份与数量分配',2)
p('项目、订单、排产、任务、检验、包装和发货必须引用同一构件身份。构件编号可以代表一组相同构件，不能直接当成唯一实物标识。平台采用内部唯一记录标识，并支持单件身份或受控批次数量分配。')
p('例如某编号共3件，可分到两张任务并分两次发运。每次分配保留来源明细及数量，累计分配不能超过来源可用量；同一实物经过多工序只增加工序记录，不增加项目构件总数。导入拆分后应保留原清单行与各子记录对应关系。')
h('3 计量与字段规则',2)
p('初稿采用数量“件”为正整数，构件单重和总重以kg保存，报表可换算为t。单重、总重、理论重量和过磅实重分别命名，不能互相覆盖。建议重量保存3位小数；累计按保存精度求和后统一显示，定稿时与现有清单精度比对。')
p('人工填写、系统带出、系统计算和状态判定在Excel中分别说明。必填字段用星号标识；有条件必填在字段提示和页面校验中注明。系统带出字段原则上只读，需要更正时修改其来源或发起E03，不在下游随意覆写。')
h('4 编码与文件',2)
p('单据编号由系统生成且保持唯一，具体前缀可按项目、工厂和单据类型配置。编号与显示名称分离。图纸、清单和生产资料保留文件号、版本、上传人和时间；任务记录其使用的版本，不能下载到已被无痕替换的文件。')

h('第三部分 功能需求及应用方案')
p('以下功能是拟建平台要求。标记“已有功能转化”表示已观察到相应东吴云功能或接口入口，不表示其中每一条校验均已实测原系统。未明确的规则在本稿给出可讨论的实施方式，并列入附录C。')
modules=OrderedDict()
for page in spec['pages']:modules.setdefault(page['module'],[]).append(page)
for mi,(module,group) in enumerate(modules.items(),1):
 h(f'{mi} {module}',2)
 for page in group:
  h(page['code']+' '+page['name'],3)
  p(page['purpose']+' 使用岗位：'+page['role']+'。',boldlead='功能用途')
  p(f"附件Excel工作表“{page['sheet']}”。表头包括："+'、'.join(f['label']+('（必填）' if f['required'] else '') for f in page['fields'])+'。',boldlead='界面模板')
  p('、'.join(page['cols'])+'。',boldlead='明细或结果列')
  p(page['actions']+'。',boldlead='页面操作')
  p(page['source'],boldlead='数据来源')
  p(page['result'],boldlead='新增数据及后续流向')
  for ri,rule in enumerate(page['rules'],1):p(rule,boldlead=f'控制要求{ri}')
  if page['basis']!='已有功能转化':p(page['basis']+'。详见附录C相关事项。',boldlead='依据边界')

h('第四部分 确认审批与异常处理')
h('1 业务动作与生效时点',2)
p('普通生产操作不一律套用多级审批。保存草稿、确认业务、主管审批和系统生效分别处理：保存草稿不占用正式数量；确认或审批成功后才生成有效业务事实。需要预约占用的场景必须另行显示锁定量和释放方式，不能与已完成量混淆。')
table(['业务','建议处理流程','何时影响后续'],[
['项目及构件资料','经办登记→检查完整性→保存生效；关键更正受控','项目或导入确认后可引用'],
['订单确认','订单人员编制→核对构件范围→确认','确认后产生可排产范围'],
['生产下发','计划员编制→生产负责人核对→确认下发','下发成功后生成计划任务来源'],
['报工','班组人员填报→系统前置及余额检查→确认','确认后计入有效工序产量'],
['质检','生产报检→质检人员登记并确认结果','确认后改变对应质量状态'],
['入库包装','经办核对→校验→确认','入库改变库存；包装只改变包内关系和占用'],
['实际发货','发货员编制→核对清单及条件→授权人确认','确认后同步形成发运和出库'],
['撤销更正','经办申请→系统列影响→主管审核→系统复核并执行','执行成功后改变有效数量及状态'],
['月报发布','统计员生成→生产负责人复核→发布','保留已发布版本，后续更正生成修订']],[2.5,7.1,5.8])
p('表中审批岗位为角色建议，不指定人员姓名。企业可在定稿时合并兼岗，但系统须保留实际操作人与批准人；高影响更正是否禁止本人自批须明确配置。')
h('2 状态与例外',2)
table(['对象','基本状态建议','关键限制'],[
['订单排产','草稿、已确认或已下发、部分执行、已完成、已取消','状态由有效明细或受控确认产生'],
['任务工序','未开始、部分完成、已完成、已取消','前置条件按工序配置；不能用一个全厂串行状态替代'],
['质量','待检、部分检验、合格、不合格、待复检','结果按件或受控数量确定；失败记录保留'],
['库存','未入库、在库、部分出库、已出库','入出库流水与余额可对账'],
['包装发运','草稿、有效包装、待发、部分发运、已发运、已撤销','包装与出库独立；撤销不能伪造实物移动'],
['报表','实时、已发布、修订版','旧版本可复现，实时结果可更新']],[2.5,6.5,6.4])
h('3 撤销更正的处理顺序',2)
p('先读取原业务记录和关联构件，再列出下游任务、检验、库存、包装、发货及报表影响。申请人填写原因和拟修改内容，主管确认处置。执行时再次检查数据版本和余额；允许的更正以关联记录留痕，不能物理抹除已生效历史。')
p('上游撤销可能使后续记录失去依据，必须先处理或冻结受影响范围。已实际发出的构件不得仅因上游撤销就回到可发库存。单据修改同时影响多个余额时，要么整组成功，要么全部不生效；不能出现发货成功而出库失败。')
h('4 重复提交与并发',2)
p('Excel确认、批量报工、扫码、下发和发货均需识别重复请求。页面重复点击、网络重试不重复计量；两个用户同时占用同一余量时，由服务端进行最终校验。批量处理应返回成功和失败明细及原因，统计只计成功生效的数据。')

h('第五部分 系统权限')
h('1 角色与功能范围',2)
table(['角色','主要操作','主要限制'],[
['系统管理员','组织、用户、角色、字典和日志管理','不自动具备业务批准权'],
['项目及技术人员','项目、文件、构件导入与维护','已执行数据只能受控更正'],
['订单及计划人员','订单、排产、分配下发和计划查询','仅操作授权项目与生产组织'],
['生产负责人','任务分派、生产查询、指定更正审核','不能无痕改质检结果或库存'],
['班组人员','本班组任务、报工和报检','不能替其他班组计产或直接发货'],
['质检人员','报检处理、检验结果、质量记录','不能覆盖原不合格事实'],
['仓管及包装人员','入库、库存、包装及清单','不能通过改库存状态替代发货单'],
['发货人员','发货编制、核对、授权确认','不得重复发运或绕过质量冻结'],
['统计及管理人员','统计、穿透、导出和发布','数据范围继承授权，不直接改业务事实']],[3,6.3,6.1])
h('2 数据权限与字段权限',2)
p('权限至少包含模块、动作、项目和组织四个维度。用户有页面权限并不代表可查看全部项目；穿透、附件、二维码链接和导出执行相同范围检查。跨项目批量操作必须逐项判断，不以当前页面可见按钮作为唯一限制。')
p('系统生成编号、汇总量、录入时间、操作者及已发布报表版本只读。经办人可编辑草稿；已确认资料按照对象状态限制编辑。管理员可以维护角色配置，但不得通过直接数据修改跳过业务更正流程。')
h('3 操作留痕与基础运行要求',2)
p('记录新增、修改、确认、撤销、更正、隐藏、导出和权限调整的操作者、时间、单据及结果。口令和登录令牌不写入业务日志。批量导入应可定位原文件和源行；导出应保留筛选条件和生成时间。')
p('页面支持关键词、分页、排序、条件重置、明细穿透及批量导出。移动端至少支持任务查看、扫码定位和报工等纳入本期的操作；是否需要专门扫码设备由实施选择，不增加硬件采购假设。上线前以实际峰值数据测试响应与批量处理，容量和响应目标在实施计划中约定。')

h('附录A 数据关系与统计口径')
h('A1 核心数据关系',2)
table(['对象关系','数量及引用要求'],[
['项目—文件版本—构件','构件保留项目、来源清单和文件版本；项目编号及构件内部标识稳定'],
['构件—订单明细—排产明细','按来源数量分配，可分批但不可超量；每次分配留关系'],
['排产—计划—任务','按部门、班组或工序分拆；来源明细不能仅凭名称匹配'],
['任务—工序记录','同件多工序可产生多条记录；不增加项目实体件数'],
['报检—检验—复检','按检验环节和处理范围关联；不合格原记录保留'],
['构件—入库—包装—发货','包装是分组；发货与出库联动；流水、实物和数量一致'],
['业务事实—报表—明细','报表保留时间、范围、版本和单位；穿透能重现同一结果']],[5,10.4])
h('A2 时间定义',2)
table(['时间字段','定义及使用'],[
['计划开始和完成','用于交期和计划查询，不作为实际产量日期'],
['实际发生时间','工序完成、检验、入库、发货等真实业务时间，决定所属业务日'],
['录入时间','系统接受数据的时间，不允许人工覆盖'],
['审批确认时间','主管确认或业务确认的时间，说明生效处理过程'],
['撤销更正时间','调整操作发生时间，与被调整的业务日期分开保存'],
['统计截止时间','报表纳入数据的边界，已发布版本固定记录'],
['报表生成与发布时间','说明结果何时生成与正式发布，不替代统计期间']],[4.3,11.1])
p('初稿采用中国标准时间，业务日为当天00:00至次日00:00，查询起点包含、终点不包含。夜班跨日规则如需按班次归属，须在定稿时统一修改相关日报月报。过去日期补录允许但保留原因；未来完成时间不作为已完成事实。')
h('A3 统计生成流程',2)
p('用户选择项目、部门、日期、状态和计量单位；系统按该报表定义读取有效业务明细及修订；过滤权限、期间和状态后按维度汇总；页面与导出使用同一口径；点击指标携带全部条件与报表版本进入明细。')
p('工序动态列来自字典及统计模板，列名必须同时说明工序、指标与单位。服务端返回的汇总应与全部匹配明细相符，不能仅合计当前分页。月度路径为模板→月份→日期→部门或班组→构件及业务记录。')
table(['指标','本版公式与口径'],[
['构件总重量','有效数量×对应版本单重；以kg归集，显示t时除以1000'],
['工序本期产量','业务发生时间落在期间内的有效工序完成量；排除撤销记录'],
['最终完工量','按构件适用路线的最终完成条件判断后计量，不累计各工序产量'],
['任务剩余量','同任务同工序计划量－有效完成量'],
['累计已发与未发','累计已发为截至期末有效发运；未发为同订单范围应发量－累计已发量'],
['发货完成率','累计已发量÷同范围应发量；件与重量分别算，分母零为不适用'],
['首次检验合格率','同环节首次合格件数÷首次检验件数；复检次数单列'],
['成品期末库存','期初＋入库－出库＋调整增加－调整减少；包装不减库存'],
['月合计','该月各日发生量相加；不累加每天的月累计值']],[4,11.4])
h('A4 补录撤销和修订示例',2)
p('以下均为虚拟数据。构件GZ01-001单重500kg，10月29日完成组立，30日补录，仍计入29日组立产量；该件30日又完成焊接，形成另一工序产量，不能将两次500kg相加认定为1000kg最终成品。')
p('构件GZ01-002单重300kg，原29日组立记录被撤销，更正为30日完成并在31日录入，则29日排除原300kg，30日增加300kg，31日只在补录操作记录中出现。Excel Z02提供可计算的对应示例。')
p('已发布的29日日报或10月月报保留原版；调整后生成修订版，注明补录或撤销影响。已发布汇总下钻对应版本明细，实时查询显示最新有效结果。原平台快照方式未完整核实，本条为新平台明确采用的实施方案。')

h('附录B 替代切换与验收')
h('B1 初始化和历史交接',2)
p('从零搭建指系统、基础档案和业务模块从头建设，不意味着忽略旧系统的未完成事项。正式替代前，应清点未结订单、排产计划、在制任务、待检与不合格、在库构件、已包装未发及已发历史关联。')
p('基础档案先装载，再装项目和构件，最后装未完业务及期初库存。旧标识与新标识建立映射；不能凭构件编号直接合并不同项目或多件实物。没有证据的历史日期、工序、批次和检验结果标为未记录，不补造。')
p('完整历史迁移或旧系统只读留档由建设单位在切换计划确定。无论采用哪种方式，都须保证未完业务可连续办理、期初库存可核对、既有报表有可追溯存档。迁移期间不将同一事实在新旧平台双重记账。')
h('B2 切换顺序',2)
table(['步骤','业务控制'],[
['切换前','导出及备份；盘点未完业务；确认映射、差异及权限；准备回退条件'],
['切换时点','暂停旧系统新增；导出最后增量；核对订单、计划、库存及发货数'],
['新系统启用','装载经确认期初与未完业务；按角色逐项验证后开放操作'],
['切换后','旧系统仅留查询；新平台作为正式业务来源；观察报表与库存差异'],
['异常回退','由业务负责人统一决定；先备份新系统新增记录，明确补登范围，不能直接恢复旧系统双写']],[3,12.4])
h('B3 验收场景',2)
tests=[
['V01','项目构件','同项目清单重复确认','不重复建件；错误行可下载；同编号多件身份可区分'],
['V02','数量分配','3件分2订单或任务，尝试再分第4件','合法分批成功，超量被拒绝，源数量可对账'],
['V03','版本引用','已有任务后替换图纸','任务旧版本可查，受影响关系可识别，不无痕覆盖'],
['V04','排产下发','同一下发请求连续提交两次','仅一组有效计划任务，未下发余额正确'],
['V05','工序执行','一件经过多个适用工序及并行前置','按规则允许或拒绝，不重复增加构件数'],
['V06','生产补录','29日完成30日录入','29日产量增加，30日补录可查，录入时间不可改'],
['V07','生产撤销','完成后撤销并更正日期','原记录仍可查，新有效量与日报一致'],
['V08','质量检验','同批部分合格、不合格后复检','各数量守恒，复检关联原记录，不合格禁止正常发运'],
['V09','入库包装','入库后包装、拆包再包装','入库只计一次，包装不改变库存总量，占用正确'],
['V10','发货并发','两人同时发同一件，或按包与按件交叉选中','仅一次生效，发货与出库同步，无负库存'],
['V11','库存平衡','期初、入库、出库及批准更正','R10按件和重量与业务流水一致'],
['V12','报表穿透','月→日→班组→构件明细','筛选、版本、单位完整继承，合计一致'],
['V13','月报修订','已发布月份发生跨月补录','旧版可复现，新修订有差异说明'],
['V14','权限','越权访问项目、附件、二维码链接及导出','服务端拒绝；看不到未授权数据'],
['V15','任务单','批量下载任务单及二维码后扫码','构件和版本一致，补打码不新建身份'],
['V16','替代切换','按同一截止时点核对新旧未完、库存和已发','差异逐项解释并签认，原系统数据可追溯'],
['V17','导出与大数据','多页列表导出、批量清单及报表','导出含全部匹配记录，表头单位时间一致，失败可重试'],
['V18','事务失败','模拟发运关联出库失败或重复请求','没有部分成功造成的库存、发货分离；错误可定位']]
table(['编号','范围','操作场景','预期结果'],tests,[1.1,2.1,5.2,7])
p('实施方交付页面与流程配置、字典、字段及报表口径说明、导入模板、操作说明、权限清单、备份恢复说明和验收记录。二维码、文件导出、批量操作及后台校验须实际测试，不能仅以页面截图认定通过。')

h('附录C 待定稿事项与依据')
h('C1 未核实事项及本版处理',2)
for item in spec['pending']:
 h(item[0]+' '+item[1],3)
 p(item[2]+'。',boldlead='已知边界');p(item[3]+'。',boldlead='本版处理')
 p(item[4]+'；验收样例：'+item[5]+'。',boldlead='确认岗位')
h('C2 东吴云功能依据对照',2)
p('此前调查包括网页前端引用的页面和接口、部分登录态只读响应。接口名称只能证明入口或调用关系，不能证明所有状态约束及数据公式。以下用于实施追溯，不要求新平台照搬旧接口命名。')
table(['功能范围','已发现入口或接口举例','对应页面'],[
['组织与权限','getInfo、getBranchs；部分响应已核对','B01、B02'],
['项目构件文件','v1.project下getList、getProjectArtifacts、getProjectFiles等','P01—P05'],
['订单构件','v1.order下getOrderArtifacts、submitArtifacts、downCodes等','O01、O02'],
['排产与下发','getSchedulings、setDepartment、setDesign、sendProduce','S01—S03'],
['计划任务与文件','getPlans、getTasks；v2生产Excel解析、任务单和二维码下载','T01—T04、P04'],
['工序','updateProcess、cancelProcess；完整转换规则待核实','E01—E03'],
['质检','getInspections、getInspectionInfo、downloadInspection、hideInspection','Q01—Q03'],
['包装发货','createPackage、getPackageArtifacts、getDeliverys、getDeliveryHistory','W03—W06'],
['库存','统计筛选出现未入库、已入库、未发货、已出库；写入口未核实','W01、W02、R10为明确化设计'],
['统计','综合、班组、构件、质量、发货及月／日统计接口族','R01—R09']],[3,9,3.4])
h('C3 参考文件与使用方式',2)
p('原《OA项目管理平台建设与应用方案20250918.docx》用于参考建设方案的组织方式；《OA项目管理平台建设与应用方案—附件5—合同管理.xlsx》用于参考表单、台账及取数控制的表达方式。旧经济管理业务不直接复制为生产业务。')
p('东吴云依据为此前调查记录及《东吴云生产管理平台_重开发数据流转说明.md》中标明的已观察事实。该说明内推定或建议规则在本方案中重新标识，不作为已实测的旧系统行为。')
p('本方案与Excel附件同版维护。任何字段、工序、数量、时间、审批或报表口径变更，都应同步修改对应页面及方案条目，再进行相关验收。')

# Permit Word to refresh simple page fields; no stale copied TOC is retained.
settings=d.settings._element
up=settings.find(qn('w:updateFields'))
if up is None:up=OxmlElement('w:updateFields');settings.append(up)
up.set(qn('w:val'),'true')
file=OUT/'OA生产管理平台_建设与应用方案.docx'
d.save(file)
assert hashlib.sha256(ref.read_bytes()).hexdigest()==source_hash
(WORK/'artifact.md').write_text(f'''# Reference and execution contract
Reference: {ref}
SHA256: {source_hash}
Scope: New production-platform document, not a narrow edit of the old economic-management content. Source is unchanged. User prioritizes business content and matching Word/Excel pages over minute format fidelity.
Source evidence: read full body and tables, all 9 reference Excel sheets; inspected source architecture and business-flow graphics. Source has alternating A4 portrait/landscape sections for wide forms. New detailed forms reside in Excel; Word uses the source portrait pattern.
Source-derived components: company cover, 24pt title, five-part structure, module/function hierarchy, interface plus functional requirements, gray-grid comparable tables, business flow and permissions.
New content replaces all old body slots, outdated TOC, figures, approval placeholders, and footer text. Retain source document as builder basis; use compact readable 11pt narrative and 9pt tables, A4 portrait with 2.54cm vertical and 2.8cm horizontal margins. No requirement for exact page count or byte-identical header parts in this new subject document.
Verification: final Word rendered and checked; Excel 40 page IDs and 320 header field definitions match spec.json. No old contract amounts, timelines or approvals carried into new scope.
''',encoding='utf-8')
print(file)
print('paragraphs',len(d.paragraphs),'tables',len(d.tables),'features',len(spec['pages']))
