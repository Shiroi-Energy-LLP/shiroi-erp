-- 194_2026-06-20-bom-review-and-data-quality-summary-rpcs.sql
-- Page-load perf audit [G6] / NEVER-DO #13 — collapse the count:'exact' clusters on
-- /bom-review and /data-quality into one COUNT(*) FILTER round-trip each.
--
-- /bom-review fired 3 count:'exact' on proposal_bom_lines (~24.7k rows, ~56 ms each
-- measured) + a 4th on data_flags + an UNBOUNDED select of item_category for ALL
-- ~24.7k rows tallied in JS. get_bom_review_summary() returns the four counts plus the
-- per-category breakdown in a single pass — no 24.7k-row transfer, one round-trip.
--
-- /data-quality fired 3 count:'exact' on data_flags + 3 more on leads/projects/proposals
-- (data_verified_at). get_data_quality_summary() returns all six in one round-trip.
--
-- Both SECURITY INVOKER (default) — they respect exactly the RLS the page's cookie-client
-- counts already enforced. Read-only, additive. (Pattern mirrors mig 192.)

BEGIN;

CREATE OR REPLACE FUNCTION public.get_bom_review_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',     (SELECT count(*) FROM proposal_bom_lines),
    'with_rate', (SELECT count(*) FROM proposal_bom_lines WHERE unit_price > 0),
    'no_rate',   (SELECT count(*) FROM proposal_bom_lines WHERE unit_price = 0),
    'flagged',   (SELECT count(*) FROM data_flags WHERE entity_type = 'bom_item' AND resolved_at IS NULL),
    'category_counts', COALESCE(
      (SELECT jsonb_object_agg(cat, cnt)
       FROM (SELECT COALESCE(item_category, 'unknown') AS cat, count(*) AS cnt
             FROM proposal_bom_lines
             GROUP BY COALESCE(item_category, 'unknown')) g),
      '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_bom_review_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bom_review_summary() TO authenticated;

COMMENT ON FUNCTION public.get_bom_review_summary() IS
  '/bom-review summary: total / with_rate / no_rate / flagged counts + per-category breakdown in one pass. Replaces 3 count:exact on proposal_bom_lines + a data_flags count + an unbounded ~24.7k-row item_category scan tallied in JS (NEVER-DO #13). SECURITY INVOKER.';

CREATE OR REPLACE FUNCTION public.get_data_quality_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_flags',        (SELECT count(*) FROM data_flags),
    'unresolved_flags',   (SELECT count(*) FROM data_flags WHERE resolved_at IS NULL),
    'resolved_this_week', (SELECT count(*) FROM data_flags
                            WHERE resolved_at IS NOT NULL AND resolved_at >= now() - interval '7 days'),
    'verified_records',   (
        (SELECT count(*) FROM leads     WHERE data_verified_at IS NOT NULL)
      + (SELECT count(*) FROM projects  WHERE data_verified_at IS NOT NULL)
      + (SELECT count(*) FROM proposals WHERE data_verified_at IS NOT NULL)
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_data_quality_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_data_quality_summary() TO authenticated;

COMMENT ON FUNCTION public.get_data_quality_summary() IS
  '/data-quality KPI cards: total / unresolved / resolved-this-week data_flags counts + verified-record count across leads+projects+proposals (data_verified_at), in one round-trip. Replaces 6 count:exact (NEVER-DO #13). SECURITY INVOKER.';

COMMIT;

-- Verification:
--   SELECT public.get_bom_review_summary();
--   SELECT public.get_data_quality_summary();
