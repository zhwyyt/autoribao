const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (!a) continue;
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i++;
        } else {
            out[key] = true;
        }
    }
    return out;
}

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                const next = line[i + 1];
                if (next === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                out.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
    }
    out.push(cur);
    return out;
}

function readCsvRecords(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r\n|\n|\r/).filter(l => l !== '');
    if (lines.length === 0) {
        throw new Error('CSV 为空');
    }

    const header = parseCsvLine(lines[0]).map(h => String(h).trim().replace(/^\uFEFF/, ''));
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const rec = {};
        for (let c = 0; c < header.length; c++) {
            rec[header[c]] = cols[c] ?? '';
        }
        records.push(rec);
    }

    return { header, records };
}

function normalizeYmd(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    const m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (!m) return null;
    const y = m[1];
    const mo = String(parseInt(m[2], 10)).padStart(2, '0');
    const d = String(parseInt(m[3], 10)).padStart(2, '0');
    return `${y}-${mo}-${d}`;
}

function parsePersonFromWorkshop(workshop) {
    const s = String(workshop || '').trim();
    if (!s) return null;
    const m = s.match(/[（(]([^（）()]+)[）)]/);
    if (m) return m[1].trim();
    return null;
}

function resolvePersonFromWorkshop(workshop, candidatePeople) {
    const direct = parsePersonFromWorkshop(workshop);
    if (direct) return direct;

    const s = String(workshop || '').trim();
    if (!s) return null;

    let best = null;
    for (const name of candidatePeople || []) {
        if (!name) continue;
        if (s.includes(name)) {
            if (!best || name.length > best.length) {
                best = name;
            }
        }
    }
    return best;
}

function toNumber(value) {
    const s = String(value ?? '').trim();
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

function cellText(cell) {
    const v = cell && cell.value !== undefined ? cell.value : '';
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
        if (v.text !== undefined) return String(v.text).trim();
        if (v.richText) return v.richText.map(x => x.text).join('').trim();
        if (v.formula !== undefined && v.result !== undefined) return String(v.result ?? '').trim();
    }
    return String(v).trim();
}

function isCellEmpty(cell) {
    if (!cell) return true;
    if (cell.value && typeof cell.value === 'object' && cell.value.formula) return false;
    const t = cellText(cell);
    return !t;
}

function toCellNumber(cell) {
    if (!cell) return 0;
    const value = cell.value;
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && value.result !== undefined && value.result !== null) {
        const n = Number(value.result);
        return Number.isFinite(n) ? n : 0;
    }
    return toNumber(cellText(cell));
}

function sumCellRange(worksheet, rowNumber, startCol, endCol) {
    let sum = 0;
    for (let c = startCol; c <= endCol; c++) {
        sum += toCellNumber(worksheet.getCell(rowNumber, c));
    }
    return Number(sum.toFixed(2));
}

function sumCellList(worksheet, rowNumber, columns) {
    let sum = 0;
    for (const col of columns || []) {
        sum += toCellNumber(worksheet.getCell(rowNumber, col));
    }
    return Number(sum.toFixed(2));
}

function setFormulaIfEmpty(cell, formula, result) {
    if (!cell) return false;
    if (cell.value && typeof cell.value === 'object' && cell.value.formula) return false;
    if (!isCellEmpty(cell)) return false;
    cell.value = { formula, result: result ?? 0 };
    return true;
}

function buildSumCellsFormula(addresses) {
    if (!addresses || addresses.length === 0) return '0';
    if (addresses.length === 1) return addresses[0];
    return `SUM(${addresses.join(',')})`;
}

function findHeaderCell(worksheet, wantText) {
    let found = null;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (found) return;
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            if (found) return;
            const t = cellText(cell);
            if (t === wantText) {
                found = { row: rowNumber, col: colNumber };
            }
        });
    });
    return found;
}

function findRowByDateLabel(worksheet, dateCol, startRow, endRow, label) {
    const want = String(label || '').trim();
    if (!want) return null;
    for (let r = startRow; r <= endRow; r++) {
        const t = cellText(worksheet.getCell(r, dateCol));
        if (t === want) return r;
    }
    return null;
}

