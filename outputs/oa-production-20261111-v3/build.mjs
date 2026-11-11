import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const input = 'I:/autoweb/autoribao/outputs/oa-production-20261031-v2/OA生产管理平台建设与应用方案-附件codex.xlsx';
const output = 'I:/autoweb/autoribao/outputs/oa-production-20261111-v3/OA生产管理平台建设与应用方案-附件_按原格式补全.xlsx';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const formTemplate = wb.worksheets.getItem('排产创建');
const ledgerTemplate = wb.worksheets.getItem('订单台账');
const detailTemplate = wb.worksheets.getItem('订单创建');

const manual = (text, source) => `填写\n来源：${source}${text ? `；${text}` : ''}`;
const select = (text, source) => `选择${text ? ` ${text}` : ''}\n来源：${source}`;
const system = (text, source) => `系统自动填写\n来源：${source}${text ? `；${text}` : ''}`;
const upload = (text, source) => `上传${text ? ` ${text}` : ''}\n来源：${source}`;
const pair = (code, label, description, required = false) => ({ label: `${code}\n${label}${required ? ' *' : ''}`, description });

function clearContents(sheet, range) { sheet.getRange(range).clear({ applyTo: 'contents' }); }
function setStyleBySource(sheet, cell, kind) {
  sheet.getRange(cell).format.font = { name: '微软雅黑', size: 11, color: kind === 'system' ? '#0070C0' : '#FF0000' };
}
function ensureMerge(sheet, address) {
  try { sheet.getRange(address).merge(); } catch { /* already merged in the supplied template */ }
}
function copyRow(sheet, targetRow, templateRow = 6) {
  sheet.getRange(`A${targetRow}:L${targetRow}`).copyFrom(formTemplate.getRange(`A${templateRow}:L${templateRow}`), 'all');
  clearContents(sheet, `A${targetRow}:L${targetRow}`);
  sheet.getRange(`A${targetRow}:L${targetRow}`).format.rowHeight = 64;
}
function copyDetailRows(sheet, titleRow, headers) {
  const width = Math.max(headers.length, 12);
  const end = String.fromCharCode(64 + width);
  sheet.getRange(`A${titleRow}:${end}${titleRow}`).copyFrom(detailTemplate.getRange(`A12:${end}12`), 'all');
  sheet.getRange(`A${titleRow + 1}:${end}${titleRow + 1}`).copyFrom(detailTemplate.getRange(`A13:${end}13`), 'all');
  sheet.getRange(`A${titleRow + 2}:${end}${titleRow + 2}`).copyFrom(detailTemplate.getRange(`A14:${end}14`), 'all');
  clearContents(sheet, `A${titleRow}:${end}${titleRow + 2}`);
  ensureMerge(sheet, `A${titleRow}:${end}${titleRow}`);
  sheet.getRange(`A${titleRow}`).values = [['明细模板']];
  sheet.getRange(`A${titleRow + 1}:${end}${titleRow + 1}`).values = [headers.concat(Array(width - headers.length).fill(null))];
  sheet.getRange(`A${titleRow + 2}:${end}${titleRow + 2}`).values = [Array(width).fill(null)];
  sheet.getRange(`A${titleRow}:${end}${titleRow}`).format.rowHeight = 28;
  sheet.getRange(`A${titleRow + 1}:${end}${titleRow + 1}`).format.rowHeight = 45;
  sheet.getRange(`A${titleRow + 2}:${end}${titleRow + 2}`).format.rowHeight = 55;
  return titleRow + 2;
}

