import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const work=path.dirname(fileURLToPath(import.meta.url));
const out=path.dirname(work), spec=JSON.parse(await fs.readFile(path.join(work,'spec.json'),'utf8'));
const wb=Workbook.create();
const index=wb.worksheets.add('00_页面目录');
const sheets=new Map(spec.pages.map(p=>[p.code,wb.worksheets.add(p.sheet)]));
const defs=wb.worksheets.add('Z01_字段对应索引');
const enums=wb.worksheets.add('01_基础选项字典');
const demo=wb.worksheets.add('Z02_统计口径示例');
const pending=wb.worksheets.add('Z03_定稿确认事项');
const manifest=[]; const dictionary=[];
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
function base(s,n=12,rows=75){
 s.showGridLines=false;
 const r=s.getRange(`A1:${col(n-1)}${rows}`);
 r.format.font={name:'Microsoft YaHei',size:11,color:'#222222'};
 r.format.columnWidthPx=96; r.format.rowHeight=25;
 r.format.verticalAlignment='center'; r.format.wrapText=true;
}
function merged(s,r,a,b,text,fill=null,bold=false,height=30){
 const g=s.getRange(`${col(a)}${r}:${col(b)}${r}`); if(a!==b)g.merge();
 s.getRange(`${col(a)}${r}`).values=[[text]];
 g.format.rowHeight=height;g.format.font.bold=bold;
 if(fill)g.format.fill=fill;
 return g;
}
function section(s,r,text,n=12){merged(s,r,0,n-1,text,'#D9E5EF',true,27);}
function header(s,r,labels){
 s.getRange(`A${r}:${col(labels.length-1)}${r}`).values=[labels];
 const g=s.getRange(`A${r}:${col(labels.length-1)}${r}`);
 g.format.fill='#E4E4E4';g.format.font.bold=true;g.format.horizontalAlignment='center';g.format.rowHeight=42;
 g.format.borders={preset:'all',style:'thin',color:'#AEB7C0'};
}
function note(s,r,label,text,n=12){merged(s,r,0,n-1,`${label}：${text}`,null,false,Math.max(32,Math.ceil((label.length+text.length+1)/(n*5.1))*20+10));}
function register(s,end,n=12,renderEnd=end){manifest.push({name:s.name,end,n,range:`A1:${col(n-1)}${renderEnd}`});}

base(index,7,60);
merged(index,1,0,6,'OA生产管理平台 页面表单与报表模板',null,true,40).format.font.size=17;
note(index,2,'版本',`${spec.version}  编制日期 ${spec.date}  建设方式 从零搭建并替代东吴云`,7);
note(index,3,'使用说明','每个业务页面独立一个工作表；页内展示表头、明细、操作和规则。与Word按页面编号一一对应。',7);
note(index,4,'标识','*表示必填；H为表头编号，D为明细编号；填写区直接注明来源。红字为人工填写或选择提示，蓝字为取数或计算说明；均为开发说明。',7);
note(index,5,'边界','模板展示的是拟建页面和业务规则，按钮、扫码、审批、跨表取数需在平台开发实现；Excel不是已运行的业务系统。',7);
header(index,7,['页面编号','所属模块','页面名称','页面类型','使用角色','对应工作表','业务用途']);
index.getRange('A8').write(spec.pages.map(p=>[p.code,p.module,p.name,({form:'操作表单',list:'查询台账',report:'统计报表',print:'打印模板'})[p.kind],p.role,p.sheet,p.purpose]));
index.getRange(`A8:G${spec.pages.length+7}`).format.rowHeight=47;
for(const [c,w] of [['A',85],['B',130],['C',185],['D',95],['E',190],['F',215],['G',430]])index.getRange(`${c}1:${c}52`).format.columnWidthPx=w;
note(index,50,'配套说明','01基础选项字典与Word第二部分同版；Z01按编号定位全部表头和明细字段；Z02使用明确标注的虚拟数据演示时间与计量口径；Z03列出初稿规则及定稿事项。',7);
note(index,51,'资料依据','2025-09-18 OA项目管理方案、2025-09-30 V2合同管理表单、2026-10东吴云前端及部分接口核查记录。原文件仅作参考，未修改。',7);
index.freezePanes.freezeRows(7);register(index,51,7,51);


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

base(pending,6,18);merged(pending,1,0,5,'定稿确认事项',null,true,38).format.font.size=16;
note(pending,2,'说明','不影响先行阅读方案。以下仅对未核实的旧行为和企业管理口径定稿，当前处理方式已写入模板。',6);
header(pending,4,['编号','事项','已知边界','本版处理方式','确认岗位','验收样例']);
pending.getRange('A5').write(spec.pending);pending.getRange(`A5:F${spec.pending.length+4}`).format.rowHeight=92;
for(const [c,w]of[['A',65],['B',150],['C',300],['D',390],['E',130],['F',270]])pending.getRange(`${c}1:${c}17`).format.columnWidthPx=w;
register(pending,spec.pending.length+4,6);

