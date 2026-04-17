-- Migration 066: Expenses module (standalone /expenses + dual workflow)
-- See docs/superpowers/specs/2026-04-17-expenses-module-design.md
--
-- Summary:
--  1. expense_categories table + seed 8 categories
--  2. employees.voucher_prefix column + trigger + unique partial index
--  3. Backfill voucher_prefix for all active employees (3→4→5 letter fallback)
--  4. RENAME project_site_expenses → expenses
--  5. project_id → nullable + general-expense CHECK constraint
--  6. New status CHECK (submitted/verified/approved/rejected); migrate data
--  7. New columns: verified_by/at, rejected_by/at, category_id
--  8. Drop: expense_category (text), employee_name, notes
--  9. expense_documents table + migrate receipt_file_path rows
-- 10. voucher_number retro-backfill → NOT NULL UNIQUE
-- 11. generate_voucher_number() function + BEFORE INSERT trigger
-- 12. RLS rewrite (SELECT/INSERT/UPDATE/DELETE per role)
-- 13. Indexes
-- 14. expense_categories + expense_documents RLS
-- 15. projects.project_type column + backfill 'sales'

BEGIN;

-- ============================================================================
-- Section 1: expense_categories master table
-- ============================================================================

CREATE TABLE expense_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO expense_categories (code, label, sort_order) VALUES
  ('travel',         'Travel',          10),
  ('food',           'Food',            20),
  ('lodging',        'Lodging',         30),
  ('site_material',  'Site Material',   40),
  ('tools',          'Tools',           50),
  ('consumables',    'Consumables',     60),
  ('labour_advance', 'Labour Advance',  70),
  ('miscellaneous',  'Miscellaneous',   80);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Section 2: employees.voucher_prefix
-- ============================================================================

ALTER TABLE employees ADD COLUMN voucher_prefix TEXT;

CREATE UNIQUE INDEX idx_employees_voucher_prefix_active
  ON employees(voucher_prefix)
  WHERE is_active = TRUE;

-- Trigger: auto-derive 3-letter prefix from full_name on INSERT/UPDATE
-- when voucher_prefix is NULL. Does NOT overwrite an explicit value.
CREATE OR REPLACE FUNCTION set_voucher_prefix()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.voucher_prefix IS NULL AND NEW.full_name IS NOT NULL THEN
    NEW.voucher_prefix := UPPER(LEFT(REGEXP_REPLACE(NEW.full_name, '[^A-Za-z]', '', 'g'), 3));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_voucher_prefix
  BEFORE INSERT OR UPDATE OF full_name ON employees
  FOR EACH ROW
  EXECUTE FUNCTION set_voucher_prefix();

-- ============================================================================
-- Section 3: Backfill voucher_prefix (3 → 4 → 5 letter fallback)
-- ============================================================================

DO $$
DECLARE
  rec RECORD;
  candidate TEXT;
  clean TEXT;
  len INT;
  max_len INT := 5;
BEGIN
  FOR rec IN
    SELECT id, full_name
    FROM employees
    WHERE is_active = TRUE AND voucher_prefix IS NULL
    ORDER BY created_at NULLS LAST, id
  LOOP
    clean := REGEXP_REPLACE(COALESCE(rec.full_name, ''), '[^A-Za-z]', '', 'g');
    IF clean = '' THEN
      RAISE EXCEPTION 'Employee % (%) has no letters in full_name — manual intervention required',
        rec.id, rec.full_name;
    END IF;

    len := 3;
    LOOP
      candidate := UPPER(LEFT(clean, len));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM employees
        WHERE voucher_prefix = candidate AND is_active = TRUE
      );
      len := len + 1;
      IF len > max_len OR len > LENGTH(clean) THEN
        RAISE EXCEPTION
          'Cannot derive unique voucher_prefix for employee % (%) at up to % letters — manual intervention required',
          rec.id, rec.full_name, max_len;
      END IF;
    END LOOP;

    UPDATE employees SET voucher_prefix = candidate WHERE id = rec.id;
    RAISE NOTICE 'voucher_prefix: % → %', rec.full_name, candidate;
  END LOOP;
