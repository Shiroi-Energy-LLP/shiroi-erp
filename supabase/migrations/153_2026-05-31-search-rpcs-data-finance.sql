-- ============================================================================
-- Migration 153 — Search RPCs (data review + orphan triage + invoices)
-- Date: 2026-05-31
-- Why: Item 2b — replace PostgREST .or() string interpolation in three search
--      callers with parameterized typed SQL RPCs. Item 2a (commit b92b9e9)
--      added tactical sanitization via sanitizeForOr; this is the structural
--      fix. Parameter binding via `ILIKE '%' || p_query || '%'` is safe
--      against PostgREST .or() injection by design — no string concatenation
--      into a filter expression at all.
--
-- Callers refactored to use these RPCs:
--   1. search_projects_for_review
--      → apps/erp/src/lib/data-review-queries.ts
--          - listProjectsForReview (needs_review / all / confirmed / duplicates)
--          - searchProjectsForDuplicate (typeahead, excludes one id)
--   2. search_projects_for_orphan_attribution
--      → apps/erp/src/lib/orphan-triage-queries.ts
--          - searchAllProjects (project picker in /cash/orphan-invoices)
--   3. search_invoices
--      → apps/erp/src/lib/invoice-queries.ts
--          - getInvoices (search branch on /invoices)
--
-- Pattern mirrored from get_payment_tracker_rows (088), get_payments_expected
-- _this_week (117), get_project_payment_overview (145). Same conventions:
--   - LANGUAGE sql STABLE
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - GRANT EXECUTE TO authenticated
-- RLS on the underlying tables stays in force.
-- ============================================================================


-- ── (1) search_projects_for_review ──────────────────────────────────────────
-- One RPC handles all four tabs the data-review page emits today:
--   - needs_review (review_status='pending', deleted_at IS NULL)
--   - confirmed    (review_status='confirmed', deleted_at IS NULL)
--   - all          (deleted_at IS NULL, any review_status)
--   - duplicates   (review_status='duplicate', deleted_at can be non-null)
-- The mode is passed as p_tab. Empty query returns the unfiltered tab page.
-- total_count is computed once and repeated on every returned row so the
-- caller can do pagination without a second round-trip.
--
-- The joined fields (proposal_id, financials_invalidated, system_size_uncertain,
-- proposal_notes, hubspot_deal_id) are returned inline so the caller no
-- longer needs the embed select.

