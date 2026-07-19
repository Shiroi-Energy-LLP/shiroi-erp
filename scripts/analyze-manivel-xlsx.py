"""Read-only aggregate analysis of Manivel's project dashboard workbook.

Produces the precise counts/totals we need to compare the source-of-truth sheet
against the ERP database. No writes anywhere.
"""
import openpyxl
from collections import Counter

PATH = r"C:\Users\vivek\Projects\shiroi-erp\scripts\data\manivel-project-dashboard-2026-06-15.xlsx"
wb = openpyxl.load_workbook(PATH, data_only=True)


def g(row, i):
    return row[i] if i < len(row) else None


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace("₹", "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def yr(v):
    n = num(v)
    return "(blank)" if n is None else str(int(n))


def real_rows(ws, key_col):
    out = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        key = g(row, key_col)
        if key is None or str(key).strip() == "":
            continue
        out.append(row)
    return out


def show_counter(label, c):
    print(f"  {label}: " + ", ".join(f"{k}={v}" for k, v in sorted(c.items(), key=lambda x: str(x[0]))))


# --- Projects ---
pr = real_rows(wb["Projects"], 1)
print(f"PROJECTS rows: {len(pr)}")
show_counter("by year", Counter(yr(g(r, 6)) for r in pr))
show_counter("by status", Counter((str(g(r, 3)).strip() if g(r, 3) else "(blank)") for r in pr))
print(f"  with size>0: {sum(1 for r in pr if (num(g(r,2)) or 0) > 0)}")

# --- Budgets ---
bd = real_rows(wb["Budgets"], 1)
pc = [num(g(r, 4)) for r in bd]
ac = [num(g(r, 5)) for r in bd]
prs = [num(g(r, 9)) for r in bd]
print(f"\nBUDGETS rows: {len(bd)}")
show_counter("by year", Counter(yr(g(r, 8)) for r in bd))
print(f"  with Project Cost>0: {sum(1 for x in pc if x and x>0)}")
print(f"  with Actual Cost>0: {sum(1 for x in ac if x and x>0)}")
print(f"  with BOTH cost+actual>0: {sum(1 for a,b in zip(pc,ac) if a and a>0 and b and b>0)}")
print(f"  SUM Project Cost: {sum(x for x in pc if x):,.2f}  (= {sum(x for x in pc if x)/1e7:.2f} Cr)")
print(f"  SUM Actual Cost:  {sum(x for x in ac if x):,.2f}  (= {sum(x for x in ac if x)/1e7:.2f} Cr)")
print(f"  SUM Profit In rs: {sum(x for x in prs if x):,.2f}  (= {sum(x for x in prs if x)/1e7:.2f} Cr)")

# --- Project details ---
pd_ = real_rows(wb["Project details"], 0)
print(f"\nPROJECT DETAILS rows: {len(pd_)}")

# --- Tasks ---
tk = real_rows(wb["Tasks"], 0)
print(f"\nTASKS rows: {len(tk)}")
show_counter("by status", Counter((str(g(r, 3)).strip() if g(r, 3) else "(blank)") for r in tk))

# --- Services ---
sv = real_rows(wb["Services"], 0)
print(f"\nSERVICES rows: {len(sv)}")
show_counter("by status", Counter((str(g(r, 4)).strip() if g(r, 4) else "(blank)") for r in sv))

# --- Plant Monitoring ---
pm = real_rows(wb["Plant Monitoring"], 0)
print(f"\nPLANT MONITORING rows: {len(pm)}")
show_counter("by brand", Counter((str(g(r, 1)).strip() if g(r, 1) else "(blank)") for r in pm))

# --- Activities ---
av = real_rows(wb["Activities"], 1)
print(f"\nACTIVITIES rows: {len(av)}")

# --- Distinct project names across sheets (join-key sanity) ---
def names(rows_, col):
    return {str(g(r, col)).strip().lower() for r in rows_ if g(r, col)}

p_names = names(pr, 1)
b_names = names(bd, 1)
d_names = names(pd_, 0)
print("\nJOIN-KEY SANITY (distinct lowercased project names):")
print(f"  Projects distinct: {len(p_names)}")
print(f"  Budgets distinct:  {len(b_names)}")
print(f"  Details distinct:  {len(d_names)}")
print(f"  in Projects but NOT in Budgets: {len(p_names - b_names)}")
print(f"  in Budgets but NOT in Projects: {len(b_names - p_names)}")
print(f"  in Projects but NOT in Details: {len(p_names - d_names)}")