function isRowBlank(worksheet, rowNumber, startCol, endCol) {
    for (let c = startCol; c <= endCol; c++) {
        const cell = worksheet.getCell(rowNumber, c);
        if (!isCellEmpty(cell)) {
            return false;
        }
    }
    return true;
}

function mergeAlignment(cell, nextAlignment) {
    if (!cell) return;
    const prev = cell.alignment || {};
    cell.alignment = { ...prev, ...nextAlignment };
}

async function main() {
    const projectRoot = path.join(__dirname, '..');
    const downloadsDir = path.join(projectRoot, 'downloads');
    const args = parseArgs(process.argv);
    const csvPath = args.csv ? path.resolve(args.csv) : path.join(downloadsDir, '2026-02_装焊入库.csv');
    const templatePath = args.template ? path.resolve(args.template) : path.join(projectRoot, '日产量模板.xlsx');

    if (!fs.existsSync(csvPath)) {
        throw new Error(`未找到 CSV: ${csvPath}`);
    }
    if (!fs.existsSync(templatePath)) {
        throw new Error(`未找到模板: ${templatePath}`);
    }

    const { records } = readCsvRecords(csvPath);

    const workbook = new ExcelJS.Workbook();
    // Keep styles.
    workbook.creator = 'shoufacun-download';
    await workbook.xlsx.readFile(templatePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        throw new Error('模板中未找到第一个 sheet');
    }

    const headerCell = findHeaderCell(worksheet, '日期');
    if (!headerCell) {
        throw new Error('模板中未找到表头“日期”单元格');
    }

    const headerRow = headerCell.row;
    const dateCol = headerCell.col;

    const header = worksheet.getRow(headerRow);
    const headerValues = [];
    const maxCol = worksheet.columnCount;
    for (let c = dateCol; c <= maxCol; c++) {
        headerValues.push(cellText(header.getCell(c)));
    }

    const personToCol = new Map();
    const subtotalCols = [];
    let totalCol = null;

    for (let i = 0; i < headerValues.length; i++) {
        const name = headerValues[i];
        const col = dateCol + i;
        if (!name) continue;
        if (name === '小计') {
            subtotalCols.push(col);
            continue;
        }
        if (name === '总计') {
            totalCol = col;
            continue;
        }
        if (name === '日期') continue;
        personToCol.set(name, col);
    }

    const candidatePeople = Array.from(personToCol.keys());

    // Aggregate weights
    const sumMap = new Map();
    const unknownWorkshop = new Set();
    const dateSet = new Set();

    for (const r of records) {
        const ymd = normalizeYmd(r['日期']);
        if (!ymd) continue;
        dateSet.add(ymd);

        const person = resolvePersonFromWorkshop(r['车间'], candidatePeople);
        if (!person) {
            const w = String(r['车间'] || '').trim();
            if (w) unknownWorkshop.add(w);
            continue;
        }

        const w = toNumber(r['重量']);
        const key = `${ymd}__${person}`;
        sumMap.set(key, (sumMap.get(key) || 0) + w);
    }

    const dates = Array.from(dateSet).sort();

    const dataStartRow = headerRow + 1;
    const endRow = worksheet.rowCount;

    const dateRowMap = new Map();
    for (let r = dataStartRow; r <= endRow; r++) {
        const ymd = normalizeYmd(cellText(worksheet.getCell(r, dateCol)));
        if (ymd) dateRowMap.set(ymd, r);
    }

    if (dateRowMap.size === 0 && dates.length > 0) {
        let r = dataStartRow;
        for (const d of dates) {
            worksheet.getCell(r, dateCol).value = d;
            dateRowMap.set(d, r);
            r++;
        }
    }

    // Fill weights
    for (const [key, weightSum] of sumMap.entries()) {
        const sep = key.indexOf('__');
        if (sep <= 0) continue;
        const ymd = key.slice(0, sep);
        const person = key.slice(sep + 2);

        const row = dateRowMap.get(ymd);
        const col = personToCol.get(person);
        if (!row || !col) continue;

        worksheet.getCell(row, col).value = Number(weightSum.toFixed(2));
    }

    // Fill '/' for missing
    for (const [ymd, row] of dateRowMap.entries()) {
        for (const [person, col] of personToCol.entries()) {
            const key = `${ymd}__${person}`;
            if (sumMap.has(key)) continue;
            const cell = worksheet.getCell(row, col);
            if (isCellEmpty(cell)) {
                cell.value = '/';
            }
        }
    }

    // Formulas
    const dayRows = Array.from(dateRowMap.values()).sort((a, b) => a - b);
    const dayCount = dayRows.length;
    const orderedPersonCols = headerValues
        .map((name, idx) => ({ name, col: dateCol + idx }))
        .filter(x => x.name && !['日期', '小计', '总计'].includes(x.name))
        .map(x => x.col);

    for (const r of dayRows) {
        let groupStartCol = null;
        for (let i = 0; i < headerValues.length; i++) {
            const name = headerValues[i];
            const col = dateCol + i;
            if (col === dateCol) continue;

            if (name && !['日期', '小计', '总计'].includes(name)) {
                if (groupStartCol === null) groupStartCol = col;
                continue;
            }

            if (name === '小计') {
                if (groupStartCol !== null) {
                    const a1 = worksheet.getCell(r, groupStartCol).address;
                    const a2 = worksheet.getCell(r, col - 1).address;
                    setFormulaIfEmpty(
                        worksheet.getCell(r, col),
                        `SUM(${a1}:${a2})`,
                        sumCellRange(worksheet, r, groupStartCol, col - 1)
                    );
                }
                groupStartCol = null;
            }
        }

        if (totalCol) {
            const cells = orderedPersonCols.map(c => worksheet.getCell(r, c).address);
            setFormulaIfEmpty(
                worksheet.getCell(r, totalCol),
                buildSumCellsFormula(cells),
                sumCellList(worksheet, r, orderedPersonCols)
            );
        }
    }

    const totalRow = findRowByDateLabel(worksheet, dateCol, dataStartRow, worksheet.rowCount, '总计') ||
        findRowByDateLabel(worksheet, dateCol, dataStartRow, worksheet.rowCount, '合计');
    const avgRow = findRowByDateLabel(worksheet, dateCol, dataStartRow, worksheet.rowCount, '日均产量');

    if (totalRow && dayCount > 0) {
        const first = dayRows[0];
        const last = dayRows[dayRows.length - 1];

        for (const col of orderedPersonCols) {
            const a1 = worksheet.getCell(first, col).address;
            const a2 = worksheet.getCell(last, col).address;
            let sum = 0;
            for (const dayRow of dayRows) sum += toCellNumber(worksheet.getCell(dayRow, col));
            setFormulaIfEmpty(worksheet.getCell(totalRow, col), `SUM(${a1}:${a2})`, Number(sum.toFixed(2)));
        }
        for (const col of subtotalCols) {
            const a1 = worksheet.getCell(first, col).address;
            const a2 = worksheet.getCell(last, col).address;
            let sum = 0;
            for (const dayRow of dayRows) sum += toCellNumber(worksheet.getCell(dayRow, col));
            setFormulaIfEmpty(worksheet.getCell(totalRow, col), `SUM(${a1}:${a2})`, Number(sum.toFixed(2)));
        }
        if (totalCol) {
            const a1 = worksheet.getCell(first, totalCol).address;
            const a2 = worksheet.getCell(last, totalCol).address;
            let sum = 0;
            for (const dayRow of dayRows) sum += toCellNumber(worksheet.getCell(dayRow, totalCol));
            setFormulaIfEmpty(worksheet.getCell(totalRow, totalCol), `SUM(${a1}:${a2})`, Number(sum.toFixed(2)));
        }
    }

    if (avgRow && totalRow && dayCount > 0) {
        for (const col of orderedPersonCols) {
            setFormulaIfEmpty(
                worksheet.getCell(avgRow, col),
                `${worksheet.getCell(totalRow, col).address}/${dayCount}`,
                Number((toCellNumber(worksheet.getCell(totalRow, col)) / dayCount).toFixed(2))
            );
        }
        for (const col of subtotalCols) {
            setFormulaIfEmpty(
                worksheet.getCell(avgRow, col),
                `${worksheet.getCell(totalRow, col).address}/${dayCount}`,
                Number((toCellNumber(worksheet.getCell(totalRow, col)) / dayCount).toFixed(2))
            );
        }
        if (totalCol) {
            setFormulaIfEmpty(
                worksheet.getCell(avgRow, totalCol),
                `${worksheet.getCell(totalRow, totalCol).address}/${dayCount}`,
                Number((toCellNumber(worksheet.getCell(totalRow, totalCol)) / dayCount).toFixed(2))
            );
        }
    }

    // Hide blank rows between data and totals area
    const totalsStart = totalRow || avgRow;
    if (totalsStart) {
        const scanStartCol = dateCol;
        const scanEndCol = dateCol + headerValues.length - 1;
        for (let r = dataStartRow; r <= totalsStart - 1; r++) {
            const hasDate = Boolean(normalizeYmd(cellText(worksheet.getCell(r, dateCol))));
            if (hasDate) continue;
            if (!isRowBlank(worksheet, r, scanStartCol, scanEndCol)) continue;
            worksheet.getRow(r).hidden = true;
        }
    }

    // Column width: make date column wide enough to show full YYYY-MM-DD.
    const dateColumn = worksheet.getColumn(dateCol);
    dateColumn.width = Math.max(dateColumn.width || 0, 13);

    // Center alignment for the whole table area.
    // Apply to: header row .. (avgRow/totalRow if exists, otherwise last used row)
    // and columns: dateCol .. (totalCol if exists else header range end)
    const alignEndRow = avgRow || totalRow || worksheet.rowCount;
    const alignEndCol = totalCol || (dateCol + headerValues.length - 1);

    for (let r = headerRow; r <= alignEndRow; r++) {
        const row = worksheet.getRow(r);
        for (let c = dateCol; c <= alignEndCol; c++) {
            const cell = row.getCell(c);
            mergeAlignment(cell, { horizontal: 'center', vertical: 'middle' });
        }
    }

    const outPath = args.out
        ? path.resolve(args.out)
        : path.join(downloadsDir, `日产量汇总_装焊入库重量_${new Date().toISOString().slice(0, 10)}.xlsx`);
    await workbook.xlsx.writeFile(outPath);

    // Export screenshot (PNG) that contains all content of the first sheet's UsedRange.
    // This uses local Excel via COM through PowerShell, so it will work only on Windows with Excel installed.
    try {
        const ps1Path = path.join(__dirname, 'export-excel-screenshot.ps1');
        const pngPath = outPath.replace(/\.xlsx$/i, '.png');
        if (fs.existsSync(ps1Path)) {
            const psExe = path.join(
                process.env.WINDIR || 'C:\\Windows',
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe'
            );
            const r = spawnSync(
                fs.existsSync(psExe) ? psExe : 'powershell',
                [
                    '-NoProfile',
                    '-STA',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    ps1Path,
                    '-InputXlsx',
                    outPath,
                    '-OutputPng',
                    pngPath
                ],
                { stdio: 'pipe', encoding: 'utf8' }
            );

            if (r.status === 0) {
                console.log(`截图已生成: ${pngPath}`);
            } else {
                const errText = (r.stderr || r.stdout || '').trim();
                console.warn(`截图导出失败（不影响Excel生成）：${errText || 'unknown error'}`);
            }
        } else {
            console.warn('截图导出脚本不存在，已跳过截图生成');
        }
    } catch (e) {
        console.warn(`截图导出异常（不影响Excel生成）：${e && e.message ? e.message : String(e)}`);
    }

    console.log(`已生成: ${outPath}`);
    if (unknownWorkshop.size > 0) {
        console.log('未能从“车间”解析出人员（没有匹配到模板人员名）的车间值：');
        for (const v of Array.from(unknownWorkshop)) {
            console.log(`- ${v}`);
        }
    }
}

main().catch(err => {
    console.error(`fill-daily 失败: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
});
