# Cash Position Root-Cause Fix (Migrations 080 + 081) — Apr 19, 2026

## What Vivek flagged (pushback on mig 079)

> "the numbers are still wrong. VAF still shows - 3 cr, whereas it should be profitable. same with a lot of other projects. you have not found the root cause for the cash position numbers. pls dig deep and get this sorted out."

Migration 079 (Apr 18) had clamped `amount_paid` and hardened the `update_po_amount_paid` trigger with `LEAST()` guards. That fixed the *symptom* (negative AP at company level) but did nothing about the two bugs actually producing wrong project-level cash. Vivek was right.

## Symptom (dev, post-079)

`project_cash_positions` showed clearly impossible data:

| Project | Real state | What cash_position said | Delta |
|---------|------------|------------------------:|-------|
| VAF (SHIROI/PROJ/2025-26/0113) | invoiced ₹1.63Cr, fully paid AP | `invoiced=0, po=3Cr, net=-3Cr` | off by ₹3Cr |
| Radiance Flourish | 0 invoiced, no real vendor spend | `po=75L, paid_vendors=75L, net=-75L` | off by ₹75L |
| Hindu School Payalwar | same | `po=54L, paid_vendors=54L, net=-54L` | off by ₹54L |
| Prestige Hill Crest | received ₹8.5L advance, no real PO | `po=39L, paid_vendors=39L, net=-31L` | off by ₹39L |
| RWD Grand Corridor | 0 real activity | `po=27L, paid_vendors=27L, net=-27L` | off by ₹27L |

All of these had big negative `net_cash_position` driven by vendor-outflow that never actually happened.

## Root cause — two bugs stacked

### Bug A — Drive-BOM fake-paid PO fabrication

`scripts/migrate-google-drive.ts` ran *before* the Zoho Books backfill (migrations 067–072). Lines 1384–1442:

```typescript
const poData = {
  project_id: projectId,
  vendor_id: vendorId,
  po_number: poNumber,
  status: 'fully_delivered',       // <-- fake
  po_date: parseDate(project.details?.startDate || '') || '2025-01-01',
  total_amount: totalAmount,
  amount_paid: totalAmount,        // <-- fake (no evidence of real payment)
  amount_outstanding: 0,
  notes: `Migrated from Google Drive: ${project.folderName}`,  // <-- provenance
};
```

Result: **869 `purchase_orders` rows** with `source='erp'`, `status='fully_delivered'`, `amount_paid=total_amount`, and notes matching `'Migrated from Google Drive:%'`. Total fabricated PO value: **₹5.41Cr**. None of these rows represents a real committed purchase order — they are BOM-derived projections masquerading as settled transactions.

Then Zoho Phase 07 (`scripts/zoho-import/phase-07-pos.ts`) imported 106 real POs with `ZHI/SE/*` prefixes:

```
// Numbers prefixed with ZHI/ to avoid collision with ERP-issued PO numbers.
```

The Zoho import intentionally treated the two universes as non-overlapping. For 8 projects that Zoho's project-matcher identified (VAF, Shoba Silks, Solai Ayyar, Swarnalatha, Syed Mubarak, 3 Ramaniyam projects), **both sets landed attached to the same project_id** — dup data. The Zoho set is the truth; the Drive-BOM set inflates `total_po_value` roughly 2× for those 8.

For the other 115 projects, only the Drive-BOM set exists (Zoho didn't match or didn't have those projects at all). Every rupee of their `total_po_value` and `total_paid_to_vendors` is fabricated.

### Bug B — `refresh_project_cash_position` LEFT JOIN bug

The trigger function (applied in an earlier migration around the cash-position module) computed `total_invoiced` via:

```sql
SELECT COALESCE(SUM(cp.amount), 0), COALESCE(SUM(inv.total_amount), 0)
INTO v_total_received, v_total_invoiced
FROM customer_payments cp
LEFT JOIN invoices inv ON inv.id = cp.invoice_id
WHERE cp.project_id = v_project_id;
```

This is backwards — it starts from `customer_payments`. For any project with 0 customer_payments (VAF had 3 invoices totaling ₹1.63Cr but no customer_payment rows imported from Zoho), the join returns 0 rows → `total_invoiced = 0` and `total_received = 0`, even when invoices exist.

10+ projects on dev had real invoices but 0 imported customer_payments — all of them showed `invoiced=0` in cash_position.

### Combined effect on VAF

| Field | What cash_position said | What was real |
|------:|------------------------:|--------------:|
| total_invoiced | 0 (Bug B) | ₹1.63Cr |
| total_received | 0 (Bug B) | ₹1.63Cr |
| total_po_value | ₹3Cr (Bug A dup) | ₹1.59Cr (Zoho only) |
| total_paid_to_vendors | ₹3Cr (Bug A dup) | ₹1.46Cr |
| **net_cash_position** | **−₹3Cr** | **+₹17.33L** |

## Fix

### Migration 080 — dup-PO cleanup + function rewrite + force refresh

