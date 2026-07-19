-- Migration 179: Auto-manage a lead's close date from its status
-- ----------------------------------------------------------------------------
-- DECISION (Vivek, 2026-06-15)
--   "When we move a lead to Won the date of closing should automatically be the
--    day it is moved. If it is moved to On Hold or Lost, the expected closing
--    date is to be removed."
--
-- Implemented as a BEFORE-UPDATE trigger so it is centralized across EVERY
-- status-change path (inline-edit, stage nav, bulk change, detail page) and
-- adds zero extra writes — it mutates NEW.expected_close_date in place. Mirrors
-- the existing leads status-trigger family (trg_block_lead_won_without_proposal,
-- trigger_lead_status_change, trg_mark_proposal_accepted_on_lead_won).
--
-- `expected_close_date` is the only close-date column on leads, a date-only
-- TEXT/DATE field — we stamp it with the IST calendar date (store-UTC /
-- display-IST convention; the move-day in Asia/Kolkata).
--
-- Scope: only the user-driven statuses Vivek named — 'won' (stamp) and
-- 'on_hold' / 'lost' (clear). Legacy 'converted' / 'disqualified' are left
-- untouched. INSERTs are not guarded (imports set their own dates), matching
-- trg_block_lead_won_without_proposal's reasoning. No KPI regression: the
-- "closing this week/month" queries already exclude won/lost.
--
-- Backfill brings existing rows in line with the rule (dev; criteria-based so
-- it re-runs cleanly on prod at cutover):
--   * Won leads  -> expected_close_date = the IST date of their most recent
--     'won' transition in lead_status_history. Leads with no such history row
--     are left as-is (we don't invent a date).
--   * On-hold / lost leads -> expected_close_date cleared.
-- The backfill only touches expected_close_date (not status), so none of the
-- status-scoped triggers fire, and trg_auto_referral_payout (the one
-- any-UPDATE trigger) early-returns because it is gated on the won transition.
-- ----------------------------------------------------------------------------

BEGIN;

-- 1. Trigger function ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_set_lead_close_date_on_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
  -- Entering 'won' -> the move-day (IST) becomes the actual close date,
  -- overwriting any prior estimate.
  IF NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won' THEN
    NEW.expected_close_date := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  -- Entering 'on_hold' or 'lost' -> no longer a live deal, clear the date.
  ELSIF NEW.status IN ('on_hold', 'lost')
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.expected_close_date := NULL;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_set_lead_close_date_on_status ON public.leads;

CREATE TRIGGER trg_set_lead_close_date_on_status
  BEFORE UPDATE OF status ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_lead_close_date_on_status();

-- 2. Backfill: won leads get the date they were marked won --------------------

UPDATE public.leads l
SET expected_close_date = h.won_date
FROM (
  SELECT DISTINCT ON (lead_id)
         lead_id,
         (changed_at AT TIME ZONE 'Asia/Kolkata')::date AS won_date
  FROM public.lead_status_history
  WHERE to_status = 'won'
  ORDER BY lead_id, changed_at DESC
) h
WHERE l.id = h.lead_id
  AND l.status = 'won'
  AND l.deleted_at IS NULL
  AND l.expected_close_date IS DISTINCT FROM h.won_date;

-- 3. Backfill: on-hold / lost leads have their close date cleared -------------

UPDATE public.leads
SET expected_close_date = NULL
WHERE status IN ('on_hold', 'lost')
  AND expected_close_date IS NOT NULL
  AND deleted_at IS NULL;

COMMIT;
