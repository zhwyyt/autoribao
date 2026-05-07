const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function a1ToRowCol(a1) {
    const m = String(a1 || '').match(/^([A-Z]+)(\d+)$/i);
    if (!m) return null;
    const letters = m[1].toUpperCase();
    const row = Number(m[2]);
    let col = 0;
    for (let i = 0; i < letters.length; i++) {
        col = col * 26 + (letters.charCodeAt(i) - 64);
    }
    if (!Number.isFinite(row) || !Number.isFinite(col) || row <= 0 || col <= 0) return null;
    return { row, col };
}

function parseMergeRange(range) {
    const parts = String(range || '').split(':');
    if (parts.length !== 2) return null;
    const a = a1ToRowCol(parts[0]);
    const b = a1ToRowCol(parts[1]);
    if (!a || !b) return null;
    const top = Math.min(a.row, b.row);
    const bottom = Math.max(a.row, b.row);
    const left = Math.min(a.col, b.col);
    const right = Math.max(a.col, b.col);
    return { top, left, bottom, right, range: `${colToLetter(left)}${top}:${colToLetter(right)}${bottom}` };
}

function getWorksheetMergeRanges(ws) {
    const merges = ws && ws._merges ? ws._merges : null;
    if (!merges) return [];

    const out = [];
    const pushRange = (rangeObj) => {
        const m = (rangeObj && rangeObj.model) ? rangeObj.model : rangeObj;
        if (!m) return;
        const top = Number(m.top);
        const left = Number(m.left);
        const bottom = Number(m.bottom);
        const right = Number(m.right);
        if (![top, left, bottom, right].every(n => Number.isFinite(n) && n > 0)) return;
        out.push({
            top,
            left,
            bottom,
            right,
            range: `${colToLetter(left)}${top}:${colToLetter(right)}${bottom}`
        });
    };

    if (merges instanceof Map) {
        for (const [, rng] of merges.entries()) {
            pushRange(rng);
        }
    } else {
        for (const k of Object.keys(merges)) {
            pushRange(merges[k]);
        }
    }
    return out;
}

function reapplyMergeRanges(ws, mergeRanges, rowOffset) {
    if (!mergeRanges || mergeRanges.length === 0) return;
    for (const mr of mergeRanges) {
        const top = mr.top + rowOffset;
        const bottom = mr.bottom + rowOffset;
        const left = mr.left;
        const right = mr.right;
        try {
            try {
                ws.unMergeCells(`${colToLetter(left)}${top}:${colToLetter(right)}${bottom}`);
            } catch {
                // ignore
            }
            ws.mergeCells(top, left, bottom, right);
        } catch {
            // ignore conflicts
        }
    }
}

function colToLetter(col) {
    let n = Number(col);
    if (!Number.isFinite(n) || n <= 0) return '';
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function findSummaryFooterRow(ws, startRow) {
    const keywords = ['合计', '编制', '审核', '审批', '统计', '制表'];
    const maxScanCol = Math.min(ws.columnCount || 20, 20);
    for (let r = startRow; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= maxScanCol; c++) {
            const v = row.getCell(c).value;
            const s = normalizeHeader(v);
            if (!s) continue;
            if (keywords.some(k => s.includes(k))) {
                return r;
            }
        }
    }
    return null;
}

function findTotalRow(ws, startRow) {
    const maxScanCol = Math.min(ws.columnCount || 20, 20);
    for (let r = startRow; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= maxScanCol; c++) {
            const s = normalizeHeader(row.getCell(c).value);
            if (s && s.includes('合计')) return r;
        }
    }
    return null;
}

function setFormulaIfEmpty(cell, formula) {
    const v = cell.value;
    const isEmpty = v == null || (typeof v === 'string' && v.trim() === '');
    if (isEmpty) {
        cell.value = { formula };
    }
}

