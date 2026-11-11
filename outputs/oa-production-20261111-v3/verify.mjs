import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import fs from 'node:fs/promises';
const p='I:/autoweb/autoribao/outputs/oa-production-20261111-v3/OA生产管理平台建设与应用方案-附件_按原格式补全.xlsx'; const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(p));
for (const name of ['排产创建','排产任务分派','工序报工','生产质检','组织架构','排产台账','生产过程记录']) { const im=await wb.render({sheetName:name,autoCrop:'all',scale:1,format:'png'}); await fs.writeFile('I:/autoweb/autoribao/outputs/oa-production-20261111-v3/out-'+name+'.png',new Uint8Array(await im.arrayBuffer())); }
console.log((await wb.inspect({kind:'sheet',include:'id,name',maxChars:10000})).ndjson);
