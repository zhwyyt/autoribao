const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function colToLetter(col) {
    let temp = col;
    let letter = '';
    while (temp > 0) {
        let rem = (temp - 1) % 26;
        letter = String.fromCharCode(65 + rem) + letter;
        temp = Math.floor((temp - 1) / 26);
    }
    return letter;
}

function getCellAddress(r, c) {
    return `${colToLetter(c)}${r}`;
}

function getMergedInfo(merges) {
    return merges.map(m => {
        const s = XLSX.utils.encode_cell(m.s);
        const e = XLSX.utils.encode_cell(m.e);
        return `${s}:${e}`;
    });
}

function sheetUsedRange(ws) {
    const ref = ws['!ref'];
    if (!ref) {
        return null;
    }
    const range = XLSX.utils.decode_range(ref);
    return {
        ref,
        startRow: range.s.r + 1,
        startCol: range.s.c + 1,
        endRow: range.e.r + 1,
        endCol: range.e.c + 1,
        rows: range.e.r - range.s.r + 1,
        cols: range.e.c - range.s.c + 1
    };
}

function readRowTexts(ws, rowNum, startCol, endCol) {
    const out = [];
    for (let c = startCol; c <= endCol; c++) {
        const addr = getCellAddress(rowNum, c);
        const cell = ws[addr];
        const v = cell ? (cell.w ?? cell.v ?? '') : '';
        out.push(String(v ?? ''));
    }
    return out;
}

function findHeaderRow(ws, used) {
    // Heuristic: pick the first row (within first 30 rows) that has >=3 non-empty cells
    // and looks like headers (short-ish strings).
    const maxScan = Math.min(used.endRow, used.startRow + 29);
    let best = null;
    for (let r = used.startRow; r <= maxScan; r++) {
        const row = readRowTexts(ws, r, used.startCol, used.endCol);
        const nonEmpty = row.filter(x => x && x.trim()).length;
        if (nonEmpty < 3) {
            continue;
        }
        const avgLen = row
            .filter(x => x && x.trim())
            .reduce((a, b) => a + b.trim().length, 0) / nonEmpty;
        // Prefer shorter average length as header.
        const score = nonEmpty * 10 - avgLen;
        if (!best || score > best.score) {
            best = { row: r, nonEmpty, avgLen, score, values: row };
        }
    }
    return best;
}

function main() {
    const filePath = path.join(__dirname, '..', '日产量模板.xlsx');
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const wb = XLSX.readFile(filePath, {
        cellText: true,
        cellDates: true,
        cellNF: true,
        cellStyles: true
    });

    console.log(`Workbook: ${path.basename(filePath)}`);
    console.log(`Sheets: ${wb.SheetNames.join(', ')}`);
    console.log('');

    for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const used = sheetUsedRange(ws);
        const merges = ws['!merges'] || [];

        console.log(`=== SHEET: ${name} ===`);
        if (!used) {
            console.log('UsedRange: <empty>');
            console.log('');
            continue;
        }

        console.log(`UsedRange: ${used.ref} (rows=${used.rows}, cols=${used.cols})`);
        console.log(`Start: R${used.startRow}C${used.startCol}, End: R${used.endRow}C${used.endCol}`);
        console.log(`MergedRanges(${merges.length}): ${merges.length ? getMergedInfo(merges).join(', ') : '<none>'}`);

        const header = findHeaderRow(ws, used);
        if (header) {
            console.log(`HeaderRowGuess: ${header.row} (nonEmpty=${header.nonEmpty}, avgLen=${header.avgLen.toFixed(2)})`);
            console.log(`HeaderValues: ${header.values.join(' | ')}`);
        } else {
            console.log('HeaderRowGuess: <not found>');
        }

        const sampleRows = 12;
        const maxRows = Math.min(used.endRow, used.startRow + sampleRows - 1);
        console.log(`SampleRows: ${used.startRow}..${maxRows}`);
        for (let r = used.startRow; r <= maxRows; r++) {
            const row = readRowTexts(ws, r, used.startCol, used.endCol);
            console.log(`ROW ${r}: ${row.join(' | ')}`);
        }

        // Print data validations if present (xlsx doesn't fully parse DV, but keep for future)
        if (ws['!dataValidations']) {
            console.log(`DataValidations: ${safeJson(ws['!dataValidations'])}`);
        }

        console.log('');
    }
}

main();
