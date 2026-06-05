-- ============================================================================
-- Migration 152 — Search RPCs for PII-bearing entities (Item 2b, batch-A)
-- Date: 2026-05-31
--
-- Why:
--   PostgREST .or() filter expressions interpolate user-supplied search text
--   into a query string. Even with the tactical sanitizeForOr() sweep landed
--   in commit b92b9e9 (Item 2a), the structural fix is to stop interpolating
--   altogether and use parameterized SQL bound through RPCs. That's what this
--   migration delivers for the three PII-bearing search surfaces in batch-A:
--
--     1. search_contacts        ← contacts-queries.ts getContacts + searchContacts
--     2. search_companies       ← contacts-queries.ts getCompanies
--     3. search_leads_by_query  ← leads-queries.ts getLeads (search branch)
--     4. search_partners        ← partners-queries.ts listPartners (search branch)
--
--   All four use bound parameters in WHERE clauses (col ILIKE '%' || p_query || '%')
--   instead of string interpolation, so a search term like ")(&" can't escape
--   filter syntax. Sample reconciliation in PR body shows row-for-row parity
--   with the old .or() pattern for representative queries.
--
-- Pattern mirrored from migration 088 (get_payment_tracker_rows),
-- migration 117 (get_payments_expected_this_week), migration 145
-- (get_project_payment_overview).
--
-- Conventions:
--   - LANGUAGE sql STABLE
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - GRANT EXECUTE TO authenticated
--   - Role gating: contacts/companies are gated by "any authenticated user"
--     RLS today, so the RPCs match. leads has a strict role list and
--     channel_partners has a tighter one; both RPCs replicate the role list
--     inside the body before returning rows (SECURITY hardening — see
--     get_my_role() check at the top of each).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. search_contacts(p_query, p_lifecycle_stage, p_sort, p_dir, p_limit, p_offset)
--    Returns JSON-flattened rows including the same nested
--    contact_company_roles → companies(name) embed the caller uses today.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_contacts(
  p_query            TEXT DEFAULT NULL,
  p_lifecycle_stage  TEXT DEFAULT NULL,
  p_sort             TEXT DEFAULT 'created_at',
  p_dir              TEXT DEFAULT 'desc',
  p_limit            INT  DEFAULT 50,
  p_offset           INT  DEFAULT 0
)
RETURNS TABLE (
  id                       UUID,
  name                     TEXT,
  first_name               TEXT,
  last_name                TEXT,
  phone                    TEXT,
  email                    TEXT,
  designation              TEXT,
  lifecycle_stage          TEXT,
  created_at               TIMESTAMPTZ,
  contact_company_roles    JSONB,
  total_count              BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort_col TEXT := COALESCE(NULLIF(p_sort, ''), 'created_at');
  v_dir      TEXT := CASE WHEN lower(COALESCE(p_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;
BEGIN
  -- contacts.read RLS is "auth.uid() IS NOT NULL" — preserve that minimum
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- Whitelist sort columns to prevent SQL identifier injection through p_sort.
  -- Anything outside the allowlist falls back to created_at.
  IF v_sort_col NOT IN ('created_at','name','first_name','last_name','phone','email','lifecycle_stage') THEN
    v_sort_col := 'created_at';
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH base AS (
      SELECT
        c.id, c.name, c.first_name, c.last_name, c.phone, c.email,
        c.designation, c.lifecycle_stage, c.created_at,
        COALESCE(
          (
            SELECT jsonb_agg(jsonb_build_object(
              'company_id',   ccr.company_id,
              'role_title',   ccr.role_title,
              'is_primary',   ccr.is_primary,
              'ended_at',     ccr.ended_at,
              'companies',    CASE
                                WHEN co.id IS NULL THEN NULL
                                ELSE jsonb_build_object('name', co.name)
                              END
            ))
            FROM contact_company_roles ccr
            LEFT JOIN companies co ON co.id = ccr.company_id
            WHERE ccr.contact_id = c.id
          ),
          '[]'::jsonb
        ) AS contact_company_roles
      FROM contacts c
      WHERE
        ($1::text IS NULL OR $1 = '' OR (
          c.name  ILIKE '%%' || $1 || '%%'
          OR c.phone ILIKE '%%' || $1 || '%%'
          OR c.email ILIKE '%%' || $1 || '%%'
        ))
        AND ($2::text IS NULL OR $2 = '' OR c.lifecycle_stage = $2)
    )
    SELECT
      base.*,
      COUNT(*) OVER () AS total_count
    FROM base
    ORDER BY %I %s NULLS LAST
    LIMIT $3 OFFSET $4
  $f$, v_sort_col, v_dir)
  USING p_query, p_lifecycle_stage, p_limit, p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_contacts(TEXT, TEXT, TEXT, TEXT, INT, INT) TO authenticated;

COMMENT ON FUNCTION public.search_contacts IS
  'Search contacts with optional text query + lifecycle filter, returns rows plus jsonb_agg of contact_company_roles for embed parity with the old PostgREST .or() pattern. Replaces apps/erp/src/lib/contacts-queries.ts getContacts + searchContacts. Item 2b.';

-- ----------------------------------------------------------------------------
-- 2. search_companies(p_query, p_segment, p_sort, p_dir, p_limit, p_offset)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_companies(
  p_query    TEXT DEFAULT NULL,
  p_segment  TEXT DEFAULT NULL,
  p_sort     TEXT DEFAULT 'name',
  p_dir      TEXT DEFAULT 'asc',
  p_limit    INT  DEFAULT 50,
  p_offset   INT  DEFAULT 0
)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  segment      TEXT,
  gstin        TEXT,
  city         TEXT,
  state        TEXT,
  industry     TEXT,
  owner_id     UUID,
  created_at   TIMESTAMPTZ,
  total_count  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort_col TEXT := COALESCE(NULLIF(p_sort, ''), 'name');
  v_dir      TEXT := CASE WHEN lower(COALESCE(p_dir, 'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF v_sort_col NOT IN ('name','segment','gstin','city','state','industry','created_at') THEN
    v_sort_col := 'name';
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH base AS (
      SELECT
        c.id, c.name, c.segment::text AS segment, c.gstin, c.city, c.state,
        c.industry, c.owner_id, c.created_at
      FROM companies c
      WHERE
        ($1::text IS NULL OR $1 = '' OR (
          c.name  ILIKE '%%' || $1 || '%%'
          OR c.city  ILIKE '%%' || $1 || '%%'
          OR c.gstin ILIKE '%%' || $1 || '%%'
        ))
        AND ($2::text IS NULL OR $2 = '' OR c.segment::text = $2)
    )
    SELECT
      base.*,
      COUNT(*) OVER () AS total_count
    FROM base
    ORDER BY %I %s NULLS LAST
    LIMIT $3 OFFSET $4
  $f$, v_sort_col, v_dir)
  USING p_query, p_segment, p_limit, p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_companies(TEXT, TEXT, TEXT, TEXT, INT, INT) TO authenticated;

COMMENT ON FUNCTION public.search_companies IS
  'Search companies with optional text query + segment filter. Replaces apps/erp/src/lib/contacts-queries.ts getCompanies. Item 2b.';

-- ----------------------------------------------------------------------------
-- 3. search_leads_by_query(...)
--    Full-fidelity replacement for getLeads when filters.search is set.
--    Honors every filter the JS query honors (status, source, segment,
--    assigned_to, kwp band, expected_close window, referrer, archive flags).
--    Returns the same flattened shape the JS used to emit downstream
--    (assigned_to_name, weighted_value, referrer_name, referrer_is_internal).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_leads_by_query(
  p_query                  TEXT     DEFAULT NULL,
  p_statuses               TEXT[]   DEFAULT NULL,    -- explicit status list (NULL = no filter)
  p_exclude_converted      BOOLEAN  DEFAULT TRUE,    -- ignored if p_statuses is non-null
  p_source                 TEXT     DEFAULT NULL,
  p_segment                TEXT     DEFAULT NULL,
  p_assigned_to            UUID     DEFAULT NULL,
  p_kwp_min                NUMERIC  DEFAULT NULL,
  p_kwp_max                NUMERIC  DEFAULT NULL,
  p_close_from             DATE     DEFAULT NULL,
  p_close_to               DATE     DEFAULT NULL,
  p_referrer_ids           UUID[]   DEFAULT NULL,    -- IN (..) filter on channel_partner_id
  p_referrer_id            UUID     DEFAULT NULL,    -- single-value eq filter (ignored if referrer_ids non-null)
  p_referred_by_clients    BOOLEAN  DEFAULT FALSE,
  p_external_partner_ids   UUID[]   DEFAULT NULL,
  p_archived_only          BOOLEAN  DEFAULT FALSE,
  p_include_archived       BOOLEAN  DEFAULT FALSE,
  p_sort                   TEXT     DEFAULT 'created_at',
  p_dir                    TEXT     DEFAULT 'desc',
  p_limit                  INT      DEFAULT 50,
  p_offset                 INT      DEFAULT 0
)
RETURNS TABLE (
  id                              UUID,
  customer_name                   TEXT,
  phone                           TEXT,
  email                           TEXT,
  city                            TEXT,
  state                           TEXT,
  segment                         TEXT,
  source                          TEXT,
  status                          TEXT,
  estimated_size_kwp              NUMERIC,
  address_line1                   TEXT,
  pincode                         TEXT,
  is_qualified                    BOOLEAN,
  next_followup_date              DATE,
  expected_close_date             DATE,
  close_probability               SMALLINT,
  is_archived                     BOOLEAN,
  assigned_to                     UUID,
  created_at                      TIMESTAMPTZ,
  ai_score                        INT,
  ai_score_reason                 TEXT,
  assigned_to_name                TEXT,
  weighted_value                  NUMERIC,
  referrer_name                   TEXT,
  referrer_is_internal            BOOLEAN,
  total_count                     BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort_col TEXT := COALESCE(NULLIF(p_sort, ''), 'created_at');
  v_dir      TEXT := CASE WHEN lower(COALESCE(p_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;
BEGIN
  -- Mirror leads_read RLS role gate inside the RPC body (SECURITY hardening
  -- — SECURITY DEFINER would otherwise bypass it).
  IF NOT (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'finance'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'designer'::app_role,
    'marketing_manager'::app_role
  ])) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Whitelist sort columns.
  IF v_sort_col NOT IN (
    'created_at','customer_name','status','estimated_size_kwp','expected_close_date',
    'close_probability','ai_score','next_followup_date'
  ) THEN
    v_sort_col := 'created_at';
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH base AS (
      SELECT
        l.id, l.customer_name, l.phone, l.email, l.city, l.state,
        l.segment::text AS segment, l.source::text AS source, l.status::text AS status,
        l.estimated_size_kwp, l.address_line1, l.pincode,
        l.is_qualified, l.next_followup_date, l.expected_close_date,
        l.close_probability, l.is_archived, l.assigned_to, l.created_at,
        l.ai_score, l.ai_score_reason,
        e.full_name AS assigned_to_name,
        ((COALESCE(l.estimated_size_kwp, 0) * 60000 * COALESCE(l.close_probability, 0)) / 100)::numeric AS weighted_value,
        cp.partner_name AS referrer_name,
        CASE WHEN cp.id IS NULL THEN NULL ELSE cp.is_internal END AS referrer_is_internal
      FROM leads l
      LEFT JOIN employees       e  ON e.id  = l.assigned_to
      LEFT JOIN channel_partners cp ON cp.id = l.channel_partner_id
      WHERE l.deleted_at IS NULL
        -- Text search (parameterized — no .or() string interpolation)
        AND ($1::text IS NULL OR $1 = '' OR (
          l.customer_name ILIKE '%%' || $1 || '%%'
          OR l.phone        ILIKE '%%' || $1 || '%%'
        ))
        -- Status filter: explicit list wins, else honour exclude_converted
        AND (
          ($2::text[] IS NOT NULL AND l.status::text = ANY ($2))
          OR ($2::text[] IS NULL  AND ($3::boolean = FALSE OR l.status::text <> 'converted'))
        )
        AND ($4::text  IS NULL OR l.source::text  = $4)
        AND ($5::text  IS NULL OR l.segment::text = $5)
        AND ($6::uuid  IS NULL OR l.assigned_to    = $6)
        AND ($7::numeric IS NULL OR l.estimated_size_kwp >= $7)
        AND ($8::numeric IS NULL OR l.estimated_size_kwp <= $8)
        AND ($9::date  IS NULL OR l.expected_close_date >= $9)
        AND ($10::date IS NULL OR l.expected_close_date <= $10)
        -- Referrer filters: referrer_ids (IN ..) takes precedence over single referrer_id (eq)
        AND (
          ($11::uuid[] IS NOT NULL AND l.channel_partner_id = ANY ($11))
          OR ($11::uuid[] IS NULL AND ($12::uuid IS NULL OR l.channel_partner_id = $12))
        )
        -- "Referred by Clients": source='referral' AND non-null channel_partner_id
        -- AND partner is external (from p_external_partner_ids).
        AND (
          $13::boolean = FALSE
          OR (
            l.source::text = 'referral'
            AND l.channel_partner_id IS NOT NULL
            AND ($14::uuid[] IS NULL OR l.channel_partner_id = ANY ($14))
          )
        )
        -- Archive flags
        AND (
          ($15::boolean = TRUE AND l.is_archived = TRUE)
          OR ($15::boolean = FALSE AND ($16::boolean = TRUE OR l.is_archived = FALSE))
        )
    )
    SELECT
      base.*,
      COUNT(*) OVER () AS total_count
    FROM base
    ORDER BY %I %s NULLS LAST
    LIMIT $17 OFFSET $18
  $f$, v_sort_col, v_dir)
  USING
    p_query, p_statuses, p_exclude_converted, p_source, p_segment, p_assigned_to,
    p_kwp_min, p_kwp_max, p_close_from, p_close_to,
    p_referrer_ids, p_referrer_id,
    p_referred_by_clients, p_external_partner_ids,
    p_archived_only, p_include_archived,
    p_limit, p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_leads_by_query(
  TEXT, TEXT[], BOOLEAN, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, DATE,
  UUID[], UUID, BOOLEAN, UUID[], BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT
) TO authenticated;

COMMENT ON FUNCTION public.search_leads_by_query IS
  'Parameterized leads search. Replaces apps/erp/src/lib/leads-queries.ts getLeads search branch. Returns flattened shape (assigned_to_name, weighted_value, referrer_name, referrer_is_internal) matching the JS post-map. Item 2b.';

-- ----------------------------------------------------------------------------
-- 4. search_partners(...)
--    Full-fidelity replacement for listPartners search branch.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_partners(
  p_query         TEXT    DEFAULT NULL,
  p_partner_type  TEXT    DEFAULT NULL,
  p_is_active     BOOLEAN DEFAULT NULL,
  p_limit         INT     DEFAULT 50,
  p_offset        INT     DEFAULT 0
)
RETURNS TABLE (
  id                       UUID,
  partner_name             TEXT,
  contact_person           TEXT,
  phone                    TEXT,
  email                    TEXT,
  whatsapp                 TEXT,
  partner_type             TEXT,
  commission_type          TEXT,
  commission_rate          NUMERIC,
  pan_number               TEXT,
  tds_applicable           BOOLEAN,
  annual_commission_ytd    NUMERIC,
  leads_referred_count     INT,
  leads_converted_count    INT,
  total_commission_paid    NUMERIC,
  agreement_start_date     DATE,
  agreement_end_date       DATE,
  agreement_storage_path   TEXT,
  is_active                BOOLEAN,
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ,
  is_internal              BOOLEAN,
  default_commission_pct   NUMERIC,
  bank_account_number      TEXT,
  bank_ifsc                TEXT,
  portal_token             TEXT,
  lifetime_referrals       INT,
  lifetime_commission      NUMERIC,
  total_count              BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Mirror channel_partners_read RLS role gate.
  IF NOT (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'finance'::app_role,
    'marketing_manager'::app_role
  ])) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      cp.id, cp.partner_name, cp.contact_person, cp.phone, cp.email, cp.whatsapp,
      cp.partner_type, cp.commission_type, cp.commission_rate, cp.pan_number,
      cp.tds_applicable, cp.annual_commission_ytd, cp.leads_referred_count,
      cp.leads_converted_count, cp.total_commission_paid,
      cp.agreement_start_date, cp.agreement_end_date, cp.agreement_storage_path,
      cp.is_active, cp.deleted_at, cp.created_at, cp.updated_at, cp.is_internal,
      cp.default_commission_pct, cp.bank_account_number, cp.bank_ifsc,
      cp.portal_token, cp.lifetime_referrals, cp.lifetime_commission
    FROM channel_partners cp
    WHERE cp.deleted_at IS NULL
      AND (p_query IS NULL OR p_query = '' OR (
        cp.partner_name  ILIKE '%' || p_query || '%'
        OR cp.contact_person ILIKE '%' || p_query || '%'
        OR cp.phone        ILIKE '%' || p_query || '%'
      ))
      AND (p_partner_type IS NULL OR cp.partner_type = p_partner_type)
      AND (p_is_active IS NULL OR cp.is_active = p_is_active)
  )
  SELECT
    base.*,
    COUNT(*) OVER () AS total_count
  FROM base
  ORDER BY base.partner_name ASC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_partners(TEXT, TEXT, BOOLEAN, INT, INT) TO authenticated;

COMMENT ON FUNCTION public.search_partners IS
  'Search channel_partners with optional text query + partner_type + is_active filters. Replaces apps/erp/src/lib/partners-queries.ts listPartners. Item 2b.';