END
$$;

-- ============================================================================
-- Section 4: Rename project_site_expenses → expenses; project_id nullable
-- ============================================================================

ALTER TABLE project_site_expenses RENAME TO expenses;

-- Rename all FK constraint names and indexes that embedded the old table name
-- so pg_dump output and error messages are consistent with the new name.
ALTER INDEX IF EXISTS project_site_expenses_pkey RENAME TO expenses_pkey;

-- Project link becomes optional (general expenses have project_id IS NULL).
ALTER TABLE expenses ALTER COLUMN project_id DROP NOT NULL;

-- General expenses must skip the Verify stage: if project_id is NULL,
-- verified_by and verified_at must both remain NULL forever.
-- (verified_by / verified_at don't exist yet — constraint added in Section 5
-- after those columns are created.)

-- ============================================================================
-- Section 5: New status workflow (submitted/verified/approved/rejected)
-- ============================================================================

ALTER TABLE expenses
  ADD COLUMN verified_by UUID REFERENCES employees(id),
  ADD COLUMN verified_at TIMESTAMPTZ,
  ADD COLUMN rejected_by UUID REFERENCES employees(id),
  ADD COLUMN rejected_at TIMESTAMPTZ,
  ADD COLUMN category_id UUID REFERENCES expense_categories(id);

-- Drop the old status CHECK if present (name may vary — be defensive)
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'expenses'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%status%')
  LOOP
    EXECUTE 'ALTER TABLE expenses DROP CONSTRAINT ' || quote_ident(c.conname);
  END LOOP;
END $$;

-- Migrate legacy status values in place
UPDATE expenses SET status = 'submitted' WHERE status IN ('pending');
UPDATE expenses SET status = 'approved'  WHERE status IN ('auto_approved');
-- 'approved' and 'rejected' stay as-is

-- New CHECK
ALTER TABLE expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (status IN ('submitted', 'verified', 'approved', 'rejected'));

-- General-expense invariant: no verified fields when project_id IS NULL
ALTER TABLE expenses
  ADD CONSTRAINT expenses_general_skip_verify_check
  CHECK (project_id IS NOT NULL OR (verified_by IS NULL AND verified_at IS NULL));

-- ============================================================================
-- Section 6: Backfill category_id from text expense_category
-- ============================================================================

UPDATE expenses ex
SET category_id = ec.id
FROM expense_categories ec
WHERE ex.expense_category = ec.code
  AND ex.category_id IS NULL;

-- Any rows still NULL? Default to 'miscellaneous'.
UPDATE expenses ex
SET category_id = ec.id
FROM expense_categories ec
WHERE ec.code = 'miscellaneous'
  AND ex.category_id IS NULL;

ALTER TABLE expenses ALTER COLUMN category_id SET NOT NULL;

-- Drop retired columns
ALTER TABLE expenses DROP COLUMN IF EXISTS expense_category;
ALTER TABLE expenses DROP COLUMN IF EXISTS employee_name;
ALTER TABLE expenses DROP COLUMN IF EXISTS notes;

-- ============================================================================
-- Section 7: expense_documents table + migrate legacy receipts
-- ============================================================================

