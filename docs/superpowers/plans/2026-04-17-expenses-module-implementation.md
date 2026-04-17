# Expenses Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the standalone Expenses module — new top-level `/expenses` nav, per-submitter voucher numbers, 3-stage approval workflow for project-linked expenses + 2-stage for general, central category master, read-only embed on Project Actuals.

**Architecture:** One SQL migration (likely 066) atomically renames `project_site_expenses → expenses`, makes `project_id` nullable, adds voucher-prefix-per-employee with advisory-locked auto-numbering trigger, and rewrites RLS. New server-action/query files, new `/expenses` route tree, replace `VoucherTable` inside project Actuals with a read-only embed. Old `/vouchers` page becomes a redirect; legacy `site-expenses-actions.ts` and `site-expense-form.tsx` deleted.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase Postgres + RLS · shadcn/ui · Tailwind · decimal.js · `@react-pdf/renderer` (no PDF here, listed for parity) · server actions returning `ActionResult<T>`.

**Spec reference:** [docs/superpowers/specs/2026-04-17-expenses-module-design.md](../specs/2026-04-17-expenses-module-design.md). Read the spec in full before starting — this plan defers all business rules to it.

---

## Ground rules (read once, apply throughout)

1. **NEVER-DO compliance** — quickly re-read `CLAUDE.md` § NEVER DO. The items most at risk in this module:
   - #3, #11: no `any` / `as any` — regenerate `packages/types/database.ts` after the migration.
   - #5: `decimal.js` on client + `NUMERIC(14,2)` in SQL for `amount`.
   - #8, #15: no inline Supabase calls from pages/components. Everything goes through `expenses-queries.ts` or `expenses-actions.ts`.
   - #12: KPI aggregation in an SQL RPC, not JS `.reduce()`.
   - #17: any new filterable/sortable column gets an index in the same migration.
   - #19: all server actions return `ActionResult<T>`. Never throw across the RSC boundary.
   - #20: migration + type regen + code in the **same commit**.
2. **Error handling shape** — every server action starts `const op = '[funcName]';` and logs with the `op` prefix on failure. See `apps/erp/src/lib/types/actions.ts` for the canonical pattern.
3. **Supabase clients** — always import from `@repo/supabase/{server,client,admin,middleware}`. Never construct inline.
4. **Types** — always `type X = Database['public']['Tables']['expenses']['Row']`. After the migration applies on dev, run the type regen command (see Task 1 Step 10).
5. **Commits** — small and frequent, one per logical unit. Commit messages follow the repo convention: `feat(expenses): ...`, `fix(expenses): ...`, `docs(expenses): ...`.
6. **Preview verification** — after any UI-affecting task, run `preview_start` on `apps/erp` and smoke-test the golden path before committing.
7. **Working branch** — this work runs on `main` with small frequent commits (Vivek reviews each). Do NOT push without Vivek's signoff.
8. **Migration number** — confirm the next number before writing the migration. `ls supabase/migrations/ | tail -3` at start. If 065 is still the latest, use 066. If someone has added 066 first, bump to 067. Throughout this plan we refer to it as `<NNN>`.

---

## File structure — what gets created / modified / deleted

### Created

| Path | Responsibility |
|---|---|
| `supabase/migrations/<NNN>_expenses_module.sql` | Single atomic migration covering rename, voucher-prefix, category master, documents table, RLS rewrite, project_type |
| `apps/erp/src/lib/expenses-actions.ts` | Server actions: submit / update / verify / approve / reject / delete / revert / upload+delete docs |
| `apps/erp/src/lib/expenses-queries.ts` | Queries: `listExpenses`, `getExpense`, `getExpensesByProject`, `getExpenseKPIs` |
| `apps/erp/src/lib/expense-categories-actions.ts` | Category CRUD actions |
| `apps/erp/src/lib/expense-categories-queries.ts` | `listCategories`, `getActiveCategories` |
| `apps/erp/src/lib/projects-actions.ts` | `createProject` action (new file) |
| `apps/erp/src/app/(erp)/expenses/page.tsx` | List page |
| `apps/erp/src/app/(erp)/expenses/[id]/page.tsx` | Detail page |
| `apps/erp/src/app/(erp)/expenses/categories/page.tsx` | Category admin |
| `apps/erp/src/components/expenses/add-expense-dialog.tsx` | Submit dialog |
| `apps/erp/src/components/expenses/edit-expense-dialog.tsx` | Edit-while-submitted dialog |
| `apps/erp/src/components/expenses/expense-table.tsx` | List-page table |
| `apps/erp/src/components/expenses/expense-filters.tsx` | Filter bar wrapper |
| `apps/erp/src/components/expenses/expense-kpis.tsx` | KPI strip |
| `apps/erp/src/components/expenses/status-badge.tsx` | Colored status pill |
| `apps/erp/src/components/expenses/scope-badge.tsx` | "Project-linked" / "General" pill |
| `apps/erp/src/components/expenses/status-timeline.tsx` | Vertical timeline (branches by scope) |
| `apps/erp/src/components/expenses/documents-list.tsx` | Document list + thumbnails |
| `apps/erp/src/components/expenses/document-upload.tsx` | Multi-file drop zone |
| `apps/erp/src/components/expenses/verify-button.tsx` | Submit→Verified action |
| `apps/erp/src/components/expenses/approve-button.tsx` | Verified→Approved (project) or Submitted→Approved (general) |
| `apps/erp/src/components/expenses/reject-dialog.tsx` | Reject with reason |
| `apps/erp/src/components/expenses/revert-button.tsx` | Founder-only reversal |
| `apps/erp/src/components/expenses/delete-expense-button.tsx` | Delete (submitter on own, founder anywhere) |
| `apps/erp/src/components/expenses/category-admin-table.tsx` | `/expenses/categories` table |
| `apps/erp/src/components/expenses/add-category-dialog.tsx` | Add category dialog |
| `apps/erp/src/components/expenses/edit-category-dialog.tsx` | Edit category dialog |
| `apps/erp/src/components/projects/new-project-dialog.tsx` | `+ New Project` dialog |
| `apps/erp/src/components/projects/site-expenses-readonly.tsx` | Read-only embed on Actuals step |
| `docs/modules/expenses.md` | New module doc |

### Modified

| Path | Change |
|---|---|
| `packages/types/database.ts` | Regenerated after migration (never hand-edited) |
| `apps/erp/src/app/(erp)/vouchers/page.tsx` | Rewrite as `redirect('/expenses?status=submitted')` |
| `apps/erp/src/components/projects/stepper-steps/step-actuals.tsx` | Swap `VoucherTable` → `SiteExpensesReadonly` |
| `apps/erp/src/app/(erp)/projects/page.tsx` | Add `+ New Project` button (role-gated) |
| `apps/erp/src/lib/roles.ts` | `ITEMS.vouchers` → `ITEMS.expenses` (label: "Expenses", href: `/expenses`, icon: `Receipt`); add to `site_supervisor`, `designer`, `marketing_manager`, `hr_manager`, `sales_engineer`, `purchase_officer`, `om_technician` sections; update `founder`, `project_manager`, `finance` label reference |
| `apps/erp/src/components/projects/project-stepper.tsx` (if exists) / step-actuals references | Ensure nothing else imports `VoucherTable` |
| `docs/modules/projects.md` | Update Actuals section (§7) to describe read-only embed |
| `docs/CURRENT_STATUS.md` | Add row to "In flight this week" while building; remove on ship |
| `docs/CHANGELOG.md` | One line on ship |

### Deleted (last, after verified unused)

| Path | Reason |
|---|---|
| `apps/erp/src/lib/site-expenses-actions.ts` | Superseded by `expenses-actions.ts` |
| `apps/erp/src/components/projects/forms/site-expense-form.tsx` | Write-capable form no longer used in read-only Actuals |
| `apps/erp/src/components/projects/forms/voucher-table-controls.tsx` | Not needed — controls now live in `/expenses` detail page |
| `apps/erp/src/components/vouchers/voucher-actions.tsx` | `/vouchers` becomes a redirect; legacy buttons gone |

---

## Phase A — Database migration

### Task 1: Write the SQL migration

**Files:**
- Create: `supabase/migrations/<NNN>_expenses_module.sql`
- Modify (regenerate): `packages/types/database.ts`

