import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const work=path.dirname(fileURLToPath(import.meta.url));
const out=path.dirname(work), spec=JSON.parse(await fs.readFile(path.join(work,'spec.json'),'utf8'));
const wb=Workbook.create();
const index=wb.worksheets.add('00_页面目录');
const sheets=new Map(spec.pages.map(p=>[p.code,wb.worksheets.add(p.sheet)]));
const defs=wb.worksheets.add('Z01_字段填写说明');
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
note(index,4,'标识','*表示必填；浅黄色区域表示人工录入或选择，浅灰色表示系统带出或计算。文字为填写说明，不是真实业务数据。',7);
note(index,5,'边界','模板展示的是拟建页面和业务规则，按钮、扫码、审批、跨表取数需在平台开发实现；Excel不是已运行的业务系统。',7);
header(index,7,['页面编号','所属模块','页面名称','页面类型','使用角色','对应工作表','业务用途']);
index.getRange('A8').write(spec.pages.map(p=>[p.code,p.module,p.name,({form:'操作表单',list:'查询台账',report:'统计报表',print:'打印模板'})[p.kind],p.role,p.sheet,p.purpose]));
index.getRange('A8:G47').format.rowHeight=47;
for(const [c,w] of [['A',85],['B',130],['C',185],['D',95],['E',190],['F',215],['G',430]])index.getRange(`${c}1:${c}52`).format.columnWidthPx=w;
note(index,49,'配套说明','Z01列出表头字段填写方式；Z02使用明确标注的虚拟数据演示时间与计量口径；Z03列出初稿规则及定稿事项。',7);
note(index,50,'资料依据','2025-09-18 OA项目管理方案、2025-09-30 V2合同管理表单、2026-10东吴云前端及部分接口核查记录。原文件仅作参考，未修改。',7);
index.freezePanes.freezeRows(7);register(index,50,7,28);

for(const p of spec.pages){
 const s=sheets.get(p.code);base(s);
 merged(s,1,0,11,`${p.code}  ${p.name}`,null,true,38).format.font.size=16;
 note(s,2,'用途',p.purpose);
 note(s,3,'使用角色',p.role+'；依据：'+p.basis);
 section(s,5,p.kind==='list'||p.kind==='report'?'查询条件':'基本信息');
 let r=6;
 p.fields.forEach((f,i)=>{
   const a=i%2?6:0;
   merged(s,r,a,a+1,f.label+(f.required?' *':''),'#F0F0F0',true,46);
   const auto=/自动|系统|当前用户|来源.*带出|任务带出|明细.*汇总|成功下发|继承/.test(f.hint);
   merged(s,r,a+2,a+5,f.hint,auto?'#F3F4F5':'#FFF4D6',false,46);
   s.getRange(`${col(a)}${r}:${col(a+5)}${r}`).format.borders={preset:'all',style:'thin',color:'#C7CCD1'};
   dictionary.push([p.code,p.name,`${col(a+2)}${r}`,f.label,f.required?'是':'按场景或选填',auto?'系统带出或计算':'人工填写或选择',f.hint]);
   if(i%2===1||i===p.fields.length-1)r++;
 });
 r++;section(s,r++,p.kind==='report'?'统计结果布局':p.kind==='list'?'查询结果布局':'明细区域');
 const hr=r;header(s,r++,p.cols);
 const first=r;
 for(let k=0;k<3;k++,r++){
   const row=p.cols.map((label,j)=>{
     if(k!==0)return '';
     if(/入口|操作|链接/.test(label))return '点击查看';
     if(/二维码/.test(label))return '系统生成码';
     if(p.kind==='print'||p.kind==='list')return '系统带出';
     if(p.kind==='report')return /率|件|重量|数量|次数|累计|期初|本期|调整/.test(label)?'系统计算':'系统带出';
     if(/本次|合格件|不合格件|待处理件|原值|申请新值|处置|缺陷|备注|前置工序|报工单位|显示名称|是否|顺序|角色名称|模块或页面|查看|新增修改|确认提交|撤销更正|导出打印|数据范围/.test(label))return /重量|原值/.test(label)?'自动计算或带出':'填写或选择';
     if(/重量|总重/.test(label))return '数量×单重';
     if(/待排|可选|可派|可报|可入库|可装包|可发|待下发|余额/.test(label))return '余额自动计算';
     return '来源自动带出';
   });
   s.getRange(`A${r}:${col(p.cols.length-1)}${r}`).values=[row];
   s.getRange(`A${r}:${col(p.cols.length-1)}${r}`).format.rowHeight=43;
 }
 s.getRange(`A${hr}:${col(p.cols.length-1)}${r-1}`).format.borders={preset:'all',style:'thin',color:'#C7CCD1'};
  p.cols.forEach((label,j)=>dictionary.push([p.code,p.name,`${col(j)}${hr}列`,label,'按本页业务规则',s.getRange(`${col(j)}${first}`).values[0][0],`明细列；数据来源：${p.source} 校验见本页规则。`]));
 note(s,r++,'明细说明','以上为重复明细区域，正式页面支持增行或分页；查询合计按全部匹配记录计算，不限当前页。');
 note(s,r++,'页面操作',p.actions);
 r++;section(s,r++,'取数与业务控制');
 note(s,r++,'数据来源',p.source);
 note(s,r++,'后续流向',p.result);
 for(let j=0;j<p.rules.length;j++)note(s,r++,`规则${j+1}`,p.rules[j]);
 if(p.code==='T04')note(s,r++,'二维码','明细最后一列为二维码占位；平台生成的任务／构件码需通过扫码验收。此Excel不含虚构可用码。');
 note(s,r++,'配套方案',`Word第三部分 ${p.module}，页面编号 ${p.code}；各字段按本页取数规则实现，枚举参照基础字典。`);
 if(p.kind==='list'||p.kind==='report')s.freezePanes.freezeRows(hr);
 register(s,r-1);
}
base(defs,7,dictionary.length+8);
merged(defs,1,0,6,'页面表头字段填写说明',null,true,38).format.font.size=16;
note(defs,2,'使用方式','本表定位各页面表头和明细列，说明填写方式与来源。明细必填及余额、状态校验以对应页面规则为准。',7);
header(defs,4,['页面编号','页面名称','字段位置','字段名称','必填要求','填写方式','来源与填写说明']);
defs.getRange('A5').write(dictionary);defs.getRange(`A5:G${dictionary.length+4}`).format.rowHeight=39;
for(const [c,w]of[['A',90],['B',180],['C',90],['D',175],['E',160],['F',175],['G',440]])defs.getRange(`${c}1:${c}${dictionary.length+5}`).format.columnWidthPx=w;
defs.freezePanes.freezeRows(4);register(defs,dictionary.length+4,7,24);

