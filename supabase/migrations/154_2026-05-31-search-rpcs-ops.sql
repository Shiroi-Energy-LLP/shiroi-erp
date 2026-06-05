-- ============================================================================
-- Migration 154 — Item 2b Batch C: typed search RPCs (ops)
-- Date: 2026-05-31
-- Why: Item 2a (commit b92b9e9) tactically added sanitizeForOr() to .or()
--      calls across the codebase to harden against PostgREST .or() injection
--      (security review 2026-05-30 #5). Item 2b is the proper structural
--      fix: parameter-bound search RPCs that interpolate user input as a
--      function argument (parameter binding) rather than splicing it into
--      a PostgREST filter string.
--
--      This file covers Batch C (ops files):
--        - search_plant_monitoring_credentials → listPlantMonitoringCredentials
--            (SENSITIVE: stores plaintext credentials — role-gated to
--             founder / project_manager / om_technician, mirroring the RLS
--             SELECT policy from migration 059)
--        - search_payments                     → getPayments
--        - search_inventory_stock_pieces       → getStockPieces
--        - search_proposals                    → getProposals
--
--      Pattern mirrored from get_payment_tracker_rows (088) /
--      get_payments_expected_this_week (117) / get_project_payment_overview
--      (145):
--        - LANGUAGE sql STABLE
--        - SECURITY DEFINER + SET search_path = public, pg_temp
--        - GRANT EXECUTE TO authenticated
--        - Search uses (col_a ILIKE '%' || p_query || '%' OR ...) — parameter
--          binding, no .or() interpolation.
--        - Returns embed columns inline so callers don't need a stitch fetch.
--        - Plant-monitoring RPC additionally checks get_my_role() in the body
--          as defense-in-depth on top of RLS (since the RPC bypasses RLS
--          via SECURITY DEFINER, we re-enforce the same role gate).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. search_plant_monitoring_credentials
-- ----------------------------------------------------------------------------
-- Replaces the .or() search branch in listPlantMonitoringCredentials.
-- SENSITIVE: returns plaintext credentials. Role-gated inside the body to
-- match the RLS SELECT policy (founder, project_manager, om_technician).
-- Returns the projects embed inline (id, customer_name, project_number) so
-- the caller can ship the same shape it does today.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_plant_monitoring_credentials(
  p_query       TEXT DEFAULT NULL,
  p_project_id  UUID DEFAULT NULL,
  p_brand       TEXT DEFAULT NULL,
  p_limit       INT  DEFAULT 50,
  p_offset      INT  DEFAULT 0
)
RETURNS TABLE (
  id                       UUID,
  project_id               UUID,
  commissioning_report_id  UUID,
  inverter_brand           TEXT,
  portal_url               TEXT,
  username                 TEXT,
  password                 TEXT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ,
  created_by               UUID,
  updated_at               TIMESTAMPTZ,
  updated_by               UUID,
  deleted_at               TIMESTAMPTZ,
  deleted_by               UUID,
  project_customer_name    TEXT,
  project_number           TEXT,
  total_count              BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role app_role;
BEGIN
  -- Defense-in-depth role gate. The RLS SELECT policy on the table allows
  -- founder / project_manager / om_technician. Because this function runs
  -- SECURITY DEFINER (bypassing RLS), we re-enforce the same gate here so
  -- a future caller cannot accidentally widen access.
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager', 'om_technician') THEN
    RAISE EXCEPTION 'forbidden: plant_monitoring_credentials access denied for role %', v_role
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      c.id,
      c.project_id,
      c.commissioning_report_id,
      c.inverter_brand,
      c.portal_url,
      c.username,
      c.password,
      c.notes,
      c.created_at,
      c.created_by,
      c.updated_at,
      c.updated_by,
      c.deleted_at,
      c.deleted_by,
      p.customer_name AS project_customer_name,
      p.project_number
    FROM public.plant_monitoring_credentials c
    LEFT JOIN public.projects p ON p.id = c.project_id
    WHERE c.deleted_at IS NULL
      AND (p_project_id IS NULL OR c.project_id = p_project_id)
      AND (p_brand IS NULL OR c.inverter_brand = p_brand)
      AND (
        p_query IS NULL
        OR length(trim(p_query)) = 0
        OR c.username ILIKE '%' || p_query || '%'
        OR c.notes    ILIKE '%' || p_query || '%'
      )
  ),
  total AS (
    SELECT COUNT(*)::BIGINT AS cnt FROM filtered
  )
  SELECT
    f.id,
    f.project_id,
    f.commissioning_report_id,
    f.inverter_brand,
    f.portal_url,
    f.username,
    f.password,
    f.notes,
    f.created_at,
    f.created_by,
    f.updated_at,
    f.updated_by,
    f.deleted_at,
    f.deleted_by,
    f.project_customer_name,
    f.project_number,
    t.cnt AS total_count
  FROM filtered f
  CROSS JOIN total t
  ORDER BY f.created_at DESC
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_plant_monitoring_credentials(TEXT, UUID, TEXT, INT, INT)
  TO authenticated;

COMMENT ON FUNCTION public.search_plant_monitoring_credentials(TEXT, UUID, TEXT, INT, INT) IS
  'Parameterised search over plant_monitoring_credentials. Replaces .or() interpolation in listPlantMonitoringCredentials (Item 2b, batch C). SENSITIVE: role-gated to founder/project_manager/om_technician to mirror RLS.';


-- ----------------------------------------------------------------------------
-- 2. search_payments
-- ----------------------------------------------------------------------------
-- Replaces the .or() search branch in getPayments. The original returns the
-- top 100 customer_payments rows joined with projects(project_number,
-- customer_name) and supports type filtering (advance vs milestone) and a
-- search over payment_reference / receipt_number.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_payments(
  p_query  TEXT DEFAULT NULL,
  p_type   TEXT DEFAULT NULL,  -- 'advance' | 'milestone' | NULL
  p_limit  INT  DEFAULT 100,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  id                  UUID,
  project_id          UUID,
  invoice_id          UUID,
  recorded_by         UUID,
  receipt_number      TEXT,
  amount              NUMERIC,
  payment_date        DATE,
  payment_method      TEXT,
  payment_reference   TEXT,
  bank_name           TEXT,
  cheque_date         DATE,
  is_advance          BOOLEAN,
  receipt_pdf_path    TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ,
  project_number      TEXT,
  customer_name       TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    cp.id,
    cp.project_id,
    cp.invoice_id,
    cp.recorded_by,
    cp.receipt_number,
    cp.amount,
    cp.payment_date,
    cp.payment_method,
    cp.payment_reference,
    cp.bank_name,
    cp.cheque_date,
    cp.is_advance,
    cp.receipt_pdf_path,
    cp.notes,
    cp.created_at,
    p.project_number,
    p.customer_name
  FROM public.customer_payments cp
  LEFT JOIN public.projects p ON p.id = cp.project_id
  WHERE
    (p_type IS NULL
      OR (p_type = 'advance'   AND cp.is_advance = TRUE)
      OR (p_type = 'milestone' AND cp.is_advance = FALSE))
    AND (
      p_query IS NULL
      OR length(trim(p_query)) = 0
      OR cp.payment_reference ILIKE '%' || p_query || '%'
      OR cp.receipt_number    ILIKE '%' || p_query || '%'
    )
  ORDER BY cp.payment_date DESC
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_payments(TEXT, TEXT, INT, INT) TO authenticated;

COMMENT ON FUNCTION public.search_payments(TEXT, TEXT, INT, INT) IS
  'Parameterised search over customer_payments with project embed. Replaces .or() interpolation in getPayments (Item 2b, batch C).';


-- ----------------------------------------------------------------------------
-- 3. search_inventory_stock_pieces
-- ----------------------------------------------------------------------------
-- Replaces the .or() search branch in getStockPieces. The original supports
-- filters on category, location, condition, project_id, is_cut_length,
-- is_scrap, plus a search over item_description / brand / serial_number.
-- Returns the full stock_pieces row + projects(project_number,
-- customer_name) embed inline.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_inventory_stock_pieces(
  p_query         TEXT    DEFAULT NULL,
  p_category      TEXT    DEFAULT NULL,
  p_location      TEXT    DEFAULT NULL,
  p_condition     TEXT    DEFAULT NULL,
  p_project_id    UUID    DEFAULT NULL,
  p_is_cut_length BOOLEAN DEFAULT NULL,
  p_is_scrap      BOOLEAN DEFAULT NULL,
  p_limit         INT     DEFAULT 1000,
  p_offset        INT     DEFAULT 0
)
RETURNS TABLE (
  id                        UUID,
  purchase_order_id         UUID,
  dc_item_id                UUID,
  grn_id                    UUID,
  item_category             TEXT,
  item_description          TEXT,
  brand                     TEXT,
  model                     TEXT,
  serial_number             TEXT,
  is_cut_length             BOOLEAN,
  original_length_m         NUMERIC,
  current_length_m          NUMERIC,
  minimum_usable_length_m   NUMERIC,
  current_location          TEXT,
  project_id                UUID,
  warehouse_location        TEXT,
  condition                 TEXT,
  is_scrap                  BOOLEAN,
  scrapped_at               TIMESTAMPTZ,
  scrap_reason              TEXT,
  installed_at_project_id   UUID,
  installed_at              TIMESTAMPTZ,
  installed_by              UUID,
  unit_cost                 NUMERIC,
  notes                     TEXT,
  created_at                TIMESTAMPTZ,
  updated_at                TIMESTAMPTZ,
  project_number            TEXT,
  project_customer_name     TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id,
    s.purchase_order_id,
    s.dc_item_id,
    s.grn_id,
    s.item_category,
    s.item_description,
    s.brand,
    s.model,
    s.serial_number,
    s.is_cut_length,
    s.original_length_m,
    s.current_length_m,
    s.minimum_usable_length_m,
    s.current_location,
    s.project_id,
    s.warehouse_location,
    s.condition,
    s.is_scrap,
    s.scrapped_at,
    s.scrap_reason,
    s.installed_at_project_id,
    s.installed_at,
    s.installed_by,
    s.unit_cost,
    s.notes,
    s.created_at,
    s.updated_at,
    p.project_number,
    p.customer_name
  FROM public.stock_pieces s
  LEFT JOIN public.projects p ON p.id = s.project_id
  WHERE (p_category   IS NULL OR s.item_category    = p_category)
    AND (p_location   IS NULL OR s.current_location = p_location)
    AND (p_condition  IS NULL OR s.condition        = p_condition)
    AND (p_project_id IS NULL OR s.project_id       = p_project_id)
    AND (p_is_cut_length IS NULL OR s.is_cut_length = p_is_cut_length)
    AND (p_is_scrap      IS NULL OR s.is_scrap      = p_is_scrap)
    AND (
      p_query IS NULL
      OR length(trim(p_query)) = 0
      OR s.item_description ILIKE '%' || p_query || '%'
      OR s.brand            ILIKE '%' || p_query || '%'
      OR s.serial_number    ILIKE '%' || p_query || '%'
    )
  ORDER BY s.updated_at DESC
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_inventory_stock_pieces(
  TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT
) TO authenticated;

COMMENT ON FUNCTION public.search_inventory_stock_pieces(
  TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, INT, INT
) IS
  'Parameterised search over stock_pieces with project embed. Replaces .or() interpolation in getStockPieces (Item 2b, batch C).';


-- ----------------------------------------------------------------------------
-- 4. search_proposals
-- ----------------------------------------------------------------------------
-- Replaces the .or() search branch in getProposals. The original returns a
-- paginated list of proposals where lead_id IS NOT NULL with leads(
-- customer_name, phone) embed, supports filters on status / system_type /
-- is_budgetary, a search over proposal_number, and dynamic sort.
--
-- The sort column / direction is passed as text and validated in a CASE
-- statement (whitelist) — we never interpolate sort identifiers, and only
-- columns the original caller could pick are allowed.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_proposals(
  p_query         TEXT    DEFAULT NULL,
  p_status        TEXT    DEFAULT NULL,
  p_system_type   TEXT    DEFAULT NULL,
  p_is_budgetary  BOOLEAN DEFAULT NULL,
  p_sort          TEXT    DEFAULT 'created_at',
  p_dir           TEXT    DEFAULT 'desc',
  p_limit         INT     DEFAULT 50,
  p_offset        INT     DEFAULT 0
)
RETURNS TABLE (
  id                        UUID,
  proposal_number           TEXT,
  status                    proposal_status,
  system_size_kwp           NUMERIC,
  system_type               system_type,
  total_after_discount      NUMERIC,
  gross_margin_pct          NUMERIC,
  created_at                TIMESTAMPTZ,
  valid_until               DATE,
  lead_id                   UUID,
  revision_number           INT,
  is_budgetary              BOOLEAN,
  margin_approval_required  BOOLEAN,
  margin_approved_by        UUID,
  lead_customer_name        TEXT,
  lead_phone                TEXT,
  total_count               BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort_key INT;
  v_ascending BOOLEAN;
BEGIN
  -- Whitelist sort columns (mirrors what the page UI can produce).
  v_sort_key := CASE lower(coalesce(p_sort, 'created_at'))
    WHEN 'created_at'           THEN 1
    WHEN 'proposal_number'      THEN 2
    WHEN 'status'               THEN 3
    WHEN 'system_size_kwp'      THEN 4
    WHEN 'system_type'          THEN 5
    WHEN 'total_after_discount' THEN 6
    WHEN 'gross_margin_pct'     THEN 7
    WHEN 'valid_until'          THEN 8
    WHEN 'revision_number'      THEN 9
    WHEN 'is_budgetary'         THEN 10
    ELSE 1
  END;

  v_ascending := lower(coalesce(p_dir, 'desc')) = 'asc';

  RETURN QUERY
  WITH filtered AS (
    SELECT
      pr.id,
      pr.proposal_number,
      pr.status,
      pr.system_size_kwp,
      pr.system_type,
      pr.total_after_discount,
      pr.gross_margin_pct,
      pr.created_at,
      pr.valid_until,
      pr.lead_id,
      pr.revision_number,
      pr.is_budgetary,
      pr.margin_approval_required,
      pr.margin_approved_by,
      l.customer_name AS lead_customer_name,
      l.phone         AS lead_phone
    FROM public.proposals pr
    LEFT JOIN public.leads l ON l.id = pr.lead_id
    WHERE pr.lead_id IS NOT NULL
      AND (p_status       IS NULL OR pr.status      = p_status::proposal_status)
      AND (p_system_type  IS NULL OR pr.system_type = p_system_type::system_type)
      AND (p_is_budgetary IS NULL OR pr.is_budgetary = p_is_budgetary)
      AND (
        p_query IS NULL
        OR length(trim(p_query)) = 0
        OR pr.proposal_number ILIKE '%' || p_query || '%'
      )
  ),
  total AS (
    SELECT COUNT(*)::BIGINT AS cnt FROM filtered
  )
  SELECT
    f.id,
    f.proposal_number,
    f.status,
    f.system_size_kwp,
    f.system_type,
    f.total_after_discount,
    f.gross_margin_pct,
    f.created_at,
    f.valid_until,
    f.lead_id,
    f.revision_number,
    f.is_budgetary,
    f.margin_approval_required,
    f.margin_approved_by,
    f.lead_customer_name,
    f.lead_phone,
    t.cnt AS total_count
  FROM filtered f
  CROSS JOIN total t
  ORDER BY
    -- Ascending branch
    CASE WHEN v_ascending AND v_sort_key = 1  THEN f.created_at           END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 2  THEN f.proposal_number      END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 3  THEN f.status::text         END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 4  THEN f.system_size_kwp      END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 5  THEN f.system_type::text    END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 6  THEN f.total_after_discount END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 7  THEN f.gross_margin_pct     END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 8  THEN f.valid_until          END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 9  THEN f.revision_number      END ASC NULLS LAST,
    CASE WHEN v_ascending AND v_sort_key = 10 THEN f.is_budgetary         END ASC NULLS LAST,
    -- Descending branch
    CASE WHEN NOT v_ascending AND v_sort_key = 1  THEN f.created_at           END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 2  THEN f.proposal_number      END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 3  THEN f.status::text         END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 4  THEN f.system_size_kwp      END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 5  THEN f.system_type::text    END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 6  THEN f.total_after_discount END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 7  THEN f.gross_margin_pct     END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 8  THEN f.valid_until          END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 9  THEN f.revision_number      END DESC NULLS LAST,
    CASE WHEN NOT v_ascending AND v_sort_key = 10 THEN f.is_budgetary         END DESC NULLS LAST
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_proposals(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INT, INT
) TO authenticated;

COMMENT ON FUNCTION public.search_proposals(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INT, INT
) IS
  'Parameterised search over proposals with leads embed. Replaces .or() interpolation in getProposals (Item 2b, batch C). Sort column whitelisted.';
