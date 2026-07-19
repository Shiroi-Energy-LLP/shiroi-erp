-- Migration 178: Proposals "Customer — Project" + saved-views backfill
-- ----------------------------------------------------------------------------
-- Two changes, applied dev-first (prod inherits at the dump/restore cutover):
--
-- 1. search_proposals RPC (powers the /proposals list) now also returns the
--    linked lead's company name + project name, so the list can render a
--    combined "Customer — Project" column the same way /leads and /projects do
--    (mig 172 added leads.project_name + the customer_project display column).
--    The proposals list is RPC-only (no PostgREST fallback), so the new fields
--    MUST come back from this function or the column blanks out.
--
--    Return-type changes require a DROP first — CREATE OR REPLACE cannot alter
--    a function's OUT columns. Parameters are unchanged, so the GRANT signature
--    is identical; we re-GRANT + re-COMMENT after recreation.
--
-- 2. Backfill every saved view (table_views) so existing views show the new
--    customer_project column instead of customer_name. We swap the key
--    in-place (preserving column order) for leads / projects / proposals,
--    only where customer_name is present and customer_project is not — so the
--    statement is idempotent and safe to re-run.
-- ----------------------------------------------------------------------------

BEGIN;

-- 1. Recreate search_proposals with lead company + project name ---------------

DROP FUNCTION IF EXISTS public.search_proposals(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INT, INT
);

CREATE FUNCTION public.search_proposals(
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
  lead_company_name         TEXT,
  lead_project_name         TEXT,
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
      l.phone         AS lead_phone,
      co.name         AS lead_company_name,
      l.project_name  AS lead_project_name
    FROM public.proposals pr
    LEFT JOIN public.leads l     ON l.id  = pr.lead_id
    LEFT JOIN public.companies co ON co.id = l.company_id
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
    f.lead_company_name,
    f.lead_project_name,
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
  'Parameterised search over proposals with leads embed. Returns the linked lead''s company + project name so the list can render a combined Customer — Project column (mig 178). Sort column whitelisted.';

-- 2. Backfill saved views: customer_name -> customer_project (in place) -------
-- Idempotent: only rewrites rows that have customer_name and not yet
-- customer_project. WITH ORDINALITY preserves the original column order.

UPDATE public.table_views
SET columns = (
  SELECT jsonb_agg(
    CASE WHEN elem = to_jsonb('customer_name'::text)
         THEN to_jsonb('customer_project'::text)
         ELSE elem END
    ORDER BY ord
  )
  FROM jsonb_array_elements(columns) WITH ORDINALITY AS arr(elem, ord)
)
WHERE entity_type IN ('leads', 'projects', 'proposals')
  AND columns @> '["customer_name"]'::jsonb
  AND NOT columns @> '["customer_project"]'::jsonb;

COMMIT;
