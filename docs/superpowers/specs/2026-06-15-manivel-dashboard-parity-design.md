# Manivel Dashboard Parity + Data Credibility — Design

> Status: approved 2026-06-15 (Vivek). Build proceeds dev-only; reconciliation is human-driven via UI.
> Source workbook committed at `scripts/data/manivel-project-dashboard-2026-06-15.xlsx`.

## 1. Problem & Goal

Manivel (PM) runs the business off a Google Apps Script dashboard backed by **one Google Sheet**
(7 tabs, 266 projects, 2022→now). It looks better and *feels* more trustworthy than the ERP's
current views, so he hasn't moved onto the ERP. Two intertwined goals:

1. **Credibility** — the ERP holds the same projects but the data is messy (row bloat, missing
   year/value, no per-project profit rollup, partial cost attribution), so any dashboard built on it
   today would surface wrong numbers.
2. **Parity-plus dashboard** — give the ERP a year-wise command center that matches every section of
   Manivel's sheet and beats its UX, so he switches.

**Direction:** the sheet is the trusted *cross-check and backfill* for historical figures; the ERP's
own transactions are the primary source where they exist. We are NOT dumping the sheet over the ERP.

## 2. Source of truth — Manivel's workbook (measured)

7 sheets, all joined on free-text **Project Name** (the de-facto key):

