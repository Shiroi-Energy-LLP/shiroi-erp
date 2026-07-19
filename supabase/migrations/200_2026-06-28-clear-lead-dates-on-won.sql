-- Migration 200: Separate actual close date from the forecast; clear forecast + follow-up on Won
-- ----------------------------------------------------------------------------
-- DECISION (Vivek, 2026-06-28)
--   "expected_close_date is a FORECAST filter — 'what will close when'. Won deals
--    stamping it (mig 179) pollute that view. Add a real `closed_date`, move the
--    win date there, and clear expected_close_date (and next_followup_date) on Won."
--
-- This SUPERSEDES the Won branch of migration 179. Mig 179 *stamped*
-- expected_close_date = today(IST) on Won; we now stamp the new `closed_date`
-- instead, and CLEAR expected_close_date so it only ever holds a forecast for
-- still-open deals. Mig 179's on_hold / lost branch (clear expected_close_date)
-- is unchanged. A Won deal also loses its next_followup_date (no more sales
-- follow-up — the spawned project's own tasks take over).
--
-- The follow-up date is bidirectionally mirrored with tasks (migs 108/193/197),
-- so a plain NULL would not "stick":
--   (1) the Won status trigger clears expected_close_date + next_followup_date in
--       NEW (BEFORE UPDATE), stamps closed_date, and soft-completes the lead's
--       open 'lead_followup' task so it neither lingers in /my-tasks nor
--       resurrects the date via the mig-197 mirror;
--   (2) sync_followup_task_to_lead (task -> lead mirror) is taught to SKIP Won
--       leads, so any other still-open lead task (Call / Document / Site-visit)
--       cannot re-stamp next_followup_date on a closed deal.
-- Reopening a lead out of Won clears closed_date again (it is no longer closed).
--
-- Centralized in the existing BEFORE-UPDATE status trigger so every status-change
-- path (inline-edit, stage nav, bulk change, detail, attemptWon, approveClosure,
-- raw UPDATE) behaves identically -- don't replicate in app code. Ordered
-- alphabetically after trg_block_lead_won_without_proposal, so a blocked Won
-- never touches dates.
-- ----------------------------------------------------------------------------

BEGIN;

-- 0. New column: the actual date a lead was Won (closed) -----------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS closed_date DATE;

COMMENT ON COLUMN public.leads.closed_date IS
  'Actual date the lead was Won (IST), set by trg_set_lead_close_date_on_status. '
  'Distinct from expected_close_date, which is a forecast for still-open deals only.';

-- Filterable / sortable -> index in the same migration (NEVER-DO #17).
CREATE INDEX IF NOT EXISTS idx_leads_closed_date
  ON public.leads (closed_date)
  WHERE closed_date IS NOT NULL;

-- 1. Status trigger: Won stamps closed_date, clears forecast + follow-up -------

CREATE OR REPLACE FUNCTION public.fn_set_lead_close_date_on_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
  -- Entering 'won' -> deal closed. Stamp the real close date, clear the forecast
  -- and the next follow-up. (Was: stamp expected_close_date = today, mig 179.)
  IF NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won' THEN
    NEW.closed_date         := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    NEW.expected_close_date := NULL;
    NEW.next_followup_date   := NULL;

    -- Close the open lead-funnel follow-up task. A direct status UPDATE does not
    -- carry next_followup_date in its SET list, so the AFTER lead->task trigger
    -- (trg_sync_lead_followup_task) will NOT fire to close it -- do it here. The
    -- nested task UPDATE fires sync_followup_task_to_lead at depth 2, which its
    -- own pg_trigger_depth() guard short-circuits, so no re-stamp / recursion.
    UPDATE public.tasks
    SET is_completed = TRUE,
        completed_at = NOW(),
        completed_by = NEW.assigned_to,
        updated_at   = NOW()
    WHERE entity_type  = 'lead'
      AND entity_id    = NEW.id
      AND category     = 'lead_followup'
      AND is_completed = FALSE
      AND deleted_at IS NULL;
  END IF;

  -- Leaving 'won' (reopened) -> no longer closed.
  IF OLD.status = 'won' AND NEW.status IS DISTINCT FROM 'won' THEN
    NEW.closed_date := NULL;
  END IF;

  -- Entering 'on_hold' or 'lost' -> clear the forecast (unchanged from mig 179).
  IF NEW.status IN ('on_hold', 'lost')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.expected_close_date := NULL;
  END IF;

  RETURN NEW;
END;
$func$;

-- Trigger definition unchanged (BEFORE UPDATE OF status), re-asserted for clarity.
DROP TRIGGER IF EXISTS trg_set_lead_close_date_on_status ON public.leads;

CREATE TRIGGER trg_set_lead_close_date_on_status
  BEFORE UPDATE OF status ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_lead_close_date_on_status();

-- 2. Task -> lead mirror: never re-stamp next_followup_date on a Won lead ------
-- Identical to mig 197 except the final UPDATE skips status = 'won' so an open
-- Call/Document/Site-visit task left on a closed deal cannot resurrect the date.
CREATE OR REPLACE FUNCTION public.sync_followup_task_to_lead()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_lead_ids UUID[] := ARRAY[]::UUID[];
  v_lead_id  UUID;
  v_new_date DATE;
BEGIN
  -- Only act on direct DML on tasks, never as a nested (lead -> task) trigger.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.entity_type = 'lead' AND OLD.entity_id IS NOT NULL THEN
    v_lead_ids := v_lead_ids || OLD.entity_id;
  END IF;
  IF NEW.entity_type = 'lead' AND NEW.entity_id IS NOT NULL THEN
    v_lead_ids := v_lead_ids || NEW.entity_id;
  END IF;

  v_lead_ids := ARRAY(SELECT DISTINCT x FROM unnest(v_lead_ids) AS x WHERE x IS NOT NULL);

  FOREACH v_lead_id IN ARRAY v_lead_ids LOOP
    SELECT MIN(due_date) INTO v_new_date
    FROM tasks
    WHERE entity_type  = 'lead'
      AND entity_id    = v_lead_id
      AND is_completed = FALSE
      AND deleted_at IS NULL;

    UPDATE leads
    SET next_followup_date = v_new_date,
        updated_at = NOW()
    WHERE id = v_lead_id
      AND deleted_at IS NULL
      AND status <> 'won'                       -- mig 200: Won deals have no follow-up
      AND next_followup_date IS DISTINCT FROM v_new_date;
  END LOOP;

  RETURN NEW;
END;
$$;

-- 3. Backfill ----------------------------------------------------------------
-- 3a. Populate closed_date for existing Won leads. Best source is the date mig
--     179 already stamped into expected_close_date; fall back to the most recent
--     'won' transition in lead_status_history. Leads with neither stay NULL
--     (we don't invent a date) -- mirrors mig 179's reasoning.
UPDATE public.leads l
SET closed_date = COALESCE(
      l.expected_close_date,
      (SELECT (h.changed_at AT TIME ZONE 'Asia/Kolkata')::date
         FROM public.lead_status_history h
        WHERE h.lead_id = l.id AND h.to_status = 'won'
        ORDER BY h.changed_at DESC
        LIMIT 1)
    )
WHERE l.status = 'won'
  AND l.deleted_at IS NULL
  AND l.closed_date IS NULL;

-- 3b. Clear the forecast + follow-up on existing Won leads. next_followup_date is
--     in the SET list, so the AFTER lead->task trigger (mig 108) fires and
--     soft-closes the open lead_followup task; status is NOT in the SET list, so
--     the status trigger does not re-fire. The task->lead mirror it triggers is
--     depth-guarded (and now skips Won leads anyway).
UPDATE public.leads
SET expected_close_date = NULL,
    next_followup_date  = NULL,
    updated_at = NOW()
WHERE status = 'won'
  AND deleted_at IS NULL
  AND (expected_close_date IS NOT NULL OR next_followup_date IS NOT NULL);

-- 4. Surface closed_date in the lead search RPC --------------------------------
-- The list page routes text queries through search_leads_by_query; add closed_date
-- to its RETURNS TABLE + base SELECT + sort whitelist so the new column is
-- consistent in both browse and search modes. RETURNS-TABLE shape changes require
-- DROP first (CREATE OR REPLACE cannot alter OUT columns). Identical to the prior
-- definition except the three closed_date additions.
DROP FUNCTION IF EXISTS public.search_leads_by_query(
  text, text[], boolean, text, text, uuid, numeric, numeric, date, date,
  uuid[], uuid, boolean, uuid[], boolean, boolean, text, text, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.search_leads_by_query(
  p_query text DEFAULT NULL::text,
  p_statuses text[] DEFAULT NULL::text[],
  p_exclude_converted boolean DEFAULT true,
  p_source text DEFAULT NULL::text,
  p_segment text DEFAULT NULL::text,
  p_assigned_to uuid DEFAULT NULL::uuid,
  p_kwp_min numeric DEFAULT NULL::numeric,
  p_kwp_max numeric DEFAULT NULL::numeric,
  p_close_from date DEFAULT NULL::date,
  p_close_to date DEFAULT NULL::date,
  p_referrer_ids uuid[] DEFAULT NULL::uuid[],
  p_referrer_id uuid DEFAULT NULL::uuid,
  p_referred_by_clients boolean DEFAULT false,
  p_external_partner_ids uuid[] DEFAULT NULL::uuid[],
  p_archived_only boolean DEFAULT false,
  p_include_archived boolean DEFAULT false,
  p_sort text DEFAULT 'created_at'::text,
  p_dir text DEFAULT 'desc'::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_no_referrer boolean DEFAULT false)
RETURNS TABLE(id uuid, customer_name text, phone text, email text, city text, state text,
  segment text, source text, status text, estimated_size_kwp numeric, address_line1 text,
  pincode text, is_qualified boolean, next_followup_date date, expected_close_date date,
  closed_date date, close_probability smallint, is_archived boolean, assigned_to uuid,
  created_at timestamp with time zone, ai_score integer, ai_score_reason text,
  assigned_to_name text, weighted_value numeric, referrer_name text,
  referrer_is_internal boolean, company_id uuid, company_name text, project_name text,
  total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sort_col TEXT := COALESCE(NULLIF(p_sort, ''), 'created_at');
  v_dir      TEXT := CASE WHEN lower(COALESCE(p_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;
BEGIN
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

  IF v_sort_col NOT IN (
    'created_at','customer_name','status','estimated_size_kwp','expected_close_date',
    'closed_date','close_probability','ai_score','next_followup_date'
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
        l.closed_date,
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
        AND ($1::text IS NULL OR $1 = '' OR (
          l.customer_name ILIKE '%%' || $1 || '%%'
          OR l.phone        ILIKE '%%' || $1 || '%%'
          OR l.project_name ILIKE '%%' || $1 || '%%'
          OR co.name        ILIKE '%%' || $1 || '%%'
        ))
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
        AND (
          ($11::uuid[] IS NOT NULL AND l.channel_partner_id = ANY ($11))
          OR ($11::uuid[] IS NULL AND ($12::uuid IS NULL OR l.channel_partner_id = $12))
        )
        AND (
          $13::boolean = FALSE
          OR (
            l.source::text = 'referral'
            AND l.channel_partner_id IS NOT NULL
            AND ($14::uuid[] IS NULL OR l.channel_partner_id = ANY ($14))
          )
        )
        AND ($19::boolean = FALSE OR l.channel_partner_id IS NULL)
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
$function$;

COMMIT;
