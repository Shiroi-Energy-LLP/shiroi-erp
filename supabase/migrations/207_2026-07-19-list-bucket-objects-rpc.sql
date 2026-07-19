-- 207: One-shot storage listing RPC to replace the app's storage.search() fan-out.
-- storage.search() was 27.9% of ALL DB time (mean 848 ms, max 19.7 s — see
-- docs/reviews/2026-07-19-erp-speed-full-report.md) because the project Documents
-- tab walked up to 33 folder listings per view (13 SCAN_FOLDERS x 2 prefixes +
-- whatsapp month walk), the lead design panel 7, etc.
--
-- This SECURITY INVOKER function returns every object under ANY of the given
-- prefixes in ONE indexed scan. storage.objects RLS applies to the caller exactly
-- as it does for supabase.storage.from(bucket).list() — per-bucket role gates hold.
--
-- Index note: the predicate is a COLLATE "C" range ([pfx||'/', pfx||'0')) rather
-- than LIKE because a non-constant LIKE pattern is not sargable; the range form
-- uses storage's idx_objects_bucket_id_name (bucket_id, name COLLATE "C").
-- Verified on dev: index scan, ~6 ms for a 4-prefix call (vs 3 s seq-scan draft).
-- '0' is the byte after '/' in C collation, so the range == "name starts with pfx/".
CREATE OR REPLACE FUNCTION public.list_bucket_objects(
  p_bucket text,
  p_prefixes text[],
  p_limit int DEFAULT 500
)
RETURNS TABLE (
  name text,
  id uuid,
  created_at timestamptz,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, storage
AS $$
  SELECT DISTINCT o.name, o.id, o.created_at, o.metadata
  FROM unnest(p_prefixes) AS p(pfx)
  JOIN storage.objects o
    ON o.bucket_id = p_bucket
   AND o.name COLLATE "C" >= (p.pfx || '/') COLLATE "C"
   AND o.name COLLATE "C" <  (p.pfx || '0') COLLATE "C"
  ORDER BY o.created_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 500), 1), 5000)
$$;

COMMENT ON FUNCTION public.list_bucket_objects(text, text[], int) IS
  'Recursive storage listing for app file tabs — one call replaces N storage.search folder walks. SECURITY INVOKER: storage RLS applies.';

REVOKE EXECUTE ON FUNCTION public.list_bucket_objects(text, text[], int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.list_bucket_objects(text, text[], int) TO authenticated;
