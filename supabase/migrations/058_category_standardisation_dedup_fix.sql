-- Migration 058 — Category standardisation: dedup + unique index fix
--
-- Context: Migration 057 (category standardisation) included a dedup step on
-- price_book keyed by (item_description, item_category), then created a unique
-- index on the same 2-column tuple. Both steps were built on a wrong domain
-- model: Price Book identity is actually a 4-tuple
-- (item_description, item_category, brand, vendor_name) because Manivel stocks
-- the same physical spec from multiple vendors/brands at different rates.
--
-- Impact of the bug: 85 legitimately distinct products (same spec, different
-- brand or vendor — e.g. "125 KW Three Phase On-grid Inverter" from Sungrow
-- vs Deye vs Growatt) were soft-deleted as "duplicates" and the 2-col unique
-- index would have blocked them from ever coming back.
--
-- Verification before writing this migration:
--   killed_rows                           : 85
--   killed_with_distinct_(brand,vendor)   : 85  (every single one)
--   killed_with_IDENTICAL_(brand,vendor)  : 0   (zero true dupes)
--   4-col collisions if restored          : 0
--   earliest_deletion = latest_deletion   : 2026-04-15 11:03:45.148614+00
--
-- This migration:
--   1. Restores the 85 soft-deleted rows (precise timestamp filter — no
--      risk of touching any other soft-deleted row)
--   2. Drops the wrong 2-col unique index
--   3. Creates the correct 4-col unique index
--   4. Post-migration sanity checks: 252 active rows, old index gone, new
--      index present, no 4-col collisions
--
-- Migration 057 stays in git history unmodified — it's the audit trail of
-- what ran on dev. The plan file will be annotated in a follow-up commit so
-- prod picks up the corrected design when 057+058 are applied together.

BEGIN;

-- ============================================================================
-- 1. Drop the wrong 2-col unique index FIRST
-- ----------------------------------------------------------------------------
-- The old index must go before we restore the 85 rows: Postgres validates
-- the index on every UPDATE, and the restored rows re-create the (desc, cat)
-- "duplicates" that the 2-col index was built to prevent. If we leave it in
-- place, the first UPDATE row will throw a unique violation.
-- ============================================================================

DROP INDEX IF EXISTS idx_price_book_desc_cat_unique;

-- ============================================================================
-- 2. Restore the 85 soft-deleted rows
-- ----------------------------------------------------------------------------
-- Precise timestamp filter: migration 057 set every dedup deletion to the
-- same transaction clock (2026-04-15 11:03:45.148614+00). Any other
-- soft-deleted row (legitimate historic deletes from the /price-book UI)
-- has a different deleted_at and will NOT be touched.
-- ============================================================================

UPDATE price_book
SET deleted_at = NULL
WHERE deleted_at = '2026-04-15 11:03:45.148614+00';

-- ============================================================================
-- 3. Create the correct 4-col unique index
-- ----------------------------------------------------------------------------
-- Postgres 15+ default: NULLS DISTINCT, so two rows with NULL brand and NULL
-- vendor_name at the same (description, category) are permitted to coexist.
-- That's the behaviour we want — legacy rows with unknown brand/vendor stay
-- as "needs enrichment" candidates without colliding.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_book_desc_cat_brand_vendor_unique
  ON price_book (item_description, item_category, brand, vendor_name)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- 4. Sanity checks — abort if something went wrong
-- ============================================================================

DO $$
DECLARE
  active_count          INT;
  old_index_present     INT;
  new_index_present     INT;
  remaining_in_window   INT;
  collision_count       INT;
BEGIN
  SELECT COUNT(*) INTO active_count
  FROM price_book WHERE deleted_at IS NULL;

  SELECT COUNT(*) INTO old_index_present
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'price_book'
    AND indexname = 'idx_price_book_desc_cat_unique';

  SELECT COUNT(*) INTO new_index_present
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'price_book'
    AND indexname = 'idx_price_book_desc_cat_brand_vendor_unique';

  SELECT COUNT(*) INTO remaining_in_window
  FROM price_book
  WHERE deleted_at = '2026-04-15 11:03:45.148614+00';

  SELECT COUNT(*) INTO collision_count FROM (
    SELECT item_description, item_category, brand, vendor_name, COUNT(*) AS c
    FROM price_book
    WHERE deleted_at IS NULL
    GROUP BY item_description, item_category, brand, vendor_name
    HAVING COUNT(*) > 1
  ) x;

  IF active_count <> 252 THEN
    RAISE EXCEPTION 'Migration 058: expected 252 active price_book rows after restore, got %', active_count;
  END IF;

  IF old_index_present <> 0 THEN
    RAISE EXCEPTION 'Migration 058: old 2-col index idx_price_book_desc_cat_unique is still present';
  END IF;

  IF new_index_present <> 1 THEN
    RAISE EXCEPTION 'Migration 058: new 4-col index idx_price_book_desc_cat_brand_vendor_unique was not created';
  END IF;

  IF remaining_in_window <> 0 THEN
    RAISE EXCEPTION 'Migration 058: % rows still soft-deleted in the restore window (expected 0)', remaining_in_window;
  END IF;

  IF collision_count > 0 THEN
    RAISE EXCEPTION 'Migration 058: % non-NULL 4-col collisions still present on active rows', collision_count;
  END IF;

  RAISE NOTICE 'Migration 058 sanity checks passed: 252 active, 0 in window, old index gone, new index present';
END $$;

COMMIT;
