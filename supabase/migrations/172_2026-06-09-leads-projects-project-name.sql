-- Migration 172 — Customer + Project name on leads & projects
-- Date: 2026-06-09
-- Why: A customer (e.g. Lancor Holdings) can run many projects. Leads — and the
--      projects they become — should optionally link to a company record and
--      carry a project name, so the lists can show "Customer — Project".
--      Spec: docs/superpowers/specs/2026-06-09-leads-projects-customer-project-name-design.md
--
-- Changes:
--   (1) leads.project_name + projects.project_name (TEXT NULL). The company_id
--       FKs already exist (leads: mig 016, projects: mig 017 era).
--   (2) Indexes on company_id (idempotent — leads already has one from mig 016).
--   (3) create_project_from_accepted_proposal trigger now copies
--       lead.company_id + lead.project_name onto the spawned project (same
--       surgical style mig 094 used for map_link; search_path hardening from
--       mig 141 preserved).
--   (4) search_leads_by_query returns company_id, company_name, project_name
--       and matches project_name + company name in the text search, so the new
--       columns survive when a search term is active. Return type changes →
--       DROP then CREATE. Input signature (21 args incl p_no_referrer) is
--       unchanged from mig 171.
-- ============================================================================

BEGIN;

-- ============================================================
-- (1) New columns
-- ============================================================
ALTER TABLE leads    ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_name TEXT;

-- ============================================================
-- (2) Indexes on company_id (idempotent)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_leads_company_id    ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);

-- ============================================================
-- (3) Won → project cascade: carry company_id + project_name.
--     Surgical change to mig 094's function: two columns added to the lead
--     SELECT and to the projects INSERT. All other logic verbatim. Keeps the
--     mig 141 `SET search_path` hardening.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_project_from_accepted_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_project_number  TEXT;
  v_lead            RECORD;
  v_existing_id     UUID;
  v_default_pm_id   UUID;
BEGIN
  -- Only fire on transition TO 'accepted'
  IF NEW.status != 'accepted' OR OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if any project already exists for this lead
  SELECT id INTO v_existing_id
    FROM projects
    WHERE lead_id = NEW.lead_id
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch customer + site details from the lead (+ company_id + project_name)
  SELECT
    customer_name,
    phone,
    email,
    COALESCE(address_line1, city) AS address_line1,
    city,
    state,
    pincode,
    map_link,
    company_id,
    project_name
  INTO v_lead
  FROM leads
  WHERE id = NEW.lead_id;

  IF v_lead IS NULL THEN
    RAISE NOTICE 'Cannot auto-create project: lead % not found', NEW.lead_id;
    RETURN NEW;
  END IF;

  -- Resolve default PM: LATEST-created active project_manager.
  SELECT e.id INTO v_default_pm_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'project_manager'
    AND e.is_active = TRUE
  ORDER BY e.created_at DESC
  LIMIT 1;

  -- Generate a new project number
  v_project_number := generate_doc_number('PROJ');

  -- Insert the project. Any field missing from the proposal falls back
  -- to safe zeros/nulls — the PM can fill in details via the stepper.
  INSERT INTO projects (
    proposal_id,
    lead_id,
    project_number,
    project_manager_id,
    customer_name,
    customer_phone,
    customer_email,
    site_address_line1,
    site_city,
    site_state,
    site_pincode,
    system_type,
    system_size_kwp,
    panel_brand,
    panel_model,
    panel_wattage,
    panel_count,
    inverter_brand,
    inverter_model,
    inverter_capacity_kw,
    battery_brand,
    battery_model,
    battery_capacity_kwh,
    contracted_value,
    advance_amount,
    advance_received_at,
    location_map_link,
    company_id,
    project_name,
    status
  ) VALUES (
    NEW.id,
    NEW.lead_id,
    v_project_number,
    v_default_pm_id,
    v_lead.customer_name,
    v_lead.phone,
    v_lead.email,
    v_lead.address_line1,
    v_lead.city,
    v_lead.state,
    v_lead.pincode,
    NEW.system_type,
    NEW.system_size_kwp,
    NEW.panel_brand,
    NEW.panel_model,
    NEW.panel_wattage,
    COALESCE(NEW.panel_count, 0),
    NEW.inverter_brand,
    NEW.inverter_model,
    NEW.inverter_capacity_kw,
    NEW.battery_brand,
    NEW.battery_model,
    NEW.battery_capacity_kwh,
    COALESCE(NEW.total_after_discount, 0),
    0,
    CURRENT_DATE,
    v_lead.map_link,
    v_lead.company_id,
    v_lead.project_name,
    'order_received'
  );

  RETURN NEW;
END;
$function$;

-- ============================================================
-- (4) search_leads_by_query: return + match company + project_name.
--     Return type changes (new columns) → DROP then CREATE. The base SELECT
--     column order and the RETURNS TABLE order MUST stay in lock-step (the RPC
--     maps by position). New columns appended just before total_count.
-- ============================================================
DROP FUNCTION IF EXISTS public.search_leads_by_query(
  TEXT, TEXT[], BOOLEAN, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, DATE,
  UUID[], UUID, BOOLEAN, UUID[], BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT, BOOLEAN
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
  company_id                      UUID,
  company_name                    TEXT,
  project_name                    TEXT,
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
        CASE WHEN cp.id IS NULL THEN NULL ELSE cp.is_internal END AS referrer_is_internal,
        l.company_id,
        co.name AS company_name,
        l.project_name
      FROM leads l
      LEFT JOIN employees       e  ON e.id  = l.assigned_to
      LEFT JOIN channel_partners cp ON cp.id = l.channel_partner_id
      LEFT JOIN companies       co ON co.id = l.company_id
      WHERE l.deleted_at IS NULL
        -- Text search (parameterized — no .or() string interpolation).
        -- Matches customer_name, phone, project_name, and linked company name.
        AND ($1::text IS NULL OR $1 = '' OR (
          l.customer_name ILIKE '%%' || $1 || '%%'
          OR l.phone        ILIKE '%%' || $1 || '%%'
          OR l.project_name ILIKE '%%' || $1 || '%%'
          OR co.name        ILIKE '%%' || $1 || '%%'
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
  'Parameterized leads search. Returns flattened shape (assigned_to_name, weighted_value, referrer_name, referrer_is_internal) + company_id/company_name/project_name (mig 172). Text match covers customer_name, phone, project_name, company name. Item 2b; +p_no_referrer (171); +company/project (172).';

COMMIT;