function normalizeHeader(v) {
    if (v != null && typeof v === 'object') {
        if (Object.prototype.hasOwnProperty.call(v, 'result')) return normalizeHeader(v.result);
        if (Object.prototype.hasOwnProperty.call(v, 'text')) return normalizeHeader(v.text);
        if (Object.prototype.hasOwnProperty.call(v, 'richText')) {
            try {
                const t = Array.isArray(v.richText) ? v.richText.map(x => x.text || '').join('') : '';
                return normalizeHeader(t);
            } catch {
                return '';
            }
        }
        if (Object.prototype.hasOwnProperty.call(v, 'formula')) {
            // if it's a formula cell, rely on result (handled above) or return empty
            return '';
        }
    }

    let s = String(v == null ? '' : v).trim();
    // Remove UTF-8 BOM if present
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    // Remove wrapping quotes
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

function parseNumberLike(v) {
    if (v == null) return null;
    if (typeof v === 'object') {
        if (Object.prototype.hasOwnProperty.call(v, 'result')) return parseNumberLike(v.result);
        if (Object.prototype.hasOwnProperty.call(v, 'text')) return parseNumberLike(v.text);
        if (Object.prototype.hasOwnProperty.call(v, 'richText')) {
            try {
                const t = Array.isArray(v.richText) ? v.richText.map(x => x.text || '').join('') : '';
                return parseNumberLike(t);
            } catch {
                return null;
            }
        }
    }
    if (typeof v === 'number') return v;
    const s = String(v).replace(/,/g, '').trim();
    if (!s) return null;
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
}

function normalizeProjectName(name) {
    let s = normalizeHeader(name);
    if (!s) return s;
    s = s.replace(/\s+/g, '');
    s = s.replace(/（/g, '(').replace(/）/g, ')');
    s = s.replace(/【/g, '[').replace(/】/g, ']');
    return s;
}

function parseWeightToTon(v, options = {}) {
    if (v == null) return null;
    const s = String(v).trim();
    const alreadyTon = Boolean(options.alreadyTon);
    // If explicit ton unit, keep as-is
    if (s.includes('吨')) {
        const n = parseNumberLike(s);
        return n == null ? null : n;
    }
    const n = parseNumberLike(s);
    if (n == null) return null;
    if (alreadyTon) return n;
    // The platform CSV exports weight in KG; Python version converts to ton.
    return n / 1000;
}

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
        // Avoid pushing trailing empty row caused by final newline
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

    // Last field/row
    pushField();
    pushRow();

    // Trim possible last empty row
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

function findColIndex(headers, candidates) {
    const h = headers.map(normalizeHeader);
    for (const cand of candidates) {
        const idx = h.findIndex(x => x === cand);
        if (idx >= 0) return idx + 1; // 1-based
    }
    for (const cand of candidates) {
        const idx = h.findIndex(x => x.includes(cand));
        if (idx >= 0) return idx + 1;
    }
    return null;
}

function readCsvToRows(csvPath) {
    // Prefer reading as UTF-8 text, since some CSV exports contain BOM and non-ASCII headers.
    // XLSX.readFile on CSV can mis-detect encoding and produce garbled headers.
    let buf = fs.readFileSync(csvPath);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        buf = buf.subarray(3);
    }
    const text = buf.toString('utf8');
    const rows = parseCsv(text);
    if (rows && rows.length > 0) return rows;

    // Fallback: try xlsx parser if needed.
    const wb = XLSX.readFile(csvPath, { type: 'file', raw: true, codepage: 65001 });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function summarizeRows(rows) {
    if (!rows || rows.length === 0) return {};

    // Detect header row (some CSV exports may contain blank/metadata rows)
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const h = (rows[i] || []).map(normalizeHeader);
        const hasName = h.some(x => x.includes('项目名称') || x.includes('工程名称') || x === '项目' || x === '工程' || x === '名称');
        const hasWeight = h.some(x => x.includes('重量'));
        if (hasName && hasWeight) {
            headerRowIndex = i;
            break;
        }
    }

    const header = (rows[headerRowIndex] || []).map(normalizeHeader);
    const nameCol = findColIndex(header, ['工程名称', '项目名称']);
    const weightCol = findColIndex(header, ['重量', '重量(吨)', '重量（吨）']);
    if (!nameCol) throw new Error('CSV 未找到工程名称/项目名称列');
    if (!weightCol) throw new Error('CSV 未找到重量列');
    const weightHeader = normalizeHeader(header[weightCol - 1]);
    const alreadyTon = weightHeader.includes('吨');

    const map = new Map();
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const r = rows[i];
        const name = normalizeProjectName(r[nameCol - 1]);
        if (!name) continue;
        const wRaw = r[weightCol - 1];
        const w = parseWeightToTon(wRaw, { alreadyTon });
        if (w == null) continue;
        map.set(name, (map.get(name) || 0) + w);
    }
    const out = {};
    for (const [k, v] of map.entries()) out[k] = Number(v.toFixed(3));
    return out;
}