CREATE OR REPLACE FUNCTION search_projects_for_review(
  p_tab    TEXT,                    -- 'needs_review' | 'all' | 'confirmed' | 'duplicates'
  p_query  TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 50,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  id                      UUID,
  project_number          TEXT,
  customer_name           TEXT,
  system_size_kwp         NUMERIC,
  contracted_value        NUMERIC,
  review_status           TEXT,
  created_at              TIMESTAMPTZ,
  notes                   TEXT,
  lead_id                 UUID,
  proposal_id             UUID,
  proposal_financials_invalidated BOOLEAN,
  proposal_system_size_uncertain  BOOLEAN,
  proposal_notes          TEXT,
  hubspot_deal_id         TEXT,
  total_count             BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH filtered AS (
    SELECT
      p.id,
      p.project_number,
      p.customer_name,
      p.system_size_kwp,
      p.contracted_value,
      p.review_status,
      p.created_at,
      p.notes,
      p.lead_id,
      p.proposal_id,
      pr.financials_invalidated AS proposal_financials_invalidated,
      pr.system_size_uncertain  AS proposal_system_size_uncertain,
      pr.notes                  AS proposal_notes,
      l.hubspot_deal_id
    FROM projects p
    LEFT JOIN proposals pr ON pr.id = p.proposal_id
    LEFT JOIN leads     l  ON l.id  = p.lead_id
    WHERE
      -- Tab filter
      CASE p_tab
        WHEN 'needs_review' THEN p.review_status = 'pending' AND p.deleted_at IS NULL
        WHEN 'confirmed'    THEN p.review_status = 'confirmed' AND p.deleted_at IS NULL
        WHEN 'duplicates'   THEN p.review_status = 'duplicate'
        WHEN 'all'          THEN p.deleted_at IS NULL
        ELSE p.deleted_at IS NULL
      END
      -- Search filter (NULL or empty → no filter). 'duplicates' tab matches
      -- only customer_name + project_number; other tabs also match notes —
      -- exactly the same set as the JS caller before the refactor.
      AND (
        p_query IS NULL
        OR length(trim(p_query)) = 0
        OR (
          p_tab = 'duplicates' AND (
            p.customer_name  ILIKE '%' || p_query || '%'
            OR p.project_number ILIKE '%' || p_query || '%'
          )
        )
        OR (
          p_tab <> 'duplicates' AND (
            p.customer_name   ILIKE '%' || p_query || '%'
            OR p.project_number ILIKE '%' || p_query || '%'
            OR p.notes          ILIKE '%' || p_query || '%'
          )
        )
      )
  ),
  cnt AS (
    SELECT COUNT(*) AS total_count FROM filtered
  )
  SELECT
    f.id,
    f.project_number,
    f.customer_name,
    f.system_size_kwp,
    f.contracted_value,
    f.review_status,
    f.created_at,
    f.notes,
    f.lead_id,
    f.proposal_id,
    f.proposal_financials_invalidated,
    f.proposal_system_size_uncertain,
    f.proposal_notes,
    f.hubspot_deal_id,
    cnt.total_count
  FROM filtered f
  CROSS JOIN cnt
  ORDER BY f.created_at DESC
  LIMIT  GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION search_projects_for_review(TEXT, TEXT, INT, INT) TO authenticated;

COMMENT ON FUNCTION search_projects_for_review(TEXT, TEXT, INT, INT) IS
  'Paginated project search for /data-review/projects (tabs: needs_review / all / confirmed / duplicates) and the typeahead in the duplicate-pick dialog. Returns joined proposal + lead fields inline. Replaces .or() string interpolation in data-review-queries.ts. Item 2b.';


-- Companion: typeahead search for "duplicate of" picker — same projects table
-- but excludes one id and is limited to 15 rows. Could reuse the above RPC
-- but the caller currently doesn't filter by tab and shouldn't return the
-- audit-only fields, so a dedicated narrow function is cleaner.

CREATE OR REPLACE FUNCTION search_projects_for_duplicate_pick(
  p_query     TEXT,
  p_exclude_id UUID,
  p_limit     INT DEFAULT 15
)
RETURNS TABLE (
  id              UUID,
  project_number  TEXT,
  customer_name   TEXT,
  system_size_kwp NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.project_number,
    p.customer_name,
    p.system_size_kwp
  FROM projects p
  WHERE p.id <> p_exclude_id
    AND p.deleted_at IS NULL
    AND (
      p.customer_name  ILIKE '%' || p_query || '%'
      OR p.project_number ILIKE '%' || p_query || '%'
    )
  ORDER BY p.created_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION search_projects_for_duplicate_pick(TEXT, UUID, INT) TO authenticated;

COMMENT ON FUNCTION search_projects_for_duplicate_pick(TEXT, UUID, INT) IS
  'Typeahead search for "duplicate of" picker in /data-review/projects. Replaces .or() string interpolation in searchProjectsForDuplicate. Item 2b.';


-- ── (2) search_projects_for_orphan_attribution ──────────────────────────────
-- Used by the project picker in /cash/orphan-invoices. The caller still
-- enriches with project_cash_positions afterwards — that enrichment isn't
-- part of the search itself and keeps the RPC narrow. Limit 50.

CREATE OR REPLACE FUNCTION search_projects_for_orphan_attribution(
  p_query TEXT,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  id                UUID,
  project_number    TEXT,
  customer_name     TEXT,
  status            project_status,
  system_size_kwp   NUMERIC,
  system_type       TEXT,
  contracted_value  NUMERIC,
  actual_start_date DATE,
  actual_end_date   DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.project_number,
    p.customer_name,
    p.status,
    p.system_size_kwp,
    p.system_type::text,
    p.contracted_value,
    p.actual_start_date,
    p.actual_end_date
  FROM projects p
  WHERE (
    p.customer_name   ILIKE '%' || p_query || '%'
    OR p.project_number ILIKE '%' || p_query || '%'
  )
  ORDER BY p.created_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION search_projects_for_orphan_attribution(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION search_projects_for_orphan_attribution(TEXT, INT) IS
  'Project search for /cash/orphan-invoices attribution picker. Replaces .or() string interpolation in searchAllProjects. Caller stitches project_cash_positions separately. Item 2b.';


-- ── (3) search_invoices ─────────────────────────────────────────────────────
-- Backs /invoices page. The caller uses select('*') + projects embed; we
-- enumerate every invoice column explicitly so the RPC return type matches
-- the table row shape and add the two embed fields inline.
--
-- Both filters (status, search) are optional and orthogonal.

CREATE OR REPLACE FUNCTION search_invoices(
  p_status TEXT DEFAULT NULL,
  p_query  TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 100
)
RETURNS TABLE (
  id                          UUID,
  project_id                  UUID,
  proposal_id                 UUID,
  raised_by                   UUID,
  invoice_number              TEXT,
  invoice_type                TEXT,
  milestone_name              TEXT,
  payment_schedule_id         UUID,
  subtotal_supply             NUMERIC,
  subtotal_works              NUMERIC,
  gst_supply_amount           NUMERIC,
  gst_works_amount            NUMERIC,
  total_amount                NUMERIC,
  amount_paid                 NUMERIC,
  amount_outstanding          NUMERIC,
  invoice_date                DATE,
  due_date                    DATE,
  sent_at                     TIMESTAMPTZ,
  sent_via                    TEXT,
  status                      TEXT,
  paid_at                     TIMESTAMPTZ,
  escalation_level            INTEGER,
  last_escalated_at           TIMESTAMPTZ,
  legal_flagged               BOOLEAN,
  legal_flagged_at            TIMESTAMPTZ,
  pdf_storage_path            TEXT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ,
  zoho_invoice_id             TEXT,
  source                      TEXT,
  zoho_customer_gst_treatment TEXT,
  zoho_customer_id            TEXT,
  zoho_customer_name          TEXT,
  excluded_from_cash          BOOLEAN,
  attribution_status          TEXT,
  erp_created                 BOOLEAN,
  description                 TEXT,
  tax_amount                  NUMERIC,
  irn                         TEXT,
  ack_number                  TEXT,
  ack_date                    TIMESTAMPTZ,
  signed_qr_code              TEXT,
  e_invoice_status            TEXT,
  e_invoice_error             TEXT,
  project_number              TEXT,
  customer_name               TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    i.id,
    i.project_id,
    i.proposal_id,
    i.raised_by,
    i.invoice_number,
    i.invoice_type,
    i.milestone_name,
    i.payment_schedule_id,
    i.subtotal_supply,
    i.subtotal_works,
    i.gst_supply_amount,
    i.gst_works_amount,
    i.total_amount,
    i.amount_paid,
    i.amount_outstanding,
    i.invoice_date,
    i.due_date,
    i.sent_at,
    i.sent_via,
    i.status,
    i.paid_at,
    i.escalation_level,
    i.last_escalated_at,
    i.legal_flagged,
    i.legal_flagged_at,
    i.pdf_storage_path,
    i.notes,
    i.created_at,
    i.zoho_invoice_id,
    i.source,
    i.zoho_customer_gst_treatment,
    i.zoho_customer_id,
    i.zoho_customer_name,
    i.excluded_from_cash,
    i.attribution_status,
    i.erp_created,
    i.description,
    i.tax_amount,
    i.irn,
    i.ack_number,
    i.ack_date,
    i.signed_qr_code,
    i.e_invoice_status,
    i.e_invoice_error,
    p.project_number,
    p.customer_name
  FROM invoices i
  LEFT JOIN projects p ON p.id = i.project_id
  WHERE
    (p_status IS NULL OR length(trim(p_status)) = 0 OR i.status = p_status)
    AND (
      p_query IS NULL
      OR length(trim(p_query)) = 0
      OR i.invoice_number ILIKE '%' || p_query || '%'
    )
  ORDER BY i.invoice_date DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION search_invoices(TEXT, TEXT, INT) TO authenticated;

COMMENT ON FUNCTION search_invoices(TEXT, TEXT, INT) IS
  'Invoice list for /invoices page with optional status filter + invoice-number search. Returns project_number / customer_name inline. Replaces .or() string interpolation in getInvoices. Item 2b.';
