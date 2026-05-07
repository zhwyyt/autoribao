import os
import re
from collections import defaultdict

import openpyxl
import pythoncom
import win32com.client


TARGET_DIR = r"C:\Users\Administrator\Desktop\设计图\杭钢"
EXPORTED_FILE = r"I:\autoweb\autoribao\downloads\杭钢玉环汽摩配智施智造中心及产业集成项目-装焊报检已完成构件.xlsx"


def normalize_text(value):
    if value is None:
        return ""
    text = str(value).strip()
    text = text.replace("\u3000", " ")
    text = text.replace("\r", " ").replace("\n", " ")
    return text.strip()


def iter_excel_files(root_dir):
    for root, _, files in os.walk(root_dir):
        for name in files:
            if name.lower().endswith((".xlsx", ".xls")):
                yield os.path.join(root, name)


def sheet_to_rows(sheet):
    used_range = sheet.UsedRange
    values = used_range.Value
    if values is None:
        return []
    if not isinstance(values, tuple):
        return [[values]]
    first = values[0] if values else ()
    if not isinstance(first, tuple):
        return [list(values)]
    return [list(row) for row in values]


def load_workbook_sheets(excel_app, file_path):
    workbook = excel_app.Workbooks.Open(file_path, ReadOnly=True, UpdateLinks=0)
    try:
        for sheet in workbook.Worksheets:
            yield sheet.Name, sheet_to_rows(sheet)
    finally:
        workbook.Close(False)


def find_candidate_sheets(excel_app, file_path):
    for sheet_name, rows in load_workbook_sheets(excel_app, file_path):
        if "入库明细" in normalize_text(sheet_name):
            yield sheet_name, rows


def detect_header_row(rows):
    candidates = [
        "构件guid", "guid", "构件编号", "项目名称", "工程名称", "重量", "单重", "总重"
    ]
    best_idx = None
    best_score = -1
    scan_limit = min(len(rows), 30)
    for idx in range(scan_limit):
        row = rows[idx]
        score = 0
        for cell in row:
            text = normalize_text(cell).lower().replace(" ", "")
            if any(key in text for key in candidates):
                score += 1
        if score > best_score:
            best_score = score
            best_idx = idx
    return best_idx if best_score > 0 else None


def normalize_header(text):
    return normalize_text(text).lower().replace(" ", "")


def detect_columns(header_row):
    col_map = {}
    for idx, cell in enumerate(header_row):
        h = normalize_header(cell)
        if not h:
            continue
        if "guid" in h and "构件" in h:
            col_map.setdefault("guid", idx)
        elif h == "guid":
            col_map.setdefault("guid", idx)
        elif ("项目" in h or "工程" in h) and ("名称" in h or h.endswith("名")):
            col_map.setdefault("project_name", idx)
        elif "重量" in h or "单重" in h or "总重" in h or h == "重":
            if "理论" not in h and "剩余" not in h:
                col_map.setdefault("weight", idx)
        elif "构件编号" in h or "编号" == h:
            col_map.setdefault("component_no", idx)
    return col_map


