-- =============================================================================
-- Migration 192 — get_purchase_order_status_counts() RPC
-- =============================================================================
-- The purchase dashboard (apps/erp/src/lib/purchase-queries.ts →
-- getPurchaseDashboardData, rendered by app/(erp)/dashboard/purchase-dashboard.tsx)
-- derived its three PO status KPIs (Pending / Active / Pending Deliveries) by
-- fetching getPurchaseOrders() and running .filter().length in JS. That fetch
-- was .limit(100)-capped, so on ~2,041 POs every KPI silently undercounted.
--
-- This RPC returns all three buckets in one COUNT(*) FILTER pass over the FULL
-- table — fixing the undercount and satisfying NEVER-DO #12 (no JS row/money
-- aggregation) and NEVER-DO #13 (no exact-count round-trips).
--
-- Bucket predicates mirror the prior JS exactly (status-based). 'pending_approval'
-- is NOT a valid status value (see mig 103 CHECK constraint) so it never matches;
-- it is retained verbatim to keep the bucket definitions byte-for-byte identical
-- to the replaced JS — the only intended change is correctness (full table vs the
-- first 100 rows), not which statuses count.
--
-- SECURITY INVOKER (default, like mig 181 get_dashboard_year_summary): respects
-- the purchase_orders RLS read policy (po_read: founder / project_manager /
-- finance / purchase_officer), so the counts match exactly what the caller could
-- list. Read-only, additive.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_purchase_order_status_counts()
RETURNS TABLE (
  pending_count       BIGINT,
  active_count        BIGINT,
  pending_deliveries  BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status IN ('draft', 'pending_approval'))               AS pending_count,
    COUNT(*) FILTER (WHERE status IN ('approved', 'partially_delivered'))         AS active_count,
    COUNT(*) FILTER (WHERE status = 'approved' AND actual_delivery_date IS NULL)  AS pending_deliveries
  FROM purchase_orders;
$$;

REVOKE ALL ON FUNCTION public.get_purchase_order_status_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_order_status_counts() TO authenticated;

COMMENT ON FUNCTION public.get_purchase_order_status_counts() IS
  'PO status KPI buckets (pending/active/pending_deliveries) for the purchase dashboard, in one COUNT(*) FILTER pass over the full purchase_orders table. Replaces a .limit(100)-capped getPurchaseOrders() + JS .filter().length that undercounted on ~2,041 rows (NEVER-DO #12/#13). SECURITY INVOKER — respects the po_read RLS policy.';

COMMIT;

-- =============================================================================
-- Verification
-- =============================================================================
--   SELECT * FROM public.get_purchase_order_status_counts();
--   -- expect one row: pending_count / active_count / pending_deliveries,
--   --    each over ALL purchase_orders, no longer capped at 100.
--   --
--   -- Cross-check against raw buckets:
--   SELECT
--     COUNT(*) FILTER (WHERE status IN ('draft','pending_approval'))              AS pending,
--     COUNT(*) FILTER (WHERE status IN ('approved','partially_delivered'))        AS active,
--     COUNT(*) FILTER (WHERE status = 'approved' AND actual_delivery_date IS NULL) AS pending_deliveries
--   FROM purchase_orders;
-- =============================================================================
