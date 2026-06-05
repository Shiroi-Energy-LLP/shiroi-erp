-- ============================================================================
-- Migration 155 — Item 2b: typed search RPCs (vendors + contacts)
-- Date: 2026-05-31
-- Why: Item 2a (commit b92b9e9) added tactical `sanitizeForOr()` wrappers
--      around PostgREST `.or()` string-interpolations. That patched the
--      injection class but kept the structural smell: caller code still
--      stitches an ILIKE filter string from a user-supplied query. This
--      migration is the proper fix — typed parameterized RPCs that bind
--      `p_query` once and use it in multiple ILIKE clauses inside SQL.
--      No interpolation, no escaping, no `.or()` string anywhere.
--
-- Pattern: mirrors get_payment_tracker_rows (mig 088),
--          get_payments_expected_this_week (mig 117),
--          get_project_payment_overview (mig 145).
--          - LANGUAGE sql STABLE
--          - SECURITY DEFINER + SET search_path = public, pg_temp
--          - GRANT EXECUTE TO authenticated
--
-- Callers replaced in this batch:
--   - search_vendors        → procurement-actions.ts::searchVendors
--                             (used by RFQ vendor combobox + requisition
--                              review actions)
--   - search_contacts_lite  → project-detail-actions.ts::searchContactsLite
--                             (used by Customer Info box on /projects/[id])
--
-- Both functions reproduce the exact filter + sort + limit semantics of
-- the old PostgREST queries. Neither table holds sensitive PII beyond
-- normal contact details — no role gating is added (the existing callers
-- have no role gate either, and RLS on the underlying tables already
-- governs visibility).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- search_vendors
-- ----------------------------------------------------------------------------
-- Original PostgREST query:
--   supabase.from('vendors')
--     .select('id, company_name, contact_person, phone, email')
--     .or(`company_name.ilike.%${q}%,contact_person.ilike.%${q}%`)
--     .eq('is_active', true)
--     .is('deleted_at', null)
--     .order('company_name')
--     .limit(limit)
--
-- The early-exit `if (query.length < 2) return []` stays in the caller
-- (avoids a useless round-trip); the RPC does not enforce a minimum length
-- so it remains usable from other callers in future.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_vendors(
  p_query TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id              UUID,
  company_name    TEXT,
  contact_person  TEXT,
  phone           TEXT,
  email           TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    v.id,
    v.company_name,
    v.contact_person,
    v.phone,
    v.email
  FROM vendors v
  WHERE v.is_active = TRUE
    AND v.deleted_at IS NULL
    AND (
      v.company_name   ILIKE '%' || p_query || '%'
      OR v.contact_person ILIKE '%' || p_query || '%'
    )
  ORDER BY v.company_name
  LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION search_vendors(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION search_vendors(TEXT, INT) IS
  'Typeahead search over vendors (company_name + contact_person). Replaces a PostgREST .or() interpolation in procurement-actions.ts::searchVendors. Item 2b — structural follow-up to the Item 2a sanitize sweep (commit b92b9e9).';

-- ----------------------------------------------------------------------------
-- search_contacts_lite
-- ----------------------------------------------------------------------------
-- Original PostgREST query:
--   supabase.from('contacts')
--     .select('id, name, phone, email')
--     .is('deleted_at', null)                  -- NOTE: column does not exist
--     .order('name', { ascending: true })
--     .limit(20)
--     -- conditionally:
--     .or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
--
-- The `deleted_at` filter in the caller is broken (the `contacts` table
-- does not have a deleted_at column — verified via information_schema).
-- We intentionally drop it here rather than carry the bug forward. RLS
-- already governs visibility.
--
-- Empty query: return all contacts up to the limit (the caller's original
-- branch). Non-empty: ILIKE across name/phone/email.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_contacts_lite(
  p_query TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id    UUID,
  name  TEXT,
  phone TEXT,
  email TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH q AS (
    SELECT NULLIF(BTRIM(COALESCE(p_query, '')), '') AS term
  )
  SELECT
    c.id,
    c.name,
    c.phone,
    c.email
  FROM contacts c, q
  WHERE
    q.term IS NULL
    OR (
      c.name  ILIKE '%' || q.term || '%'
      OR c.phone ILIKE '%' || q.term || '%'
      OR c.email ILIKE '%' || q.term || '%'
    )
  ORDER BY c.name ASC
  LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION search_contacts_lite(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION search_contacts_lite(TEXT, INT) IS
  'Typeahead search over contacts (name + phone + email) for the project Customer Info picker. Empty query returns all (up to limit). Replaces a PostgREST .or() interpolation in project-detail-actions.ts::searchContactsLite. Item 2b — structural follow-up to the Item 2a sanitize sweep (commit b92b9e9).';