The migration is **one atomic file** sectioned with banner comments. Every step below is one `BEGIN`-independent SQL block inside the same file (the migration runs inside Supabase's default transaction).

- [ ] **Step 1: Confirm next migration number**

```bash
ls supabase/migrations/ | tail -3
```

Expected: `065_purchase_v2_feedback.sql` as the last file. The new file is `066_expenses_module.sql`. If `066_*.sql` already exists, bump to `067`, etc. Use the chosen number throughout.

- [ ] **Step 2: Create the migration file skeleton**

Create `supabase/migrations/<NNN>_expenses_module.sql` with the following exact header:

```sql
-- Migration <NNN>: Expenses module (standalone /expenses + dual workflow)
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
```

End the file with `COMMIT;` (added in the last step).

- [ ] **Step 3: Section 1 — `expense_categories` table + seed**

Append to the migration file:

```sql
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
```

- [ ] **Step 4: Section 2 — `employees.voucher_prefix` column + trigger**

Append:

```sql
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
```

- [ ] **Step 5: Section 3 — Backfill `voucher_prefix` for all active employees**

Append:

```sql
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
```

- [ ] **Step 6: Section 4 — Rename + nullable + CHECK constraint**

Append:

```sql
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
```

- [ ] **Step 7: Section 5 — Add new status columns + rebuild status CHECK**

Append:

```sql
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
```

- [ ] **Step 8: Section 6 — Backfill `category_id` from text `expense_category`**

Append:

```sql
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
```

- [ ] **Step 9: Section 7 — `expense_documents` table + migrate `receipt_file_path`**

Append:

```sql
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
```

- [ ] **Step 10: Section 8 — `voucher_number` retro-backfill + NOT NULL UNIQUE**

Append:

```sql
-- ============================================================================
-- Section 8: voucher_number retro-backfill
-- ============================================================================

-- For existing rows with submitted_by set: derive per-employee sequence.
WITH numbered AS (
  SELECT
    ex.id,
    e.voucher_prefix || '-' ||
      LPAD(
        (ROW_NUMBER() OVER (
          PARTITION BY ex.submitted_by
          ORDER BY ex.submitted_at NULLS LAST, ex.created_at, ex.id
        ))::TEXT,
        3, '0'
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
WITH orphans AS (
  SELECT
    id,
    'UNASSIGNED-' ||
      LPAD(
        (ROW_NUMBER() OVER (ORDER BY created_at, id))::TEXT,
        3, '0'
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
```

- [ ] **Step 11: Section 9 — `generate_voucher_number` function + BEFORE INSERT trigger**

Append:

```sql
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

  RETURN v_prefix || '-' || LPAD(v_next_seq::TEXT, 3, '0');
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
```

- [ ] **Step 12: Section 10 — Rewrite RLS on `expenses`**

Append:

```sql
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
```

- [ ] **Step 13: Section 11 — Indexes**

Append:

```sql
-- ============================================================================
-- Section 11: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_expenses_project      ON expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status       ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_submitted_by ON expenses(submitted_by);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category     ON expenses(category_id);
-- voucher_number already unique-indexed via the UNIQUE constraint in Section 8.
```

- [ ] **Step 14: Section 12 — RLS for `expense_categories` and `expense_documents`**

Append:

```sql
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
```

- [ ] **Step 15: Section 13 — `projects.project_type`**

Append:

```sql
-- ============================================================================
-- Section 13: projects.project_type (for + New Project dialog)
-- ============================================================================

ALTER TABLE projects
  ADD COLUMN project_type TEXT
  CHECK (project_type IN ('sales', 'internal'));

UPDATE projects SET project_type = 'sales' WHERE project_type IS NULL;

ALTER TABLE projects ALTER COLUMN project_type SET NOT NULL;
ALTER TABLE projects ALTER COLUMN project_type SET DEFAULT 'sales';
```

- [ ] **Step 16: Section 14 — RPC `get_expense_kpis`**

Append:

```sql
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
```

- [ ] **Step 17: Close the migration**

Append:

```sql
COMMIT;
```

- [ ] **Step 18: Apply the migration on dev**

Use the Supabase MCP `apply_migration` tool (preferred) or paste into the Supabase SQL editor on the dev project (`actqtzoxjilqnldnacqz`). Confirm the migration returns no errors.

Verification queries (run after apply):

```sql
-- Status distinct values should be only the new 4
SELECT DISTINCT status FROM expenses;

-- No duplicate voucher numbers
SELECT voucher_number, COUNT(*) FROM expenses GROUP BY voucher_number HAVING COUNT(*) > 1;

-- No duplicate active prefixes
SELECT voucher_prefix, COUNT(*) FROM employees
WHERE is_active = TRUE AND voucher_prefix IS NOT NULL
GROUP BY voucher_prefix HAVING COUNT(*) > 1;

-- All expenses have category
SELECT COUNT(*) FROM expenses WHERE category_id IS NULL;

-- All projects have type
SELECT COUNT(*) FROM projects WHERE project_type IS NULL;
```

Expected: every query returns 0 rows / 0 count.

- [ ] **Step 19: Regenerate types**

Run:

```bash
cd C:/Users/vivek/Projects/shiroi-erp
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz > packages/types/database.ts
```

Expected: file updates with `expenses`, `expense_categories`, `expense_documents` table shapes, plus `get_expense_kpis`, `generate_voucher_number`, `current_employee_id`, `current_app_role` functions. The `project_site_expenses` entry disappears.

- [ ] **Step 20: Typecheck**

Run:

```bash
pnpm check-types
```

Expected: 0 errors (you'll see references to `project_site_expenses` in `site-expenses-actions.ts` and `voucher-table*` — these get fixed / deleted in later tasks; for this commit we temporarily add `@ts-expect-error` comments on those broken references OR just accept the error and fix in the next task. **Preferred:** leave the errors and fix in Task 2's first subtask, since they'll all be deleted anyway.)

Actually: don't commit with failing typecheck. Instead, skip this until the legacy deletions in Task 10. Move directly to Step 21.

- [ ] **Step 21: Commit the migration alone (types regen + broken legacy files reverted locally)**

Stage just the migration + types:

```bash
git add supabase/migrations/<NNN>_expenses_module.sql packages/types/database.ts
git commit -m "$(cat <<'EOF'
feat(expenses): migration <NNN> — standalone expenses module schema

- expense_categories master + seed 8 categories
- employees.voucher_prefix with 3→4→5 letter backfill
- rename project_site_expenses → expenses (project_id nullable)
- 4-status workflow + general-expense skip-verify CHECK
- expense_documents table + migrate receipt_file_path
- voucher_number retro-backfill + generate_voucher_number trigger
- RLS rewrite; RPC get_expense_kpis; projects.project_type
EOF
)"
```

Expected: commit succeeds despite the typecheck errors in `site-expenses-actions.ts`/`voucher-*` files. This is acceptable because those files are deleted in Task 10. **But** if the pre-commit hooks reject the commit, revert and instead use the approach in Task 2's Step 1 (rename `site-expenses-actions.ts` → `.bak.ts` temporarily so it's not typechecked, commit the migration, then handle properly in Task 10).

---

## Phase B — Server actions and queries

### Task 2: Delete legacy voucher code paths (or stash for later cleanup)

- [ ] **Step 1: Stash or delete legacy files**

To keep the typechecker happy while the new module is being built, delete the legacy files now. They'll be recreated in spirit by the new `expenses-actions.ts`.

```bash
rm apps/erp/src/lib/site-expenses-actions.ts
rm apps/erp/src/components/projects/forms/site-expense-form.tsx
rm apps/erp/src/components/projects/forms/voucher-table-controls.tsx
rm apps/erp/src/components/vouchers/voucher-actions.tsx
```

- [ ] **Step 2: Fix any imports that break**

Run:

```bash
pnpm check-types
```

Expected: errors in `apps/erp/src/app/(erp)/vouchers/page.tsx`, `apps/erp/src/components/projects/stepper-steps/step-actuals.tsx`, and possibly others that imported `site-expenses-actions` or the deleted components. We handle these:

- **`vouchers/page.tsx`**: rewrite as a redirect right now (tiny). Replace the entire file with:

```tsx
import { redirect } from 'next/navigation';

export default function VouchersPage() {
  redirect('/expenses?status=submitted');
}
```

- **`step-actuals.tsx`**: temporarily comment out the `VoucherTable` import + usage. Leave a TODO that Task 8 replaces it. The Actuals page stays functional without the voucher section for one commit; this is acceptable on dev.

```tsx
// TEMP: voucher controls moved to /expenses — replaced by SiteExpensesReadonly in Task 8
// import { VoucherTable } from '...';
// <VoucherTable ... />
```

Run `pnpm check-types` again. Expected: 0 errors.

- [ ] **Step 3: Commit the cleanup**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(expenses): remove legacy voucher code paths

Deleted site-expenses-actions.ts, site-expense-form.tsx,
voucher-table-controls.tsx, and voucher-actions.tsx in preparation for the
standalone expenses module. /vouchers is now a redirect to
/expenses?status=submitted. Project Actuals voucher section temporarily
hidden; replaced by SiteExpensesReadonly in a follow-up task.
EOF
)"
```

### Task 3: Write `expense-categories-queries.ts` and `expense-categories-actions.ts`

**Files:**
- Create: `apps/erp/src/lib/expense-categories-queries.ts`
- Create: `apps/erp/src/lib/expense-categories-actions.ts`

- [ ] **Step 1: Write `expense-categories-queries.ts`**

```typescript
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

export type ExpenseCategory = Database['public']['Tables']['expense_categories']['Row'];

