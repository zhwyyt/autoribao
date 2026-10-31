import json,re,zipfile,hashlib
from pathlib import Path
from docx import Document
from openpyxl import load_workbook
from PIL import Image,ImageDraw,ImageFont
import pdfplumber
W=Path(__file__).resolve().parent;out=W.parent
s=json.loads((W/'spec.json').read_text(encoding='utf8'))
dp=out/'OA生产管理平台_建设与应用方案_V2.docx';xp=out/'OA生产管理平台_页面表单与报表模板_V2.xlsx'
for p in [dp,xp]:
 with zipfile.ZipFile(p) as z:assert z.testzip() is None
d=Document(dp);x=load_workbook(xp,data_only=False);xc=load_workbook(xp,data_only=True)
t='\n'.join(p.text for p in d.paragraphs)+'\n'+'\n'.join(c.text for tb in d.tables for row in tb.rows for c in row.cells)
xt='\n'.join(str(c.value) for ws in x for row in ws for c in row if c.value is not None)
ids=[f['id'] for p in s['pages'] for f in p['fields']+p['details']]
assert len(ids)==len(set(ids))==763
assert all(i in t and i in xt for i in ids)
assert all(p['sheet'] in x.sheetnames and p['sheet'] in t for p in s['pages'])
assert len(x.sheetnames)==46 and len(d.inline_shapes)==6
assert all(r['code'] in t and r['code'] in xt for di in s['dictionaries'] for r in di['rows'])
assert all(item[0] in t and item[0] in xt for item in s['pending'])
assert '来源自动带出' not in xt and '同一信息直接写入' not in xt
assert all(c.data_type!='e' for ws in xc for row in ws for c in row)
demo=xc['Z02_统计口径示例']
assert [[demo.cell(r,c).value for c in [3,4]] for r in range(13,17)]==[[1,500],[1,300],[1,500],[0,0]]
assert hashlib.sha256(Path(r'I:\OA生产平台开发\OA项目管理平台建设与应用方案20250918.docx').read_bytes()).hexdigest()=='6ef618122659686f44b566913f43aa43db7751ef6536b980ba73344014093ec1'
pdfpath=W/'qa_delivery/OA生产管理平台_建设与应用方案_V2.pdf'
pdf=pdfplumber.open(pdfpath)
pt=''.join(pg.extract_text() or '' for pg in pdf.pages);norm=re.sub(r'\s+','',pt)
missing=[i for i in ids if i not in norm]
assert not missing,missing
outside=[]
for i,pg in enumerate(pdf.pages,1):
 for word in pg.extract_words():
  if word['x0']<0 or word['top']<0 or word['x1']>pg.width+1 or word['bottom']>pg.height+1:outside.append((i,word))
assert not outside,outside[:3]
report=dict(pages=len(pdf.pages),business_pages=len(s['pages']),worksheets=len(x.sheetnames),fields=len(ids),dictionaries=len(s['dictionaries']),diagrams=len(d.inline_shapes),formula_example='1件500kg；1件300kg；1件500kg；0件0kg',source_unchanged=True,all_field_ids_in_pdf=True)
(W/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=False))
font=ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc',16)
for kind,files in [('final_word',sorted((W/'qa_delivery').glob('page-*.png'),key=lambda p:int(p.stem.split('-')[-1]))),('final_sheet',sorted((W/'sheet_previews').glob('*.png')))]:
 for k in range(0,len(files),12):
  im=Image.new('RGB',(1600,1800),'#ddd');dr=ImageDraw.Draw(im)
  for j,f in enumerate(files[k:k+12]):
   a=Image.open(f);a.thumbnail((390,550));xx=j%4*400;yy=j//4*600;im.paste(a,(xx,yy+30));dr.text((xx+5,yy+5),f.stem,font=font,fill='black')
  im.save(W/f'{kind}_{k//12+1}.png')
(W/'artifact.md').write_text('''# 本次修订执行记录
参考原Word的编写逻辑及9张合同Excel：先定义基础分类选项，再展示界面和字段来源，随后解释功能、关联、条件控制与回写；以流程图连接业务。
本次重写Word第二、第三部分，逐字段列编号、名称、可能内容和来源。Excel沿用表单及台账表达，直接在填写位置和明细首行标注取数规则。
已对照既有东吴云接口依据，纠正工艺路线与图纸版本混淆，补齐订单导入和排产文件导出回传路径。未验证规则保留明确标记。
交付41个业务页面、21类基础字典、763项字段定义、6张流程图；Excel共46页。
验证详见verification.json及公式检查结果；原参考文件未修改。没有改变本地业务项目或生产平台行为。
''',encoding='utf8')
