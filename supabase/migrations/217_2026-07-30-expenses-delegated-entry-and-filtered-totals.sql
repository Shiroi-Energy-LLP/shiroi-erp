-- ============================================================================
-- 217: Expenses — delegated entry (submit on behalf) + filter-aware KPI totals
-- ============================================================================
-- Numbered 217, not 215: 215 was already committed by the om/tickets
-- ticket-number session, and a concurrent AMC session holds an uncommitted
-- 215_2026-07-30-amc-visit-events.sql — 216 is left free for it to land on.
-- (Same convention as mig 212, "renumbered from 210 — purchase-flow session
-- took 210/211".)
-- Three changes, all driven by the 2026-07-30 Expenses list-page request:
--
--   A. `expenses.entered_by` — the employee who actually keyed the voucher when
--      a Founder / *_manager / Finance submits on behalf of someone else.
--      NULL = the submitter entered it themselves (all pre-existing rows).
--      Needed because `submitted_by` must stay the *claimant* (it drives the
--      voucher prefix, the KPI scoping and the reimbursement), so the delegated
--      keystroke had nowhere to be recorded.
--
--   B. RLS: the mig-066 INSERT policy hard-required `submitted_by =
--      current_employee_id()` (anti-impersonation), which blocks delegated
--      entry outright. Replaced with: self-insert for everyone non-customer,
--      OR any submitted_by for the five delegated-entry roles. The SELECT
--      policy gains `entered_by = current_employee_id()` so an hr_manager /
--      marketing_manager (who cannot see all expenses) can still open the
--      voucher they just keyed.
--
--   C. `get_expense_filtered_totals` — count + SUM(amount) over the *same*
--      filter set the list query uses, for the new filter-aware KPI card.
--      SQL aggregation, not JS (NEVER-DO #12). SECURITY INVOKER (default) so
--      the caller's RLS decides visibility — identical scoping to listExpenses.
--      Plus the pg_trgm GIN indexes the voucher/description ILIKE search has
--      been missing since mig 066 (NEVER-DO #23).
--
-- Dev only for now — no prod window open.
-- ============================================================================

BEGIN;

-- ============================================================================
-- Section A: entered_by column
-- ============================================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS entered_by UUID REFERENCES employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN expenses.entered_by IS
  'Employee who keyed this voucher on behalf of submitted_by. NULL = the submitter entered it themselves.';

-- Filterable/joined column gets its index in the same migration (NEVER-DO #17).
-- Partial: only delegated rows are ever looked up by this column.
CREATE INDEX IF NOT EXISTS idx_expenses_entered_by
  ON expenses(entered_by)
  WHERE entered_by IS NOT NULL;

-- ============================================================================
-- Section B: RLS — allow delegated INSERT, keep delegated rows visible
-- ============================================================================

-- SELECT: submitter sees own rows; the delegated keyer sees rows they entered;
-- founder/project_manager/finance see all.
-- Function calls wrapped in (SELECT ...) so the planner hoists them to an
-- InitPlan instead of re-evaluating per row (mig 206 pattern).
DROP POLICY IF EXISTS expenses_select_own ON expenses;
CREATE POLICY expenses_select_own ON expenses
  FOR SELECT
  USING (
    submitted_by = (SELECT current_employee_id())
    OR entered_by = (SELECT current_employee_id())
    OR (SELECT current_app_role()) IN ('founder', 'project_manager', 'finance')
  );

-- INSERT: any authenticated active employee except customer.
-- submitted_by must equal the caller (anti-impersonation) UNLESS the caller
-- holds a delegated-entry role — Founder, the *_manager roles, or Finance.
-- Kept in sync with DELEGATED_ENTRY_ROLES in apps/erp/src/lib/expenses-constants.ts.
DROP POLICY IF EXISTS expenses_insert_self ON expenses;
CREATE POLICY expenses_insert_self ON expenses
  FOR INSERT
  WITH CHECK (
    (SELECT current_app_role()) IS NOT NULL
    AND (SELECT current_app_role()) <> 'customer'
    AND (
      submitted_by = (SELECT current_employee_id())
      OR (SELECT current_app_role()) IN (
        'founder', 'project_manager', 'hr_manager', 'marketing_manager', 'finance'
      )
    )
  );

-- ============================================================================
-- Section C: filter-aware KPI totals + the missing search indexes
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The list search is a leading-wildcard ILIKE on these two columns and has had
-- no supporting index since mig 066 (NEVER-DO #23).
CREATE INDEX IF NOT EXISTS idx_expenses_voucher_number_trgm
  ON expenses USING gin (voucher_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_expenses_description_trgm
  ON expenses USING gin (description gin_trgm_ops);

-- Mirrors ListExpensesFilters in apps/erp/src/lib/expenses-queries.ts.
-- p_project_id: pass the literal UUID for one project. p_scope handles
-- 'project' (any project) / 'general' (project_id IS NULL) / 'all'.
CREATE OR REPLACE FUNCTION public.get_expense_filtered_totals(
  p_search        TEXT DEFAULT NULL,
  p_scope         TEXT DEFAULT 'all',
  p_status        TEXT DEFAULT NULL,
  p_category_id   UUID DEFAULT NULL,
  p_submitted_by  UUID DEFAULT NULL,
  p_project_id    UUID DEFAULT NULL,
  p_date_from     DATE DEFAULT NULL,
  p_date_to       DATE DEFAULT NULL
)
RETURNS TABLE (expense_count BIGINT, total_amount NUMERIC)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::BIGINT, COALESCE(SUM(e.amount), 0)::NUMERIC
    FROM expenses e
   WHERE (p_status       IS NULL OR e.status = p_status)
     AND (p_category_id  IS NULL OR e.category_id = p_category_id)
     AND (p_submitted_by IS NULL OR e.submitted_by = p_submitted_by)
     AND (p_project_id   IS NULL OR e.project_id = p_project_id)
     AND (p_date_from    IS NULL OR e.expense_date >= p_date_from)
     AND (p_date_to      IS NULL OR e.expense_date <= p_date_to)
     AND (COALESCE(p_scope, 'all') <> 'project' OR e.project_id IS NOT NULL)
     AND (COALESCE(p_scope, 'all') <> 'general' OR e.project_id IS NULL)
     AND (
       p_search IS NULL
       OR e.voucher_number ILIKE '%' || p_search || '%'
       OR COALESCE(e.description, '') ILIKE '%' || p_search || '%'
     );
$$;

GRANT EXECUTE ON FUNCTION public.get_expense_filtered_totals(
  TEXT, TEXT, TEXT, UUID, UUID, UUID, DATE, DATE
) TO authenticated;

-- ============================================================================
-- Section D: generate_voucher_number must not depend on the caller's
--            visibility of the *target* employee
-- ============================================================================
-- The BEFORE INSERT trigger calls this with NEW.submitted_by. As SECURITY
-- INVOKER it reads `employees` under the caller's RLS, and the mig-102-era
-- employees_read policy only exposes founder/hr_manager → all, plus your own
-- row and your direct reports. So a project_manager or finance user filing on
-- behalf of a non-report hit `employee % has no voucher_prefix` — the prefix
-- read returned NULL, not because the prefix is missing but because the row was
-- invisible. Verified on dev 2026-07-30: the PM profile can read exactly 1 of 7
-- active employee rows.
--
-- SECURITY DEFINER + a pinned search_path fixes that, and also makes the
-- sequence MAX() see every prior voucher for that employee rather than only the
-- RLS-visible subset — which is what the UNIQUE constraint on voucher_number
-- wants anyway. Body is otherwise unchanged from mig 066 §9.
CREATE OR REPLACE FUNCTION generate_voucher_number(p_employee_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix   TEXT;
  v_next_seq INT;
BEGIN
  SELECT voucher_prefix INTO v_prefix FROM employees WHERE id = p_employee_id;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'employee % has no voucher_prefix', p_employee_id;
  END IF;

  -- Serialize concurrent submissions from the same prefix.
  PERFORM pg_advisory_xact_lock(hashtext('voucher_seq:' || v_prefix));

  SELECT COALESCE(MAX(
    CAST(REGEXP_REPLACE(voucher_number, '^[A-Z]+-', '') AS INT)
  ), 0) + 1
  INTO v_next_seq
  FROM expenses
  WHERE submitted_by = p_employee_id
    AND voucher_number ~ ('^' || v_prefix || '-[0-9]+$');

  -- to_char with 'FM000' pads to minimum 3 digits and grows naturally above
  -- 999 without truncating (LPAD truncates when input exceeds target length).
  RETURN v_prefix || '-' || to_char(v_next_seq, 'FM000');
END;
$$;

-- ============================================================================
-- Section E: employee name/option list for the expenses screens
-- ============================================================================
-- Same root cause as Section D, on the read side: `expenses_select_own` lets
-- founder / project_manager / finance see EVERY voucher, but `employees_read`
-- only lets founder / hr_manager read every employee. Net effect on dev today:
-- the PM sees all 6,283 vouchers while 5,114 of them render Submitter '—', and
-- the Submitter filter offers a single name (their own). That makes the
-- requested Engineer/Submitter filter useless for the exact role that needs it.
--
-- Narrow SECURITY DEFINER projection — id, full_name, is_active only. No
-- salary/PAN/Aadhaar/bank columns are exposed (those stay behind employees_read),
-- so this widens nothing sensitive. Roles that can act on other people's
-- vouchers get the full list; everyone else gets themselves + direct reports,
-- which is all their own RLS scope can show anyway.
--
-- Returns inactive employees too: 5,114 legacy vouchers belong to people who
-- have since left, and their names still have to render in the list.
CREATE OR REPLACE FUNCTION public.list_expense_employees()
RETURNS TABLE (id UUID, full_name TEXT, is_active BOOLEAN)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.full_name, e.is_active
    FROM employees e
   WHERE current_app_role() IN (
           'founder', 'hr_manager', 'project_manager', 'finance', 'marketing_manager'
         )
      OR e.profile_id = auth.uid()
      OR e.reporting_to_id = current_employee_id()
   ORDER BY e.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_expense_employees() TO authenticated;

COMMIT;