CREATE TABLE expense_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  file_name   TEXT,
  file_size   BIGINT,
  mime_type   TEXT,
  uploaded_by UUID REFERENCES employees(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_documents_expense ON expense_documents(expense_id);

ALTER TABLE expense_documents ENABLE ROW LEVEL SECURITY;

-- Migrate existing receipt_file_path rows into expense_documents
INSERT INTO expense_documents (expense_id, file_path, uploaded_by, uploaded_at)
SELECT
  id,
  receipt_file_path,
  submitted_by,
  COALESCE(submitted_at, created_at)
FROM expenses
WHERE receipt_file_path IS NOT NULL AND receipt_file_path <> '';

ALTER TABLE expenses DROP COLUMN IF EXISTS receipt_file_path;

-- ============================================================================
-- Section 8: voucher_number retro-backfill
-- ============================================================================

-- For existing rows with submitted_by set: derive per-employee sequence.
-- LPAD to 5 to survive future growth; existing counts per-submitter are low
-- (< 1000 each) so truncation isn't triggered today, but wider is safer.
WITH numbered AS (
  SELECT
    ex.id,
    e.voucher_prefix || '-' ||
      LPAD(
        (ROW_NUMBER() OVER (
          PARTITION BY ex.submitted_by
          ORDER BY ex.submitted_at NULLS LAST, ex.created_at, ex.id
        ))::TEXT,
        5, '0'
      ) AS vn
  FROM expenses ex
  JOIN employees e ON e.id = ex.submitted_by
  WHERE ex.voucher_number IS NULL OR ex.voucher_number = ''
)
UPDATE expenses ex
SET voucher_number = numbered.vn
FROM numbered
WHERE ex.id = numbered.id;

-- Legacy rows without submitted_by: assign UNASSIGNED-### sentinels.
-- Note: LPAD truncates when input exceeds target length, so pad to 5
-- to safely cover thousands of legacy orphan rows without collisions.
WITH orphans AS (
  SELECT
    id,
    'UNASSIGNED-' ||
      LPAD(
        (ROW_NUMBER() OVER (ORDER BY created_at, id))::TEXT,
        5, '0'
      ) AS vn
  FROM expenses
  WHERE submitted_by IS NULL AND (voucher_number IS NULL OR voucher_number = '')
)
UPDATE expenses ex
SET voucher_number = orphans.vn
FROM orphans
WHERE ex.id = orphans.id;

-- Any rows still NULL? Fail loudly.
DO $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM expenses WHERE voucher_number IS NULL OR voucher_number = '';
  IF n > 0 THEN
    RAISE EXCEPTION 'Voucher retro-backfill missed % rows', n;
  END IF;
END $$;

ALTER TABLE expenses ALTER COLUMN voucher_number SET NOT NULL;
ALTER TABLE expenses ADD CONSTRAINT expenses_voucher_number_unique UNIQUE (voucher_number);

-- ============================================================================
-- Section 9: voucher_number auto-generation for new rows
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_voucher_number(p_employee_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
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

CREATE OR REPLACE FUNCTION expenses_set_voucher_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.voucher_number IS NULL OR NEW.voucher_number = '' THEN
    IF NEW.submitted_by IS NULL THEN
      RAISE EXCEPTION 'expenses.submitted_by is required for voucher_number generation';
    END IF;
    NEW.voucher_number := generate_voucher_number(NEW.submitted_by);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_expenses_set_voucher_number
  BEFORE INSERT ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION expenses_set_voucher_number();

-- ============================================================================
-- Section 10: expenses RLS
-- ============================================================================

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies (defensive — policy names may vary by history)
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename = 'expenses' AND schemaname = 'public'
  LOOP
    EXECUTE 'DROP POLICY ' || quote_ident(p.policyname) || ' ON expenses';
  END LOOP;
END $$;

-- Helper: current employee id
CREATE OR REPLACE FUNCTION current_employee_id()
RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT id FROM employees WHERE profile_id = auth.uid() LIMIT 1;
$$;

-- Helper: current role (from profiles)
CREATE OR REPLACE FUNCTION current_app_role()
RETURNS app_role
LANGUAGE sql STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- SELECT: submitter sees own rows; founder/project_manager/finance see all
CREATE POLICY expenses_select_own ON expenses
  FOR SELECT
  USING (
    submitted_by = current_employee_id()
    OR current_app_role() IN ('founder', 'project_manager', 'finance')
  );

-- INSERT: any authenticated active employee except customer.
-- The role gate is enforced via `current_app_role() <> 'customer'`.
-- submitted_by MUST equal the caller (anti-impersonation).
CREATE POLICY expenses_insert_self ON expenses
  FOR INSERT
  WITH CHECK (
    current_app_role() IS NOT NULL
    AND current_app_role() <> 'customer'
    AND submitted_by = current_employee_id()
  );

-- UPDATE: submitter while submitted; PM for project-linked submitted; founder anytime
CREATE POLICY expenses_update ON expenses
  FOR UPDATE
  USING (
    (submitted_by = current_employee_id() AND status = 'submitted')
    OR (current_app_role() = 'project_manager' AND project_id IS NOT NULL)
    OR current_app_role() = 'founder'
  )
  WITH CHECK (
    (submitted_by = current_employee_id() AND status = 'submitted')
    OR (current_app_role() = 'project_manager' AND project_id IS NOT NULL)
    OR current_app_role() = 'founder'
  );

-- DELETE: submitter while submitted; founder anytime
CREATE POLICY expenses_delete ON expenses
  FOR DELETE
  USING (
    (submitted_by = current_employee_id() AND status = 'submitted')
    OR current_app_role() = 'founder'
  );

-- ============================================================================
-- Section 11: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_expenses_project      ON expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status       ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_submitted_by ON expenses(submitted_by);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category     ON expenses(category_id);
-- voucher_number already unique-indexed via the UNIQUE constraint in Section 8.

-- ============================================================================
-- Section 12: expense_categories + expense_documents RLS
-- ============================================================================

-- expense_categories: SELECT open to all authenticated users; INSERT/UPDATE for
-- founder + finance.
CREATE POLICY expense_categories_select ON expense_categories
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY expense_categories_mutate_admin ON expense_categories
  FOR ALL
  USING (current_app_role() IN ('founder', 'finance'))
  WITH CHECK (current_app_role() IN ('founder', 'finance'));

-- expense_documents: mirrors expenses. SELECT if user can SELECT the parent.
CREATE POLICY expense_documents_select ON expense_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM expenses ex
      WHERE ex.id = expense_documents.expense_id
        AND (
          ex.submitted_by = current_employee_id()
          OR current_app_role() IN ('founder', 'project_manager', 'finance')
        )
    )
  );

