import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import fs from 'node:fs/promises';
const p='I:/autoweb/autoribao/outputs/oa-production-20261031-v2/OA生产管理平台建设与应用方案-附件codex.xlsx'; const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(p));
for (const name of ['项目自动创建','项目台账','订单创建','订单台账','排产创建']) { const im=await wb.render({sheetName:name,autoCrop:'all',scale:1,format:'png'}); await fs.writeFile('I:/autoweb/autoribao/outputs/oa-production-20261111-v3/'+name+'.png',new Uint8Array(await im.arrayBuffer())); }
console.log((await wb.inspect({kind:'sheet',include:'id,name',maxChars:3000})).ndjson);