function fillForm(name, title, fields, detail) {
  const sheet = wb.worksheets.getItem(name);
  const lastFieldRow = 1 + Math.ceil(fields.length / 2);
  const detailTitleRow = detail ? lastFieldRow + 3 : 0;
  const lastRow = detail ? detailTitleRow + 2 : lastFieldRow;
  if (name !== '排产创建') {
    clearContents(sheet, `A1:L${Math.max(lastRow, 20)}`);
    for (let r = 1; r <= lastRow; r++) copyRow(sheet, r, r === 1 ? 1 : 6);
    clearContents(sheet, `A1:L${Math.max(lastRow, 20)}`);
    sheet.getRange('A1:L1').copyFrom(formTemplate.getRange('A1:L1'), 'all');
    clearContents(sheet, 'A1:L1');
  } else {
    clearContents(sheet, `A1:L${Math.max(lastRow, 20)}`);
    for (let r = 7; r <= lastRow; r++) copyRow(sheet, r, 6);
  }
  ensureMerge(sheet, 'A1:L1'); sheet.getRange('A1').values = [[title]];
  for (let i = 0; i < fields.length; i++) {
    const row = 2 + Math.floor(i / 2);
    const col = i % 2 === 0 ? 'A' : 'G';
    const descCol = i % 2 === 0 ? 'C' : 'I';
    const f = fields[i];
    ensureMerge(sheet, `${col}${row}:${i % 2 === 0 ? 'B' : 'H'}${row}`);
    ensureMerge(sheet, `${descCol}${row}:${i % 2 === 0 ? 'F' : 'L'}${row}`);
    sheet.getRange(`${col}${row}`).values = [[f.label]];
    sheet.getRange(`${descCol}${row}`).values = [[f.description]];
    setStyleBySource(sheet, `${descCol}${row}`, f.kind || 'manual');
  }
  if (detail) copyDetailRows(sheet, detailTitleRow, detail.headers);
  sheet.freezePanes.freezeRows(detail ? detailTitleRow + 1 : 1);
}

function fillLedger(name, title, filters, headers, operations, rows = 1) {
  const sheet = wb.worksheets.getItem(name);
  const last = Math.max(8, 7 + rows);
  clearContents(sheet, `A1:L${last}`);
  // 复用订单台账的标题、筛选和台账表头样式。
  sheet.getRange(`A1:L${last}`).copyFrom(ledgerTemplate.getRange(`A1:L${Math.min(last, 10)}`), 'all');
  clearContents(sheet, `A1:L${last}`);
  ensureMerge(sheet, 'A1:L1'); sheet.getRange('A1').values = [[title]];
  for (let i = 0; i < filters.length; i++) {
    const row = 2 + Math.floor(i / 2);
    const col = i % 2 === 0 ? 'A' : 'G';
    const descCol = i % 2 === 0 ? 'C' : 'I';
    ensureMerge(sheet, `${col}${row}:${i % 2 === 0 ? 'B' : 'H'}${row}`);
    ensureMerge(sheet, `${descCol}${row}:${i % 2 === 0 ? 'F' : 'L'}${row}`);
    sheet.getRange(`${col}${row}`).values = [[filters[i].label]];
    sheet.getRange(`${descCol}${row}`).values = [[filters[i].description]];
    setStyleBySource(sheet, `${descCol}${row}`, 'manual');
  }
  const titleRow = Math.max(6, 4 + Math.ceil(filters.length / 2));
  ensureMerge(sheet, `A${titleRow}:L${titleRow}`); sheet.getRange(`A${titleRow}`).values = [['查询台账模板']];
  sheet.getRange(`A${titleRow + 1}:L${titleRow + 1}`).values = [headers.concat(Array(12 - headers.length).fill(null))];
  sheet.getRange(`A${titleRow + 2}:L${titleRow + 2}`).values = [operations.concat(Array(12 - operations.length).fill(null))];
  sheet.getRange(`A${titleRow + 1}:L${titleRow + 1}`).format.rowHeight = 42;
  sheet.getRange(`A${titleRow + 2}:L${titleRow + 2}`).format.rowHeight = 45;
  if (rows > 1) {
    for (let r = titleRow + 3; r < titleRow + 2 + rows; r++) {
      sheet.getRange(`A${r}:L${r}`).copyFrom(ledgerTemplate.getRange('A8:L8'), 'all');
      clearContents(sheet, `A${r}:L${r}`);
    }
  }
  sheet.getRange(`A${titleRow + 2}`).values = [[operations.join('、')]];
  sheet.freezePanes.freezeRows(titleRow + 1);
}

