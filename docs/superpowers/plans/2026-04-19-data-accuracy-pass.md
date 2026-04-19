# Data Accuracy Pass — Projects, Money Received, Profitability

**Goal:** Fix the broken attribution chain between ERP projects and Zoho money-movement data so that (1) every ERP project that has a Zoho counterpart is linked, (2) all customer payments in Zoho flow to the right project, (3) profitability per project becomes trustworthy.

**Architecture:** Rewrite Zoho import phases 06–12 to use direct Zoho IDs (Project ID, Invoice ID, Bill ID, InvoicePayment ID, PIPayment ID) instead of name lookups. Wipe and re-run the full import. Payment XLS files are already per-allocation — stop collapsing them.

**Branch:** `feat/n8n-workflow-scaffolding` (current)

---

## Problem Statement

Current state (dev, before this plan):

| Metric | Count | Expected |
|---|---|---|
| ERP projects with `zoho_project_id` | 12 | 248+ |
| `zoho_project_mapping` rows | 12 | 248 |
| Invoices (`source='zoho_import'`) | 20 | ~140 unique |
| Customer payments (`source='zoho_import'`) | 7 | 1197 allocations |
| Vendor bills (`source='zoho_import'`) | 2336 | ~2500 |
| Vendor payments (`source='zoho_import'`) | 720 | 3397 allocations |
| POs (`source='zoho_import'`) | 106 | ~250 |
| Expenses (`source='zoho_import'`) | 190 | ~1500 |

Root causes:
1. **Phase 06** auto-matches at ≥0.85 only → 12 projects matched, 236 orphaned in review/unmatched CSVs.
2. **Phase 07/08/12** look up project via `zoho_project_mapping` (by name) — with only 12 mapped, 90%+ of POs/invoices/expenses get no project_id and are skipped.
3. **Phase 09 (customer payments)** dedupes by `CustomerPayment ID` (losing per-invoice allocations), ignores `InvoicePayment ID`, `Invoice Number`, `Amount Applied to Invoice`. Result: 7 imported out of 1197 rows.
4. **Phase 11 (vendor payments)** dedupes by `VendorPayment ID` (losing per-bill allocations), ignores `PIPayment ID`, `Bill ID`. Result: 720 imported out of 3397 rows.

---

## Zoho XLS Shapes (Confirmed)

| File | Rows | Grain | Dedupe Key | Project Attribution |
|---|---|---|---|---|
| `Projects.xls` | 248 | 1 row / project | `Project ID` | — |
| `Invoice.xls` | 923 | 1 row / line item | group by `Invoice ID` | `Project ID` column (direct) |
| `Customer_Payment.xls` | 1197 | 1 row / invoice allocation | `InvoicePayment ID` | via linked invoice |
| `Purchase_Order.xls` | 4322 | 1 row / line item | group by `Purchase Order ID` | `Project ID` column (direct) |
| `Bill.xls` | 5937 | 1 row / line item | group by `Bill ID` | `Project Name` only (no Project ID) |
| `Vendor_Payment.xls` | 3397 | 1 row / bill allocation | `PIPayment ID` | via linked bill |
| `Expense.xls` | 5302 | 1 row / expense | `Expense Reference ID` | `Project Name` only |

---

## Plan

### Phase 1 — Aggressive project matching (Phase 06 rewrite)

**Goal:** bring the `zoho_project_mapping` table from 12 → 240+ rows and backfill `projects.zoho_project_id`.

**File:** `scripts/zoho-import/phase-06-projects.ts`

Changes:
1. Drop auto-accept threshold from 0.85 to 0.60, with a "clear winner" rule: accept best match when `bestScore ≥ 0.50 AND (bestScore - secondBest) ≥ 0.15`.
2. Add project-cost signal: if token match is borderline and `|zoho_cost - erp_contracted_value| / max(...) < 0.05`, bump score by 0.20 (financial fingerprint is very strong).
3. Add customer-name signal: if zoho.Customer Name tokens overlap ERP project's customer company_name, bump score by 0.10.
4. After matching: write `projects.zoho_project_id = zoho_project_id` for matched ERP projects (backfill — currently only 12 have it).
5. Keep review-queue CSV for genuinely ambiguous (<0.50 or tie), but this should now be <20 projects.