CREATE POLICY expense_documents_insert_submitter ON expense_documents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses ex
      WHERE ex.id = expense_documents.expense_id
        AND ex.submitted_by = current_employee_id()
        AND ex.status = 'submitted'
    )
    OR current_app_role() = 'founder'
  );

CREATE POLICY expense_documents_delete_founder ON expense_documents
  FOR DELETE USING (current_app_role() = 'founder');

-- ============================================================================
-- Section 13: projects.project_type (for + New Project dialog)
-- ============================================================================

ALTER TABLE projects
  ADD COLUMN project_type TEXT
  CHECK (project_type IN ('sales', 'internal'));

UPDATE projects SET project_type = 'sales' WHERE project_type IS NULL;

ALTER TABLE projects ALTER COLUMN project_type SET NOT NULL;
ALTER TABLE projects ALTER COLUMN project_type SET DEFAULT 'sales';

-- ============================================================================
-- Section 14: RPC for KPI aggregation (NEVER-DO #12 — no JS aggregation)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_expense_kpis(
  p_role TEXT,
  p_employee_id UUID
)
RETURNS TABLE (
  total_count        BIGINT,
  submitted_count    BIGINT,
  pending_action_amt NUMERIC,
  approved_month_amt NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH scoped AS (
    SELECT *
    FROM expenses
    WHERE
      p_role IN ('founder', 'project_manager', 'finance')
      OR submitted_by = p_employee_id
  )
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE status = 'submitted')::BIGINT,
    COALESCE(SUM(amount) FILTER (WHERE status = 'submitted'), 0)::NUMERIC,
    COALESCE(SUM(amount) FILTER (
      WHERE status = 'approved'
      AND DATE_TRUNC('month', approved_at) = DATE_TRUNC('month', NOW())
    ), 0)::NUMERIC
  FROM scoped;
$$;

COMMIT;
