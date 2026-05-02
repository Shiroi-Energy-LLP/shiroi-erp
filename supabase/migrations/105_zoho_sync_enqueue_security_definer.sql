-- ============================================================================
-- Migration 105 — enqueue_zoho_sync SECURITY DEFINER (RLS bypass for triggers)
-- Date: 2026-05-02
--
-- BUG REPORTED BY VIVEK (2026-05-02)
-- ----------------------------------
--   Manivel (project_manager) tries to change a project's status:
--     "new row violates policy for zoho_sync_queue"
--   Same UPDATE works for the founder.
--
-- ROOT CAUSE
-- ----------
-- Migration 067 created zoho_sync_queue with strict RLS:
--     zoho_sync_queue_mutate FOR ALL TO finance, founder
-- Migration 069 added per-table AFTER INSERT/UPDATE triggers
-- (projects, contacts, vendors, invoices, customer_payments,
--  purchase_orders, vendor_bills, vendor_payments, expenses) that
-- call helper enqueue_zoho_sync(...) → INSERT INTO zoho_sync_queue.
--
-- enqueue_zoho_sync was created LANGUAGE sql with the default
-- SECURITY INVOKER, so the INSERT runs as the calling user. Anyone
-- whose role is NOT finance/founder fails the RLS check the moment
-- they touch any synced table.
--
-- This blocks every PM, designer, sales engineer, etc. from doing
-- anything that touches zoho_sync_queue — which is nine tables.
--
-- FIX
-- ---
-- Make enqueue_zoho_sync SECURITY DEFINER so the INSERT runs as the
-- function owner (postgres / superuser, RLS-bypass). The RLS policy
-- itself stays restrictive — the only RLS-bypassing path is this one
-- helper, which only writes (entity_type, entity_id, action, status)
-- and is already idempotent via ON CONFLICT DO NOTHING.
--
-- search_path is locked to public to prevent search_path attacks
-- against SECURITY DEFINER functions (best practice; mirrors the
-- pattern in mig 072's claim_next_sync_batch / ack_sync_batch).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_zoho_sync(
  p_entity_type zoho_sync_entity_type,
  p_entity_id   UUID,
  p_action      zoho_sync_action
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO zoho_sync_queue (entity_type, entity_id, action, status)
  VALUES (p_entity_type, p_entity_id, p_action, 'pending')
  ON CONFLICT DO NOTHING;
$$;

COMMIT;
