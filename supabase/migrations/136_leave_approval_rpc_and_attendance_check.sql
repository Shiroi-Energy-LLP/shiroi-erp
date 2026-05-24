-- Migration 136: Atomic leave-approval RPC + attendance self-mark CHECK
-- See docs/reviews/2026-05-24-comprehensive-review.md (Phase C-HR findings).
--
-- Two fixes:
--   1. fn_approve_leave_request — wraps the previously non-atomic 3-step approval
--      flow (update request status + insert ledger + maintain balance) in a single
--      transaction. The existing refresh_leave_balance trigger on leave_ledger
--      INSERT already keeps leave_balances consistent, so we only need the request
--      update + ledger insert here.
--   2. attendance_insert CHECK — the previous policy let an employee insert
--      attendance for themselves with any status, including 'on_leave' or 'absent'
--      (bypassing the leave_requests workflow). Restrict self-mark to the
--      "I'm at work" statuses; HR/founder can still mark anything.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Atomic leave-approval RPC.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_approve_leave_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_approver_employee_id UUID;
  v_request RECORD;
  v_current_balance NUMERIC(6,2);
  v_balance_after NUMERIC(6,2);
BEGIN
  -- Role gate (founder + hr_manager only).
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'hr_manager') THEN
    RAISE EXCEPTION 'Only HR manager or founder can approve leave requests';
  END IF;

  -- Resolve approver employee id.
  SELECT id INTO v_approver_employee_id
    FROM employees
    WHERE profile_id = auth.uid();

  IF v_approver_employee_id IS NULL THEN
    RAISE EXCEPTION 'Approver does not have an employees row';
  END IF;

  -- Fetch the request, locking the row so a concurrent approve/cancel can't race.
  SELECT id, employee_id, leave_type, days_requested, status, from_date, to_date
    INTO v_request
    FROM leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request % not found', p_request_id;
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Cannot approve a request with status: %', v_request.status;
  END IF;

  -- Update the request.
  UPDATE leave_requests
    SET status = 'approved',
        approved_by = v_approver_employee_id,
        approved_at = NOW()
    WHERE id = p_request_id;

  -- Compute the new balance for the ledger row (the trigger maintains
  -- leave_balances itself, but the ledger expects the post-debit value).
  SELECT COALESCE(balance_days, 0) INTO v_current_balance
    FROM leave_balances
    WHERE employee_id = v_request.employee_id
      AND leave_type = v_request.leave_type;

  v_balance_after := COALESCE(v_current_balance, 0) - v_request.days_requested;

  -- Insert the ledger debit. refresh_leave_balance trigger on this insert
  -- propagates the balance to leave_balances atomically.
  INSERT INTO leave_ledger (
    id, employee_id, leave_request_id, entry_type, leave_type,
    days, balance_after, description, recorded_by, transaction_date
  ) VALUES (
    gen_random_uuid(),
    v_request.employee_id,
    p_request_id,
    'debit',
    v_request.leave_type,
    -v_request.days_requested,
    v_balance_after,
    format('%s leave taken %s to %s', v_request.leave_type, v_request.from_date, v_request.to_date),
    v_approver_employee_id,
    CURRENT_DATE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_approve_leave_request(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Lock down attendance_insert self-mark to safe statuses only.
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS attendance_insert ON attendance;

CREATE POLICY attendance_insert ON attendance
  FOR INSERT
  WITH CHECK (
    -- HR/founder can insert anything (correction path).
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR
    -- Employees can self-mark, but ONLY with statuses that don't bypass the
    -- leave workflow. 'on_leave' and 'absent' must go through leave_requests
    -- or an HR correction.
    (
      employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
      AND status IN ('present', 'work_from_home', 'half_day')
    )
  );

COMMIT;