base(pending,6,18);merged(pending,1,0,5,'定稿确认事项',null,true,38).format.font.size=16;
note(pending,2,'说明','不影响先行阅读方案。以下仅对未核实的旧行为和企业管理口径定稿，当前处理方式已写入模板。',6);
header(pending,4,['编号','事项','已知边界','本版处理方式','确认岗位','验收样例']);
pending.getRange('A5').write(spec.pending);pending.getRange('A5:F14').format.rowHeight=82;
for(const [c,w]of[['A',65],['B',150],['C',300],['D',390],['E',130],['F',270]])pending.getRange(`${c}1:${c}17`).format.columnWidthPx=w;
register(pending,14,6);

base(demo,10,42);merged(demo,1,0,9,'统计口径示例',null,true,38).format.font.size=16;
note(demo,2,'数据性质','全部为虚拟验收数据。用于说明补录、撤销、不同工序与最终完工的关系，不代表东吴云实际数据。',10);
note(demo,3,'计量说明','时间按业务发生日；重量kg＝数量×单重；示例只演示工序日报，最终完工须另按适用路线判断。',10);
header(demo,5,['记录号','构件标识','工序','业务日期','录入日期','数量件','单重kg','有效标识','重量kg','说明']);
const serial=s=>Math.round((Date.parse(s+'T00:00:00Z')-Date.parse('1899-12-30T00:00:00Z'))/86400000);
demo.getRange('A6:J9').values=[
 ['EV01','GZ01-001','组立',serial('2026-10-29'),serial('2026-10-30'),1,500,1,null,'跨日补录'],
 ['EV02','GZ01-001','焊接',serial('2026-10-30'),serial('2026-10-30'),1,500,1,null,'同件另一工序'],
 ['EV03','GZ01-002','组立',serial('2026-10-29'),serial('2026-10-29'),1,300,0,null,'已撤销原记录'],
 ['EV04','GZ01-002','组立',serial('2026-10-30'),serial('2026-10-31'),1,300,1,null,'更正后记录']];
demo.getRange('D6:E9').setNumberFormat('yyyy-mm-dd');
demo.getRange('I6:I9').formulas=Array.from({length:4},(_,i)=>[`=F${i+6}*G${i+6}`]);
demo.getRange('A6:J9').format.rowHeight=39;
header(demo,12,['统计日期','工序','有效完成件','有效重量kg']);
demo.getRange('A13:B16').values=[[serial('2026-10-29'),'组立'],[serial('2026-10-30'),'组立'],[serial('2026-10-30'),'焊接'],[serial('2026-10-31'),'组立']];
demo.getRange('A13:A16').setNumberFormat('yyyy-mm-dd');
for(let r=13;r<=16;r++){
demo.getRange(`C${r}`).formulas=[[`=SUMIFS($F$6:$F$9,$D$6:$D$9,A${r},$C$6:$C$9,B${r},$H$6:$H$9,1)`]];
demo.getRange(`D${r}`).formulas=[[`=SUMIFS($I$6:$I$9,$D$6:$D$9,A${r},$C$6:$C$9,B${r},$H$6:$H$9,1)`]];
}
note(demo,18,'解释一','10月29日组立为1件500kg。EV01虽在30日补录仍属于29日；已撤销EV03不计入有效产量。',10);
note(demo,19,'解释二','10月30日组立1件300kg，焊接1件500kg。两工序合计800kg不能直接当成最终完工重量。',10);
note(demo,20,'解释三','10月31日组立发生量为0。EV04当天录入，但业务发生日为30日；补录操作量应另列。',10);
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
await exported.save(path.join(out,'OA生产管理平台_页面表单与报表模板.xlsx'));
await fs.writeFile(path.join(work,'sheet_manifest.json'),JSON.stringify(manifest,null,2));
console.log(`EXPORTED ${manifest.length} sheets, ${dictionary.length} header fields; example formulas verified.`);
await fs.mkdir(path.join(work,'sheet_previews'),{recursive:true});
for(const [i,m]of manifest.entries()){
 const blob=await wb.render({sheetName:m.name,range:m.range,scale:1.3,format:'png'});
 await fs.writeFile(path.join(work,'sheet_previews',m.name+'.png'),new Uint8Array(await blob.arrayBuffer()));
 console.log(`RENDER ${i+1}/${manifest.length} ${m.name}`);
}
