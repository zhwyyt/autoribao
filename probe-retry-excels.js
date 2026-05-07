const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

function previewSheet(ws, maxRows = 5, maxCols = 30) {
  const range = xlsx.utils.decode_range(ws['!ref'] || 'A1:A1');
  const rows = [];
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + maxRows - 1); r++) {
    const row = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + maxCols - 1); c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = ws[addr];
      row.push(cell ? String(cell.v).trim() : '');
    }
    rows.push(row);
  }
  return rows;
}

function guessHeaderRow(preview) {
  // find first row with at least 3 non-empty cells
  for (let i = 0; i < preview.length; i++) {
    const nonEmpty = preview[i].filter(v => v !== '').length;
    if (nonEmpty >= 3) return i;
  }
  return 0;
}

function main() {
  const dir = path.resolve(__dirname, 'retry');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'));

  for (const f of files) {
    const full = path.join(dir, f);
    const wb = xlsx.readFile(full, { cellDates: false });
    console.log(`\n=== ${f} ===`);
    console.log('Sheets:', wb.SheetNames.join(', '));

    for (const sheetName of wb.SheetNames.slice(0, 2)) {
      const ws = wb.Sheets[sheetName];
      console.log(`-- Sheet: ${sheetName} --`);
      const prev = previewSheet(ws, 6, 40);
      const headerRowIdx = guessHeaderRow(prev);
      const header = prev[headerRowIdx] || [];
      console.log('HeaderRowIdx:', headerRowIdx + 1);
      console.log('Header:', header.filter(Boolean).join(' | '));
      console.log('Preview:');
      for (let i = 0; i < prev.length; i++) {
        const line = prev[i].map(v => (v || '').slice(0, 20));
        console.log(String(i + 1).padStart(2, '0'), line.join('\t'));
      }
    }
  }
}

main();
