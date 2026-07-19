-- 171: add p_no_referrer to search_leads_by_query so the leads-page "No referrer"
-- bucket (channel_partner_id IS NULL) works when a text search is also active.
-- Adding a param changes the signature, so DROP the old one first (CREATE OR
-- REPLACE will not replace across a changed arg list — it would overload).

DROP FUNCTION IF EXISTS public.search_leads_by_query(
  TEXT, TEXT[], BOOLEAN, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, DATE,
  UUID[], UUID, BOOLEAN, UUID[], BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT
);

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
  p_offset                 INT      DEFAULT 0,
  p_no_referrer            BOOLEAN  DEFAULT FALSE     -- "No referrer" bucket: channel_partner_id IS NULL
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
        -- "No referrer" bucket: channel_partner_id IS NULL
        AND ($19::boolean = FALSE OR l.channel_partner_id IS NULL)
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
    p_limit, p_offset, p_no_referrer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_leads_by_query(
  TEXT, TEXT[], BOOLEAN, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, DATE,
  UUID[], UUID, BOOLEAN, UUID[], BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT, BOOLEAN
) TO authenticated;

COMMENT ON FUNCTION public.search_leads_by_query IS
  'Parameterized leads search. Replaces apps/erp/src/lib/leads-queries.ts getLeads search branch. Returns flattened shape (assigned_to_name, weighted_value, referrer_name, referrer_is_internal) matching the JS post-map. Item 2b; +p_no_referrer (mig 171).';
