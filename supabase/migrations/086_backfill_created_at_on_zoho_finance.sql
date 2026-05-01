-- Migration 086: backfill workflow-timestamp columns on Zoho-imported
-- finance rows so they reflect the actual historical date, not the
-- import-batch moment.
--
-- Context: the Apr 19/20 data-accuracy pass (migration 084 + phases
-- 06-12 rewrites) landed 11,841 zoho_import rows across 6 finance
-- tables — every one of them has `created_at = 2026-04-20` (DB
-- default now() fired at insert time). On expenses this also means
-- `submitted_at` and `approved_at` are clobbered to now() because
-- phase-12-expenses.ts explicitly sets them to `new Date().toISOString()`.
--
-- Observable bug: `get_expense_kpis` counts approved_month_amt via
-- DATE_TRUNC('month', approved_at) = DATE_TRUNC('month', NOW()) →
-- all 5113 imported expenses roll up as "approved this month" (₹6.53 Cr).
-- The /expenses list sorts by submitted_at DESC → imported rows all
-- cluster at the top looking identical date-wise, masking the real
-- multi-year history in expense_date.
--
-- Fix: snap the workflow timestamps back to each row's domain date at
-- 12:00 IST (Asia/Kolkata). Same pattern as migrations 073/076/077/078
-- for projects/proposals/leads.
--
-- Scope:
--   - expenses     → created_at / submitted_at / approved_at ← expense_date
--   - customer_pay → created_at ← payment_date
--   - vendor_pay   → created_at ← payment_date
--   - invoices     → created_at ← invoice_date
--   - vendor_bills → created_at ← bill_date
--   - purchase_ord → created_at ← po_date
--
-- Guards:
--   - only source='zoho_import' rows touched
--   - LEAST() so re-runs never move a date forward
--   - explicit Asia/Kolkata timezone so the 12:00 anchor lands at noon IST
--     regardless of the server locale

BEGIN;

-- ------------------------------------------------------------------
-- Expenses: fix all 3 workflow timestamps (primary complaint)
-- ------------------------------------------------------------------
UPDATE expenses
SET
  created_at   = LEAST(created_at,   (expense_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata'),
  submitted_at = LEAST(COALESCE(submitted_at, 'infinity'::timestamptz),
                       (expense_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata'),
  approved_at  = CASE
                   WHEN approved_at IS NULL THEN NULL
                   ELSE LEAST(approved_at, (expense_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata')
                 END
WHERE source = 'zoho_import'
  AND expense_date IS NOT NULL;

-- ------------------------------------------------------------------
-- Customer payments: created_at ← payment_date
-- ------------------------------------------------------------------
UPDATE customer_payments
SET created_at = LEAST(created_at, (payment_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata')
WHERE source = 'zoho_import'
  AND payment_date IS NOT NULL;

-- ------------------------------------------------------------------
-- Vendor payments: created_at ← payment_date
-- ------------------------------------------------------------------
UPDATE vendor_payments
SET created_at = LEAST(created_at, (payment_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata')
WHERE source = 'zoho_import'
  AND payment_date IS NOT NULL;

-- ------------------------------------------------------------------
-- Invoices: created_at ← invoice_date
-- ------------------------------------------------------------------
UPDATE invoices
SET created_at = LEAST(created_at, (invoice_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata')
WHERE source = 'zoho_import'
  AND invoice_date IS NOT NULL;

-- ------------------------------------------------------------------
-- Vendor bills: created_at ← bill_date
-- ------------------------------------------------------------------
UPDATE vendor_bills
SET created_at = LEAST(created_at, (bill_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata')
WHERE source = 'zoho_import'
  AND bill_date IS NOT NULL;

-- ------------------------------------------------------------------
-- Purchase orders: created_at ← po_date
-- ------------------------------------------------------------------
UPDATE purchase_orders
SET created_at = LEAST(created_at, (po_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata')
WHERE source = 'zoho_import'
  AND po_date IS NOT NULL;

COMMIT;
