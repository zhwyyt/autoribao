from openpyxl import load_workbook

p = r"G:\网页下载\项目构件详情.xlsx"
wb = load_workbook(p, read_only=True, data_only=True)
print("sheets:", wb.sheetnames)
for ws in wb.worksheets[:5]:
    print("===", ws.title, "===")
    for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
        print(i, [None if v is None else str(v) for v in row[:16]])
        if i >= 12:
            break