const formData = {
  '排产创建': {
    title: '基本信息',
    fields: [
      [pair('S01-H01','排产编号',system('唯一编号','排产创建保存成功后系统生成'),false),'system'],
      [pair('S01-H02','排产名称',manual('计划员维护本批名称','排产人员填写'),true),'manual'],
      [pair('S01-H03','来源订单',select('O02有效订单','订单台账；只显示当前项目范围内状态为待排产或部分排产的订单'),true),'manual'],
      [pair('S01-H04','所属项目',system('由订单带出','订单创建.所属项目'),true),'system'],
      [pair('S01-H05','工艺路线',select('已启用工艺路线','工序与工艺路线；选择后展示本路线全部工序、前置条件和检验要求'),true),'manual'],
      [pair('S01-H06','计划开始日期',manual('填写本批计划开始日期','排产人员维护本单字段'),true),'manual'],
      [pair('S01-H07','计划结束日期',manual('填写本批计划结束日期','排产人员维护本单字段'),true),'manual'],
      [pair('S01-H08','订单需求日期',system('只读','订单创建.计划结束日期'),false),'system'],
      [pair('S01-H09','排产计划表Excel',upload('含构件、数量和生产班组的排产计划表','排产人员上传；系统保存文件名、版本、上传人和上传时间'),true),'manual'],
      [pair('S01-H10','编制人',system('当前用户','人员与权限.当前登录OA账号'),true),'system'],
      [pair('S01-H11','排产状态',system('草稿、校验失败、待下发、已下发、生产中、已完成、已取消','排产保存、导入校验、确认下发及生产进度自动更新'),false),'system'],
      [pair('S01-H12','计划说明',manual('填写本批计划说明','排产人员维护本单字段'),false),'manual'],
    ],
    detail:{headers:['序号','订单明细ID','构件编号','构件GUID','本次排产数量件','生产班组编码','生产班组名称','所属车间','备注','导入校验结果','匹配班组长','匹配车间负责人']}
  },
  '排产任务分派': {
    title:'排产任务分派',
    fields:[
      [pair('S03-H01','排产编号',system('只读','排产创建.排产编号'),true),'system'],
      [pair('S03-H02','来源订单',system('只读','排产创建.来源订单'),true),'system'],
      [pair('S03-H03','工艺路线及版本',system('只读','排产创建.工艺路线及启用版本；本页展示具体工序清单'),true),'system'],
      [pair('S03-H04','导入文件及版本',system('只读','排产创建.排产计划表Excel上传记录'),true),'system'],
      [pair('S03-H05','匹配规则',system('只读','生产班组编码优先；无编码时按班组名称＋所属车间匹配；人员取平台设置'),true),'system'],
      [pair('S03-H06','下发范围',system('按车间、生产班组分组','排产Excel明细及组织架构、班组检验人员配置'),true),'system'],
      [pair('S03-H07','校验结果',system('通过或失败；失败定位文件源行及字段','订单构件、数量余额、班组、班组长、车间负责人、探伤人员、质检人员'),true),'system'],
      [pair('S03-H08','下发人',system('当前用户','人员与权限.当前登录OA账号'),true),'system'],
      [pair('S03-H09','下发时间',system('成功下发时记录','系统服务器时间'),false),'system'],
      [pair('S03-H10','下发状态',system('未下发、部分下发、已下发','生产任务生成结果及下发数量'),false),'system'],
      [pair('S03-H11','下发说明',manual('填写下发备注','生产负责人维护本次下发说明'),false),'manual'],
      [pair('S03-H12','接收人通知',system('自动通知班组长、车间负责人及配置的其他接收人','排产任务分派确认下发成功后生成待办'),false),'system'],
    ],
    detail:{headers:['序号','构件编号','本次数量件','生产班组','班组长','车间负责人','探伤人员','质检人员','涂装班组','校验结果','任务编号','通知状态']}
  },
  '任务单与二维码': {
    title:'任务单与二维码', fields:[
      [pair('T04-H01','任务编号',select('生产任务单台账中的任务','生产任务单台账；也可直接扫描二维码定位'),true),'manual'],
      [pair('T04-H02','项目及订单',system('只读','生产任务.项目、订单'),true),'system'],
      [pair('T04-H03','生产车间及班组',system('只读','排产任务分派.匹配车间、生产班组'),true),'system'],
      [pair('T04-H04','班组长及车间负责人',system('只读','组织架构.负责人快照'),true),'system'],
      [pair('T04-H05','工艺路线及版本',system('只读','排产创建.工艺路线；任务保存下发时版本'),true),'system'],
      [pair('T04-H06','任务单文件',system('下载任务单及图纸版本','生产任务及订单上传文件版本'),false),'system'],
      [pair('T04-H07','二维码',system('一件一个二维码；补打沿用原二维码','任务ID＋单件追踪ID；扫码后校验登录用户和权限'),true),'system'],
      [pair('T04-H08','打印及补打记录',system('系统记录打印人、时间和数量','任务单与二维码打印操作日志'),false),'system'],
    ], detail:{headers:['序号','构件名称','构件编号','单件追踪ID','模型ID','规格/型号','单重kg','适用工序','计划日期','图纸版本','二维码内容','二维码图像']}
  },
  '工序报工': {
    title:'工序报工', fields:[
      [pair('E01-H01','构件二维码',manual('扫码定位具体实物件','任务单与二维码.二维码内容'),true),'manual'],
      [pair('E01-H02','任务编号',system('扫码带出只读','二维码关联生产任务'),true),'system'],
      [pair('E01-H03','项目、订单、构件编号',system('扫码带出只读','生产任务及订单创建.项目、订单、构件身份'),true),'system'],
      [pair('E01-H04','生产班组',system('只读','生产任务下发时的生产班组快照'),true),'system'],
      [pair('E01-H05','当前工序',select('路线中前置条件已满足的生产工序','工艺路线及版本节点；探伤、质检和涂装在相应页面办理'),true),'manual'],
      [pair('E01-H06','报工动作',select('开始或完成并报检','工序与工艺路线.节点类型和完成条件'),true),'manual'],
      [pair('E01-H07','实际开始时间',manual('填写实际开始时间；默认当前时间','生产人员按实际发生填写；提交时间另由系统记录'),false),'manual'],
      [pair('E01-H08','实际完成时间',manual('填写实际完成时间；默认当前时间','生产人员按实际发生填写；完成并签字后生效'),false),'manual'],
      [pair('E01-H09','工序追溯人',select('本班组实际参与人员，可多选','人员与权限.启用用户及工序岗位'),true),'manual'],
      [pair('E01-H10','签字确认人',system('当前登录用户','人员与权限.当前账号；必须本人登录签字'),true),'system'],
      [pair('E01-H11','签字内容',manual('现场手写签名','签名绑定构件、工序、追溯人、完成时间及记录版本'),true),'manual'],
      [pair('E01-H12','报检单号',system('完成并签字后自动生成','本次工序完成记录；不要求再次手工填写报检单'),false),'system'],
    ], detail:{headers:['序号','构件编号','单件追踪ID','工序','开始时间','完成时间','完成数量件','工序追溯人','签字人','签字时间','报检单号','提交状态']}
  },
  '生产质检': {
    title:'生产质检', fields:[
      [pair('Q01-H01','质检单号',system('生产报检成功后自动生成','工序报工.完成并报检记录'),true),'system'],
      [pair('Q01-H02','来源报检单号',system('只读','工序报工.自动生成报检单号'),true),'system'],
      [pair('Q01-H03','项目、订单、任务',system('只读','生产任务及订单创建关联'),true),'system'],
      [pair('Q01-H04','报检工序',system('只读','工序报工.当前工序'),true),'system'],
      [pair('Q01-H05','生产班组',system('只读','工序报工.生产班组快照'),true),'system'],
      [pair('Q01-H06','探伤任务责任人',system('平台自动匹配','班组检验人员配置.生产班组对应探伤人员'),true),'system'],
      [pair('Q01-H07','质检任务责任人',system('平台自动匹配','班组检验人员配置.生产班组对应质检人员'),true),'system'],
      [pair('Q01-H08','探伤实际检验时间',manual('探伤人员填写实际时间','探伤人员办理探伤任务；服务器另记提交时间'),true),'manual'],
      [pair('Q01-H09','质检实际检验时间',manual('质检人员填写实际时间','质检人员办理质检任务；服务器另记提交时间'),true),'manual'],
      [pair('Q01-H10','探伤结果及签字',manual('逐件填写结果、上传报告并签字','探伤人员本人登录；结果和签名独立保存'),true),'manual'],
      [pair('Q01-H11','质检结果及签字',manual('逐件填写结果并签字','质检人员本人登录；结果和签名独立保存'),true),'manual'],
      [pair('Q01-H12','涂装放行状态',system('探伤和质检对同一件均签字合格且未冻结时自动放行','探伤结果、质检结果、质量冻结标记'),false),'system'],
    ], detail:{headers:['序号','构件编号','单件追踪ID','检验类别','责任人','实际检验时间','结果','缺陷或结论','检验报告','签字人','签字时间','涂装放行']}
  },
  '构件打包单': {
    title:'构件打包单', fields:[
      [pair('W03-H01','包装编号',system('唯一编号','本页保存成功后系统生成'),false),'system'],
      [pair('W03-H02','所属项目',select('有效项目','项目台账；按权限取候选项目'),true),'manual'],
      [pair('W03-H03','来源订单',select('有效订单','订单台账；按已选项目过滤'),true),'manual'],
      [pair('W03-H04','包装名称',manual('填写本包名称','包装人员维护本单字段'),true),'manual'],
      [pair('W03-H05','包装时间',manual('填写实际包装时间','包装人员按实际业务填写'),true),'manual'],
      [pair('W03-H06','包装人',system('当前用户','人员与权限.当前登录用户'),true),'system'],
      [pair('W03-H07','可选构件',system('只显示已入库、双检通过、未冻结且未发货的构件','成品入库与库存；生产质检状态'),true),'system'],
      [pair('W03-H08','包装件数及重量t',system('按本包实物件明细自动合计','包装明细.数量及重量kg合计÷1000'),false),'system'],
      [pair('W03-H09','包装状态',system('草稿、有效包装、已撤销','本页保存、确认和撤销动作自动更新'),false),'system'],
      [pair('W03-H10','备注',manual('填写包装说明','包装人员维护本单字段'),false),'manual'],
    ], detail:{headers:['序号','构件编号','单件追踪ID','可装包件数','本次装包件数','单重kg','重量kg','质量状态','库存状态','包装人','包装时间','备注']}
  },
  '扫码发货': {
    title:'扫码发货', fields:[
      [pair('W05-H01','发货单号',system('唯一编号','保存发货草稿时系统生成'),false),'system'],
      [pair('W05-H02','所属项目',select('有效项目','项目台账；按权限取候选项目'),true),'manual'],
      [pair('W05-H03','来源订单',select('有效订单','订单台账；按已选项目过滤'),true),'manual'],
      [pair('W05-H04','发货方式',select('按包或按构件','发货人员选择；按包扫码后展开包内构件'),true),'manual'],
      [pair('W05-H05','实际发货时间',manual('填写实际装车发运时间','发货人员按实际业务填写'),true),'manual'],
      [pair('W05-H06','包装码或构件码',manual('扫码加入发货明细','构件打包单.包装二维码或任务单与二维码.构件二维码'),true),'manual'],
      [pair('W05-H07','收货单位及地址',system('从发货信息登记带出；本次发货可修改并留痕','发货信息登记'),true),'system'],
      [pair('W05-H08','车辆信息',system('从发货信息登记带出','发货信息登记.车牌号、驾驶员、承运单位'),true),'system'],
      [pair('W05-H09','质量及涂装校验',system('双检通过、涂装完成、未冻结才允许确认','生产质检、涂装扫码签字、成品入库与库存'),true),'system'],
      [pair('W05-H10','发货件数及重量t',system('按本单有效实物件自动合计','发货明细.数量及重量kg合计÷1000'),false),'system'],
      [pair('W05-H11','发货经办人',system('当前用户','人员与权限.当前登录用户'),true),'system'],
      [pair('W05-H12','确认发货',manual('确认后同步生成出库流水','本页确认成功；重复提交不重复发货'),true),'manual'],
    ], detail:{headers:['序号','包装编号','构件编号','单件追踪ID','可发件数','本次发货件数','单重kg','重量kg','库存检查','质量检查','装车状态','备注']}
  },
  '发货信息登记': {
    title:'发货信息登记', fields:[
      [pair('W05-H13','发货单号',select('扫码发货草稿','扫码发货.发货单号；本页不另建发货单'),true),'manual'],
      [pair('W05-H14','收货单位',manual('填写本次收货单位','发货人员维护本次发运资料'),true),'manual'],
      [pair('W05-H15','收货地址',manual('默认项目地址，可按实际收货点修改','项目自动创建.项目地址；本次修改留痕'),true),'manual'],
      [pair('W05-H16','收货联系人及电话',manual('填写本次收货联系人和电话','发货人员维护本次发运资料'),true),'manual'],
      [pair('W05-H17','车牌号',manual('填写实际运输车辆','发货人员维护本次发运资料'),true),'manual'],
      [pair('W05-H18','驾驶员及电话',manual('填写实际驾驶员和电话','发货人员维护本次发运资料'),false),'manual'],
      [pair('W05-H19','承运单位',manual('填写运输单位','发货人员维护本次发运资料'),false),'manual'],
      [pair('W05-H20','过磅净重kg',manual('填写车辆过磅净重并上传磅单','发货人员上传磅单；不覆盖构件理论重量'),false),'manual'],
      [pair('W05-H21','发货附件',upload('磅单、装车照片等','发货人员上传；系统保存文件名、版本、上传人和时间'),false),'manual'],
      [pair('W05-H22','登记人及登记时间',system('当前用户及保存时间','人员与权限.当前登录用户；系统服务器时间'),true),'system'],
    ]
  },
  '撤销与更正': {
    title:'撤销与更正', fields:[
      [pair('E03-H01','申请编号',system('唯一编号','本页保存成功后系统生成'),false),'system'],
      [pair('E03-H02','业务类型',select('工序、检验、涂装、入库、包装或发货','原业务记录所在页面'),true),'manual'],
      [pair('E03-H03','原业务单号及构件',select('有效业务记录','生产过程记录、质检台账、发货台账等；保存原记录ID和版本'),true),'manual'],
      [pair('E03-H04','处理方式',select('撤销或更正','更正＝撤销原记录并新增更正记录；不原地覆盖原签字'),true),'manual'],
      [pair('E03-H05','申请原因',manual('填写申请原因','申请人维护本单字段'),true),'manual'],
      [pair('E03-H06','申请人及申请时间',system('当前用户及提交时间','人员与权限.当前登录用户；系统服务器时间'),true),'system'],
      [pair('E03-H07','下游影响',system('列出任务、质检、涂装、库存、包装、发货和报表引用','系统按原记录关联关系生成影响清单'),true),'system'],
      [pair('E03-H08','审核人及意见',manual('负责人填写审核意见','按工序、质量、仓库或发货责任岗位审核'),true),'manual'],
      [pair('E03-H09','执行结果',system('待审核、已驳回、待执行、已执行、执行失败','审核记录及系统执行结果'),false),'system'],
      [pair('E03-H10','新记录及新签字',system('执行更正后关联新业务记录和重新签字','原记录、原签名及新记录双向关联'),false),'system'],
    ], detail:{headers:['序号','对象标识','字段或动作','原值','申请新值','下游影响','审核意见','执行状态','原记录编号','新记录编号','申请人','执行时间']}
  },
  '组织架构': {
    title:'组织架构及班组检验人员配置', fields:[
      [pair('B01-H01','组织编号',manual('OA组织同步只读；平台补建班组时填写且唯一','OA组织架构；平台管理员补建班组'),true),'manual'],
      [pair('B01-H02','组织名称',manual('OA组织同步只读；平台补建班组时填写','OA组织架构；平台管理员补建班组'),true),'manual'],
      [pair('B01-H03','组织类型',select('公司、工厂、车间、部门、班组','组织架构字典'),true),'manual'],
      [pair('B01-H04','上级组织／所属车间',select('组织树节点','组织架构；班组必须挂在车间下'),true),'manual'],
      [pair('B01-H05','生产班组标识',select('是或否','管理员配置；排产Excel只能匹配启用生产班组'),true),'manual'],
      [pair('B01-H06','组织负责人',select('启用用户','人员与权限.用户账号'),true),'manual'],
      [pair('B01-H07','启用状态',select('启用或停用','组织架构维护；停用不删除历史业务'),true),'manual'],
      [pair('B01-H08','班组探伤人员',select('具备探伤角色的启用用户','人员与权限；按生产班组固定配置，排产下发自动匹配'),true),'manual'],
      [pair('B01-H09','班组质检人员',select('具备质检角色的启用用户','人员与权限；按生产班组固定配置，排产下发自动匹配'),true),'manual'],
      [pair('B01-H10','涂装班组',select('启用涂装班组','组织架构；双检通过后自动接收涂装任务'),true),'manual'],
      [pair('B01-H11','生效时间',system('配置保存时间','组织及班组检验人员配置版本'),true),'system'],
      [pair('B01-H12','配置版本',system('保存时递增','班组人员变更保存版本；已下发任务保留原人员快照'),false),'system'],
    ], detail:{headers:['组织编号','组织名称','组织类型','上级组织','所属车间','生产班组','组织负责人','探伤人员','质检人员','涂装班组','启用状态','生效时间']}
  },
  '人员与权限': {
    title:'人员与权限', fields:[
      [pair('B02-H01','用户账号',system('OA账号只读','OA用户中心；统一登录账号'),true),'system'],
      [pair('B02-H02','姓名及工号',system('OA同步只读','OA用户中心'),true),'system'],
      [pair('B02-H03','所属组织',system('OA同步只读','OA用户中心；关联组织架构'),true),'system'],
      [pair('B02-H04','平台启用状态',select('启用或停用','系统管理员维护；不修改OA账号状态'),true),'manual'],
      [pair('B02-H05','角色',select('系统管理员、计划员、班组长、生产人员、探伤人员、质检人员、仓库、发货等','本页角色配置'),true),'manual'],
      [pair('B02-H06','数据范围',select('本人、本组织、指定项目、全部授权数据','用户授权配置；与角色动作权限叠加'),true),'manual'],
      [pair('B02-H07','指定项目',select('有效项目，可多选','项目台账；数据范围为指定项目时必填'),false),'manual'],
      [pair('B02-H08','工序岗位',select('可操作的工序岗位','工序与工艺路线；用于追溯人和扫码操作范围'),false),'manual'],
      [pair('B02-H09','授权有效期',manual('填写起止日期，空表示长期有效','系统管理员维护'),false),'manual'],
      [pair('B02-H10','角色页面权限',select('查看、新增修改、确认提交、撤销更正、导出打印','管理员为角色配置；服务端同步校验'),true),'manual'],
    ], detail:{headers:['角色名称','页面','查看','新增修改','确认提交','撤销更正','导出打印','适用工序','数据范围','授权人','生效时间','状态']}
  },
  '工序与工艺路线': {
    title:'工序与工艺路线', fields:[
      [pair('B04-H01','路线编号',manual('填写唯一编号','工艺负责人维护；保存后不可修改'),true),'manual'],
      [pair('B04-H02','路线名称',manual('填写路线名称','工艺负责人维护'),true),'manual'],
      [pair('B04-H03','路线版本',manual('填写版本号；变更新建版本','工艺负责人维护；已下发任务固定原版本'),true),'manual'],
      [pair('B04-H04','适用构件类别',select('构件类型，可多选','订单创建.构件类型编码；只允许适用路线'),true),'manual'],
      [pair('B04-H05','启用状态',select('草稿、启用、停用','工艺负责人保存，生产负责人启用'),true),'manual'],
      [pair('B04-H06','最终完工条件',select('路线最终节点及必须合格的检验节点','路线节点明细；涂装前必须探伤、质检均通过'),true),'manual'],
      [pair('B04-H07','启用人及生效时间',system('启用动作的用户及时间','人员与权限.当前用户；系统服务器时间'),false),'system'],
      [pair('B04-H08','路线节点',system('读取下方工序明细','本页路线节点明细；每个订单排产选择后生成任务工序实例'),true),'system'],
      [pair('B04-H09','前置工序',select('本路线其他节点，可多选','路线节点；不得自引用或形成环'),true),'manual'],
      [pair('B04-H10','责任岗位',select('生产班组、探伤人员、质检人员、涂装班组','路线节点配置；具体人由班组配置自动匹配'),true),'manual'],
      [pair('B04-H11','检验及涂装要求',manual('填写标准或上传工艺文件','路线节点配置；任务单按版本带出'),false),'manual'],
    ], detail:{headers:['节点顺序','工序编码','工序名称','节点类型','前置节点','责任岗位','是否必经','是否检验节点','完成条件','检验标准','涂装要求','是否最终节点']}
  },
};

