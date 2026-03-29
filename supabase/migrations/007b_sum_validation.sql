-- ============================================================
-- Migration 007b — Sum-to-100% Validation
-- File: supabase/migrations/007b_sum_validation.sql
-- Description: Enforce that proposal payment schedules and
--              project milestone weights always sum to 100%.
-- Date: 2026-03-29
-- Rollback:
--   DROP TRIGGER IF EXISTS trigger_validate_payment_schedule ON proposal_payment_schedule;
--   DROP TRIGGER IF EXISTS trigger_validate_milestone_weights ON project_milestone_weights;
--   DROP FUNCTION IF EXISTS validate_payment_schedule_sum();
--   DROP FUNCTION IF EXISTS validate_milestone_weights_sum();
-- Dependencies: 003c_proposals_acceptance.sql, 004a_projects_core.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Validate proposal_payment_schedule sums to 100%
-- Fires after every INSERT, UPDATE, DELETE on the table.
-- Raises exception if total percentage for a proposal != 100.
-- Grace: allows < 100% while status = 'draft' (partial entry).
-- Enforces exactly 100% when proposal status = 'sent' or beyond.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_payment_schedule_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_proposal_id   UUID;
  v_total_pct     NUMERIC(7,2);
  v_proposal_status TEXT;
BEGIN
  v_proposal_id := COALESCE(NEW.proposal_id, OLD.proposal_id);

  SELECT SUM(percentage), p.status
  INTO v_total_pct, v_proposal_status
  FROM proposal_payment_schedule pps
  JOIN proposals p ON p.id = pps.proposal_id
  WHERE pps.proposal_id = v_proposal_id
  GROUP BY p.status;

  -- Only enforce when proposal is being sent or is already active.
  -- Allow partial entry while still in draft.
  IF v_proposal_status NOT IN ('draft') THEN
    IF v_total_pct IS NULL OR ROUND(v_total_pct, 2) != 100.00 THEN
      RAISE EXCEPTION
        'Payment schedule percentages must sum to exactly 100%% for proposal %. '
        'Current sum: %%%. Cannot send a proposal with an incomplete payment schedule.',
        v_proposal_id, COALESCE(v_total_pct, 0);
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trigger_validate_payment_schedule
  AFTER INSERT OR UPDATE OR DELETE ON proposal_payment_schedule
  FOR EACH ROW EXECUTE FUNCTION validate_payment_schedule_sum();


-- ------------------------------------------------------------
-- 2. Validate project_milestone_weights sums to 100%
-- Fires after every INSERT, UPDATE, DELETE on the table.
-- Enforces that weights for each segment+system_type = 100%.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_milestone_weights_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_segment     customer_segment;
  v_system_type system_type;
  v_total_pct   NUMERIC(7,2);
BEGIN
  v_segment     := COALESCE(NEW.segment, OLD.segment);
  v_system_type := COALESCE(NEW.system_type, OLD.system_type);

  SELECT SUM(weight_pct)
  INTO v_total_pct
  FROM project_milestone_weights
  WHERE segment     = v_segment
    AND system_type = v_system_type
    AND is_active   = TRUE;

  IF v_total_pct IS NOT NULL AND ROUND(v_total_pct, 2) != 100.00 THEN
    RAISE EXCEPTION
      'Milestone weights for segment=% system_type=% must sum to 100%%. '
      'Current sum: %%%.',
      v_segment, v_system_type, v_total_pct;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trigger_validate_milestone_weights
  AFTER INSERT OR UPDATE OR DELETE ON project_milestone_weights
  FOR EACH ROW EXECUTE FUNCTION validate_milestone_weights_sum();

COMMIT;