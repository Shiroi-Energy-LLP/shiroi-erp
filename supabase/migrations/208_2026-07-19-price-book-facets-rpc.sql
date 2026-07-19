-- 208: /price-book filter dropdowns — one facets RPC instead of three
-- full-table single-column fetches + JS Set dedup (G5/G6, 2026-07-19 perf work,
-- docs/reviews/2026-07-19-erp-speed-full-report.md).
-- SECURITY INVOKER: price_book RLS applies to the caller.
-- Verified on dev: 13 categories / 22 brands / 17 vendors, one round trip.
CREATE OR REPLACE FUNCTION public.get_price_book_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'categories', (
      SELECT coalesce(jsonb_agg(DISTINCT item_category ORDER BY item_category), '[]'::jsonb)
      FROM price_book
      WHERE deleted_at IS NULL AND is_active = true AND item_category IS NOT NULL
    ),
    'brands', (
      SELECT coalesce(jsonb_agg(DISTINCT brand ORDER BY brand), '[]'::jsonb)
      FROM price_book
      WHERE deleted_at IS NULL AND is_active = true AND brand IS NOT NULL
    ),
    'vendors', (
      SELECT coalesce(jsonb_agg(DISTINCT vendor_name ORDER BY vendor_name), '[]'::jsonb)
      FROM price_book
      WHERE deleted_at IS NULL AND vendor_name IS NOT NULL
    )
  )
$$;

COMMENT ON FUNCTION public.get_price_book_facets() IS
  'Distinct category/brand/vendor lists for /price-book filter dropdowns in one pass. Vendors intentionally include inactive items (matches old getPriceBookVendors behavior).';

REVOKE EXECUTE ON FUNCTION public.get_price_book_facets() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_price_book_facets() TO authenticated;