export async function listCategories(opts?: { includeInactive?: boolean }): Promise<ExpenseCategory[]> {
  const op = '[listCategories]';
  const supabase = await createClient();
  let query = supabase
    .from('expense_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });

  if (!opts?.includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} failed`, { error });
    return [];
  }
  return data ?? [];
}

export async function getActiveCategories(): Promise<ExpenseCategory[]> {
  return listCategories({ includeInactive: false });
}
```

- [ ] **Step 2: Write `expense-categories-actions.ts`**

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

type CategoryInsert = Database['public']['Tables']['expense_categories']['Insert'];
type CategoryUpdate = Database['public']['Tables']['expense_categories']['Update'];

export async function addCategory(input: {
  code: string;
  label: string;
  sort_order?: number;
}): Promise<ActionResult<{ id: string }>> {
  const op = '[addCategory]';
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(code)) {
    return err('Code must be lowercase letters, numbers, underscore only');
  }
  if (!input.label.trim()) return err('Label is required');

  const supabase = await createClient();
  const payload: CategoryInsert = {
    code,
    label: input.label.trim(),
    sort_order: input.sort_order ?? 999,
    is_active: true,
  };
  const { data, error } = await supabase
    .from('expense_categories')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    console.error(`${op} failed`, { input, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses/categories');
  revalidatePath('/expenses');
  return ok({ id: data.id });
}

export async function updateCategory(
  id: string,
  patch: { label?: string; sort_order?: number },
): Promise<ActionResult<void>> {
  const op = '[updateCategory]';
  const update: CategoryUpdate = {};
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.sort_order !== undefined) update.sort_order = patch.sort_order;
  update.updated_at = new Date().toISOString();

  const supabase = await createClient();
  const { error } = await supabase.from('expense_categories').update(update).eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, patch, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses/categories');
  revalidatePath('/expenses');
  return ok(undefined as void);
}

export async function toggleCategoryActive(id: string, active: boolean): Promise<ActionResult<void>> {
  const op = '[toggleCategoryActive]';
  const supabase = await createClient();
  const { error } = await supabase
    .from('expense_categories')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, active, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses/categories');
  revalidatePath('/expenses');
  return ok(undefined as void);
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm check-types
git add apps/erp/src/lib/expense-categories-queries.ts apps/erp/src/lib/expense-categories-actions.ts
git commit -m "feat(expenses): category master queries + CRUD actions"
```

### Task 4: Write `expenses-queries.ts`

**File:** `apps/erp/src/lib/expenses-queries.ts`

- [ ] **Step 1: Write the file**

```typescript
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

export type Expense = Database['public']['Tables']['expenses']['Row'];
export type ExpenseStatus = 'submitted' | 'verified' | 'approved' | 'rejected';

export interface ExpenseListRow {
  id: string;
  voucher_number: string;
  project_id: string | null;
  project_number: string | null;
  customer_name: string | null;
  submitted_by: string | null;
  submitter_name: string | null;
  category_id: string;
  category_label: string | null;
  category_code: string | null;
  description: string | null;
  amount: number;
  expense_date: string | null;
  status: ExpenseStatus;
  submitted_at: string | null;
  verified_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  document_count: number;
}

export interface ListExpensesFilters {
  search?: string;
  projectId?: string | null; // pass the literal string 'general' for general-only
  submittedBy?: string;
  categoryId?: string;
  status?: ExpenseStatus;
  scope?: 'all' | 'project' | 'general';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export async function listExpenses(filters: ListExpensesFilters = {}): Promise<{
  rows: ExpenseListRow[];
  total: number;
}> {
  const op = '[listExpenses]';
  const supabase = await createClient();
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('expenses')
    .select(
      `
      id, voucher_number, project_id, submitted_by, category_id, description,
      amount, expense_date, status, submitted_at, verified_at, approved_at,
      rejected_at, rejected_reason,
      projects:projects(project_number, customer_name),
      submitter:employees!expenses_submitted_by_fkey(full_name),
      category:expense_categories(label, code),
      documents:expense_documents(id)
    `,
      { count: 'estimated' },
    )
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + pageSize - 1);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters.submittedBy) query = query.eq('submitted_by', filters.submittedBy);
  if (filters.scope === 'project') query = query.not('project_id', 'is', null);
  if (filters.scope === 'general') query = query.is('project_id', null);
  if (filters.projectId && filters.projectId !== 'general') query = query.eq('project_id', filters.projectId);
  if (filters.projectId === 'general') query = query.is('project_id', null);
  if (filters.dateFrom) query = query.gte('expense_date', filters.dateFrom);
  if (filters.dateTo) query = query.lte('expense_date', filters.dateTo);
  if (filters.search) {
    const s = filters.search.trim();
    query = query.or(
      `voucher_number.ilike.%${s}%,description.ilike.%${s}%`,
    );
    // Note: searching submitter/customer names requires joined-table search —
    // handled client-side as a post-filter or via an RPC (future enhancement).
  }

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} failed`, { filters, error });
    return { rows: [], total: 0 };
  }

  const rows: ExpenseListRow[] = (data ?? []).map((r) => {
    const project = (r.projects as { project_number: string | null; customer_name: string | null } | null) ?? null;
    const submitter = (r.submitter as { full_name: string | null } | null) ?? null;
    const cat = (r.category as { label: string | null; code: string | null } | null) ?? null;
    const docs = (r.documents as { id: string }[] | null) ?? [];
    return {
      id: r.id,
      voucher_number: r.voucher_number,
      project_id: r.project_id,
      project_number: project?.project_number ?? null,
      customer_name: project?.customer_name ?? null,
      submitted_by: r.submitted_by,
      submitter_name: submitter?.full_name ?? null,
      category_id: r.category_id,
      category_label: cat?.label ?? null,
      category_code: cat?.code ?? null,
      description: r.description,
      amount: Number(r.amount ?? 0),
      expense_date: r.expense_date,
      status: r.status as ExpenseStatus,
      submitted_at: r.submitted_at,
      verified_at: r.verified_at,
      approved_at: r.approved_at,
      rejected_at: r.rejected_at,
      rejected_reason: r.rejected_reason,
      document_count: docs.length,
    };
  });

  return { rows, total: count ?? 0 };
}

export async function getExpense(id: string): Promise<(ExpenseListRow & {
  verified_by: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  verified_by_name: string | null;
  approved_by_name: string | null;
  rejected_by_name: string | null;
  documents: Array<{
    id: string;
    file_path: string;
    file_name: string | null;
    file_size: number | null;
    mime_type: string | null;
    uploaded_at: string;
  }>;
}) | null> {
  const op = '[getExpense]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('expenses')
    .select(
      `
      id, voucher_number, project_id, submitted_by, category_id, description,
      amount, expense_date, status, submitted_at, verified_at, approved_at,
      rejected_at, rejected_reason, verified_by, approved_by, rejected_by,
      projects:projects(project_number, customer_name),
      submitter:employees!expenses_submitted_by_fkey(full_name),
      verifier:employees!expenses_verified_by_fkey(full_name),
      approver:employees!expenses_approved_by_fkey(full_name),
      rejecter:employees!expenses_rejected_by_fkey(full_name),
      category:expense_categories(label, code),
      documents:expense_documents(id, file_path, file_name, file_size, mime_type, uploaded_at)
    `,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`${op} failed`, { id, error });
    return null;
  }
  if (!data) return null;

  const project = (data.projects as { project_number: string | null; customer_name: string | null } | null) ?? null;
  const submitter = (data.submitter as { full_name: string | null } | null) ?? null;
  const verifier = (data.verifier as { full_name: string | null } | null) ?? null;
  const approver = (data.approver as { full_name: string | null } | null) ?? null;
  const rejecter = (data.rejecter as { full_name: string | null } | null) ?? null;
  const cat = (data.category as { label: string | null; code: string | null } | null) ?? null;
  const docs = (data.documents as Array<{
    id: string;
    file_path: string;
    file_name: string | null;
    file_size: number | null;
    mime_type: string | null;
    uploaded_at: string;
  }> | null) ?? [];

  return {
    id: data.id,
    voucher_number: data.voucher_number,
    project_id: data.project_id,
    project_number: project?.project_number ?? null,
    customer_name: project?.customer_name ?? null,
    submitted_by: data.submitted_by,
    submitter_name: submitter?.full_name ?? null,
    verified_by: data.verified_by,
    verified_by_name: verifier?.full_name ?? null,
    approved_by: data.approved_by,
    approved_by_name: approver?.full_name ?? null,
    rejected_by: data.rejected_by,
    rejected_by_name: rejecter?.full_name ?? null,
    category_id: data.category_id,
    category_label: cat?.label ?? null,
    category_code: cat?.code ?? null,
    description: data.description,
    amount: Number(data.amount ?? 0),
    expense_date: data.expense_date,
    status: data.status as ExpenseStatus,
    submitted_at: data.submitted_at,
    verified_at: data.verified_at,
    approved_at: data.approved_at,
    rejected_at: data.rejected_at,
    rejected_reason: data.rejected_reason,
    document_count: docs.length,
    documents: docs,
  };
}

export async function getExpensesByProject(projectId: string): Promise<ExpenseListRow[]> {
  const { rows } = await listExpenses({ projectId, pageSize: 500 });
  return rows;
}

export async function getExpenseKPIs(): Promise<{
  total_count: number;
  submitted_count: number;
  pending_action_amt: number;
  approved_month_amt: number;
}> {
  const op = '[getExpenseKPIs]';
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { total_count: 0, submitted_count: 0, pending_action_amt: 0, approved_month_amt: 0 };
  }

  const [{ data: profile }, { data: employee }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.user.id).maybeSingle(),
    supabase.from('employees').select('id').eq('profile_id', user.user.id).maybeSingle(),
  ]);

  const { data, error } = await supabase.rpc('get_expense_kpis', {
    p_role: profile?.role ?? 'customer',
    p_employee_id: employee?.id ?? '00000000-0000-0000-0000-000000000000',
  });

  if (error) {
    console.error(`${op} failed`, { error });
    return { total_count: 0, submitted_count: 0, pending_action_amt: 0, approved_month_amt: 0 };
  }
  const row = (data ?? [])[0];
  return {
    total_count: Number(row?.total_count ?? 0),
    submitted_count: Number(row?.submitted_count ?? 0),
    pending_action_amt: Number(row?.pending_action_amt ?? 0),
    approved_month_amt: Number(row?.approved_month_amt ?? 0),
  };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm check-types
git add apps/erp/src/lib/expenses-queries.ts
git commit -m "feat(expenses): listExpenses / getExpense / KPI queries"
```

### Task 5: Write `expenses-actions.ts`

**File:** `apps/erp/src/lib/expenses-actions.ts`

- [ ] **Step 1: Write the file**

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

type ExpenseInsert = Database['public']['Tables']['expenses']['Insert'];
type ExpenseUpdate = Database['public']['Tables']['expenses']['Update'];

interface CallerContext {
  userId: string;
  role: string | null;
  employeeId: string | null;
}

async function getCaller(): Promise<CallerContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { userId: '', role: null, employeeId: null };

  const [{ data: profile }, { data: employee }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.from('employees').select('id').eq('profile_id', user.id).maybeSingle(),
  ]);

  return {
    userId: user.id,
    role: profile?.role ?? null,
    employeeId: employee?.id ?? null,
  };
}

const STORAGE_BUCKET = 'project-files';

export async function submitExpense(input: {
  projectId: string | null;
  categoryId: string;
  description: string;
  amount: number;
  expenseDate?: string | null;
}): Promise<ActionResult<{ id: string; voucherNumber: string }>> {
  const op = '[submitExpense]';
  if (!input.categoryId) return err('Category is required');
  if (!input.description.trim()) return err('Description is required');
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return err('Amount must be a positive number');
  }

  const caller = await getCaller();
  if (!caller.userId) return err('Not authenticated');
  if (!caller.employeeId) return err('No employee record — contact HR');
  if (caller.role === 'customer') return err('Customers cannot submit expenses');

  const supabase = await createClient();
  const payload: ExpenseInsert = {
    project_id: input.projectId,
    category_id: input.categoryId,
    description: input.description.trim(),
    amount: input.amount,
    expense_date: input.expenseDate ?? new Date().toISOString().slice(0, 10),
    status: 'submitted',
    submitted_by: caller.employeeId,
    submitted_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select('id, voucher_number')
    .single();

  if (error) {
    console.error(`${op} failed`, { input, error });
    return err(error.message, error.code);
  }

  revalidatePath('/expenses');
  if (input.projectId) revalidatePath(`/projects/${input.projectId}`);
  return ok({ id: data.id, voucherNumber: data.voucher_number });
}

export async function updateExpense(
  id: string,
  patch: {
    description?: string;
    amount?: number;
    expenseDate?: string;
    categoryId?: string;
    projectId?: string | null;
  },
): Promise<ActionResult<void>> {
  const op = '[updateExpense]';
  const supabase = await createClient();
  const update: ExpenseUpdate = { updated_at: new Date().toISOString() };
  if (patch.description !== undefined) update.description = patch.description.trim();
  if (patch.amount !== undefined) {
    if (!Number.isFinite(patch.amount) || patch.amount <= 0) return err('Amount must be positive');
    update.amount = patch.amount;
  }
  if (patch.expenseDate !== undefined) update.expense_date = patch.expenseDate;
  if (patch.categoryId !== undefined) update.category_id = patch.categoryId;
  if (patch.projectId !== undefined) update.project_id = patch.projectId;

  const { error } = await supabase.from('expenses').update(update).eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, patch, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses');
  revalidatePath(`/expenses/${id}`);
  return ok(undefined as void);
}