Expected outcome: 200+ mappings, <50 unmatched.

### Phase 2 — Purchase Orders by Zoho Project ID (Phase 07 rewrite)

**File:** `scripts/zoho-import/phase-07-pos.ts`

Current: looks up project by `Project Name` via `zoho_project_mapping`.

Rewrite:
1. Build lookup: `zoho_project_id → erp_project_id` from `projects` where `zoho_project_id IS NOT NULL` (populated by Phase 1).
2. For each PO line-item group (grouped by `Purchase Order ID`), read the line's `Project ID` column directly.
3. If the PO has `Project ID` and it maps → use that ERP project.
4. If `Project ID` is empty, fall back to name lookup via `zoho_project_mapping`.
5. If still unresolved, import PO with `project_id = NULL` (schema allows it for imports).

Expected outcome: 200+ POs imported (vs 106 today).

### Phase 3 — Invoices by Zoho Project ID (Phase 08 rewrite)

**File:** `scripts/zoho-import/phase-08-invoices.ts`

Current: dedupes by Invoice ID already (good), but project lookup via name only.

Rewrite:
1. Group line items by `Invoice ID` (keep current logic).
2. Use `Project ID` column from first line of each invoice → lookup in zoho-id map built in Phase 2.
3. Fall back to name lookup, then customer-only projects, then NULL.
4. Store `zoho_project_id` and `zoho_customer_id` already supported — keep.

Expected outcome: 130+ invoices (vs 20).

### Phase 4 — Customer Payments per-allocation (Phase 09 rewrite)

**File:** `scripts/zoho-import/phase-09-customer-payments.ts`

Current: dedupes by `CustomerPayment ID` → 7 rows imported.

Rewrite:
1. One DB row per Customer_Payment.xls row (they are already per-allocation).
2. Dedupe key = `InvoicePayment ID` (stored in `zoho_customer_payment_id`).
3. Amount = `Amount Applied to Invoice`.
4. Link:
   - `invoice_id` = lookup by `Invoice Number` → `invoices.zoho_invoice_number` (store prefix `ZHI/`).
   - `project_id` = invoice.project_id (propagate from linked invoice).
5. If no invoice match: try project-by-customer-name (legacy path); if still none, skip.

Expected outcome: 900+ customer-payment allocations (vs 7).

### Phase 5 — Bills (Phase 10 rewrite, minor)

**File:** `scripts/zoho-import/phase-10-bills.ts`

Current: aggregates correctly (2336 imported). Project lookup by name only (Bill.xls has no Project ID).

Changes:
1. Keep name-lookup path but now using the much larger `zoho_project_mapping` (from Phase 1).
2. Add customer-name signal: if bill has `Customer Name`, use `projects.customer_id → customers.company_name` to narrow when name-lookup is ambiguous.

Expected outcome: more bills get `project_id`.

### Phase 6 — Vendor Payments per-allocation (Phase 11 rewrite)

**File:** `scripts/zoho-import/phase-11-vendor-payments.ts`

Current: 720 rows imported via exact-amount heuristic.

Rewrite:
1. One DB row per Vendor_Payment.xls row.
2. Dedupe key = `PIPayment ID` (stored in `zoho_vendor_payment_id`).
3. Amount = `Bill Amount` (the per-bill allocated amount, not total payment).
4. Link `vendor_bill_id` via `Bill ID` → `vendor_bills.zoho_bill_id` (direct match).
5. `project_id` = bill.project_id.
6. If bill has no project, skip (project_id is NOT NULL on vendor_payments).

Expected outcome: 2500+ vendor-payment allocations (vs 720). Cleanly linked per bill — eliminates the "exact-amount guess" heuristic that migration 079 had to clean up.

