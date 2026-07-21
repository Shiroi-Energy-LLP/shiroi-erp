-- ============================================================================
-- 213: BOI KPI search parity — project name joins the search haystack
-- ============================================================================
-- Review fix (2026-07-21, purchase-flow BOI Manager batch): the workspace's
-- client-side table search matches on project_display_name
-- (COALESCE(NULLIF(project_name,''), customer_name)), but the KPI RPC's
-- haystack (mig 210 §E) did not include it — searching a project name showed
-- matching table rows while the status cards reported zero. This is a
-- CREATE OR REPLACE of get_boi_status_totals with the mig-210 body plus a
-- LEFT JOIN to projects and the project display name appended to the
-- ILIKE haystack. Signature unchanged.
--
-- NOTE on idx_boq_items_search_trgm (mig 210): the trgm GIN expression index
-- no longer matches the RPC's haystack expression (the joined project name
-- can't be part of a single-table expression index), so the planner won't use
-- it for this ILIKE. That's fine: the index still serves the common
-- no-search path untouched, project_boq_items is small (~1k rows), and a
-- seq scan on a search is cheap at this scale. Deliberately NOT dropped.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_boi_status_totals(
  p_project_id UUID DEFAULT NULL, p_category TEXT DEFAULT NULL,
  p_vendor TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL
) RETURNS TABLE(status TEXT, line_count BIGINT, total_amount NUMERIC)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN b.procurement_status = 'ready_to_dispatch' THEN 'received'
              ELSE b.procurement_status END AS status,
         COUNT(*),
         ROUND(SUM(b.quantity * b.unit_price * (1 + COALESCE(b.gst_rate, 0) / 100)), 2)
    FROM project_boq_items b
    LEFT JOIN projects p ON p.id = b.project_id
   WHERE (p_project_id IS NULL OR b.project_id = p_project_id)
     AND (p_category  IS NULL OR b.item_category = p_category)
     AND (p_vendor    IS NULL OR b.vendor_name = p_vendor)
     AND (p_search    IS NULL OR
          (COALESCE(b.item_description, '') || ' ' || COALESCE(b.brand, '') || ' ' ||
           COALESCE(b.item_category, '') || ' ' || COALESCE(b.vendor_name, '') || ' ' ||
           COALESCE(NULLIF(p.project_name, ''), p.customer_name, ''))
          ILIKE '%' || p_search || '%')
   GROUP BY 1
$$;

REVOKE ALL ON FUNCTION public.get_boi_status_totals(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_boi_status_totals(UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_boi_status_totals(UUID, TEXT, TEXT, TEXT) IS
  'BOI workspace KPI row: per-status line count + GST-inclusive money total over project_boq_items with the non-status filters applied (spec §5.2). ready_to_dispatch is folded into received. p_search haystack = item/brand/category/vendor + project display name (mig 213 — parity with the client table search). SECURITY INVOKER — boq read RLS applies. NEVER-DO #12: money aggregation in SQL.';