export async function verifyExpense(id: string): Promise<ActionResult<void>> {
  const op = '[verifyExpense]';
  const caller = await getCaller();
  if (!caller.userId) return err('Not authenticated');

  const supabase = await createClient();
  // Guard: general expenses skip verify.
  const { data: row } = await supabase
    .from('expenses')
    .select('project_id, status, project:projects(id)')
    .eq('id', id)
    .maybeSingle();
  if (!row) return err('Expense not found');
  if (row.project_id === null) return err('General expenses skip the Verify stage');
  if (row.status !== 'submitted') return err(`Cannot verify — status is ${row.status}`);

  const { error } = await supabase
    .from('expenses')
    .update({
      status: 'verified',
      verified_by: caller.employeeId,
      verified_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses');
  revalidatePath(`/expenses/${id}`);
  if (row.project_id) revalidatePath(`/projects/${row.project_id}`);
  return ok(undefined as void);
}

export async function approveExpense(id: string): Promise<ActionResult<void>> {
  const op = '[approveExpense]';
  const caller = await getCaller();
  if (caller.role !== 'founder') return err('Only the Founder can approve expenses');

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('expenses')
    .select('project_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!row) return err('Expense not found');

  // Project-linked: must be verified. General: must be submitted.
  if (row.project_id === null) {
    if (row.status !== 'submitted') return err(`Cannot approve — status is ${row.status}`);
  } else {
    if (row.status !== 'verified') return err(`Cannot approve — status is ${row.status} (must be verified)`);
  }

  const { error } = await supabase
    .from('expenses')
    .update({
      status: 'approved',
      approved_by: caller.employeeId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses');
  revalidatePath(`/expenses/${id}`);
  if (row.project_id) revalidatePath(`/projects/${row.project_id}`);
  return ok(undefined as void);
}

export async function rejectExpense(id: string, reason: string): Promise<ActionResult<void>> {
  const op = '[rejectExpense]';
  if (!reason.trim()) return err('Rejection reason is required');

  const caller = await getCaller();
  if (caller.userId === '') return err('Not authenticated');

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('expenses')
    .select('project_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!row) return err('Expense not found');
  if (!['submitted', 'verified'].includes(row.status)) {
    return err(`Cannot reject — status is ${row.status}`);
  }

  // PMs can only reject project-linked submitted rows.
  if (caller.role === 'project_manager') {
    if (row.project_id === null) return err('PM cannot reject general expenses');
    if (row.status !== 'submitted') return err('PM can only reject from submitted');
  } else if (caller.role !== 'founder') {
    return err('Only PM or Founder can reject');
  }

  const { error } = await supabase
    .from('expenses')
    .update({
      status: 'rejected',
      rejected_by: caller.employeeId,
      rejected_at: new Date().toISOString(),
      rejected_reason: reason.trim(),
    })
    .eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses');
  revalidatePath(`/expenses/${id}`);
  if (row.project_id) revalidatePath(`/projects/${row.project_id}`);
  return ok(undefined as void);
}

export async function deleteExpense(id: string): Promise<ActionResult<void>> {
  const op = '[deleteExpense]';
  const supabase = await createClient();
  // RLS handles authorization. Delete related documents cascade via FK.
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses');
  return ok(undefined as void);
}

export async function revertExpense(
  id: string,
  target: 'submitted' | 'verified',
): Promise<ActionResult<void>> {
  const op = '[revertExpense]';
  const caller = await getCaller();
  if (caller.role !== 'founder') return err('Only Founder can revert');

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('expenses')
    .select('project_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!row) return err('Expense not found');

  // Constraint: general expenses cannot be 'verified' — they have no verified stage.
  if (target === 'verified' && row.project_id === null) {
    return err('General expenses cannot be in verified state');
  }

  const update: ExpenseUpdate = { status: target, updated_at: new Date().toISOString() };
  // Clear the stage fields after the target.
  if (target === 'submitted') {
    update.verified_by = null;
    update.verified_at = null;
    update.approved_by = null;
    update.approved_at = null;
    update.rejected_by = null;
    update.rejected_at = null;
    update.rejected_reason = null;
  } else if (target === 'verified') {
    update.approved_by = null;
    update.approved_at = null;
    update.rejected_by = null;
    update.rejected_at = null;
    update.rejected_reason = null;
  }

  const { error } = await supabase.from('expenses').update(update).eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, target, error });
    return err(error.message, error.code);
  }
  revalidatePath('/expenses');
  revalidatePath(`/expenses/${id}`);
  return ok(undefined as void);
}

export async function uploadExpenseDocument(input: {
  expenseId: string;
  filePath: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const op = '[uploadExpenseDocument]';
  const caller = await getCaller();
  if (!caller.employeeId) return err('Not authenticated');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('expense_documents')
    .insert({
      expense_id: input.expenseId,
      file_path: input.filePath,
      file_name: input.fileName ?? null,
      file_size: input.fileSize ?? null,
      mime_type: input.mimeType ?? null,
      uploaded_by: caller.employeeId,
    })
    .select('id')
    .single();
  if (error) {
    console.error(`${op} failed`, { input, error });
    return err(error.message, error.code);
  }
  revalidatePath(`/expenses/${input.expenseId}`);
  return ok({ id: data.id });
}

export async function deleteExpenseDocument(id: string, expenseId: string): Promise<ActionResult<void>> {
  const op = '[deleteExpenseDocument]';
  const supabase = await createClient();
  // Fetch path before delete so we can remove storage object too.
  const { data: row } = await supabase
    .from('expense_documents')
    .select('file_path')
    .eq('id', id)
    .maybeSingle();
  const { error } = await supabase.from('expense_documents').delete().eq('id', id);
  if (error) {
    console.error(`${op} failed`, { id, error });
    return err(error.message, error.code);
  }
  if (row?.file_path) {
    await supabase.storage.from(STORAGE_BUCKET).remove([row.file_path]);
  }
  revalidatePath(`/expenses/${expenseId}`);
  return ok(undefined as void);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm check-types
git add apps/erp/src/lib/expenses-actions.ts
git commit -m "feat(expenses): server actions (submit/verify/approve/reject/revert/delete + docs)"
```

---

## Phase C — Projects auxiliary

### Task 6: Write `projects-actions.ts` + `+ New Project` dialog

**Files:**
- Create: `apps/erp/src/lib/projects-actions.ts`
- Create: `apps/erp/src/components/projects/new-project-dialog.tsx`
- Modify: `apps/erp/src/app/(erp)/projects/page.tsx`

- [ ] **Step 1: Write `projects-actions.ts`**

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

type ProjectInsert = Database['public']['Tables']['projects']['Insert'];

export async function createProject(input: {
  projectName: string;
  customerName: string;
  pmEmployeeId?: string | null;
  systemSizeKwp?: number | null;
  projectType: 'sales' | 'internal';
}): Promise<ActionResult<{ id: string }>> {
  const op = '[createProject]';
  if (!input.projectName.trim()) return err('Project name is required');
  if (!input.customerName.trim()) return err('Customer name is required');

  const supabase = await createClient();
  const payload: ProjectInsert = {
    project_name: input.projectName.trim(),
    customer_name: input.customerName.trim(),
    project_manager_id: input.pmEmployeeId ?? null,
    system_size_kwp: input.systemSizeKwp ?? null,
    project_type: input.projectType,
    status: 'yet_to_start',
  };

  const { data, error } = await supabase
    .from('projects')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    console.error(`${op} failed`, { input, error });
    return err(error.message, error.code);
  }
  revalidatePath('/projects');
  return ok({ id: data.id });
}
```

NOTE: Confirm `projects.project_name` column exists (it does — see existing schema). If the column name is different in the actual table (e.g., `name`), adjust. Check with:

```bash
# In Supabase SQL editor on dev:
SELECT column_name FROM information_schema.columns WHERE table_name = 'projects' AND column_name IN ('project_name', 'name', 'system_size_kwp');
```

- [ ] **Step 2: Write `new-project-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui';
import { createProject } from '@/lib/projects-actions';

interface Pm {
  id: string;
  full_name: string;
}

export function NewProjectDialog({ pms }: { pms: Pm[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [pmId, setPmId] = useState<string>('');
  const [sizeKwp, setSizeKwp] = useState<string>('');
  const [projectType, setProjectType] = useState<'sales' | 'internal'>('sales');

  function reset() {
    setProjectName('');
    setCustomerName('');
    setPmId('');
    setSizeKwp('');
    setProjectType('sales');
    setError(null);
    setSaving(false);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const result = await createProject({
      projectName,
      customerName,
      pmEmployeeId: pmId || null,
      systemSizeKwp: sizeKwp ? Number(sizeKwp) : null,
      projectType,
    });
    if (!result.success) {
      setError(result.error);
      setSaving(false);
      return;
    }
    setOpen(false);
    reset();
    router.push(`/projects/${result.data.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>+ New Project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create project</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Project name *</Label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </div>
          <div>
            <Label>Customer name *</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div>
            <Label>Project manager</Label>
            <Select value={pmId} onValueChange={setPmId}>
              <SelectTrigger><SelectValue placeholder="Select PM" /></SelectTrigger>
              <SelectContent>
                {pms.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>System size (kWp)</Label>
            <Input type="number" step="0.01" value={sizeKwp} onChange={(e) => setSizeKwp(e.target.value)} />
          </div>
          <div>
            <Label>Project type</Label>
            <div className="flex gap-4 mt-1">
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={projectType === 'sales'} onChange={() => setProjectType('sales')} />
                Sales
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={projectType === 'internal'} onChange={() => setProjectType('internal')} />
                Internal
              </label>
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

NOTE: Confirm the exact exports from `@repo/ui` (`Dialog`, `DialogTrigger`, `Select`, etc.) by reading one of the existing dialog components in `apps/erp/src/components/om/` for reference. If an export is missing, add it to `packages/ui/src/index.ts`.

- [ ] **Step 3: Wire the button into `projects/page.tsx`**

Read the file and add the `<NewProjectDialog>` trigger near the page header, rendering it only for `project_manager` + `founder`.

Locate the component that shows role — likely a server component that reads `profiles.role`. Follow the pattern used by other role-gated buttons.

- [ ] **Step 4: Preview + commit**

```bash
cd apps/erp && pnpm dev  # via preview_start
```

Smoke test: open `/projects` as founder. Click `+ New Project`. Create a test project with type=internal. Verify redirect to detail.

```bash
git add apps/erp/src/lib/projects-actions.ts apps/erp/src/components/projects/new-project-dialog.tsx apps/erp/src/app/\(erp\)/projects/page.tsx
git commit -m "feat(projects): + New Project dialog (role-gated PM + founder)"
```

---

## Phase D — Expenses list page

### Task 7: Build `/expenses` list page

**Files:**
- Create: `apps/erp/src/app/(erp)/expenses/page.tsx`
- Create: `apps/erp/src/components/expenses/expense-kpis.tsx`
- Create: `apps/erp/src/components/expenses/expense-filters.tsx`
- Create: `apps/erp/src/components/expenses/expense-table.tsx`
- Create: `apps/erp/src/components/expenses/status-badge.tsx`
- Create: `apps/erp/src/components/expenses/scope-badge.tsx`
- Create: `apps/erp/src/components/expenses/add-expense-dialog.tsx` (stub — full impl in Task 9)

- [ ] **Step 1: Write `status-badge.tsx`**

```tsx
import { cn } from '@repo/ui';

const STYLES: Record<string, string> = {
  submitted: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  verified:  'bg-blue-100 text-blue-800 border-blue-300',
  approved:  'bg-green-100 text-green-800 border-green-300',
  rejected:  'bg-red-100 text-red-800 border-red-300',
};

const LABELS: Record<string, string> = {
  submitted: 'Submitted',
  verified:  'Verified',
  approved:  'Approved',
  rejected:  'Rejected',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('px-2 py-0.5 rounded border text-xs font-medium', STYLES[status] ?? 'bg-gray-100 text-gray-800 border-gray-300')}>
      {LABELS[status] ?? status}
    </span>
  );
}
```

- [ ] **Step 2: Write `scope-badge.tsx`**

```tsx
import { cn } from '@repo/ui';

export function ScopeBadge({ projectLinked }: { projectLinked: boolean }) {
  return (
    <span className={cn(
      'px-2 py-0.5 rounded border text-xs font-medium',
      projectLinked ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-violet-100 text-violet-700 border-violet-300',
    )}>
      {projectLinked ? 'Project-linked' : 'General'}
    </span>
  );
}
```

- [ ] **Step 3: Write `expense-kpis.tsx`**

```tsx
import { formatINR } from '@/lib/utils/format';
import type { getExpenseKPIs } from '@/lib/expenses-queries';

type KPIs = Awaited<ReturnType<typeof getExpenseKPIs>>;

export function ExpenseKPIs({ kpis }: { kpis: KPIs }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
      <Card label="Total Vouchers" value={kpis.total_count.toString()} />
      <Card label="Submitted" value={kpis.submitted_count.toString()} />
      <Card label="Pending Action" value={formatINR(kpis.pending_action_amt)} />
      <Card label="Approved This Month" value={formatINR(kpis.approved_month_amt)} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded border bg-white">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold mt-1 font-mono">{value}</div>
    </div>
  );
}
```

NOTE: Confirm `formatINR` exists at `apps/erp/src/lib/utils/format.ts`. If not, find its current location with `grep -r "formatINR" apps/erp/src/lib`.

- [ ] **Step 4: Write `expense-filters.tsx`**

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from '@repo/ui';

const STATUSES = ['submitted', 'verified', 'approved', 'rejected'] as const;

export function ExpenseFilters({
  categories,
  submitters,
}: {
  categories: { id: string; label: string }[];
  submitters: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function update(key: string, value: string | null) {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    p.delete('page');
    router.push(`/expenses?${p.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2 mb-4 items-end">
      <Input
        placeholder="Search voucher, description…"
        className="h-9 w-56"
        defaultValue={sp.get('search') ?? ''}
        onKeyDown={(e) => { if (e.key === 'Enter') update('search', (e.target as HTMLInputElement).value); }}
      />
      <div className="flex gap-1">
        {(['all', 'project', 'general'] as const).map((s) => {
          const active = (sp.get('scope') ?? 'all') === s;
          return (
            <Button
              key={s}
              size="sm"
              variant={active ? 'default' : 'outline'}
              onClick={() => update('scope', s === 'all' ? null : s)}
            >
              {s === 'all' ? 'All' : s === 'project' ? 'Project' : 'General'}
            </Button>
          );
        })}
      </div>
      <Select value={sp.get('status') ?? ''} onValueChange={(v) => update('status', v || null)}>
        <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">All statuses</SelectItem>
          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={sp.get('category') ?? ''} onValueChange={(v) => update('category', v || null)}>
        <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Category" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">All categories</SelectItem>
          {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={sp.get('submitter') ?? ''} onValueChange={(v) => update('submitter', v || null)}>
        <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Submitter" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">All submitters</SelectItem>
          {submitters.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 5: Write `expense-table.tsx`**

```tsx
import Link from 'next/link';
import { StatusBadge } from './status-badge';
import { formatINR } from '@/lib/utils/format';
import type { ExpenseListRow } from '@/lib/expenses-queries';

export function ExpenseTable({ rows }: { rows: ExpenseListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 border rounded">
        <div className="text-gray-400 text-sm">No expenses yet</div>
      </div>
    );
  }
  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">Voucher</th>
            <th className="px-3 py-2 text-left">Project</th>
            <th className="px-3 py-2 text-left">Submitter</th>
            <th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-center">Docs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2 font-mono">
                <Link href={`/expenses/${r.id}`} className="text-blue-600 hover:underline">{r.voucher_number}</Link>
              </td>
              <td className="px-3 py-2">
                {r.project_number
                  ? <span>{r.project_number}<span className="text-gray-500"> · {r.customer_name}</span></span>
                  : <span className="italic text-gray-500">General</span>}
              </td>
              <td className="px-3 py-2">{r.submitter_name ?? '—'}</td>
              <td className="px-3 py-2">{r.category_label ?? '—'}</td>
              <td className="px-3 py-2 max-w-xs truncate" title={r.description ?? ''}>{r.description ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono">{formatINR(r.amount)}</td>
              <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
              <td className="px-3 py-2 text-center text-xs text-gray-500">{r.document_count > 0 ? `📎${r.document_count}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Write `add-expense-dialog.tsx` (stub)**

Minimal stub so the button on the list page has something to click. Full implementation in Task 9.

```tsx
'use client';

import { useState } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@repo/ui';

export function AddExpenseDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>+ Add Expense</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add expense</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-500">Not implemented yet — full dialog arrives in the next commit.</p>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Write `expenses/page.tsx`**

```tsx
import { Suspense } from 'react';
import { createClient } from '@repo/supabase/server';
import { listExpenses, getExpenseKPIs, type ListExpensesFilters } from '@/lib/expenses-queries';
import { getActiveCategories } from '@/lib/expense-categories-queries';
import { ExpenseKPIs } from '@/components/expenses/expense-kpis';
import { ExpenseFilters } from '@/components/expenses/expense-filters';
import { ExpenseTable } from '@/components/expenses/expense-table';
import { AddExpenseDialog } from '@/components/expenses/add-expense-dialog';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: {
    search?: string;
    scope?: 'project' | 'general';
    status?: string;
    category?: string;
    submitter?: string;
    page?: string;
  };
}

export default async function ExpensesPage({ searchParams }: Props) {
  const filters: ListExpensesFilters = {
    search: searchParams.search,
    scope: searchParams.scope ?? 'all',
    status: (['submitted', 'verified', 'approved', 'rejected'] as const).includes(searchParams.status as never)
      ? (searchParams.status as never) : undefined,
    categoryId: searchParams.category,
    submittedBy: searchParams.submitter,
    page: searchParams.page ? parseInt(searchParams.page, 10) : 1,
  };

  const [kpis, { rows, total }, categories] = await Promise.all([
    getExpenseKPIs(),
    listExpenses(filters),
    getActiveCategories(),
  ]);

  const supabase = await createClient();
  const { data: submittersData } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');
  const submitters = (submittersData ?? []).map((s) => ({ id: s.id, full_name: s.full_name ?? '' }));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-500">Vouchers</div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
        </div>
        <AddExpenseDialog />
      </div>

      <ExpenseKPIs kpis={kpis} />
      <ExpenseFilters
        categories={categories.map((c) => ({ id: c.id, label: c.label }))}
        submitters={submitters}
      />
      <Suspense>
        <ExpenseTable rows={rows} />
      </Suspense>

      <div className="text-xs text-gray-500 mt-2">
        Showing {rows.length} of {total} · Page {filters.page}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Preview + smoke test**

Start the dev server and navigate to `/expenses` as founder. Verify:
- KPI strip renders with values
- Filter bar renders with categories + submitters populated
- Table shows at least the migrated rows from `project_site_expenses`
- Scope chips toggle (add `?scope=project`, `?scope=general` manually)
- Status filter works

Fix any runtime issues before proceeding.

- [ ] **Step 9: Typecheck + commit**

```bash
pnpm check-types
git add apps/erp/src/app/\(erp\)/expenses/page.tsx apps/erp/src/components/expenses/
git commit -m "feat(expenses): list page — KPIs, filters, scope chips, table"
```

---

## Phase E — Expense detail page

### Task 8: Build `/expenses/[id]` detail page

**Files:**
- Create: `apps/erp/src/app/(erp)/expenses/[id]/page.tsx`
- Create: `apps/erp/src/components/expenses/status-timeline.tsx`
- Create: `apps/erp/src/components/expenses/documents-list.tsx`
- Create: `apps/erp/src/components/expenses/verify-button.tsx`
- Create: `apps/erp/src/components/expenses/approve-button.tsx`
- Create: `apps/erp/src/components/expenses/reject-dialog.tsx`
- Create: `apps/erp/src/components/expenses/revert-button.tsx`
- Create: `apps/erp/src/components/expenses/delete-expense-button.tsx`
- Create: `apps/erp/src/components/expenses/edit-expense-dialog.tsx` (stub for now)

- [ ] **Step 1: Write action buttons (client components)**

Create the following small client components, each wraps a single server action call with optimistic UX and error toasts.

`verify-button.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { verifyExpense } from '@/lib/expenses-actions';

export function VerifyButton({ id }: { id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function handle() {
    setSaving(true);
    const r = await verifyExpense(id);
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  }
  return <Button onClick={handle} disabled={saving}>{saving ? 'Verifying…' : 'Verify'}</Button>;
}
```

`approve-button.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { approveExpense } from '@/lib/expenses-actions';

export function ApproveButton({ id }: { id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function handle() {
    setSaving(true);
    const r = await approveExpense(id);
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  }
  return <Button variant="default" onClick={handle} disabled={saving}>{saving ? 'Approving…' : 'Approve'}</Button>;
}
```

`reject-dialog.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Label } from '@repo/ui';
import { rejectExpense } from '@/lib/expenses-actions';

export function RejectDialog({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    setSaving(true);
    setError(null);
    const r = await rejectExpense(id, reason);
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    setOpen(false);
    setReason('');
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setReason(''); setError(null); } }}>
      <DialogTrigger asChild><Button variant="destructive">Reject</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Reject expense</DialogTitle></DialogHeader>
        <div>
          <Label>Reason *</Label>
          <textarea className="w-full border rounded p-2 text-sm" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="destructive" onClick={handle} disabled={saving || !reason.trim()}>
            {saving ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`revert-button.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { revertExpense } from '@/lib/expenses-actions';

export function RevertButton({ id, target }: { id: string; target: 'submitted' | 'verified' }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function handle() {
    if (!confirm(`Revert to ${target}?`)) return;
    setSaving(true);
    const r = await revertExpense(id, target);
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  }
  return <Button variant="outline" onClick={handle} disabled={saving}>Revert to {target}</Button>;
}
```

`delete-expense-button.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { deleteExpense } from '@/lib/expenses-actions';

export function DeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function handle() {
    if (!confirm('Delete this expense?')) return;
    setSaving(true);
    const r = await deleteExpense(id);
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    router.push('/expenses');
  }
  return <Button variant="outline" onClick={handle} disabled={saving}>Delete</Button>;
}
```

`edit-expense-dialog.tsx` (stub — full impl in Task 9):

```tsx
'use client';
import { Button } from '@repo/ui';

export function EditExpenseDialog({ id: _id }: { id: string }) {
  return <Button variant="outline" onClick={() => alert('Edit dialog: coming in the next commit')}>Edit</Button>;
}
```

- [ ] **Step 2: Write `status-timeline.tsx`**

```tsx
import { formatIST } from '@/lib/utils/format';

interface TimelineProps {
  projectLinked: boolean;
  status: string;
  submittedAt: string | null;
  submitterName: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectedReason: string | null;
}

export function StatusTimeline(p: TimelineProps) {
  const nodes: Array<{ key: string; label: string; actor: string | null; at: string | null; active: boolean; color: string }> = [
    { key: 'submitted', label: 'Submitted', actor: p.submitterName, at: p.submittedAt, active: !!p.submittedAt, color: 'yellow' },
  ];
  if (p.projectLinked) {
    nodes.push({ key: 'verified', label: 'Verified', actor: p.verifiedByName, at: p.verifiedAt, active: !!p.verifiedAt, color: 'blue' });
  }
  nodes.push({ key: 'approved', label: 'Approved', actor: p.approvedByName, at: p.approvedAt, active: !!p.approvedAt, color: 'green' });
  if (p.status === 'rejected') {
    nodes.push({ key: 'rejected', label: `Rejected${p.rejectedReason ? ': ' + p.rejectedReason : ''}`, actor: p.rejectedByName, at: p.rejectedAt, active: true, color: 'red' });
  }

  return (
    <ol className="relative border-l-2 border-gray-200 ml-4">
      {nodes.map((n) => (
        <li key={n.key} className="ml-4 py-2">
          <span className={`absolute -left-[9px] w-4 h-4 rounded-full ${
            n.active
              ? n.color === 'yellow' ? 'bg-yellow-400'
                : n.color === 'blue'   ? 'bg-blue-500'
                : n.color === 'green'  ? 'bg-green-500'
                : 'bg-red-500'
              : 'bg-gray-200'
          }`} />
          <div className={n.active ? 'text-gray-900' : 'text-gray-400'}>
            <div className="text-sm font-medium">{n.label}</div>
            {n.active && (
              <div className="text-xs text-gray-500">
                {n.actor ?? '—'} · {n.at ? formatIST(n.at) : '—'}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

NOTE: `formatIST` — confirm it exists at `apps/erp/src/lib/utils/format.ts`. If not, `new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })`.

- [ ] **Step 3: Write `documents-list.tsx`**

```tsx
import { createClient as createClientSupabase } from '@repo/supabase/server';

interface DocRow {
  id: string;
  file_path: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: string;
}

async function signUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const supabase = await createClientSupabase();
  const { data } = await supabase.storage.from('project-files').createSignedUrls(paths, 3600);
  const map: Record<string, string> = {};
  for (const s of data ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
  return map;
}

export async function DocumentsList({ docs }: { docs: DocRow[] }) {
  const urls = await signUrls(docs.map((d) => d.file_path));
  if (docs.length === 0) {
    return <div className="text-sm text-gray-500 py-2">No documents attached</div>;
  }
  return (
    <ul className="space-y-2">
      {docs.map((d) => {
        const url = urls[d.file_path];
        const isImage = (d.mime_type ?? '').startsWith('image/');
        return (
          <li key={d.id} className="flex items-center gap-3 p-2 border rounded">
            {isImage && url
              ? <img src={url} alt={d.file_name ?? ''} className="w-16 h-16 object-cover rounded" />
              : <div className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded text-gray-400 text-xs">PDF</div>}
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{d.file_name ?? d.file_path.split('/').pop()}</div>
              <div className="text-xs text-gray-500">{d.file_size ? `${Math.round(d.file_size / 1024)} KB` : ''} · {d.mime_type ?? ''}</div>
            </div>
            {url && <a href={url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">Open</a>}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Write `expenses/[id]/page.tsx`**

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { getExpense } from '@/lib/expenses-queries';
import { StatusBadge } from '@/components/expenses/status-badge';
import { ScopeBadge } from '@/components/expenses/scope-badge';
import { StatusTimeline } from '@/components/expenses/status-timeline';
import { DocumentsList } from '@/components/expenses/documents-list';
import { VerifyButton } from '@/components/expenses/verify-button';
import { ApproveButton } from '@/components/expenses/approve-button';
import { RejectDialog } from '@/components/expenses/reject-dialog';
import { RevertButton } from '@/components/expenses/revert-button';
import { DeleteExpenseButton } from '@/components/expenses/delete-expense-button';
import { EditExpenseDialog } from '@/components/expenses/edit-expense-dialog';
import { formatINR } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

export default async function ExpenseDetail({ params }: { params: { id: string } }) {
  const expense = await getExpense(params.id);
  if (!expense) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  let callerRole: string | null = null;
  let callerEmployeeId: string | null = null;
  if (auth.user) {
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle(),
      supabase.from('employees').select('id').eq('profile_id', auth.user.id).maybeSingle(),
    ]);
    callerRole = p?.role ?? null;
    callerEmployeeId = e?.id ?? null;
  }

  const isSubmitter = callerEmployeeId === expense.submitted_by;
  const isPM = callerRole === 'project_manager';
  const isFounder = callerRole === 'founder';
  const projectLinked = expense.project_id !== null;

  const canEdit =
    (isSubmitter && expense.status === 'submitted')
    || (isPM && projectLinked && expense.status === 'submitted')
    || isFounder;

  const canDelete =
    (isSubmitter && expense.status === 'submitted')
    || isFounder;

  const canVerify = projectLinked && expense.status === 'submitted' && (isPM || isFounder);
  const canApprove = isFounder && (
    (projectLinked && expense.status === 'verified')
    || (!projectLinked && expense.status === 'submitted')
  );
  const canReject =
    ['submitted', 'verified'].includes(expense.status)
    && (
      isFounder
      || (isPM && projectLinked && expense.status === 'submitted')
    );

  const canRevert = isFounder && (expense.status === 'approved' || expense.status === 'rejected');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/expenses" className="text-sm text-blue-600 hover:underline">← Back to expenses</Link>

      <div className="flex items-baseline gap-3 mt-2">
        <h1 className="text-2xl font-mono">{expense.voucher_number}</h1>
        <ScopeBadge projectLinked={projectLinked} />
        <StatusBadge status={expense.status} />
        <div className="ml-auto text-3xl font-mono font-semibold">{formatINR(expense.amount)}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <div className="space-y-2 p-4 border rounded bg-white">
          <h2 className="font-semibold">Details</h2>
          <Row label="Project">
            {expense.project_id
              ? <Link className="text-blue-600 hover:underline" href={`/projects/${expense.project_id}`}>{expense.project_number ?? '(project)'}{expense.customer_name ? ` · ${expense.customer_name}` : ''}</Link>
              : <em className="text-gray-500">General expense — no project</em>}
          </Row>
          <Row label="Submitter">{expense.submitter_name ?? '—'}</Row>
          <Row label="Category">{expense.category_label ?? '—'}</Row>
          <Row label="Expense date">{expense.expense_date ?? '—'}</Row>
          <Row label="Description"><span className="whitespace-pre-wrap">{expense.description ?? '—'}</span></Row>
        </div>

        <div className="p-4 border rounded bg-white">
          <h2 className="font-semibold mb-2">Timeline</h2>
          <StatusTimeline
            projectLinked={projectLinked}
            status={expense.status}
            submittedAt={expense.submitted_at}
            submitterName={expense.submitter_name}
            verifiedAt={expense.verified_at}
            verifiedByName={expense.verified_by_name}
            approvedAt={expense.approved_at}
            approvedByName={expense.approved_by_name}
            rejectedAt={expense.rejected_at}
            rejectedByName={expense.rejected_by_name}
            rejectedReason={expense.rejected_reason}
          />
        </div>
      </div>

      <div className="mt-4 p-4 border rounded bg-white">
        <h2 className="font-semibold mb-2">Documents</h2>
        <DocumentsList docs={expense.documents} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {canEdit && <EditExpenseDialog id={expense.id} />}
        {canVerify && <VerifyButton id={expense.id} />}
        {canApprove && <ApproveButton id={expense.id} />}
        {canReject && <RejectDialog id={expense.id} />}
        {canRevert && expense.status === 'approved' && (
          <RevertButton id={expense.id} target={projectLinked ? 'verified' : 'submitted'} />
        )}
        {canRevert && expense.status === 'rejected' && <RevertButton id={expense.id} target="submitted" />}
        {canDelete && <DeleteExpenseButton id={expense.id} />}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px,1fr] text-sm gap-2">
      <div className="text-gray-500">{label}</div>
      <div>{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Preview + smoke test**

Start dev. Navigate to `/expenses/<some-id>`. Verify:
- Voucher number / scope / status / amount render correctly
- Timeline branches by scope (general shows no Verified node)
- Documents list shows (or "No documents attached")
- Action buttons appear based on role + status

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm check-types
git add apps/erp/src/app/\(erp\)/expenses/\[id\]/page.tsx apps/erp/src/components/expenses/
git commit -m "feat(expenses): detail page — timeline, documents, action bar"
```

---

## Phase F — Add/Edit dialogs (full impl)

### Task 9: Build `add-expense-dialog.tsx` (full) + `edit-expense-dialog.tsx`

**Files:**
- Modify: `apps/erp/src/components/expenses/add-expense-dialog.tsx` (replace stub)
- Modify: `apps/erp/src/components/expenses/edit-expense-dialog.tsx` (replace stub)
- Create: `apps/erp/src/components/expenses/document-upload.tsx`

- [ ] **Step 1: Write `document-upload.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { createClient } from '@repo/supabase/client';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

export interface UploadedFile {
  path: string;
  name: string;
  size: number;
  mime: string;
}

export function DocumentUpload({
  expenseId,
  projectId,
  onUploaded,
}: {
  expenseId?: string;
  projectId?: string | null;
  onUploaded: (f: UploadedFile) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      if (!ALLOWED.includes(file.type)) { setError(`Rejected ${file.name}: type ${file.type}`); continue; }
      if (file.size > MAX_BYTES) { setError(`Rejected ${file.name}: over 5MB`); continue; }
      const scopePath = projectId
        ? `projects/${projectId}/expenses/${expenseId ?? 'pending'}/${file.name}`
        : `expenses/general/${expenseId ?? 'pending'}/${file.name}`;
      const { error: upErr } = await supabase.storage.from('project-files').upload(scopePath, file, { upsert: false });
      if (upErr) { setError(`Upload failed for ${file.name}: ${upErr.message}`); continue; }
      onUploaded({ path: scopePath, name: file.name, size: file.size, mime: file.type });
    }
    setUploading(false);
  }

  return (
    <div>
      <input
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={uploading}
      />
      {uploading && <div className="text-xs text-gray-500 mt-1">Uploading…</div>}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Write full `add-expense-dialog.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui';
import { submitExpense, uploadExpenseDocument } from '@/lib/expenses-actions';
import { DocumentUpload, type UploadedFile } from './document-upload';

interface ProjectOpt { id: string; project_number: string | null; customer_name: string | null }
interface CategoryOpt { id: string; label: string }

const GENERAL_SENTINEL = '__general__';

export function AddExpenseDialog({ projects, categories }: {
  projects: ProjectOpt[];
  categories: CategoryOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [pendingDocs, setPendingDocs] = useState<UploadedFile[]>([]);

  function reset() {
    setProjectId('');
    setCategoryId('');
    setDescription('');
    setAmount('');
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setPendingDocs([]);
    setError(null);
    setSaving(false);
  }

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const isGeneral = projectId === GENERAL_SENTINEL;

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const amt = Number(amount);
    if (!categoryId) { setError('Category is required'); setSaving(false); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setError('Amount must be positive'); setSaving(false); return; }
    if (!description.trim()) { setError('Description is required'); setSaving(false); return; }

    const r = await submitExpense({
      projectId: isGeneral || !projectId ? null : projectId,
      categoryId,
      description,
      amount: amt,
      expenseDate,
    });
    if (!r.success) { setError(r.error); setSaving(false); return; }

    // Persist pending documents against the new expense.
    for (const d of pendingDocs) {
      await uploadExpenseDocument({
        expenseId: r.data.id,
        filePath: d.path,
        fileName: d.name,
        fileSize: d.size,
        mimeType: d.mime,
      });
    }

    setOpen(false);
    router.push(`/expenses/${r.data.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>+ Add Expense</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Submit expense</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select project or General" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={GENERAL_SENTINEL}>— General expense (no project) —</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.project_number ?? p.id.slice(0, 8)} · {p.customer_name ?? ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isGeneral && (
              <p className="text-xs text-blue-600 mt-1">
                General expenses are approved directly by the Founder (no PM verification stage).
              </p>
            )}
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description *</Label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isGeneral ? 'Describe the expense and business purpose (since there is no project context)' : ''}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount ₹ *</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Expense date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Documents</Label>
            <DocumentUpload
              projectId={isGeneral || !projectId ? null : projectId}
              onUploaded={(f) => setPendingDocs((prev) => [...prev, f])}
            />
            <ul className="text-xs text-gray-600 mt-1 space-y-1">
              {pendingDocs.map((d) => <li key={d.path}>📎 {d.name} ({Math.round(d.size / 1024)} KB)</li>)}
            </ul>
            {pendingDocs.length === 0 && (
              <p className="text-xs text-yellow-700 mt-1">
                Warning: no supporting document attached. You can still submit, but PM may reject without a receipt.
              </p>
            )}
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Update `expenses/page.tsx` to pass projects + categories to the dialog**

Modify the page to load active projects and active categories, then pass to `<AddExpenseDialog />`.

```tsx
// Inside ExpensesPage, extend the Promise.all:
const { data: projectsData } = await supabase
  .from('projects')
  .select('id, project_number, customer_name')
  .order('created_at', { ascending: false })
  .limit(500);
const projectOpts = (projectsData ?? []).map((p) => ({
  id: p.id, project_number: p.project_number, customer_name: p.customer_name,
}));

// Replace <AddExpenseDialog /> with:
<AddExpenseDialog projects={projectOpts} categories={categories.map((c) => ({ id: c.id, label: c.label }))} />
```

- [ ] **Step 4: Write full `edit-expense-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui';
import { updateExpense } from '@/lib/expenses-actions';

interface CategoryOpt { id: string; label: string }

export function EditExpenseDialog({
  id,
  initial,
  categories,
}: {
  id: string;
  initial: { description: string | null; amount: number; expense_date: string | null; category_id: string };
  categories: CategoryOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(initial.description ?? '');
  const [amount, setAmount] = useState(String(initial.amount));
  const [expenseDate, setExpenseDate] = useState(initial.expense_date ?? '');
  const [categoryId, setCategoryId] = useState(initial.category_id);

  async function handle() {
    setSaving(true); setError(null);
    const r = await updateExpense(id, {
      description,
      amount: Number(amount),
      expenseDate: expenseDate || undefined,
      categoryId,
    });
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">Edit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit expense</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <textarea className="w-full border rounded p-2 text-sm" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount ₹</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Expense date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handle} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Wire `EditExpenseDialog` into the detail page**

Update `/expenses/[id]/page.tsx` to load active categories and pass `initial` + `categories` props:

```tsx
// Before the return:
const activeCategories = await getActiveCategories();

// In the action bar:
{canEdit && (
  <EditExpenseDialog
    id={expense.id}
    initial={{
      description: expense.description,
      amount: expense.amount,
      expense_date: expense.expense_date,
      category_id: expense.category_id,
    }}
    categories={activeCategories.map((c) => ({ id: c.id, label: c.label }))}
  />
)}
```

- [ ] **Step 6: Preview + smoke test submit + edit**

1. Go to `/expenses`. Click `+ Add Expense`.
2. Pick a project, fill in amount + category + description. Attach a PDF.
3. Submit — should redirect to detail page with timeline and document showing.
4. Click Edit on your submitted row — change amount, save, refresh.
5. Click `+ Add Expense` again, pick "General expense", submit. Detail page should show timeline with no Verified node.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm check-types
git add apps/erp/src/components/expenses/ apps/erp/src/app/\(erp\)/expenses/
git commit -m "feat(expenses): full add + edit dialogs, multi-doc upload"
```

---

## Phase G — Category admin

### Task 10: Build `/expenses/categories` admin page

**Files:**
- Create: `apps/erp/src/app/(erp)/expenses/categories/page.tsx`
- Create: `apps/erp/src/components/expenses/category-admin-table.tsx`
- Create: `apps/erp/src/components/expenses/add-category-dialog.tsx`
- Create: `apps/erp/src/components/expenses/edit-category-dialog.tsx`

- [ ] **Step 1: Write `category-admin-table.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Button, Switch } from '@repo/ui';
import { toggleCategoryActive } from '@/lib/expense-categories-actions';
import { EditCategoryDialog } from './edit-category-dialog';

interface Row { id: string; code: string; label: string; is_active: boolean; sort_order: number }

export function CategoryAdminTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  async function toggle(id: string, next: boolean) {
    await toggleCategoryActive(id, next);
    router.refresh();
  }

  return (
    <table className="w-full text-sm border rounded">
      <thead className="bg-gray-50 text-xs uppercase">
        <tr>
          <th className="px-3 py-2 text-left">Label</th>
          <th className="px-3 py-2 text-left">Code</th>
          <th className="px-3 py-2 text-left">Active</th>
          <th className="px-3 py-2 text-left">Sort</th>
          <th className="px-3 py-2 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="px-3 py-2">{r.label}</td>
            <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
            <td className="px-3 py-2"><Switch checked={r.is_active} onCheckedChange={(v) => toggle(r.id, v)} /></td>
            <td className="px-3 py-2 font-mono text-xs">{r.sort_order}</td>
            <td className="px-3 py-2 text-right"><EditCategoryDialog id={r.id} initial={{ label: r.label, sort_order: r.sort_order }} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

NOTE: Confirm `Switch` export in `@repo/ui`. If absent, add it from shadcn or use a checkbox.

- [ ] **Step 2: Write `add-category-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label } from '@repo/ui';
import { addCategory } from '@/lib/expense-categories-actions';

export function AddCategoryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [sortOrder, setSortOrder] = useState('999');

  async function handle() {
    setSaving(true); setError(null);
    const r = await addCategory({ code, label, sort_order: Number(sortOrder) });
    setSaving(false);
    if (!r.success) { setError(r.error); return; }
    setOpen(false);
    setCode(''); setLabel(''); setSortOrder('999');
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>+ Add category</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add expense category</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Label *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label>Code * (lowercase_snake)</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <Label>Sort order</Label>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handle} disabled={saving}>{saving ? 'Saving…' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write `edit-category-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label } from '@repo/ui';
import { updateCategory } from '@/lib/expense-categories-actions';

export function EditCategoryDialog({ id, initial }: { id: string; initial: { label: string; sort_order: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState(initial.label);
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order));

  async function handle() {
    setSaving(true);
    const r = await updateCategory(id, { label, sort_order: Number(sortOrder) });
    setSaving(false);
    if (!r.success) { alert(r.error); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Edit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit category</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div><Label>Sort order</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handle} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write `expenses/categories/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { listCategories } from '@/lib/expense-categories-queries';
import { CategoryAdminTable } from '@/components/expenses/category-admin-table';
import { AddCategoryDialog } from '@/components/expenses/add-category-dialog';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
  if (!['founder', 'finance'].includes(profile?.role ?? '')) {
    redirect('/expenses');
  }

  const cats = await listCategories({ includeInactive: true });
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Expense categories</h1>
        <AddCategoryDialog />
      </div>
      <CategoryAdminTable
        rows={cats.map((c) => ({ id: c.id, code: c.code, label: c.label, is_active: c.is_active, sort_order: c.sort_order }))}
      />
    </div>
  );
}
```

- [ ] **Step 5: Smoke test + commit**

Open `/expenses/categories` as founder. Verify the 8 seeded rows. Add a new category, edit an existing one, archive one.

```bash
pnpm check-types
git add apps/erp/src/app/\(erp\)/expenses/categories/page.tsx apps/erp/src/components/expenses/
git commit -m "feat(expenses): category admin page (founder + finance)"
```

---

## Phase H — Project Actuals read-only embed

### Task 11: `site-expenses-readonly.tsx` + swap into `step-actuals.tsx`

**Files:**
- Create: `apps/erp/src/components/projects/site-expenses-readonly.tsx`
- Modify: `apps/erp/src/components/projects/stepper-steps/step-actuals.tsx`

- [ ] **Step 1: Write `site-expenses-readonly.tsx`**

```tsx
import Link from 'next/link';
import { getExpensesByProject } from '@/lib/expenses-queries';
import { StatusBadge } from '@/components/expenses/status-badge';
import { formatINR } from '@/lib/utils/format';

/**
 * Read-only embed of /expenses filtered to a single project.
 * General expenses (project_id IS NULL) naturally drop out since the filter
 * is project_id = :id — no extra check needed.
 */
export async function SiteExpensesReadonly({ projectId }: { projectId: string }) {
  const rows = await getExpensesByProject(projectId);

  const subtotal = rows
    .filter((r) => r.status === 'verified' || r.status === 'approved')
    .reduce((acc, r) => acc + Number(r.amount), 0);

  if (rows.length === 0) {
    return <div className="text-sm text-gray-500">No expenses logged for this project yet. Add one from <Link className="text-blue-600 hover:underline" href="/expenses">/expenses</Link>.</div>;
  }

  return (
    <div className="border rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">Voucher</th>
            <th className="px-3 py-2 text-left">Engineer</th>
            <th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-center">Docs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-3 py-2 font-mono">
                <Link href={`/expenses/${r.id}`} className="text-blue-600 hover:underline">{r.voucher_number}</Link>
              </td>
              <td className="px-3 py-2">{r.submitter_name ?? '—'}</td>
              <td className="px-3 py-2">{r.category_label ?? '—'}</td>
              <td className="px-3 py-2 max-w-xs truncate" title={r.description ?? ''}>{r.description ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono">{formatINR(r.amount)}</td>
              <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
              <td className="px-3 py-2 text-center text-xs text-gray-500">{r.document_count > 0 ? `📎${r.document_count}` : ''}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold">
            <td colSpan={4} className="px-3 py-2 text-right">Subtotal (verified + approved):</td>
            <td className="px-3 py-2 text-right font-mono">{formatINR(subtotal)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Swap `VoucherTable` → `SiteExpensesReadonly` in `step-actuals.tsx`**

Read the file. Remove the temporary commented-out import and the TODO placeholder. Replace with:

```tsx
import { SiteExpensesReadonly } from '@/components/projects/site-expenses-readonly';

// ... inside the component:
<section className="...">
  <h3 className="font-semibold mb-2">Site expenses</h3>
  <SiteExpensesReadonly projectId={project.id} />
</section>
```

- [ ] **Step 3: Preview + smoke test**

Open `/projects/[some-id]`. Navigate to Actuals tab. Verify:
- Voucher rows appear with clickable voucher numbers
- Subtotal shows only verified + approved
- No edit / delete / status controls
- Clicking a voucher number navigates to `/expenses/[id]`

- [ ] **Step 4: Commit**

```bash
pnpm check-types
git add apps/erp/src/components/projects/site-expenses-readonly.tsx apps/erp/src/components/projects/stepper-steps/step-actuals.tsx
git commit -m "feat(projects): read-only site-expenses embed on Actuals tab"
```

---

## Phase I — Navigation updates

### Task 12: Update `roles.ts` — rename nav item + add to more roles

**File:** `apps/erp/src/lib/roles.ts`

- [ ] **Step 1: Rename `ITEMS.vouchers` → `ITEMS.expenses`**

```typescript
// Rename the entry in the ITEMS map:
  expenses:       { label: 'Expenses',         href: '/expenses',           icon: 'Receipt' },
// Delete the old entry:
-  vouchers:       { label: 'Voucher Approvals', href: '/vouchers',           icon: 'Receipt' },
```

- [ ] **Step 2: Update every `SECTIONS_BY_ROLE` entry that referenced `ITEMS.vouchers`**

For `founder`, `project_manager`, `finance`: rename the `Approvals` section item from `ITEMS.vouchers` to `ITEMS.expenses`.

For every other role except `customer`, add `ITEMS.expenses` to an appropriate section (typically the same section where `projects` lives, or a new `Expenses` section). Example changes:

- `site_supervisor`: add to `My Work` section → `items: [ITEMS.myReports, ITEMS.myTasks, ITEMS.expenses]`
- `designer`: add to a new section or to `Projects (R/O)` section
- `marketing_manager`: add to `Projects (R/O)` section
- `sales_engineer`: add to `Sales` section
- `purchase_officer`: add to `Procurement` or a new section
- `hr_manager`: add to `People` section
- `om_technician`: add to `O&M` section

Keep `customer`: no expenses link.

- [ ] **Step 3: Preview + typecheck**

Start dev. Log in as each role (use the `?view_as=<role>` query param on `/dashboard` as founder to impersonate). Verify `/expenses` appears in each nav.

```bash
pnpm check-types
git add apps/erp/src/lib/roles.ts
git commit -m "feat(expenses): add /expenses nav item to every active role"
```

---

## Phase J — Docs

### Task 13: Write module doc + update related docs

**Files:**
- Create: `docs/modules/expenses.md`
- Modify: `docs/modules/projects.md`
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Write `docs/modules/expenses.md`**

Use the same structure as `docs/modules/projects.md` — follow the module-doc template. Sections:
1. Overview (what this module does)
2. Workflow (dual state machine)
3. Tables (expenses, expense_categories, expense_documents, employees.voucher_prefix)
4. Key files (actions / queries / routes)
5. Role access matrix (copy from spec §3)
6. Past decisions (link to the original spec + migration NNN)
7. Gotchas (from spec §8)

Keep it concise — no code snippets, just pointers.

- [ ] **Step 2: Update `docs/modules/projects.md`**

In the Actuals section (§7 or similar), replace the VoucherTable description with:

> **Voucher entry** now happens in the standalone `/expenses` module. The Actuals tab embeds a read-only `SiteExpensesReadonly` view filtered to the project. To submit a voucher, go to `/expenses` → `+ Add Expense` and select this project.

- [ ] **Step 3: Update `docs/CURRENT_STATUS.md`**

Remove the expense-module "In flight" row (if present) and add to "This week shipped" or the equivalent:

```markdown
| **Expenses Module** | Claude | ✅ Shipped 2026-04-XX | Standalone /expenses module; dual workflow (project-linked 3-stage + general 2-stage); per-submitter voucher numbers; category master + CRUD; Project Actuals read-only embed. Migration <NNN>. |
```

Update the migration table: `Dev` latest = `<NNN>`; `Prod pending` range = `013 through <NNN>`.

- [ ] **Step 4: Update `docs/CHANGELOG.md`**

Add one line at the top of the current week:

```markdown
- **2026-04-XX** — Expenses module shipped: standalone /expenses, dual state machine (project-linked + general), per-submitter voucher numbering, category master. Migration <NNN>.
```

- [ ] **Step 5: Commit docs**

```bash
git add docs/modules/expenses.md docs/modules/projects.md docs/CURRENT_STATUS.md docs/CHANGELOG.md
git commit -m "docs(expenses): module doc + projects Actuals note + status + changelog"
```

---

## Phase K — Final verification

### Task 14: End-to-end smoke test

- [ ] **Step 1: Type + lint + discipline gate**

```bash
cd C:/Users/vivek/Projects/shiroi-erp
pnpm check-types
pnpm lint
bash scripts/ci/check-forbidden-patterns.sh
```

Expected: all three pass.

- [ ] **Step 2: Preview the full flow**

Start the dev server (`preview_start`) and walk through:

1. **Founder journey:**
   - `/expenses` → filter by scope=general → submit a marketing expense (general)
   - Approve it directly from the detail page
   - Submit a project-linked expense → verify → approve
   - Reject a submitted expense with reason
   - Revert the rejected one back to submitted
   - Toggle a category inactive on `/expenses/categories`

2. **Site supervisor journey (use `view_as=site_supervisor`):**
   - Sidebar shows `Expenses`
   - `/expenses` list shows only own rows
   - Submit a voucher for a project
   - No Verify / Approve buttons visible on detail page

3. **Designer journey (use `view_as=designer`):**
   - Sidebar shows `Expenses`
   - Submit a general expense (site visit reimbursement)
   - Check the timeline — no Verified node

4. **PM journey (use `view_as=project_manager`):**
   - Sidebar shows `Expenses`
   - See all project-linked submitted vouchers
   - Verify one → moves to verified
   - Cannot verify a general expense (Verify button not visible; direct server-action call blocked by guard)

5. **Project Actuals embed:**
   - Open a project detail → Actuals tab → voucher list renders read-only with correct subtotal

- [ ] **Step 3: Data integrity spot-check (SQL)**

Run in the Supabase SQL editor:

```sql
SELECT DISTINCT status FROM expenses;
SELECT voucher_number FROM expenses WHERE voucher_number IS NULL OR voucher_number = '';
SELECT voucher_prefix, COUNT(*) FROM employees WHERE is_active GROUP BY voucher_prefix HAVING COUNT(*) > 1;
SELECT COUNT(*) FROM expenses WHERE project_id IS NOT NULL AND verified_by IS NULL AND status = 'verified';
SELECT COUNT(*) FROM expenses WHERE project_id IS NULL AND verified_by IS NOT NULL;  -- must be 0 (CHECK constraint)
```

Expected: 4 statuses, 0 NULLs, 0 dupes, 0 bad-verified rows, 0 general-with-verified.

- [ ] **Step 4: Final commit (if any last-minute tweaks)**

If anything was adjusted during smoke testing, commit with:

```bash
git add -A
git commit -m "fix(expenses): <concise description of the fix>"
```

Otherwise skip this step.

- [ ] **Step 5: Push to main**

**Only after Vivek reviews the work.** Do NOT push unprompted. When ready:

```bash
git push origin main
```

---

## Self-Review (completed before handoff)

1. **Spec coverage** — every spec section has a task:
   - §2 scope → Task 1 (migration covers nullable project_id, dual workflow), Task 7 (scope chips)
   - §3 roles → Task 12 (nav) + RLS in Task 1 Section 10
   - §4 data model → Task 1 Sections 1–8, Section 13, Section 14
   - §5 workflow → Task 5 (actions enforce state machine) + Task 1 Section 5 CHECKs
   - §6 screens → Tasks 7 (list), 8 (detail), 9 (dialogs), 10 (categories), 11 (Actuals embed)
   - §7.1 migration steps → Task 1
   - §7.2 code delivery → Tasks 2–12
   - §7.3 docs → Task 13
   - §7.4 verification → Task 14

2. **Placeholder scan** — no TBDs or vague "add error handling" directives. NOTE comments point out confirmations Sonnet should do (column names, UI export availability) — these are explicit validation tasks, not unknowns.

3. **Type consistency** — `ExpenseListRow`, `ExpenseStatus`, `UploadedFile` used consistently across queries, actions, and components. `submitExpense` returns `{ id, voucherNumber }` consistently.

4. **Scope** — Single coherent module with related auxiliary (projects.project_type, +New Project, read-only embed). No drift into unrelated refactoring.
