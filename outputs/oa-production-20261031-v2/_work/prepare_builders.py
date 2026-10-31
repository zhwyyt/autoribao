from pathlib import Path
W=Path(__file__).resolve().parent
old=W.parent.parent/'oa-production-20261031/_work'
x=(old/'build_xlsx.mjs').read_text(encoding='utf8')
x=x.replace("const defs=wb.worksheets.add('Z01_字段填写说明');","const defs=wb.worksheets.add('Z01_字段对应索引');\nconst enums=wb.worksheets.add('01_基础选项字典');")
x=x.replace("'浅黄色区域表示人工录入或选择'","'蓝字表示选择、带出或计算，红字表示人工填写或上传'")
x=x.replace('*表示必填；浅黄色区域表示人工录入或选择，浅灰色表示系统带出或计算。文字为填写说明，不是真实业务数据。','*表示必填；H为表头编号，D为明细编号；填写区直接注明来源。红字为人工填写或选择提示，蓝字为取数或计算说明；均为开发说明。')
x=x.replace("header(index,7,['页面编号'", "header(index,7,['页面编号'")
x=x.replace("index.getRange('A8:G47')", "index.getRange(`A8:G${spec.pages.length+7}`)")
x=x.replace("note(index,49,", "note(index,50,").replace("note(index,50,'资料依据'", "note(index,51,'资料依据'")
x=x.replace("register(index,50,7,28)","register(index,51,7,51)")
x=x.replace('Z01列出表头字段填写方式；','01基础选项字典与Word第二部分同版；Z01按编号定位全部表头和明细字段；')
start=x.index('for(const p of spec.pages){')
end=x.index('base(pending,6,18);')
x=x[:start]+r'''
base(enums,5,250);
merged(enums,1,0,4,'基础分类与选项定义',null,true,38).format.font.size=16;
note(enums,2,'编码说明',spec.dictionary_note,5);
header(enums,4,['分类编号','分类名称','选项编号','可能的字段内容','说明及引用页面']);
const enumRows=spec.dictionaries.flatMap(d=>d.rows.map(v=>[d.code,d.name,v.code,v.name,v.note+' 引用：'+d.used]));
enums.getRange('A5').write(enumRows);
for(const [c,w]of[['A',95],['B',180],['C',100],['D',240],['E',600]])enums.getRange(`${c}1:${c}${enumRows.length+5}`).format.columnWidthPx=w;
enums.getRange(`A5:E${enumRows.length+4}`).format.rowHeight=56;
enums.freezePanes.freezeRows(4);register(enums,enumRows.length+4,5,22);

for(const p of spec.pages){
 const s=sheets.get(p.code), n=Math.max(12,p.cols.length);base(s,n,190);
 merged(s,1,0,n-1,`${p.code}  ${p.name}`,null,true,38).format.font.size=16;
 note(s,2,'对应方案',`第三部分 ${p.module} — ${p.code}。H为表头字段，D为明细字段；编号与Word逐项对应。`,n);
 note(s,3,'使用岗位',p.role+'。'+p.purpose,n);
 section(s,5,p.section,n);
 let r=6;const rowHeights={};
 p.fields.forEach((f,i)=>{
   const a=i%2?6:0;
   merged(s,r,a,a+1,f.id+'\n'+f.label+(f.required?' *':''),'#F4F4F4',true,70);
   const auto=/^(系统|自动|当前用户|明细|来源.*带出|任务带出|来源计划|来源排产|继承|成功下发)/.test(f.hint)&&!/填写|按权限调整/.test(f.hint);
   const height=Math.max(70,Math.ceil((f.hint.length+f.source.length+4)/22)*16+16);
   rowHeights[r]=Math.max(height,rowHeights[r]||70);
   merged(s,r,a+2,a+5,f.hint+'\n来源：'+f.source,null,false,rowHeights[r]).format.font.color=auto?'#1686A3':'#C03221';
   s.getRange(`${col(a)}${r}:${col(a+5)}${r}`).format.borders={preset:'all',style:'thin',color:'#BFC3C7'};
   dictionary.push([f.id,p.sheet,`${col(a+2)}${r}`,f.label,f.required?'必填':'选填或按条件',f.content,f.source]);
   if(i%2===1||i===p.fields.length-1)r++;
 });
 r++;section(s,r++,p.kind==='report'?'报表结果模板':p.kind==='list'?'查询台账模板':'业务明细模板',n);
 const hr=r;header(s,r++,p.details.map(f=>f.id+'\n'+f.label));
 s.getRange(`A${hr}:${col(p.cols.length-1)}${hr}`).format.rowHeight=54;
 const sr=r;
 s.getRange(`A${r}:${col(p.cols.length-1)}${r}`).values=[p.details.map(f=>f.source)];
 s.getRange(`A${r}:${col(p.cols.length-1)}${r}`).format.font.color='#1686A3';
 s.getRange(`A${r}:${col(p.cols.length-1)}${r}`).format.font.size=10;
 s.getRange(`A${r}:${col(p.cols.length-1)}${r}`).format.rowHeight=Math.max(120,Math.ceil(Math.max(...p.details.map(f=>f.source.length))/6)*14+15);r++;
 for(let k=0;k<3;k++,r++)s.getRange(`A${r}:${col(p.cols.length-1)}${r}`).format.rowHeight=28;
 s.getRange(`A${hr}:${col(p.cols.length-1)}${r-1}`).format.borders={preset:'all',style:'thin',color:'#C7CCD1'};
 for(let i=0;i<p.details.length;i++){const f=p.details[i];dictionary.push([f.id,p.sheet,`${col(i)}${hr}:${col(i)}${sr}`,f.label,'按本页控制条件',f.content,f.source]);}
 note(s,r++,'填写说明','明细第一行是来源或计算说明，以下空行为正式填报区域示意。平台应提供新增明细、选择构件、查询和穿透功能。',n);
 const formEnd=r-1;
 if(['R01','R07','R08'].includes(p.code)){
  section(s,++r,'网页动态列示意',n);r++;
  header(s,r++,['日期或项目','部门班组','装焊报检 件','装焊报检 t','装焊探伤 件','装焊探伤 t','装焊质检 件','装焊质检 t','涂装 件','涂装 t','明细入口']);
  note(s,r++,'动态列规则','所列工序仅作布局示例，正式列取R06模板或本页工序选择。每个指标按工序编码绑定来源、单位、时间、汇总和穿透，不能跨工序累加为成品重量。',n);
 }
 note(s,++r,'页面操作',p.actions,n);r++;
 section(s,r++,'取数规则与条件控制',n);
 note(s,r++,'来源选择',p.source,n);
 note(s,r++,'确认后写入与回写',p.result,n);
 for(let j=0;j<p.rules.length;j++)note(s,r++,`条件控制${j+1}`,p.rules[j],n);
 note(s,r++,'原平台依据',p.basis+'。详细状态、时间口径及未核实入口见 Z03；本模板为拟建系统规格。',n);
 if(p.kind==='list'||p.kind==='report')s.freezePanes.freezeRows(hr);
 register(s,r-1,n,r-1);manifest[manifest.length-1].formEnd=formEnd;
}
base(defs,7,dictionary.length+8);
merged(defs,1,0,6,'Word与Excel字段对应索引',null,true,38).format.font.size=16;
note(defs,2,'编号','H为表头字段，D为明细或报表列；每一编号同时出现在Word定义表和Excel对应位置。',7);
header(defs,4,['字段编号','工作表','位置','字段名称','填写要求','可能内容及说明','具体来源或计算规则']);
defs.getRange('A5').write(dictionary);defs.getRange(`A5:G${dictionary.length+4}`).format.rowHeight=76;
for(const [c,w]of[['A',120],['B',230],['C',130],['D',190],['E',160],['F',360],['G',540]])defs.getRange(`${c}1:${c}${dictionary.length+5}`).format.columnWidthPx=w;
defs.freezePanes.freezeRows(4);register(defs,dictionary.length+4,7,18);

''' + x[end:]
x=x.replace("pending.getRange('A5:F14').format.rowHeight=82", "pending.getRange(`A5:F${spec.pending.length+4}`).format.rowHeight=92")
x=x.replace('register(pending,14,6)','register(pending,spec.pending.length+4,6)')
x=x.replace("'OA生产管理平台_页面表单与报表模板.xlsx'","'OA生产管理平台_页面表单与报表模板_V2.xlsx'")
x=x.replace('header fields','field definitions')
x=x.replace('组立','装焊报检').replace('焊接','涂装')
x=x.replace("await fs.mkdir(path.join(work,'sheet_previews'),{recursive:true});", "await fs.mkdir(path.join(work,'sheet_previews'),{recursive:true});")
(W/'build_xlsx.mjs').write_text(x,encoding='utf8')

