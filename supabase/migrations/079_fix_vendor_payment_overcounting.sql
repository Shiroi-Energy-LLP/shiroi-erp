-- ============================================================================
-- Migration 079 — Fix vendor payment over-counting from Zoho import
-- ============================================================================
--
-- Root cause (Vivek's flag: "VAF is fully paid but shows as outstanding;
-- the financial data is the heart of the ERP for founders"):
--
-- 1. Zoho import Phase 11 (vendor_payments) did not carry the bill/PO-level
--    allocation from Zoho. For each Zoho vendor payment it grabbed "the first
--    open bill for that vendor" or "the latest PO for that vendor" as a
--    fallback link. This produced 669 payments linked to wrong POs.
--
-- 2. The existing `update_po_amount_paid` trigger on vendor_payments fires
--    `UPDATE purchase_orders SET amount_paid = (SELECT SUM(amount) FROM
--    vendor_payments WHERE purchase_order_id = NEW.purchase_order_id)`.
--    Because of (1), many POs ended up with amount_paid = sum of many
--    unrelated payments — e.g.:
--      - VAF bill 1654845000003253387: total ₹12.17L, amount_paid ₹1.97Cr
--      - SHIROI/PO/2026-27/0018: total ₹11,800, amount_paid ₹1.35Cr
--      - ZHI/SE/PANEL/532/2526:   total ₹65,734, amount_paid ₹1.87Cr
--
-- 3. Company cash summary showed:
--      - total_ap_bills:  −₹1.39Cr (negative outstanding on bills)
--      - total_ap_pos:    −₹4.29Cr (negative outstanding on POs)
--    which made the ERP look like the company had been over-paid by ₹5.68Cr —
--    the exact opposite of reality.
--
-- Fix (safe floor):
--
--   A. Clamp `vendor_bills.amount_paid` and `purchase_orders.amount_paid`
--      to `total_amount`. This gives every row a non-negative outstanding.
--      We lose the ability to recover the "real" paid amount per PO from
--      the polluted sum, but the clamped value is the correct upper bound.
--
--   B. Harden the two cascade triggers so future vendor_payment inserts
--      cannot push amount_paid past total_amount.
--
--   C. AR side is untouched — audit confirmed invoices have 0 overpaid rows
--      and total AR outstanding is ₹3.94L (correct).
--
-- Post-migration verification will run in the same transaction and RAISE
-- NOTICE with the new company cash summary so we can see the effect.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Clamp vendor_bills.amount_paid
--    balance_due is a generated column (total_amount - amount_paid),
--    so it updates automatically.
-- ------------------------------------------------------------------
DO $$
DECLARE
  v_affected INT;
  v_sum_excess NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount_paid - total_amount), 0)
  INTO v_affected, v_sum_excess
  FROM vendor_bills
  WHERE amount_paid > total_amount + 0.01;

  UPDATE vendor_bills
  SET amount_paid = total_amount
  WHERE amount_paid > total_amount + 0.01;

  RAISE NOTICE 'vendor_bills: clamped % rows, removed ₹% of fake over-payment', v_affected, ROUND(v_sum_excess, 2);
END $$;

-- ------------------------------------------------------------------
-- 2. Clamp purchase_orders.amount_paid and recompute amount_outstanding
-- ------------------------------------------------------------------
DO $$
DECLARE
  v_affected INT;
  v_sum_excess NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount_paid - total_amount), 0)
  INTO v_affected, v_sum_excess
  FROM purchase_orders
  WHERE amount_paid > total_amount + 0.01;

  UPDATE purchase_orders
  SET amount_paid = total_amount,
      amount_outstanding = 0
  WHERE amount_paid > total_amount + 0.01;

  RAISE NOTICE 'purchase_orders: clamped % rows, removed ₹% of fake over-payment', v_affected, ROUND(v_sum_excess, 2);
END $$;

-- Also: any PO with amount_outstanding <> total_amount - amount_paid is stale
UPDATE purchase_orders
SET amount_outstanding = total_amount - amount_paid
WHERE ABS(amount_outstanding - (total_amount - amount_paid)) > 0.01;

-- ------------------------------------------------------------------
-- 3. Harden update_po_amount_paid trigger — LEAST clamp going forward
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_po_amount_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_po_total   NUMERIC(14,2);
  v_sum_paid   NUMERIC(14,2);
BEGIN
  IF NEW.purchase_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT total_amount INTO v_po_total
  FROM purchase_orders WHERE id = NEW.purchase_order_id;

  IF v_po_total IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_sum_paid
  FROM vendor_payments WHERE purchase_order_id = NEW.purchase_order_id;

  UPDATE purchase_orders SET
    amount_paid        = LEAST(v_sum_paid, v_po_total),
    amount_outstanding = GREATEST(v_po_total - v_sum_paid, 0),
    updated_at         = NOW()
  WHERE id = NEW.purchase_order_id;

  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------------
-- 4. Harden recalc_vendor_bill_totals — LEAST clamp
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_vendor_bill_totals(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_paid   NUMERIC(14,2);
  v_total  NUMERIC(14,2);
  v_status vendor_bill_status;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM vendor_payments WHERE vendor_bill_id = p_bill_id;

  SELECT total_amount INTO v_total FROM vendor_bills WHERE id = p_bill_id;
  IF v_total IS NULL THEN RETURN; END IF;

  -- Clamp paid to total — we never want balance_due to go negative
  v_paid := LEAST(v_paid, v_total);

  IF v_paid <= 0 THEN
    v_status := 'pending';
  ELSIF v_paid >= v_total THEN
    v_status := 'paid';
  ELSE
    v_status := 'partially_paid';
  END IF;

  UPDATE vendor_bills
  SET amount_paid = v_paid,
      status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE v_status END,
      updated_at = NOW()
  WHERE id = p_bill_id;
END;
$function$;

-- ------------------------------------------------------------------
-- 5. Refresh project_cash_positions for every project touched
--    (we do this by firing dummy UPDATEs that the refresh trigger catches)
-- ------------------------------------------------------------------
-- Force-refresh each project's cash position using the trigger
-- by bumping updated_at on one PO per project that has POs.
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (project_id) id, project_id
    FROM purchase_orders
    WHERE project_id IS NOT NULL
    ORDER BY project_id, created_at DESC
  LOOP
    UPDATE purchase_orders SET updated_at = NOW() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Refreshed cash_position for % projects', v_count;
END $$;

-- ------------------------------------------------------------------
-- 6. Verification — print the new company cash summary
-- ------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM get_company_cash_summary_v2();
  RAISE NOTICE '=== Company cash summary AFTER fix ===';
  RAISE NOTICE 'total_receivables        = ₹%', ROUND(r.total_receivables, 2);
  RAISE NOTICE 'total_ap_bills           = ₹%', ROUND(r.total_ap_bills, 2);
  RAISE NOTICE 'total_ap_pos             = ₹%', ROUND(r.total_ap_pos, 2);
  RAISE NOTICE 'total_project_expenses   = ₹%', ROUND(r.total_project_expenses_paid, 2);
  RAISE NOTICE 'open_reconciliation_cnt  = %',  r.open_reconciliation_count;
END $$;

COMMIT;