1. **Delete 9 mis-linked vendor_payments** on ERP-source POs across the 8 dup projects (no valid re-link target).
2. **Delete 75 ERP-source POs** on the 8 dup projects. 181 `purchase_order_items` rows cascade (FK `ON DELETE CASCADE`).
3. **Rewrite `refresh_project_cash_position`** to query `invoices` and `customer_payments` independently (no JOIN trick). When `customer_payments` is empty for a project, fall back to `invoices.amount_paid` so Zoho-imported invoices with the paid flag still register as received.
4. **Force-refresh all 57 `project_cash_positions` rows** via INSERT…SELECT using the same corrected logic.

### Migration 081 — soft-cancel remaining Drive-BOM POs

1. **UPDATE 775 Drive-BOM POs**: `status='cancelled'`, `amount_paid=0`, `amount_outstanding=total_amount`. The `refresh_project_cash_position` function filters `status NOT IN ('cancelled')`, so these stop contributing to cash rollups.
2. **2,167 `purchase_order_items` kept** (BOM history retained for reference, not useful as financial signal).
3. **57 mis-linked Zoho vendor_payments (₹98.49L total) kept attached** to the now-cancelled Drive-BOM POs. The `vendor_payments_has_link` CHECK (`purchase_order_id IS NOT NULL OR vendor_bill_id IS NOT NULL`) still holds. These payments are real money that Zoho recorded but for which we don't know the correct target on this side — deleting them would lose audit trail; leaving them attached to a cancelled PO keeps the record available for future re-import with per-bill allocation data.
4. **Force-refresh all `project_cash_positions` rows again.**

## Post-fix state

### VAF (the project Vivek named)

```json
{
  "project_number":         "SHIROI/PROJ/2025-26/0113",
  "customer_name":          "Vaf def Aero Systems Pt Ltd",
  "total_contracted":       20256400.00,
  "total_invoiced":         16374388.00,
  "total_received":         16374388.00,
  "total_po_value":         14641286.00,
  "total_paid_to_vendors":  14641286.00,
  "total_outstanding":             0.00,
  "total_vendor_outstanding":      0.00,
  "net_cash_position":       1733102.00,
  "is_invested":                  false
}
```

₹17.33L positive — profitable, as Vivek said.

### Company cash summary

```json
{
  "total_receivables":    394124,
  "total_ap_bills":      5669525,
  "total_ap_pos":            774,
  "total_project_expenses_paid": 2187510,
  "open_reconciliation_count":  3
}
```

All positive, same as after mig 079 (company summary was already correct at the AP/AR level; the bug was in project-level attribution).

### Remaining negative-net projects (5 total, all legitimate)

| Project | Invoiced | PO value | Net | Why |
|---------|---------:|---------:|----:|-----|
| Mr Solai Ayyar | 0 | ₹4.5L | −₹4.5L | 8 real Zoho POs, customer not yet invoiced |
| M/s Srividya Srikanth | 0 | ₹1.5L | −₹1.5L | 4 real Zoho POs, not yet invoiced |
| Syed Mubarak | 0 | ₹2.4L | −₹0.87L | Advance received, no invoice yet |
| Swarnalatha | ₹2.59L | ₹3.4L | −₹0.83L | Over-spent vs. invoiced (real) |
| Deepak | 0 | ₹1.7L | −₹0.12L | 6 real SHIROI/PO/2026-27 POs, fresh project |

All 5 are the correct behaviour — vendor spend committed ahead of customer invoicing. No fake data.

## Known follow-ups

1. **`scripts/migrate-google-drive.ts` should be retired** or have its auto-PO logic removed. Running it again today would re-introduce fake-paid POs. Safest to add a guard at the top that no-ops if the Zoho import has already run.
2. **57 Zoho vendor_payments (₹98.49L) are orphaned on cancelled POs.** They represent real money but with no valid project/bill target. Recovery requires Zoho's per-bill allocation export (same follow-up as mig 079). Queryable via `SELECT * FROM vendor_payments vp JOIN purchase_orders po ON po.id = vp.purchase_order_id WHERE po.status='cancelled' AND po.notes LIKE 'Migrated from Google Drive:%'`.
3. **2,167 purchase_order_items on cancelled Drive-BOM POs** are still in the DB. Not harmful (no query reads items from cancelled POs) but can be purged in a future cleanup.
4. **Phase 11 Zoho import still has the fallback-to-latest-PO bug** (noted in mig 079 follow-ups). Will need fixing before any future Zoho re-sync.

## Files

- `supabase/migrations/080_fix_duplicate_pos_and_cash_position.sql` — dup cleanup + function fix
- `supabase/migrations/081_cancel_drive_bom_pos.sql` — soft-cancel fabricated POs
- `scripts/migrate-google-drive.ts` — root-cause for Bug A, needs retirement/guard
- `docs/2026-04-18-finance-overcounting-fix.md` — the mig 079 findings doc (earlier, symptom-level fix)
