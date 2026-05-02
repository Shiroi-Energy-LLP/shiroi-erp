-- ============================================================================
-- Migration 107 — Block lead status='won' transition when no proposal exists
-- Date: 2026-05-02
--
-- DECISION (Vivek, 2026-05-02)
-- ----------------------------
--   "If no stub proposal is there highlight it and dont allow it to go to won."
--
-- Background: mig 055 added fn_mark_proposal_accepted_on_lead_won which fires
-- on lead → won and tries to flip the most recent in-play proposal to
-- 'accepted', cascading into project creation. When no in-play proposal
-- exists, the function logs a NOTICE and exits. The lead still transitions
-- to 'won', but no project is auto-created — exactly what happened to the
-- "Mani" test lead this afternoon (won → on_hold, no project ever, no
-- visible error).
--
-- Earlier today we considered auto-stubbing a proposal in that case;
-- Vivek vetoed that ("dont allow it to go to won") in favour of forcing
-- the proper flow: create a Quick Quote (Path A) or detailed proposal
-- (Path B) first, then mark won. The cascade then runs end-to-end with
-- real numbers in place of stub defaults.
--
-- THIS MIGRATION
-- --------------
-- BEFORE-UPDATE trigger fn_block_lead_won_without_proposal — fires only on
-- the OLD.status != 'won' AND NEW.status = 'won' transition. If the lead
-- has no proposal of any kind, RAISE EXCEPTION with a user-friendly
-- message; the UPDATE rolls back, the lead stays at its previous status,
-- and the UI surfaces the error in the inline-edit / dropdown toast.
--
-- INSERT path is intentionally NOT guarded — bulk imports legitimately
-- create won leads with proposals already attached in the same transaction
-- (the import script inserts both rows). Guarding INSERT would break those
-- workflows.
--
-- The trigger is BEFORE UPDATE so it precedes both
-- trg_mark_proposal_accepted_on_lead_won (AFTER UPDATE) and
-- log_lead_status_change (BEFORE UPDATE on status_updated_at): the lead
-- never actually flips, no cascading triggers fire, no orphan history
-- row gets written. Side effects on failure: zero.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_block_lead_won_without_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
DECLARE
  v_has_proposal BOOLEAN;
BEGIN
  IF NEW.status != 'won' OR OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM proposals
    WHERE lead_id = NEW.id
  ) INTO v_has_proposal;

  IF NOT v_has_proposal THEN
    RAISE EXCEPTION
      'Cannot mark lead as Won without a proposal. Create a Quick Quote (Path A) or a detailed proposal (Path B) first, then retry.'
      USING ERRCODE = 'check_violation', HINT = 'Use the "Quick Quote" button in the lead header, or the Quote tab to compose a detailed proposal.';
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_block_lead_won_without_proposal ON leads;

CREATE TRIGGER trg_block_lead_won_without_proposal
  BEFORE UPDATE OF status ON leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_lead_won_without_proposal();

COMMIT;
