from openpyxl import load_workbook
from collections import defaultdict


CORRECT_PATH = r"I:\autoweb\autoribao\downloads\2026\04\25\2026年4月份成品仓库收发存-正确版.xlsx"
TARGET = "和孚重兆职工公寓项目"


def to_float(v):
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return 0.0
    if s.startswith("="):
        return None
    return float(s)


wb = load_workbook(CORRECT_PATH, read_only=True, data_only=False)

print("=== SUMMARY ROW ===")
ws = wb["汇总"]
for row in ws.iter_rows(values_only=True):
    vals = ["" if v is None else str(v) for v in row[:8]]
    if len(vals) > 1 and TARGET in vals[1]:
        print(vals)

print("\n=== INBOUND DETAIL SAMPLE + SUM ===")
ws = wb["入库明细"]
count = 0
total = 0.0
for row in ws.iter_rows(values_only=True):
    vals = list(row)
    if len(vals) > 1 and vals[1] == TARGET:
        count += 1
        total += float(vals[7] or 0)
        if count <= 20:
            print([None if v is None else str(v) for v in vals[:12]])
print("inbound_count=", count, "inbound_weight_kg=", round(total, 3), "inbound_ton=", round(total / 1000.0, 3))

print("\n=== OUTBOUND DETAIL SAMPLE + SUM ===")
ws = wb["出库明细"]
count = 0
total = 0.0
for row in ws.iter_rows(values_only=True):
    vals = list(row)
    if len(vals) > 2 and vals[2] == TARGET:
        count += 1
        total += float(vals[9] or 0)
        if count <= 20:
            print([None if v is None else str(v) for v in vals[:12]])
print("outbound_count=", count, "outbound_weight_kg=", round(total, 3), "outbound_ton=", round(total / 1000.0, 3))
