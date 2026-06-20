-- 196_2026-06-20-purchase-request-aggregates-rpc.sql
-- Page-load perf audit [G6] / NEVER-DO #12 — /procurement list (getPurchaseRequests).
--
-- After paging 50 projects, the list fired TWO unbounded `.in(projectIds)` reads
-- (project_boq_items + purchase_orders) and built per-project aggregates with JS
-- loops (sum amounts, count status buckets, count POs). get_purchase_request_aggregates
-- does the whole per-project rollup in one SQL pass for the given project ids.
--
-- Bucket logic mirrors the prior JS exactly:
--   total_amount    = SUM(quantity * unit_price)
--   total_with_tax  = SUM(total_price)
--   item_count      = COUNT(*) of boq items with procurement_status <> 'yet_to_finalize'
--   items_yet_to_place/order_placed/received = COUNT(*) FILTER on that status
--   items_ready     = COUNT(*) FILTER (procurement_status IN ('ready_to_dispatch','delivered'))
--   po_count        = COUNT(*) of purchase_orders with status <> 'cancelled'
-- One row per requested project id (LEFT JOIN over unnest), zeros when no rows.
--
-- SECURITY INVOKER — respects the project_boq_items / purchase_orders RLS the
-- list's cookie-client reads already enforced. Read-only, additive.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_purchase_request_aggregates(p_project_ids uuid[])
RETURNS TABLE (
  project_id          uuid,
  total_amount        numeric,
  total_with_tax      numeric,
  item_count          bigint,
  items_yet_to_place  bigint,
  items_order_placed  bigint,
  items_received      bigint,
  items_ready         bigint,
  po_count            bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH boq AS (
    SELECT
      b.project_id,
      COALESCE(SUM(COALESCE(b.quantity, 0) * COALESCE(b.unit_price, 0)), 0) AS total_amount,
      COALESCE(SUM(COALESCE(b.total_price, 0)), 0)                          AS total_with_tax,
      COUNT(*)                                                              AS item_count,
      COUNT(*) FILTER (WHERE b.procurement_status = 'yet_to_place')         AS items_yet_to_place,
      COUNT(*) FILTER (WHERE b.procurement_status = 'order_placed')         AS items_order_placed,
      COUNT(*) FILTER (WHERE b.procurement_status = 'received')             AS items_received,
      COUNT(*) FILTER (WHERE b.procurement_status IN ('ready_to_dispatch', 'delivered')) AS items_ready
    FROM project_boq_items b
    WHERE b.project_id = ANY(p_project_ids)
      AND b.procurement_status <> 'yet_to_finalize'
    GROUP BY b.project_id
  ),
  po AS (
    SELECT o.project_id, COUNT(*) AS po_count
    FROM purchase_orders o
    WHERE o.project_id = ANY(p_project_ids)
      AND o.status <> 'cancelled'
    GROUP BY o.project_id
  )
  SELECT
    pid AS project_id,
    COALESCE(boq.total_amount, 0),
    COALESCE(boq.total_with_tax, 0),
    COALESCE(boq.item_count, 0),
    COALESCE(boq.items_yet_to_place, 0),
    COALESCE(boq.items_order_placed, 0),
    COALESCE(boq.items_received, 0),
    COALESCE(boq.items_ready, 0),
    COALESCE(po.po_count, 0)
  FROM unnest(p_project_ids) AS pid
  LEFT JOIN boq ON boq.project_id = pid
  LEFT JOIN po  ON po.project_id  = pid;
$$;

REVOKE ALL ON FUNCTION public.get_purchase_request_aggregates(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_request_aggregates(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_purchase_request_aggregates(uuid[]) IS
  '/procurement list per-project rollup (BOQ amounts + status buckets + PO count) in one SQL pass for the given project ids. Replaces 2 unbounded .in() reads + JS loops (NEVER-DO #12). SECURITY INVOKER.';

COMMIT;

-- Verification: SELECT * FROM public.get_purchase_request_aggregates(ARRAY(SELECT id FROM projects WHERE procurement_status IS NOT NULL LIMIT 5));