function copyRowStyle(ws, srcRowNum, dstRowNum, maxCol) {
    const srcRow = ws.getRow(srcRowNum);
    const dstRow = ws.getRow(dstRowNum);
    dstRow.height = srcRow.height;
    for (let c = 1; c <= maxCol; c++) {
        const srcCell = srcRow.getCell(c);
        const dstCell = dstRow.getCell(c);
        dstCell.style = { ...srcCell.style };
        if (srcCell.numFmt) dstCell.numFmt = srcCell.numFmt;
        dstCell.border = srcCell.border;
        dstCell.fill = srcCell.fill;
        dstCell.font = srcCell.font;
        dstCell.alignment = srcCell.alignment;
    }
}

async function readLastMonthBalanceMap(lastMonthPath) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(lastMonthPath);
    const ws = wb.getWorksheet('汇总');
    if (!ws) throw new Error('上月文件缺少“汇总”工作表');

    const headerRow = 4;
    const startRow = 5;

    const headers = [];
    for (let c = 1; c <= ws.columnCount; c++) {
        headers.push(normalizeHeader(ws.getRow(headerRow).getCell(c).value));
    }

    const nameCol = findColIndex(headers, ['工程名称', '项目名称', '项目', '工程', '名称']);
    const balanceCol = findColIndex(headers, ['本月结存', '结存']);
    if (!nameCol) throw new Error('上月汇总未找到工程名称列');
    if (!balanceCol) throw new Error('上月汇总未找到本月结存列');

    const map = {};
    for (let r = startRow; r <= ws.rowCount; r++) {
        const name = normalizeProjectName(ws.getRow(r).getCell(nameCol).value);
        if (!name) continue;
        if (['合计', '编制', '审核', '审批', '统计', '制表'].some(k => name.includes(k))) break;
        const v = parseNumberLike(ws.getRow(r).getCell(balanceCol).value);
        if (v == null) continue;
        map[name] = v;
    }
    return map;
}

function fillPeriodText(ws, periodText) {
    if (!periodText) return;
    for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
            const v = row.getCell(c).value;
            if (typeof v === 'string' && v.includes('周期')) {
                row.getCell(c).value = periodText;
                return;
            }
        }
    }
    ws.getRow(3).getCell(5).value = periodText;
}