### Phase 7 — Expenses (Phase 12 rewrite, minor)

**File:** `scripts/zoho-import/phase-12-expenses.ts`

Rewrite:
1. Name lookup via larger mapping from Phase 1.
2. For expenses with no project, still import (expenses have nullable project_id).

Expected outcome: 1300+ expenses (vs 190).

### Phase 8 — Wipe and re-import

1. `DELETE FROM customer_payments WHERE source='zoho_import';`
2. `DELETE FROM vendor_payments WHERE source='zoho_import';`
3. `DELETE FROM vendor_bill_items WHERE vendor_bill_id IN (SELECT id FROM vendor_bills WHERE source='zoho_import');`
4. `DELETE FROM vendor_bills WHERE source='zoho_import';`
5. `DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE source='zoho_import');`
6. `DELETE FROM invoices WHERE source='zoho_import';`
7. `DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE source='zoho_import');`
8. `DELETE FROM purchase_orders WHERE source='zoho_import';`
9. `DELETE FROM expenses WHERE source='zoho_import';`
10. Reset `projects.zoho_project_id` to NULL so Phase 06 can re-map.
11. Clear `zoho_project_mapping`.
12. Re-run Phase 06, 07, 08, 09, 10, 11, 12 in order.

### Phase 9 — Reconciliation report

Write `scripts/zoho-import/reconcile.ts`:
1. Sum `Amount Applied to Invoice` across Customer_Payment.xls → compare with `SUM(amount)` from `customer_payments WHERE source='zoho_import'`.
2. Sum `Bill Amount` across Vendor_Payment.xls → compare with `SUM(amount)` from `vendor_payments WHERE source='zoho_import'`.
3. Sum `Total` per unique `Invoice ID` in Invoice.xls → compare with `SUM(total_amount)` from `invoices WHERE source='zoho_import'`.
4. Sum `Total` per unique `Bill ID` in Bill.xls → compare with `SUM(total_amount)` from `vendor_bills WHERE source='zoho_import'`.
5. Sum `Total` per unique `Purchase Order ID` in Purchase_Order.xls → compare with `SUM(total_amount)` from `purchase_orders WHERE source='zoho_import'`.
6. Write differences > 1% to `scripts/zoho-import/reconciliation-report.md` for Vivek to review.

### Phase 10 — Commit + push

Commit + push after each of phases 1–7 individually (not wait for end-to-end). Phase 8 as one commit. Phase 9 as final commit. Update `docs/CHANGELOG.md` + `docs/CURRENT_STATUS.md` after each.

---

## Non-goals

- UI changes. Finance dashboard already reads from these tables; just need the data to be right.
- Schema changes beyond ensuring nullability where needed (already done in earlier migrations).
- Fixing individual ERP projects that lack any Zoho match (not every ERP project has Zoho money, and that's fine).

## Risks

- **Bills can't be linked to projects at the line level** because Bill.xls only has Project Name. This means bill→project attribution still depends on name match quality. Acceptable — vendor_payments link to bills, and bills link to projects through name, so money still flows.
- **Advance payments** (customer paid before invoice issued) → Customer_Payment row has no Invoice Number. These will get project via customer-name fallback or get skipped. Re-importing with better data later is cheap.
- **Duplicate PIPayment IDs across wipe/reload cycles** → unique index on `zoho_vendor_payment_id` would block, but we wipe first, so fresh insert works.

## Success criteria

After Phase 8:
- `projects.zoho_project_id IS NOT NULL` count ≥ 200
- `customer_payments` with `source='zoho_import'` count ≥ 900
- `vendor_payments` with `source='zoho_import'` count ≥ 2500
- `invoices` count ≥ 130
- `purchase_orders` with `source='zoho_import'` count ≥ 200
- No unique-constraint errors during import
- Reconciliation report shows <1% delta between Zoho raw totals and ERP totals for all five entities

Once these hold, `get_project_profitability_v2` RPC will return trustworthy numbers for the ~200 Zoho-matched projects, and "money received" totals will match Zoho's books.