const ledgerData = {
  '生产过程记录': {
    filters:[pair('','项目／订单／任务',select('关联单据','项目台账、订单台账、生产任务单台账')),pair('','构件编号／单件追踪ID',manual('输入关键词或扫码','订单创建构件身份、任务单与二维码')),pair('','工序／生产班组',select('工序和班组','工序与工艺路线、组织架构、工序报工快照')),pair('','追溯人／签字人',select('人员','人员与权限；工序报工、生产质检和涂装签字记录')),pair('','实际发生时间范围',manual('选择起止日期时间','工序报工、生产质检、涂装扫码签字的实际业务时间')),pair('','记录状态',select('有效、已撤销、已更正','生产过程记录；默认只显示有效记录'))],
    headers:['ID','来源单号','构件编号','单件追踪ID','工序／动作','生产班组','追溯人','签字人','实际发生时间','数量件','有效状态','操作'], ops:['详情、查看签名、申请撤销或更正']
  },
  '排产台账': {
    filters:[pair('','项目名称',select('项目','项目台账；按权限取有效项目')),pair('','订单编号',manual('输入关键词','订单台账.订单编号')),pair('','排产编号',manual('输入关键词','排产创建.排产编号')),pair('','生产班组',select('启用生产班组','组织架构；按排产任务分派匹配班组')),pair('','计划日期范围',manual('选择起止日期','排产创建.计划开始、计划结束')),pair('','排产状态',select('草稿、待下发、已下发、生产中、已完成、已取消','排产创建.排产状态'))],
    headers:['ID','排产编号','排产名称','项目名称','订单编号','工艺路线','计划开始','计划结束','排产数量件','已下发件数','排产状态','操作'], ops:['编辑、详情、下发、撤销']
  },
  '生产任务单台账': {
    filters:[pair('','我的任务',select('是或否','当前登录用户；班组长看本班组，车间负责人看本车间')),pair('','项目／订单／排产',select('关联单据','项目台账、订单台账、排产台账')),pair('','任务编号／构件编号',manual('输入关键词或扫码','生产任务单及任务单与二维码')),pair('','生产车间／班组',select('组织','组织架构；任务下发时快照')),pair('','工序／任务状态',select('待生产、生产中、待检验、待涂装、已完成、已取消','工序与工艺路线及生产过程记录'))],
    headers:['ID','任务编号','项目名称','订单编号','车间','生产班组','班组长','工艺路线','任务数量件','双检通过件','涂装完成件','操作'], ops:['详情、下载任务单、扫码办理']
  },
  '质检台账': {
    filters:[pair('','项目／订单／任务',select('关联单据','项目台账、订单台账、生产任务单台账')),pair('','构件编号／二维码',manual('输入关键词或扫码','订单创建构件身份、任务单二维码')),pair('','生产班组／检验人员',select('组织或人员','组织架构、人员与权限、质检责任人')),pair('','探伤状态',select('待检、已签字合格、已签字不合格、待复检','生产质检.探伤任务结果')),pair('','质检状态',select('待检、已签字合格、已签字不合格、待复检','生产质检.质检任务结果')),pair('','检验日期范围',manual('选择起止日期','生产质检.实际检验时间'))],
    headers:['ID','质检单号','报检单号','构件编号','单件追踪ID','生产班组','探伤结果','探伤签字人','质检结果','质检签字人','涂装放行','操作'], ops:['详情、下载质检单、查看返工复检']
  },
  '打包单台账': {
    filters:[pair('','项目／订单',select('关联单据','项目台账、订单台账')),pair('','包装编号／名称',manual('输入关键词或扫码','构件打包单.包装编号及二维码')),pair('','包装日期范围',manual('选择起止日期','构件打包单.包装时间')),pair('','包装状态',select('草稿、有效包装、已撤销','构件打包单.包装状态')),pair('','发运进度',select('未发运、部分发运、已发运','扫码发货.有效发货明细'))],
    headers:['ID','包装编号','包装名称','项目名称','订单编号','包装件数','包装重量t','包装人','包装时间','已发件数','发运进度','操作'], ops:['详情、打印包码、拆包、扫码发货']
  },
  '发货台账': {
    filters:[pair('','项目／订单',select('关联单据','项目台账、订单台账')),pair('','发货单号／构件编号',manual('输入关键词或扫码','扫码发货.发货单号、构件编号')),pair('','实际发货日期范围',manual('选择起止日期','扫码发货.实际发货时间')),pair('','车牌号／收货单位',manual('输入关键词','发货信息登记.车牌号、收货单位')),pair('','有效状态',select('有效、已撤销、已更正','扫码发货.有效状态'))],
    headers:['ID','发货单号','项目名称','订单编号','实际发货时间','发货件数','重量t','收货单位','车牌号','出库单号','状态','操作'], ops:['详情、打印发货单、查看出库、申请更正']
  },
};

for (const [name, data] of Object.entries(formData)) {
  fillForm(name, data.title, data.fields.map(([f, kind]) => ({ ...f, kind })), data.detail);
}
for (const [name, data] of Object.entries(ledgerData)) fillLedger(name, name, data.filters, data.headers, data.ops);

const inspectBefore = await wb.inspect({ kind: 'sheet', include: 'id,name', maxChars: 5000 });
wb.recalculate();
const check = await wb.inspect({ kind: 'table', sheetId: '排产创建', range: 'A1:L14', include: 'values,formulas', tableMaxRows: 14, tableMaxCols: 12, maxChars: 5000 });
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options: { useRegex: true, maxResults: 50 }, summary: 'formula error scan', maxChars: 1000 });
await fs.writeFile('I:/autoweb/autoribao/outputs/oa-production-20261111-v3/verify-inspect.ndjson', `${inspectBefore.ndjson}\n${check.ndjson}\n${errors.ndjson}`);
const blob = await SpreadsheetFile.exportXlsx(wb);
await blob.save(output);
console.log(JSON.stringify({ output, inspect: inspectBefore.ndjson, check: check.ndjson, errors: errors.ndjson }));

