"""Extract source PDF in memory; retain redacted page text, never the raw PDF."""
import io, json, re, sys, pathlib, hashlib
from pypdf import PdfReader
raw = sys.stdin.buffer.read()
reader = PdfReader(io.BytesIO(raw))
pages = []
for index, page in enumerate(reader.pages):
    text = page.extract_text() or ''
    # Retain table facts, exclude project contact/introduction and transport details.
    text = re.sub(r'项目介绍\s*[：:][\s\S]*', '项目介绍：[REDACTED]', text)
    text = re.sub(r'(?m)^.*(?:运输车号|发货信息|联系人|联系方式|联系电话|收货地址|司机|车牌).*$','[REDACTED contact/transport line]',text)
    text = re.sub(r'(?<!\d)1[3-9]\d{9}(?!\d)', '[REDACTED PHONE]', text)
    text = re.sub(r'[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{5,6}', '[REDACTED PLATE]', text)
    pages.append({'page': index + 1, 'text': text})
result={'pageCount': len(pages), 'pages': pages, 'redactions': 'Contact/transport lines, introduction, phone and plate patterns; raw bytes not saved.'}
if len(sys.argv)>2:
    import pdfplumber, pypdfium2
    output=pathlib.Path(sys.argv[1]); delivery_id=sys.argv[2]
    rendered=pypdfium2.PdfDocument(raw); crops=[]
    with pdfplumber.open(io.BytesIO(raw)) as doc:
        for index,page in enumerate(doc.pages):
            words=page.extract_words()
            starts=[w for w in words if '序列' in w['text']]
            if not starts: raise ValueError('No table header located')
            top=min(w['top'] for w in starts)-4
            stop=[w['top'] for w in words if ('审核' in w['text'] if index==0 else 'Powered' in w['text']) and w['top']>top]
            bottom=min(stop)-3 if stop else page.height-35
            pil=rendered[index].render(scale=1.7).to_pil()
            crop=pil.crop((int(20*1.7),int(top*1.7),int((page.width-20)*1.7),int(bottom*1.7)))
            name=f'delivery-{delivery_id}-page-{index+1}-table.png';crop.save(output/name)
            crops.append({'page':index+1,'file':name,'box':[20,top,page.width-20,bottom],'sha256':hashlib.sha256((output/name).read_bytes()).hexdigest()})
    result['tableCrops']=crops
print(json.dumps(result,ensure_ascii=False))