def parse_weight(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = normalize_text(value).replace(",", "")
    if not text:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", text)
    if not m:
        return None
    return float(m.group(0))


def project_matches(text):
    s = normalize_text(text)
    return ("杭钢玉环汽摩配智施智造中心及产业集成项目" in s) or ("杭钢" in s)


def looks_like_guid(text):
    s = normalize_text(text)
    if not s:
        return False
    if len(s) < 6:
        return False
    return bool(re.search(r"[A-Za-z0-9_-]{6,}", s))


def load_exported_guids(file_path):
    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    ws = wb[wb.sheetnames[0]]
    header = [normalize_header(v) for v in next(ws.iter_rows(values_only=True))]
    try:
        guid_idx = header.index("构件guid")
    except ValueError:
        guid_idx = None
        for i, h in enumerate(header):
            if "guid" in h:
                guid_idx = i
                break
    guids = set()
    rows = 0
    for row in ws.iter_rows(values_only=True):
        rows += 1
        if rows == 1:
            continue
        if guid_idx is None or guid_idx >= len(row):
            continue
        guid = normalize_text(row[guid_idx])
        if guid:
            guids.add(guid)
    return guids


def main():
    pythoncom.CoInitialize()
    excel_app = win32com.client.DispatchEx("Excel.Application")
    excel_app.Visible = False
    excel_app.DisplayAlerts = False

    exported_guids = load_exported_guids(EXPORTED_FILE)

    total_weight = 0.0
    matched_rows = []
    guid_occurrences = defaultdict(list)
    sheet_summaries = []
    diagnostics = []
    project_stats = defaultdict(lambda: {"rows": 0, "weight": 0.0})

    try:
        for file_path in sorted(iter_excel_files(TARGET_DIR)):
            for sheet_name, rows in find_candidate_sheets(excel_app, file_path):
                header_idx = detect_header_row(rows)
                if header_idx is None:
                    diagnostics.append((file_path, sheet_name, "未识别到表头"))
                    continue

                header_row = rows[header_idx]
                col_map = detect_columns(header_row)
                if "project_name" not in col_map or "weight" not in col_map or "guid" not in col_map:
                    diagnostics.append((file_path, sheet_name, f"缺少关键列 {col_map}"))
                    continue

                sheet_weight = 0.0
                sheet_count = 0
                for row_idx in range(header_idx + 1, len(rows)):
                    row = rows[row_idx]
                    if not row:
                        continue
                    project_name = normalize_text(row[col_map["project_name"]]) if col_map["project_name"] < len(row) else ""
                    if not project_matches(project_name):
                        continue

                    guid = normalize_text(row[col_map["guid"]]) if col_map["guid"] < len(row) else ""
                    weight = parse_weight(row[col_map["weight"]]) if col_map["weight"] < len(row) else None

                    if not guid and weight is None:
                        continue
                    if guid and not looks_like_guid(guid):
                        continue

                    component_no = normalize_text(row[col_map["component_no"]]) if "component_no" in col_map and col_map["component_no"] < len(row) else ""
                    sheet_count += 1
                    if weight is not None:
                        sheet_weight += weight
                        total_weight += weight
                        project_stats[project_name]["weight"] += weight
                    project_stats[project_name]["rows"] += 1

                    record = {
                        "file": file_path,
                        "sheet": sheet_name,
                        "row_index": row_idx + 1,
                        "project_name": project_name,
                        "guid": guid,
                        "component_no": component_no,
                        "weight": weight,
                    }
                    matched_rows.append(record)
                    if guid:
                        guid_occurrences[guid].append(record)

                sheet_summaries.append({
                    "file": file_path,
                    "sheet": sheet_name,
                    "count": sheet_count,
                    "weight": sheet_weight,
                    "columns": col_map,
                    "header_row": header_idx + 1,
                })
    finally:
        excel_app.Quit()
        pythoncom.CoUninitialize()

    inbound_guids = {r["guid"] for r in matched_rows if r["guid"]}
    duplicate_guids = {g: rows for g, rows in guid_occurrences.items() if len(rows) > 1}
    missing_in_export = sorted(inbound_guids - exported_guids)
    extra_in_export = sorted(exported_guids - inbound_guids)

    print("=== SHEET_SUMMARY ===")
    for item in sheet_summaries:
        print(f"{item['file']} | {item['sheet']} | header_row={item['header_row']} | rows={item['count']} | weight={item['weight']:.3f} | columns={item['columns']}")

    print("\n=== TOTAL ===")
    print(f"matched_rows={len(matched_rows)}")
    print(f"unique_inbound_guids={len(inbound_guids)}")
    print(f"total_weight={total_weight:.3f}")

    print("\n=== PROJECT_BREAKDOWN ===")
    for project_name, stats in sorted(project_stats.items(), key=lambda x: (-x[1]["weight"], x[0])):
        print(f"{project_name} | rows={stats['rows']} | weight={stats['weight']:.3f}")

    print("\n=== DUPLICATE_GUIDS ===")
    print(f"duplicate_guid_count={len(duplicate_guids)}")
    for guid, items in sorted(duplicate_guids.items())[:200]:
        where = "; ".join(f"{os.path.basename(x['file'])}/{x['sheet']}#{x['row_index']}" for x in items)
        print(f"{guid} | occurrences={len(items)} | {where}")

    print("\n=== COMPARE_WITH_EXPORTED ===")
    print(f"exported_guid_count={len(exported_guids)}")
    print(f"missing_in_export_count={len(missing_in_export)}")
    print(f"extra_in_export_count={len(extra_in_export)}")

    print("\n--- missing_in_export sample ---")
    for guid in missing_in_export[:200]:
        print(guid)

    print("\n--- extra_in_export sample ---")
    for guid in extra_in_export[:200]:
        print(guid)

    print("\n=== DIAGNOSTICS ===")
    for file_path, sheet_name, msg in diagnostics:
        print(f"{file_path} | {sheet_name} | {msg}")


if __name__ == "__main__":
    main()
