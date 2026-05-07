from openpyxl import load_workbook

path = r"I:\autoweb\autoribao\downloads\2026\04\25\202604收发存报表.xlsx"
target = "和孚重兆职工公寓项目"

wb = load_workbook(path, data_only=False, read_only=True)
ws = wb["汇总"]

for row in ws.iter_rows(values_only=True):
    vals = ["" if v is None else str(v) for v in row]
    if any(target in v for v in vals):
        print(vals)
