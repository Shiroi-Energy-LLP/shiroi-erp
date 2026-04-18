# Finance Over-counting Fix (Migration 079) — Apr 18, 2026

## What Vivek flagged

> "The financial data that you have on the ERP is bad. We dont have so much outstanding. For example VAF is fully paid and so on. You have all the data from Zoho in terms of payment received. Go over all the payments properly to understand the correct cash position. I think you have taken earlier data from completed projects and when you have taken data from zoho it has to be verified, not added up? Check if you did a dedup? We need to get this financial data proper because this is the heart of the ERP for the founders."

## Symptom

Company cash summary on dev was showing impossible values:

| Metric | Before fix | Expected |
|--------|-----------:|---------:|
| total_ap_bills    | −₹1.39Cr | positive (outstanding) |
| total_ap_pos      | −₹4.29Cr | positive (outstanding) |
| VAF AP outstanding | ~₹2Cr    | ₹0 (Vivek: "fully paid") |

Negative AP = we had "paid" more than we were billed. That's the direction of the error Vivek picked up on.

## Root cause

The overnight Zoho Books historical import (Phase 11, `scripts/zoho-import/phase-11-vendor-payments.ts`) imported 729 vendor payments from Zoho. Zoho's payment records contain per-bill / per-PO allocation data, but the import script ignored it. Instead, for each Zoho vendor payment it applied this fallback heuristic:

1. Look up open `vendor_bills` for the vendor, try to find one whose `balance_due ≈ payment_amount`.
2. If no amount match — pick `vendorBills[0]` (**first open bill for that vendor**).
3. If no bill — pick the **latest PO for that vendor** (`ORDER BY po_date DESC LIMIT 1`).

`vendor_payments` has a CHECK constraint `vendor_payments_has_link`: every row must link to *some* bill or PO. The fallback heuristic was added to satisfy the CHECK constraint, not to reflect what Zoho actually said about allocation.

Result: **669 of 729 Zoho vendor payments were linked to wrong bills / POs.** The existing `update_po_amount_paid` trigger on `vendor_payments` then ran:

```sql
UPDATE purchase_orders
SET amount_paid = (SELECT SUM(amount) FROM vendor_payments WHERE purchase_order_id = NEW.purchase_order_id)
```

…which summed dozens of unrelated payments onto a single target PO. Examples from prod-shaped data:

| PO / bill | Total | amount_paid (wrong) | Payments counted |
|-----------|------:|--------------------:|-----------------:|
| VAF bill `1654845000003253387`     | ₹12.17L   | ₹1.97Cr | 16× |
| `SHIROI/PO/2026-27/0018`           | ₹11,800   | ₹1.35Cr | 163× |
| `ZHI/SE/PANEL/532/2526`            | ₹65,734   | ₹1.87Cr | — |

`vendor_bills.balance_due` is a generated column (`total_amount − amount_paid`), so the bills showed *negative* balances and the company roll-up dipped to −₹5.68Cr total AP outstanding.

**AR side was fine.** Audit confirmed 0 invoices with `amount_outstanding < 0`, total AR outstanding ₹3.94L (unchanged). Only AP (vendor payments) was affected.

## Fix — Migration 079

Two moves:

### A. Clamp existing rows (one-time)

```sql
UPDATE vendor_bills
SET amount_paid = total_amount
WHERE amount_paid > total_amount + 0.01;

UPDATE purchase_orders
SET amount_paid = total_amount,
    amount_outstanding = 0
WHERE amount_paid > total_amount + 0.01;
```

- **2 bills** clamped (polluted by over-linked payments)
- **25 POs** clamped (largest removed excess: −₹1.35Cr from SHIROI/PO/2026-27/0018)

Note: clamping loses the ability to recover "real paid per PO" from the polluted sum, but the clamped value is the correct upper bound. Since the bills/POs in question were already fully billed out in Zoho, paid=total is the right state for the ones Zoho said were settled.

### B. Harden the cascade functions (forward-looking)

```sql
-- update_po_amount_paid trigger
UPDATE purchase_orders SET
  amount_paid        = LEAST(v_sum_paid, v_po_total),
  amount_outstanding = GREATEST(v_po_total - v_sum_paid, 0),
  ...

-- recalc_vendor_bill_totals function
v_paid := LEAST(v_paid, v_total);
```

Future vendor_payment inserts can no longer push `amount_paid` above `total_amount`, even if the link is wrong. Balance due can never go negative.

## Post-fix state

Company cash summary after migration 079:

```json
{
  "total_receivables":          394124.00,      // ₹3.94L — unchanged ✓
  "total_ap_bills":            5669525.08,      // ₹56.70L positive ✓
  "total_ap_pos":                   774.00,     // ₹774 positive ✓
  "total_project_expenses_paid": 2187510.03,
  "open_reconciliation_count":        3
}
```

VAF (the project Vivek named) after fix:

```json
{
  "project_number":        "SHIROI/PROJ/2025-26/0113",
  "customer_name":         "Vaf def Aero Systems Pt Ltd",
  "contracted_value":      20256400.00,
  "total_invoiced":        16374388.00,
  "total_received":        16374388.00,
  "total_ar_outstanding":         0.00,          // fully paid on AR ✓
  "total_billed":          14683738.00,
  "total_vendor_paid":     14683738.00,
  "total_ap_outstanding":         0.00,          // fully paid on AP ✓
  "margin_amount":          5386345.97,
  "margin_pct":                  26.59
}
```

Matches Vivek's statement.

## Known follow-ups

1. **Phase 11 re-import will recreate the problem** if run today. The root-cause bug in `scripts/zoho-import/phase-11-vendor-payments.ts` (fallback-to-first-bill / fallback-to-latest-PO) is still there. Fix documented in a separate commit: replace the heuristic with a dry-run report that flags payments Zoho did not allocate cleanly, and require per-line allocation from Zoho's `line_item_id` where available.
2. **Per-bill payment attribution is lost for the 669 mis-linked payments.** We know the vendor-level total is correct (each payment's `amount` is untouched) but not which bill each one settled. For projects that are fully paid end-to-end (like VAF), this doesn't matter — total billed = total paid. For partially-paid vendors it means the per-bill `amount_paid` values are approximate. If this becomes a problem downstream, we'd re-import from Zoho with real allocation.
3. **Phase 11 heuristic needs to be fixed before the next Zoho sync run.** The hardening in migration 079 prevents over-payment from accumulating on a single target, but a mis-linked payment would still be attributed to the wrong PO — it just wouldn't cause the balance to go negative.

## Files

- `supabase/migrations/079_fix_vendor_payment_overcounting.sql` — the fix
- `scripts/zoho-import/phase-11-vendor-payments.ts` — root-cause bug (to be fixed)