async function generateShoufacunReport(options) {
    const {
        inboundCsv,
        outboundCsv,
        templatePath,
        outDir,
        lastMonthPath,
        periodText,
        outputFileName
    } = options;

    if (!inboundCsv || !fs.existsSync(inboundCsv)) throw new Error(`Inbound CSV not found: ${inboundCsv}`);
    if (!outboundCsv || !fs.existsSync(outboundCsv)) throw new Error(`Outbound CSV not found: ${outboundCsv}`);
    if (!templatePath || !fs.existsSync(templatePath)) throw new Error(`Template not found: ${templatePath}`);
    if (!outDir) throw new Error('outDir is required');

    ensureDir(outDir);

    const inRows = readCsvToRows(inboundCsv);
    const outRows = readCsvToRows(outboundCsv);

    const inboundSummary = summarizeRows(inRows);
    const outboundSummary = summarizeRows(outRows);

    let lastMonthMap = null;
    if (lastMonthPath && fs.existsSync(lastMonthPath)) {
        lastMonthMap = await readLastMonthBalanceMap(lastMonthPath);
    }

    const allProjects = Array.from(
        new Set([
            ...Object.keys(inboundSummary),
            ...Object.keys(outboundSummary),
            ...(lastMonthMap ? Object.keys(lastMonthMap) : [])
        ])
    ).sort();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);

    const inWs = wb.getWorksheet('入库明细');
    const outWs = wb.getWorksheet('出库明细');
    const sumWs = wb.getWorksheet('汇总');
    if (!inWs) throw new Error('模板缺少“入库明细”工作表');
    if (!outWs) throw new Error('模板缺少“出库明细”工作表');
    if (!sumWs) throw new Error('模板缺少“汇总”工作表');

    // Overwrite detail sheets with CSV content (keep first 1.. existing header rows if any)
    // We write starting row 1 with CSV header.
    inWs.spliceRows(1, inWs.rowCount);
    outWs.spliceRows(1, outWs.rowCount);
    for (const r of inRows) inWs.addRow(r);
    for (const r of outRows) outWs.addRow(r);

    fillPeriodText(sumWs, periodText);

    const headerRowNum = 4;
    const dataStart = 5;
    const headers = [];
    for (let c = 1; c <= sumWs.columnCount; c++) {
        headers.push(normalizeHeader(sumWs.getRow(headerRowNum).getCell(c).value));
    }

    const seqCol = findColIndex(headers, ['序号']) || 1;
    const nameCol = findColIndex(headers, ['工程名称', '项目名称', '项目', '工程', '名称']) || 2;
    const lastCol = findColIndex(headers, ['上月结存']) || 3;
    const inboundCol = findColIndex(headers, ['本期入库', '入库']) || 4;
    const outboundCol = findColIndex(headers, ['本期出库', '出库']) || 5;
    const balanceCol = findColIndex(headers, ['本月结存', '结存']) || 6;

    const templateRowNum = dataStart;
    const maxCol = Math.max(7, sumWs.columnCount);

    // Anchor: "合计" row never changes (content/style). We only edit rows above it.
    // ExcelJS spliceRows may drop merge definitions; we capture merges around the total/signature area and reapply.
    let totalRow = findTotalRow(sumWs, dataStart);
    if (!totalRow) {
        throw new Error('模板汇总表未找到“合计”行，无法按模板对齐');
    }

    const totalRowTemplate = totalRow;
    const templateMergeRanges = getWorksheetMergeRanges(sumWs).filter(mr => {
        // Capture merges that intersect 合计行及其下方两行（通常是签字区的两行合并）
        const start = totalRowTemplate;
        const end = totalRowTemplate + 2;
        return mr.top <= end && mr.bottom >= start;
    });

    // Ensure enough data rows exist between dataStart..totalRow-1 for all projects.
    const requiredRows = allProjects.length;
    let existingRows = totalRow - dataStart;
    if (existingRows < requiredRows) {
        const add = requiredRows - existingRows;
        sumWs.spliceRows(totalRow, 0, ...new Array(add).fill([]));
        for (let i = 0; i < add; i++) {
            copyRowStyle(sumWs, templateRowNum, totalRow + i, maxCol);
        }
        totalRow += add;
        existingRows += add;
    }

    let footerRow = totalRow;

    // Reapply merges for total row + signature rows (which may be lost after spliceRows)
    reapplyMergeRanges(sumWs, templateMergeRanges, footerRow - totalRowTemplate);

    // Clear the whole data area (dataStart..footerRow-1)
    for (let rr = dataStart; rr < footerRow; rr++) {
        for (let c = 1; c <= Math.max(balanceCol, 6); c++) {
            sumWs.getRow(rr).getCell(c).value = null;
        }
    }

    // Write new summary rows into data area.
    for (let i = 0; i < allProjects.length; i++) {
        const r = dataStart + i;
        if (r >= footerRow) break;
        const project = allProjects[i];
        const inW = inboundSummary[project] || 0;
        const outW = outboundSummary[project] || 0;
        const last = lastMonthMap && Object.prototype.hasOwnProperty.call(lastMonthMap, project) ? (lastMonthMap[project] || 0) : 0;

        sumWs.getRow(r).getCell(seqCol).value = i + 1;
        sumWs.getRow(r).getCell(nameCol).value = project;
        sumWs.getRow(r).getCell(lastCol).value = last;
        sumWs.getRow(r).getCell(inboundCol).value = inW;
        sumWs.getRow(r).getCell(outboundCol).value = outW;

        const cAddr = `${colToLetter(lastCol)}${r}`;
        const dAddr = `${colToLetter(inboundCol)}${r}`;
        const eAddr = `${colToLetter(outboundCol)}${r}`;
        sumWs.getRow(r).getCell(balanceCol).value = { formula: `${cAddr}+${dAddr}-${eAddr}` };
    }

    // Delete blank rows / all-zero rows between dataStart..合计行-1.
    // Delete from bottom to top so indices stay stable.
    for (let rr = footerRow - 1; rr >= dataStart; rr--) {
        const row = sumWs.getRow(rr);
        const project = normalizeHeader(row.getCell(nameCol).value);
        const lastV = parseNumberLike(row.getCell(lastCol).value) || 0;
        const inV = parseNumberLike(row.getCell(inboundCol).value) || 0;
        const outV = parseNumberLike(row.getCell(outboundCol).value) || 0;
        const isAllZero = Math.abs(lastV) < 1e-9 && Math.abs(inV) < 1e-9 && Math.abs(outV) < 1e-9;

        if (!project || isAllZero) {
            sumWs.spliceRows(rr, 1);
            footerRow -= 1; // total row shifts up by one
        }
    }

    // Reapply merges again after deletions (deletions shift the total/signature area upward).
    // Without this, WPS may show total/signature rows as unmerged.
    reapplyMergeRanges(sumWs, templateMergeRanges, footerRow - totalRowTemplate);

    // Force-merge key areas to match template (ExcelJS spliceRows may lose merges):
    // - 合计行：A:B
    // - 合计下方两行（签字区/空白区）：A:G（两行合并成一个大块）
    try {
        sumWs.unMergeCells(`A${footerRow}:B${footerRow}`);
    } catch {
        // ignore
    }
    try {
        sumWs.mergeCells(`A${footerRow}:B${footerRow}`);
    } catch {
        // ignore
    }

    try {
        sumWs.unMergeCells(`A${footerRow + 1}:G${footerRow + 2}`);
    } catch {
        // ignore
    }
    try {
        sumWs.mergeCells(`A${footerRow + 1}:G${footerRow + 2}`);
    } catch {
        // ignore
    }

    // Resequence 序号 after deletions
    let seq = 1;
    for (let rr = dataStart; rr < footerRow; rr++) {
        const project = normalizeHeader(sumWs.getRow(rr).getCell(nameCol).value);
        if (!project) continue;
        sumWs.getRow(rr).getCell(seqCol).value = seq;
        seq += 1;
    }

    // Rebuild per-row balance formulas after deletions.
    // ExcelJS does not shift formula references when rows are spliced.
    for (let rr = dataStart; rr < footerRow; rr++) {
        const row = sumWs.getRow(rr);
        const project = normalizeHeader(row.getCell(nameCol).value);
        if (!project) continue;
        const cAddr = `${colToLetter(lastCol)}${rr}`;
        const dAddr = `${colToLetter(inboundCol)}${rr}`;
        const eAddr = `${colToLetter(outboundCol)}${rr}`;
        row.getCell(balanceCol).value = { formula: `${cAddr}+${dAddr}-${eAddr}` };
    }

    // Reset total row formulas to match the final data range.
    // Note: formulas don't automatically adjust in ExcelJS when splicing rows.
    const dataFirst = dataStart;
    const dataLast = footerRow - 1;
    if (dataLast >= dataFirst) {
        const sumRange = (col) => {
            const a1 = sumWs.getRow(dataFirst).getCell(col).address;
            const a2 = sumWs.getRow(dataLast).getCell(col).address;
            return `SUM(${a1}:${a2})`;
        };
        sumWs.getRow(footerRow).getCell(lastCol).value = { formula: sumRange(lastCol) };
        sumWs.getRow(footerRow).getCell(inboundCol).value = { formula: sumRange(inboundCol) };
        sumWs.getRow(footerRow).getCell(outboundCol).value = { formula: sumRange(outboundCol) };
        sumWs.getRow(footerRow).getCell(balanceCol).value = { formula: sumRange(balanceCol) };
    }

    // Total row formulas are reset above to match the final data range.

    const outName = outputFileName || `收发存报表_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const outPath = path.join(outDir, outName);
    try {
        await wb.xlsx.writeFile(outPath);
        return outPath;
    } catch (e) {
        const code = e && e.code ? String(e.code) : '';
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') {
            throw e;
        }

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const altPath = outPath.replace(/\.xlsx$/i, `_${ts}.xlsx`);
        await wb.xlsx.writeFile(altPath);
        return altPath;
    }
}

module.exports = { generateShoufacunReport };
