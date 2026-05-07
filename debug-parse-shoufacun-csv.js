const fs = require('fs');
const XLSX = require('xlsx');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      pushField();
      continue;
    }
    if (ch === '\r') {
      continue;
    }
    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }
    field += ch;
  }

  pushField();
  pushRow();

  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (!last || last.every(v => String(v || '').trim() === '')) {
      rows.pop();
      continue;
    }
    break;
  }

  return rows;
}

function readCsvToRows(csvPath) {
  let buf = fs.readFileSync(csvPath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }
  const text = buf.toString('utf8');
  const rows = parseCsv(text);
  if (rows && rows.length > 0) return rows;

  const wb = XLSX.readFile(csvPath, { type: 'file', raw: true, codepage: 65001 });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function main() {
  const csvPath = process.argv[2];
  const rows = readCsvToRows(csvPath);
  console.log(JSON.stringify({
    csvPath,
    rowCount: rows.length,
    firstRows: rows.slice(0, 3),
    lastRows: rows.slice(-3)
  }, null, 2));
}

main();
