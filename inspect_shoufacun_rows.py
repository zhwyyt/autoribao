import sys
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path, data_only=False, read_only=True)
for name in wb.sheetnames:
    ws = wb[name]
    print(f'=== {name} rows={ws.max_row} cols={ws.max_column} ===')
    for idx, row in enumerate(ws.iter_rows(min_row=1, max_row=min(ws.max_row, 5), values_only=True), start=1):
        print(idx, list(row))
    if ws.max_row > 5:
        print('...')
        start = max(1, ws.max_row - 2)
        for idx, row in enumerate(ws.iter_rows(min_row=start, max_row=ws.max_row, values_only=True), start=start):
            print(idx, list(row))
