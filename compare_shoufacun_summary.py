from openpyxl import load_workbook

CORRECT = r"I:\autoweb\autoribao\downloads\2026\04\25\2026年4月份成品仓库收发存-正确版.xlsx"
GENERATED = r"I:\autoweb\autoribao\downloads\2026\04\25\202604收发存报表.xlsx"


def norm_name(v):
    s = "" if v is None else str(v).strip()
    s = s.replace("（", "(").replace("）", ")")
    s = s.replace("【", "[").replace("】", "]")
    s = "".join(s.split())
    return s


def val(v):
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


def read_summary(path):
    wb = load_workbook(path, data_only=False, read_only=False)
    ws = wb["汇总"]
    data = {}
    for r in range(5, ws.max_row + 1):
        name = norm_name(ws.cell(r, 2).value)
        if not name:
            continue
        if any(k in name for k in ["合计", "编制", "审核", "审批", "统计", "制表"]):
            continue
        data[name] = {
            "display": ws.cell(r, 2).value,
            "last": val(ws.cell(r, 3).value),
            "in": val(ws.cell(r, 4).value),
            "out": val(ws.cell(r, 5).value),
        }
    return data


correct = read_summary(CORRECT)
generated = read_summary(GENERATED)

all_names = sorted(set(correct) | set(generated))
print("project_count_correct=", len(correct))
print("project_count_generated=", len(generated))

for name in all_names:
    c = correct.get(name)
    g = generated.get(name)
    if c is None:
        print("ONLY_GENERATED", generated[name]["display"])
        continue
    if g is None:
        print("ONLY_CORRECT", correct[name]["display"])
        continue
    diffs = []
    for key in ["last", "in", "out"]:
        cv = c[key]
        gv = g[key]
        if cv is None or gv is None:
            if cv != gv:
                diffs.append(f"{key}: correct={cv} generated={gv}")
        elif round(cv - gv, 3) != 0:
            diffs.append(f"{key}: correct={cv:.3f} generated={gv:.3f}")
    if diffs:
        print(g["display"])
        for d in diffs:
            print("  ", d)
