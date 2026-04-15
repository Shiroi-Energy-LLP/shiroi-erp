-- ============================================================================
-- Migration 056 - Fix log_proposal_status_change FK bug (missed by 055)
-- ============================================================================
-- Bug surfaced immediately after migration 055 went live:
--
--   "insert or update on table proposal_status_history violates foreign key
--    constraint proposal_status_history_changed_by_fkey"
--
-- Same bug pattern as log_lead_status_change (fixed in 055) and
-- log_project_status_change (fixed in 031): the function writes
-- auth.uid()::UUID into changed_by, but that column is FK to employees.id,
-- not profiles.id. Two different identifiers.
--
-- This manifested now because migration 055 added the
-- trg_mark_proposal_accepted_on_lead_won trigger which UPDATEs proposals
-- when a lead flips to 'won'. That UPDATE fires trigger_proposal_status_change
-- which calls log_proposal_status_change — and boom, FK violation rolls the
-- whole chain back.
--
-- My original 055 verification passed because the DO block ran as the
-- Supabase service role where auth.uid() returns NULL — the NULL fallback
-- kicked in, FK check accepted NULL, chain succeeded. The real logged-in
-- user (Vivek) has auth.uid() = his profile.id which isn't in employees.
--
-- Fix: same pattern as 055 — look up employees.id via profile_id, leave
-- changed_by NULL if no match. changed_by is already nullable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_proposal_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_employee_id UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT id INTO v_employee_id
      FROM employees
      WHERE profile_id = auth.uid()
      LIMIT 1;

    INSERT INTO proposal_status_history (
      proposal_id, changed_by, from_status, to_status
    ) VALUES (
      NEW.id, v_employee_id, OLD.status, NEW.status
    );

    NEW.status_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$func$;

-- ============================================================================
-- END OF MIGRATION 056
-- ============================================================================