| Sheet | Rows | Notes |
|---|---|---|
| Projects | 266 (264 unique; 2 dup names) | Name, Size, Status, Location, **Years**, Remarks |
| Budgets | 266 | Project Cost, Actual Cost, Est/Act Profit, **Year**, Profit ₹ |
| Project details | **22** | rich config — barely used (ERP is richer here) |
| Tasks | 268 | Closed 234 / Open 34 |
| Services | 46 | Closed 44 / Open 2 |
| Plant Monitoring | 187 | brand creds; brand names messy (Goodwe/Goodwee, Fronius/Fronious) |
| Activities | 24 | Date/Stage/Done By/**SE·OutSource·Contractor manpower** — exact match to `project_activities` |

**Year span:** 2024:133 · 2025:108 · 2026:23 · (2022/23: 1 each).
**Financials populated on only 190 of 266:** ₹15.47 Cr project cost · ₹11.70 Cr actual · ₹3.78 Cr profit
(≈24.7% avg act margin). 76 rows have no money. `Profit ₹ = Project Cost − Actual Cost` (confirmed).

## 3. ERP current state (dev `actqtzoxjilqnldnacqz`, measured 2026-06-15)

- **465 active projects** (+10 soft-deleted). 349 completed.
- `contracted_value` on 383 (₹30.64 Cr). `system_size_kwp` on 458. `order_date` on 310 (**155 blank**).
- `project_name` on 14, `company_id` on 15 → naming relies on `customer_name`.
- `data_verified_at` on **1 of 465** (mechanism exists, unused).
- Cost data IS present: **expenses** (6,283 rows / 173 projects / ₹6.75 Cr), **purchase_orders**
  (2,046 / 181 / ₹45.58 Cr), **vendor_payments** (1,486 / 45 attributed / ₹46.72 Cr),
  **invoices** (₹74.74 Cr), **customer_payments** (₹70.42 Cr), **BOQ** (62 projects / ₹3.04 Cr).
- **178 projects have both revenue and attributed cost → real margin computable today** (150 completed).
  That's ≈ the sheet's 190. So the ERP is *not* missing the money.
- BUT the designed rollup tables **`bom_actual_vs_budgetary` and `project_cost_variances` are EMPTY**,
  and lots of cash isn't project-attributed (esp. vendor_payments).

## 4. The credibility gap (precise)

1. **No per-project rollup** — granular transactions never summed into "this project cost ₹X, margin Y%".
2. **Partial attribution** — much spend/receipt isn't tagged to a project; company-wide Zoho totals
   (₹45–74 Cr) dwarf the curated sheet (₹15.47 Cr) because they're all of Shiroi's cash.
3. **No reconciliation** — ERP-computed cost has never been checked against Manivel's manual number.
4. **Row/▢year mess** — 465 vs 266; ~199 older (pre-2022) rows; `order_date` missing on a third.

## 5. Approach

### 5.1 Reconciliation model
- **Match key:** normalized Project Name (lowercase, strip punctuation/honorifics/whitespace) +
  size proximity + location as tiebreak. Trigram/`difflib` similarity score per pair.
- **Confidence buckets:** `auto` (score ≥ 0.92 & size match), `likely` (0.75–0.92), `ambiguous` (<0.75 or
  multiple candidates), `sheet-only` (no ERP row), `erp-only` (no sheet row → pre-2022 candidate).
- **Nothing auto-applied.** Matches land in a staging table; Manivel confirms/overrides in the UI.

### 5.2 Profitability rollup (ERP primary, sheet cross-check + backfill)
- A SQL rollup per project:
  - `revenue_erp` = `contracted_value` (fallback `sum(invoices.total_amount)`).
  - `cost_erp` = `sum(purchase_orders.total_amount)` (committed material) + `sum(expenses.amount where status approved)` (site). vendor_payments excluded to avoid double-count with POs.
  - `margin_erp` = (revenue − cost) / revenue.
- Stored alongside the sheet figures (`project_cost_sheet`, `actual_cost_sheet`) with a
  `preferred_source` flag so the dashboard shows **ERP-computed vs Manivel's manual side-by-side** and
  flags divergence > threshold. Backfill: projects with no `cost_erp` fall back to the sheet figure.
- Money aggregation in **SQL RPCs only** (never JS `.reduce()` — house rule).

### 5.3 Reconciliation UI (for Manivel, tomorrow)
A `/reconciliation` workspace (founder + PM) where Manivel, per project:
- sees the proposed sheet↔ERP match + confidence, **confirms or re-points** it;
- sees ERP-computed cost/margin next to the sheet's number, picks the trusted one;
- resolves `sheet-only` (create/locate ERP project) and `erp-only` (confirm pre-2022 → bucket "≤2021");
- sets the project's **resolved year** and status.
Edits write to a **side table** (`project_reconciliation`), leaving core `projects` untouched until a
deliberate "commit to project" action (human-clicked) writes back. No autonomous mutation of `projects`.

### 5.4 Dashboard (parity → beat it)
New `/dashboard` command center mirroring the sheet's nav, reading reconciled data:
- Overview cards: projects, completed, total value, actual cost, est/act profit %, tasks, services, activities.
- Tasks/Services status charts.
- **Year-grouped project ledger** with financials + the **"≤2021"** bucket and a year filter.
- Section views wiring existing modules: Tasks (execution), Services (O&M/tickets), Activities
  (`project_activities`), Plant Monitoring (commissioning creds). UI/UX pass to exceed the Apps Script look.

### 5.5 Year handling
Resolved year precedence: confirmed sheet Year (matched) → `order_date`/`commissioned_date` year →
**"≤2021"** bucket (erp-only/older) → "unknown". Stored as `resolved_year` in `project_reconciliation`.

## 6. Data model (dev migrations, additive — overwrite nothing)
- `recon_sheet_projects` — imported 266 Budgets+Projects rows (name, size, status, location, year, project_cost, actual_cost, profit). Source-of-truth snapshot, kept for audit.
- `project_reconciliation` — `project_id` PK, `matched_sheet_id`, `match_score`, `match_method`,
  `status` (proposed/confirmed/rejected/manual), `resolved_year`, `resolved_status`,
  `sheet_project_cost`, `sheet_actual_cost`, `cost_erp`, `revenue_erp`, `preferred_source`,
  `reviewed_by`, `reviewed_at`, `notes`.
- `get_project_profitability()` RPC + a thin view the dashboard reads.
- (Optional later) populate `bom_actual_vs_budgetary` from BOQ vs PO once matches are confirmed.
- Plant-monitoring credential import (187 rows) → normalized brand, into the monitoring/commissioning store.

## 7. Phases & deliverables
- **P0 Foundations** (done): workbook + parsers in repo; schema audited.
- **P1 Reconciliation audit** (read-only): matcher → `docs/reviews/2026-06-15-manivel-erp-reconciliation.md`
  + per-project CSV. The "compare once and for all" artifact.
- **P2 Rollup + staging + UI**: profitability RPC; `recon_sheet_projects` + `project_reconciliation`
  (dev migrations); `/reconciliation` UI for Manivel; monitoring-cred import (proposed, not applied).
- **P3 Dashboard**: `/dashboard` parity command center on reconciled data.

## 8. Guardrails & non-goals
- **Dev only. Never prod** until Vivek green-lights a window.
- **No autonomous destructive data ops** — matches/dedupe/bucketing/value-overrides go through the
  Manivel UI; core `projects` rows are only changed by a human-clicked commit.
- Every commit passes the 4 CI gates and is reviewable on `main`.
- Non-goal: importing the sheet's sparse "Project details" config (ERP is already richer).
- Non-goal: touching the live Zoho-imported finance totals; we only *attribute/roll up* per project.

## 9. Testing
- Vitest for the matcher normalization + diff helpers (pure functions).
- RPC correctness checked against known projects (spot-compare ERP rollup vs sheet).
- `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build` before each push.

## 10. Open decisions (for Manivel/Vivek)
- Exact `cost_erp` definition (PO+expenses vs vendor_payments+expenses) — defaulted to PO+expenses; validate against sheet in the UI.
- Divergence threshold for flagging ERP-vs-sheet mismatch (default 10%).
- Whether confirmed reconciliation auto-sets `data_verified_at`.