base(demo,10,42);merged(demo,1,0,9,'统计口径示例',null,true,38).format.font.size=16;
note(demo,2,'数据性质','全部为虚拟验收数据。用于说明补录、撤销、不同工序与最终完工的关系，不代表东吴云实际数据。',10);
note(demo,3,'计量说明','时间按业务发生日；重量kg＝数量×单重；示例只演示工序日报，最终完工须另按适用路线判断。',10);
header(demo,5,['记录号','构件标识','工序','业务日期','录入日期','数量件','单重kg','有效标识','重量kg','说明']);
const serial=s=>Math.round((Date.parse(s+'T00:00:00Z')-Date.parse('1899-12-30T00:00:00Z'))/86400000);
demo.getRange('A6:J9').values=[
 ['EV01','GZ01-001','装焊报检',serial('2026-10-29'),serial('2026-10-30'),1,500,1,null,'跨日补录'],
 ['EV02','GZ01-001','涂装',serial('2026-10-30'),serial('2026-10-30'),1,500,1,null,'同件另一工序'],
 ['EV03','GZ01-002','装焊报检',serial('2026-10-29'),serial('2026-10-29'),1,300,0,null,'已撤销原记录'],
 ['EV04','GZ01-002','装焊报检',serial('2026-10-30'),serial('2026-10-31'),1,300,1,null,'更正后记录']];
demo.getRange('D6:E9').setNumberFormat('yyyy-mm-dd');
demo.getRange('I6:I9').formulas=Array.from({length:4},(_,i)=>[`=F${i+6}*G${i+6}`]);
demo.getRange('A6:J9').format.rowHeight=39;
header(demo,12,['统计日期','工序','有效完成件','有效重量kg']);
demo.getRange('A13:B16').values=[[serial('2026-10-29'),'装焊报检'],[serial('2026-10-30'),'装焊报检'],[serial('2026-10-30'),'涂装'],[serial('2026-10-31'),'装焊报检']];
demo.getRange('A13:A16').setNumberFormat('yyyy-mm-dd');
for(let r=13;r<=16;r++){
demo.getRange(`C${r}`).formulas=[[`=SUMIFS($F$6:$F$9,$D$6:$D$9,A${r},$C$6:$C$9,B${r},$H$6:$H$9,1)`]];
demo.getRange(`D${r}`).formulas=[[`=SUMIFS($I$6:$I$9,$D$6:$D$9,A${r},$C$6:$C$9,B${r},$H$6:$H$9,1)`]];
}
note(demo,18,'解释一','10月29日装焊报检为1件500kg。EV01虽在30日补录仍属于29日；已撤销EV03不计入有效产量。',10);
note(demo,19,'解释二','10月30日装焊报检1件300kg，涂装1件500kg。两工序合计800kg不能直接当成最终完工重量。',10);
note(demo,20,'解释三','10月31日装焊报检发生量为0。EV04当天录入，但业务发生日为30日；补录操作量应另列。',10);
note(demo,21,'系统实现','Excel公式只演示本例。正式平台需保留撤销、更正关系及报表版本，不能靠手改有效标识完成业务审计。',10);
demo.getRange('A1:B23').format.columnWidthPx=145;
demo.getRange('D1:E23').format.columnWidthPx=135;
demo.getRange('J1:J23').format.columnWidthPx=185;
register(demo,21,10);

wb.recalculate();
const check=await wb.inspect({kind:'table',range:"'Z02_统计口径示例'!A12:D16",include:'values,formulas',tableMaxRows:6,tableMaxCols:4});
await fs.writeFile(path.join(work,'formula_check.txt'),check.ndjson);
const vals=demo.getRange('C13:D16').values;
if(JSON.stringify(vals)!==JSON.stringify([[1,500],[1,300],[1,500],[0,0]]))throw Error('Demo formula mismatch '+JSON.stringify(vals));
demo.getRange('F6').values=[[2]];wb.recalculate();
if(demo.getRange('D13').values[0][0]!==1000)throw Error('Input change not propagated');
demo.getRange('F6').values=[[1]];wb.recalculate();
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!',options:{useRegex:true,maxResults:20},summary:'formula errors'});
await fs.writeFile(path.join(work,'formula_errors.txt'),errors.ndjson);
const exported=await SpreadsheetFile.exportXlsx(wb);
await exported.save(path.join(out,'OA生产管理平台_页面表单与报表模板_V2.xlsx'));
await fs.writeFile(path.join(work,'sheet_manifest.json'),JSON.stringify(manifest,null,2));
console.log(`EXPORTED ${manifest.length} sheets, ${dictionary.length} field definitions; example formulas verified.`);
await fs.mkdir(path.join(work,'sheet_previews'),{recursive:true});
for(const [i,m]of manifest.entries()){
 const blob=await wb.render({sheetName:m.name,range:m.range,scale:1.3,format:'png'});
 await fs.writeFile(path.join(work,'sheet_previews',m.name+'.png'),new Uint8Array(await blob.arrayBuffer()));
 console.log(`RENDER ${i+1}/${manifest.length} ${m.name}`);
}