d=(old/'build_docx.py').read_text(encoding='utf8')
d=d.replace("spec=json.loads", "spec=json.loads",1)
d=d.replace("s.left_margin=Cm(2.8);s.right_margin=Cm(2.8)","s.left_margin=Cm(2.2);s.right_margin=Cm(2.2)")
d=d.replace("table(['版本'", "table(['版本'")
d=d.replace('40个','41个').replace('40页','41页').replace('40个业务页面','41个业务页面').replace('44个工作表','46个工作表')
d=d.replace('OA生产管理平台_页面表单与报表模板.xlsx','OA生产管理平台_页面表单与报表模板_V2.xlsx')
d=d.replace("file=OUT/'OA生产管理平台_建设与应用方案.docx'", "file=OUT/'OA生产管理平台_建设与应用方案_V2.docx'")
d=d.replace('部门设计','部门工艺').replace('320项表头字段说明','逐项字段对应索引').replace('10项定稿确认事项','12项定稿确认事项')
d=d.replace('另有页面目录、逐项字段对应索引、统计口径示例及12项定稿确认事项','另有页面目录、基础选项字典、逐项字段对应索引、统计口径示例及12项定稿确认事项')
d=d.replace('人工填写、系统带出、系统计算和状态判定在Excel中分别说明。','人工填写、系统带出、系统计算和状态判定在Excel中分别说明；字段编号与Word逐项对应。')
d=d.replace("p('Excel 共46个工作表", "p('Excel 共46个工作表")
pos=d.index("h('第一部分 建设方案概述')")
d=d[:pos]+'''p('本版按原方案的编写关系组织：基础分类及选项表先定义可选内容；第三部分按业务顺序列字段编号、字段名称、可能内容及来源，再对应Excel界面模板；功能需求说明关联、取数、条件控制及回写；流程图连接上下游表单。')
p('例如发货单的来源订单选择O01，构件读取库存W02；本次发货件数由经办填写，本次重量取数量×库存版本单重。确认后生成发货及出库，回写库存、包装发运状态，发货统计读取该有效事实。每一字段都应能找到入口、来源或计算依据。')

'''+d[pos:]
start=d.index("h('第二部分 基础档案方案')")
end=d.index("h('3 计量与字段规则',2)")
d=d[:start]+'''h('第二部分 基础档案方案')
p(spec['dictionary_note'])
for di in spec['dictionaries']:
 h(di['code']+' '+di['name'],2)
 table(['编号','可能的字段内容','说明'],[[r['code'],r['name'],r['note']] for r in di['rows']],[2.4,4.4,8.6])
 p('应用位置：'+di['used']+'。统一由B03维护，页面按字段引用适用选项。')
h('基础档案维护与关联',2)
table(['档案','从零建设内容','引用关系'],[
 ['组织班组 B01','按实际公司、工厂、车间、部门和班组建立层级，标明生产和检验职责','S03部门分配、T02派工、E01记录、各类班组报表'],
 ['用户角色 B02','建立账号、姓名、组织、角色和数据范围','业务经办、审核、确认、查询和导出'],
 ['业务字典 B03','本部分分类、区域、材质、工序、单位和库存地点；企业实际名单另行装载','各表单下拉及动态报表列'],
 ['工艺路线 B04','路线名称版本、节点、前置关系、责任部门和最终完工判定','S03选用，任务留存下发版本，生产检验按路线执行'],
 ['项目构件 P01及P04','项目主档、源清单、GUID、构件规格、数量、重量、位置及扩展字段','订单、排产、任务、质量、成品和发货统一关联']],[3,6.2,6.2])
h('构件身份与业务编号',2)
p('项目编号、构件显示编号、源GUID、订单明细标识、计划明细标识分别保存，不把不同数据层的id混为一个值。新平台建立稳定构件身份及跨层关联，业务分配保留来源明细、目标明细和数量；显示编号相同不代表同一实物，GUID也不能脱离来源上下文全局匹配。')
p('某编号共3件可以分任务、分包装和分批发货。每次分配不得超过对应来源余额；同一构件经过多个工序，只增加过程记录，不增加项目构件总数。订单入口导入和项目入口导入统一去重。')

'''+d[end:]
start=d.index("h('第三部分 功能需求及应用方案')")
end=d.index("h('第四部分 确认审批与异常处理')")
d=d[:start]+'''h('第三部分 功能需求及应用方案')
p('页面按基础维护、项目构件、订单、排产下发、生产执行、检验、成品发货、管理报表排列。每页先给字段定义，后给Excel界面位置和功能需求。H为表头或筛选字段，D为明细或报表列；同一编号在Word与Excel中一致。')
p('表内“可能内容”为取值范围、示例或格式要求，示例不是企业实际数据。“来源”说明谁填写、从哪张表哪个字段取值、何时计算。已有功能转化只表示已有入口或接口依据；审批、详细约束和未证实口径属于本方案拟定规则。')
modules=OrderedDict()
for page in spec['pages']:modules.setdefault(page['module'],[]).append(page)
for mi,(module,group) in enumerate(modules.items(),1):
 h(f'{mi} {module}',2)
 p('本模块包括：'+'、'.join(g['code']+' '+g['name'] for g in group)+'。')
 if module=='生产与质量':pass
 for page in group:
  h(page['code']+' '+page['name'],3)
  p(page['purpose']+' 使用岗位：'+page['role']+'。')
  p('1 字段定义和可能内容',boldlead='字段表')
  p(page['section']+'；带*字段必填，条件必填见说明。')
  table(['编号','字段名称','可能内容或填写要求','来源及取数规则'],[[f['id'],f['label']+(' *' if f['required'] else ''),f['content'],f['source']] for f in page['fields']],[1.85,2.65,4.8,6.1])
  p('明细字段或查询报表结果列。各列值均按本页筛选及业务身份归集。')
  table(['编号','字段名称','可能内容或计算结果','来源及取数规则'],[[f['id'],f['label'],f['content'],f['source']] for f in page['details']],[1.85,2.65,4.8,6.1])
  p('2 界面模板',boldlead='对应附件')
  p('Excel工作表“'+page['sheet']+'”；表头字段和明细列均标注上述编号。表头填写区直接注明填写方式及来源，明细首行注明取数或计算规则，空行作为重复明细区域。')
  p('3 功能需求及应用',boldlead='业务要求')
  p(page['actions']+'。',boldlead='页面操作')
  p(page['source'],boldlead='关联与取数')
  p(page['result'],boldlead='确认后的新增与回写')
  for ri,rule in enumerate(page['rules'],1):p(rule,boldlead=f'条件控制{ri}')
  p(page['basis']+'。具体未核实事项见附录C。',boldlead='依据说明')

'''+d[end:]
# Add flow diagrams at the relevant reading point, generated separately.
d=d.replace("h('第二部分 基础档案方案')", "p('图1 平台架构');d.add_picture(str(WORK/'figures/architecture.png'),width=Cm(15.4))\np('图2 主业务与数据流向');d.add_picture(str(WORK/'figures/main_flow.png'),width=Cm(15.4))\np('虚线或旁路说明不表示所有工序必须串行；实际前置条件由工艺路线决定。入库独立入口为拟建规则，原系统具体写入口仍待核实。')\nh('第二部分 基础档案方案')")
d=d.replace("h('第四部分 确认审批与异常处理')", "h('第四部分 确认审批与异常处理')\np('图3 下发前资料与工艺关系');d.add_picture(str(WORK/'figures/dispatch.png'),width=Cm(15.4))\np('图4 检验返工与复检');d.add_picture(str(WORK/'figures/quality.png'),width=Cm(15.4))\np('图5 受控更正流程');d.add_picture(str(WORK/'figures/correction.png'),width=Cm(15.4))")
d=d.replace("h('附录A 数据关系与统计口径')", "h('附录A 数据关系与统计口径')\np('图6 报表生成与穿透取数');d.add_picture(str(WORK/'figures/reporting.png'),width=Cm(15.4))")
d=d.replace("['订单构件','v1.order下getOrderArtifacts、submitArtifacts、downCodes等','O01、O02']", "['订单构件','v1.order下getOrderArtifacts、submitArtifacts（order_id与file_id）、downCodes等','P04、O01、O02']")
d=d.replace("['排产与下发','getSchedulings、setDepartment、setDesign、sendProduce','S01—S03']", "['排产与下发','getSchedulings、setDepartment、setDesign指定工艺、exportProduction、syncProduction、sendProduce','B04、S01—S03']")
d=d.replace("'本方案与Excel附件同版维护。", "'补充对照资料包括既有东吴云API参考及已使用请求封装：订单上传构件、指定工艺、导出排产分配文件再导入后下发均有调用依据；这些仅作为平台行为证据，不把本地自动化项目当作待建设平台。' )\np('本方案与Excel附件同版维护。")
d=d.replace('虚线或旁路说明不表示所有工序必须串行','主图箭头表示主要数据流向，不表示所有工序必须严格串行')
d=d.replace('图纸、清单和生产资料保留文件号','工艺路线版本与图纸文件版本分别维护。图纸、清单和生产资料保留文件号')
d=d.replace('实际发生时间落在期间内的有效工序完成量','实际发生时间落在期间内的有效工序完成量')
d=d.replace('组立','装焊报检').replace('焊接','涂装')
# Keep long field tables readable; allow headers to repeat without chained paragraph keeps.
d=d.replace("for para in c.paragraphs:\n    para.paragraph_format.space_after", "for para in c.paragraphs:\n    para.paragraph_format.keep_with_next=False\n    para.paragraph_format.space_after")
d=d.replace("t=d.add_table(rows=1,cols=len(headers));t.autofit=False", "t=d.add_table(rows=1,cols=len(headers));t.autofit=False\n if widths:\n  for column,width in zip(t.columns,widths):column.width=Cm(width)")
d=d.replace("else:x.add_run(text)\n return x", "else:x.add_run(text)\n if text.startswith('图') and len(text)<40:x.paragraph_format.keep_with_next=True\n return x")
(W/'build_docx.py').write_text(d,encoding='utf8')
print('Builders revised')
