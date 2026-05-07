const ExcelJS = require('exceljs');

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

function rowValues(row) {
  return row.values.slice(1).map(value => {
    if (value == null) return '';
    if (typeof value === 'object' && value.text) return value.text;
    return String(value);
  });
}

async function inspectProcessReport(filePath) {
  const workbook = await readWorkbook(filePath);
  const out = { filePath, type: 'process', sheets: [] };
  for (const sheet of workbook.worksheets) {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 6 || rowNumber <= 20 && sheet.name !== '汇总') {
        rows.push({ rowNumber, values: rowValues(row) });
      }
    });
    out.sheets.push({ name: sheet.name, preview: rows });
  }
  return out;
}

async function inspectShippingReport(filePath) {
  const workbook = await readWorkbook(filePath);
  const out = { filePath, type: 'shipping', sheets: [] };
  for (const sheet of workbook.worksheets) {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 20) {
        rows.push({ rowNumber, values: rowValues(row) });
      }
    });
    out.sheets.push({ name: sheet.name, preview: rows });
  }
  return out;
}

async function main() {
  const filePath = process.argv[2];
  const type = process.argv[3] || 'auto';
  if (!filePath) {
    throw new Error('请传入文件路径');
  }
  const result = type === 'shipping'
    ? await inspectShippingReport(filePath)
    : await inspectProcessReport(filePath);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
