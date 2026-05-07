from openpyxl import load_workbook
import sys


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python inspect_workbook_preview.py <xlsx-path>")

    path = sys.argv[1]
    wb = load_workbook(path, read_only=True, data_only=False)
    print(wb.sheetnames)
    for s in wb.sheetnames[:3]:
        ws = wb[s]
        print(f"=== {s} ===")
        for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
            print(i, [None if v is None else str(v) for v in row[:12]])
            if i >= 12:
                break


if __name__ == "__main__":
    main()
