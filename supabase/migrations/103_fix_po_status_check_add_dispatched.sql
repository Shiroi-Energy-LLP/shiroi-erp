-- =============================================================================
-- Migration 103 — Add 'dispatched' to purchase_orders.status check constraint
-- =============================================================================
-- Bug: sendPOToVendor (po-actions.ts:624) and markPODispatched (po-actions.ts:509)
-- both write status='dispatched' but the check constraint last set in
-- migration 041 only permits ('draft','approved','sent','acknowledged',
-- 'partially_delivered','fully_delivered','closed','cancelled').
-- Symptom (live):
--   new row for relation "purchase_orders" violates check constraint
--   "purchase_orders_status_check"
-- Purchase v2 (migration 060) introduced the dispatch lifecycle
-- draft → dispatched → acknowledged after approval, but never updated the
-- legacy constraint. Migration 065 piled on `dispatch_stage` and the cascade
-- helpers but left the constraint as-is.
-- This migration fixes the omission. No data backfill needed — only writes
-- of 'dispatched' were failing; no rows currently exist with that value.
-- =============================================================================

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN (
    'draft',
    'approved',
    'sent',
    'dispatched',
    'acknowledged',
    'partially_delivered',
    'fully_delivered',
    'closed',
    'cancelled'
  ));

COMMENT ON CONSTRAINT purchase_orders_status_check ON purchase_orders IS
  'Allowed PO status values. v2 lifecycle (migration 060/065): draft → dispatched → acknowledged. Legacy values (approved/sent/partially_delivered/fully_delivered/closed) retained for backward-compat with pre-v2 rows.';

-- =============================================================================
-- Verification
-- =============================================================================
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname = 'purchase_orders_status_check';
--   -- expect: CHECK (status = ANY (ARRAY['draft', 'approved', 'sent',
--   --   'dispatched', 'acknowledged', 'partially_delivered',
--   --   'fully_delivered', 'closed', 'cancelled']))
--
--   -- After the next sendPOToVendor click the row should land at
--   -- status='dispatched' with sent_to_vendor_at and dispatched_at set.
-- =============================================================================
