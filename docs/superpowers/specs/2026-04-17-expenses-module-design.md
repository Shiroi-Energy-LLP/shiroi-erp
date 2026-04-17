# Expenses Module — Design Spec

**Date:** 2026-04-17
**Status:** Design approved, pending implementation plan
**Ships with:** migration 062
**Author:** Vivek (brainstormed with Claude)

---

## 1. Problem

Today, voucher-level site expenses are entered and approved inside each individual project's Actuals tab (`/projects/[id]` → stepper step 7). Every project has its own `VoucherTable` with inline submit/approve/reject controls. This has four problems:

1. **Cross-project visibility is poor.** A site supervisor working across three projects has to click into each project detail page to find their own vouchers. Finance has no single "all expenses" view.
2. **Voucher numbering is inconsistent.** The existing `voucher_no TEXT` column is nullable, not unique, and manually entered — so collisions, typos, and gaps are common.
3. **Workflow is too shallow.** Today's 2-stage flow (`pending → approved/rejected`) skips the Project Manager's verification step, so the founder is the only reviewer. Manivel has asked for an explicit "Verified by PM" stage between submission and founder approval.
4. **Categories are hardcoded.** The 8-value CHECK constraint means new categories require a migration. Admin can't add / archive categories without engineering involvement.

The fix is a standalone **Expenses** module with its own navigation entry, 3-stage workflow, per-engineer auto-generated voucher numbers, and a central category master. Project Actuals becomes a read-only embed that auto-pulls from this module filtered by project.

## 2. Scope

### In scope

- New top-level `/expenses` module with list + detail + add/edit dialog
- Central `expense_categories` table with admin CRUD at `/expenses/categories`
- Per-engineer auto-generated voucher numbers (e.g., `MAN-001`, `MAN-002`)
- 3-stage workflow: `submitted → verified → approved` (+ `rejected`)
- Multi-document attachment per expense
- Role-based permission matrix (submit / edit own / verify / approve / delete)
- Read-only "Site Expenses" embed on Project Actuals, filtered by project
- `+ New Project` button on `/projects` list page for Project Manager + Founder
- Data migration: rename `project_site_expenses → expenses`, retro-backfill voucher numbers, migrate status values

### Out of scope

- Email / in-app notifications on status change (future scope)
- Expense budgets per category or per project
- Mobile app parity
- OCR for receipt auto-entry
- Expense export to Zoho Books (handled separately by the Zoho import track)

## 3. Users & roles

Only two roles submit expenses: `site_supervisor` and `project_manager`. **Founder does not submit their own expenses through this module** — if Vivek needs reimbursement, Manivel submits on his behalf (cleaner audit trail and a single chain of custody). The voucher-numbering series is keyed by whoever submits — Manivel (PM) submits into his own `MAN-###` series; each site supervisor has their own series.

| Action | `site_supervisor` | `project_manager` | `founder` | `finance` | Others |
|---|:---:|:---:|:---:|:---:|:---:|
| Submit new expense | ✅ | ✅ | ❌ | ❌ | ❌ |
| View own expenses | ✅ | ✅ (all) | ✅ (all, read-only submit) | ✅ (all, read-only) | ❌ |
| Edit own `submitted` expense | ✅ | ✅ | — | — | ❌ |
| Delete own `submitted` expense | ✅ | ✅ | — | — | ❌ |
| Edit any `submitted` expense | ❌ | ✅ | ✅ | ❌ | ❌ |
| Edit any expense (all statuses) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Delete any expense | ❌ | ❌ | ✅ | ❌ | ❌ |
| Mark `submitted → verified` | ❌ | ✅ | ✅ | ❌ | ❌ |
| Mark `submitted/verified → rejected` | ❌ | ✅ (from `submitted`) | ✅ | ❌ | ❌ |
| Mark `verified → approved` | ❌ | ❌ | ✅ | ❌ | ❌ |
| Reverse `approved → verified` (audit) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Manage categories (`/expenses/categories`) | ❌ | ❌ | ✅ | ✅ | ❌ |
| Add new project (`+ New Project` button) | ❌ | ✅ | ✅ | ❌ | ❌ |

`finance` sees all expenses read-only (they show up in profitability reports) and manages the category master. They do not submit, verify, or approve — that's strictly Engineer / PM / Founder.

## 4. Data model

### 4.1 New table — `expense_categories`

```sql
CREATE TABLE expense_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,  -- machine key: 'travel', 'site_material'
  label       TEXT NOT NULL,         -- display: 'Travel', 'Site Material'
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seed with the current 8 categories (`travel`, `food`, `lodging`, `site_material`, `tools`, `consumables`, `labour_advance`, `miscellaneous`). `code` is **immutable after creation** (because it's referenced from legacy / external systems). `is_active = false` soft-archives a category without breaking FK links from historical `expenses.category_id` rows.

### 4.2 New table — `expense_documents`

```sql
CREATE TABLE expense_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  file_name    TEXT,
  file_size    BIGINT,
  mime_type    TEXT,
  uploaded_by  UUID REFERENCES employees(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_expense_documents_expense ON expense_documents(expense_id);
```

Files live in the existing `project-files` Storage bucket under the path `expenses/{expense_id}/{original_filename}`. Allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`. Size limit: 5 MB per file, enforced client-side and via bucket policy.

### 4.3 Renamed + extended — `project_site_expenses → expenses`

The rename is justified because the module is now standalone and not a child of projects. The `project_id` FK stays (an expense is still against one project — this module is cross-project, not project-agnostic).

Changes to the existing table:

- `status` CHECK rebuilt: `'submitted' | 'verified' | 'approved' | 'rejected'`
- `voucher_number TEXT NOT NULL UNIQUE` (retro-backfilled; see §4.5)
- Add `verified_by UUID REFERENCES employees(id)`, `verified_at TIMESTAMPTZ`
- Add `rejected_by UUID REFERENCES employees(id)`, `rejected_at TIMESTAMPTZ`
- Add `category_id UUID NOT NULL REFERENCES expense_categories(id)`
- Drop `expense_category` (replaced by `category_id`)
- Drop `receipt_file_path` (migrated to `expense_documents`)
- Drop `employee_name` (unused; we have `submitted_by` → `employees.full_name`)
- Drop `notes` (unused per code audit)
- Keep: `id`, `project_id`, `description`, `amount`, `expense_date`, `status`, `submitted_by/at`, `approved_by/at`, `rejected_reason`, `created_at`, `updated_at`

### 4.4 Extended — `employees`

Add `voucher_prefix TEXT` column.

- Auto-derived on INSERT via a trigger: `UPPER(LEFT(REGEXP_REPLACE(full_name, '[^A-Za-z]', '', 'g'), 3))`
- Unique among active employees: `CREATE UNIQUE INDEX idx_employees_voucher_prefix_active ON employees(voucher_prefix) WHERE is_active = TRUE`
- On collision (two active employees both resolve to the same 3-letter prefix): the trigger **raises an exception**. Admin must enter a unique override in the employee form (e.g. `MAN` vs `MNV` for Manivel vs Manish).
- Deactivating an employee (`is_active = FALSE`) frees the prefix for reuse.

### 4.5 Voucher number generation

Function called by a `BEFORE INSERT` trigger on `expenses`:

```sql
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

  -- advisory lock per-prefix: concurrent submissions from same engineer serialize
  PERFORM pg_advisory_xact_lock(hashtext('voucher_seq:' || v_prefix));

  SELECT COALESCE(MAX(
    CAST(REGEXP_REPLACE(voucher_number, '^[A-Z]+-', '') AS INT)
  ), 0) + 1
  INTO v_next_seq
  FROM expenses
  WHERE submitted_by = p_employee_id;

  RETURN v_prefix || '-' || LPAD(v_next_seq::TEXT, 3, '0');
END;
$$;
```

Format: `{PREFIX}-{NNN}`, zero-padded to 3 digits. Rolls over to 4+ digits after 999 (`MAN-1000`). Sequence is **per-employee, never resets, monotonically increasing** across all projects.

**Retro backfill** for existing rows (one-time in migration 062):

```sql
WITH numbered AS (
  SELECT
    ex.id,
    UPPER(LEFT(REGEXP_REPLACE(e.full_name, '[^A-Za-z]', '', 'g'), 3)) || '-' ||
      LPAD(
        (ROW_NUMBER() OVER (PARTITION BY submitted_by ORDER BY submitted_at, ex.id))::TEXT,
        3, '0'
      ) AS vn
  FROM expenses ex
  JOIN employees e ON e.id = ex.submitted_by
  WHERE ex.voucher_number IS NULL
)
UPDATE expenses ex
SET voucher_number = numbered.vn
FROM numbered
WHERE ex.id = numbered.id;
```

### 4.6 Indexes (added in migration 062)

```sql
CREATE UNIQUE INDEX idx_expenses_voucher_number ON expenses(voucher_number);
CREATE INDEX idx_expenses_project ON expenses(project_id);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_submitted_by ON expenses(submitted_by);
CREATE INDEX idx_expenses_expense_date ON expenses(expense_date DESC);
CREATE INDEX idx_expense_documents_expense ON expense_documents(expense_id);
CREATE UNIQUE INDEX idx_employees_voucher_prefix_active
  ON employees(voucher_prefix) WHERE is_active = TRUE;
```

### 4.7 Extended — `projects` (for `+ New Project` feature)

Add `project_type TEXT CHECK (project_type IN ('sales', 'internal')) DEFAULT 'sales'` column. Backfill all existing rows to `'sales'`. `sales` projects are born from a won sales lead (existing trigger-driven flow). `internal` projects are manually created via the new `+ New Project` dialog for non-customer-facing work (warehouse repairs, marketing events, internal tooling). The type is informational for now — no behavior branches on it yet.

### 4.8 RLS policies (rewrite in migration 062)

| Operation | Policy |
|---|---|
| `SELECT` | `site_supervisor` → only rows where `submitted_by = self.employee_id`; `project_manager` + `founder` + `finance` → all rows |
| `INSERT` | `site_supervisor` + `project_manager` only; `submitted_by = self` enforced |
| `UPDATE` (general fields — description / amount / category / date) | submitter while `status = 'submitted'`; or `project_manager` / `founder` while `status = 'submitted'`; or `founder` at any status |
| `UPDATE` (status transitions) | enforced via server action guards + trigger: `submitted → verified` by PM/founder, `verified → approved` by founder, `* → rejected` by PM (from `submitted` only) or founder (from `submitted`/`verified`) |
| `DELETE` | submitter while `status = 'submitted'`; or founder at any status |

`expense_categories` RLS: `SELECT` open to all authenticated roles; `INSERT/UPDATE` for `founder` + `finance`.

`expense_documents` RLS: follows `expenses` — if user can SELECT the parent expense, they can SELECT its documents. INSERT gated to the submitter and PM/founder. DELETE gated to founder only.

## 5. Status workflow

### 5.1 State machine

```
        submitted ──PM/Founder "Verify"──▶ verified ──Founder "Approve"──▶ approved
            │                                 │
            └── PM/Founder "Reject" ──────────┴──▶ rejected (terminal unless Founder reverses)
```

- `submitted` (yellow badge) — default on INSERT
- `verified` (blue badge) — PM or Founder promotes; DB check: previous status must be `submitted`
- `approved` (green badge) — Founder only; DB check: previous status must be `verified` (no skip-verify shortcut)
- `rejected` (red badge) — PM (from `submitted` only) or Founder (from `submitted` or `verified`); `rejected_reason` required
- Founder can force any transition for audit correction (including `approved → verified` or `rejected → submitted`)

### 5.2 Edit / delete gates

- Submitter can edit/delete own row **only while `status = 'submitted'`**
- PM can edit/delete any `submitted` row
- Founder can edit/delete any row at any status
- Once `verified`, the row is locked for non-founder users (mirrors `actuals_locked` semantics)

### 5.3 Rejected → retry

Submitter can't unreject their own row. To retry, they create a **new** expense (new voucher number — the rejected number is not reused). The rejected row stays as a historical record. Founder can manually reverse a rejection via the "Revert" action if the rejection was made in error.

## 6. Screens

### 6.1 `/expenses` — list page

**Header:** "Expenses" title + eyebrow "SITE EXPENSES" + `+ Add Expense` button (visible to `site_supervisor` + `project_manager` only — founder does not submit).

**KPI strip** (4 cards):
1. Total Vouchers (count)
2. Submitted (count, pending verification)
3. Pending Verification ₹ (sum of `amount` where `status = 'submitted'`)
4. Approved This Month ₹ (sum of `amount` where `status = 'approved' AND DATE_TRUNC('month', approved_at) = current month`)

**Filter bar** (reuses `FilterBar` + `FilterSelect` + `SearchInput` + `ProjectFilterCombobox`):
- Search (matches on `voucher_number`, `projects.project_number`, `projects.customer_name`, `employees.full_name`, `description`)
- Project combobox (from existing `/components/om/project-filter-combobox.tsx`)
- Engineer dropdown (all active `site_supervisor` + `project_manager` employees)
- Category dropdown (active categories)
- Status chips: All / Submitted / Verified / Approved / Rejected
- Date range (expense_date from / to)

**Table columns:** `Voucher No` (mono) · `Project` (project_number + customer_name) · `Engineer` · `Category` · `Description` (truncated) · `Amount ₹` (right, mono) · `Status` (badge) · `📎N` (document count) · `Actions` (View / Edit / Delete icons — role-gated).

Row click → `/expenses/[id]`. Clickable column headers for sort. Pagination: 25 rows/page.

Empty state: `Receipt` lucide icon + "No expenses yet" + submit CTA.

### 6.2 `/expenses/[id]` — detail page

- **Top band:** voucher number (mono, large) · status badge · amount ₹ (large, mono)
- **Info card:** project (linked) · engineer · category · description (multi-line) · expense date
- **Status timeline** (vertical): 3 nodes
  - Submitted: `submitted_by` (name) + `submitted_at` (IST)
  - Verified: `verified_by` + `verified_at`, or dim grey if not yet verified
  - Approved: `approved_by` + `approved_at`, or dim grey if not yet approved
  - If rejected: 4th red node with `rejected_by`, `rejected_at`, `rejected_reason`
- **Documents card:** list of `expense_documents` with inline image thumbnails (PNG/JPG) or PDF icon + filename + size; each has Preview / Download links
- **Action bar** (bottom, role + status gated):
  - Submitter + `status = 'submitted'`: `[Edit]` `[Delete]`
  - PM + `status = 'submitted'`: `[Verify]` `[Reject]` `[Edit]` `[Delete]`
  - Founder + `status = 'submitted'`: `[Verify]` `[Reject]` `[Edit]` `[Delete]`
  - Founder + `status = 'verified'`: `[Approve]` `[Reject]`
  - Founder + `status = 'approved'`: `[Revert to Verified]`
  - Founder + `status = 'rejected'`: `[Revert to Submitted]`
- Back link → `/expenses`

### 6.3 Add / Edit expense dialog

Reuses the shadcn `Dialog` pattern. Fields:

- **Project** — combobox (searchable, active projects only). Reuses `components/om/project-filter-combobox.tsx`.
- **Voucher No** — greyed-out input, placeholder `"auto-generated on save ({PREFIX}-###)"`. Read-only.
- **Engineer** — greyed-out, auto-filled from `auth.uid() → employees.full_name`.
- **Category** — dropdown from `expense_categories WHERE is_active = TRUE`, ordered by `sort_order`.
- **Description** — `<textarea>`, unbounded.
- **Amount ₹** — numeric input, 2-decimal, `decimal.js` on client, `NUMERIC(14,2)` in SQL.
- **Documents** — drag-drop zone (reuses existing file-upload pattern from QC). Multi-file. Accepts `.pdf / .jpg / .jpeg / .png`. Size limit 5 MB per file. Shows uploaded list with remove buttons.
- **Warning banner** — yellow, shown if no document attached: `"Warning: no supporting document attached. You can still submit, but PM may reject without a receipt."` Submit is allowed (soft-warn per spec).

On submit: calls server action `submitExpense(...)` which inserts the row (trigger generates voucher number) then uploads documents to storage and inserts `expense_documents` rows. Dialog closes, list revalidates.

Dialog resets state on close (matches the pattern from recent plant-monitoring fix: `showPassword + saving` reset — see commit 6f68753).

### 6.4 `/expenses/categories` — admin-only

Simple table: `Label` · `Code` · `Active` (toggle switch) · `Sort Order` · `Edit icon`. `+ Add Category` button opens a dialog with `label` + `code` + `sort_order`.

- `code` is immutable after creation (FK integrity to `expenses.category_id` via lookup key).
- Archiving = setting `is_active = FALSE`. Historical expenses with that `category_id` still render correctly; the category just no longer appears in the Add-Expense dropdown.
- Label and sort_order are editable.

Visible to `founder` + `finance` only.

### 6.5 `+ New Project` dialog on `/projects`

Button on the `/projects` list page, top-right. Visible to `project_manager` + `founder` only.

Fields:
- Project Name (required)
- Customer Name (required, free text)
- PM (dropdown of active PMs; default = self)
- System Size kWp (optional, numeric)
- Project Type radio: `sales` (default) or `internal` (internal projects are non-customer-facing: warehouse, tooling, marketing events)

Creates a row in `projects` with `status = 'yet_to_start'`, `primary_contact_id = NULL`, no `lead_id` / `proposal_id` linkage, no contracted value. On success, redirects to `/projects/[id]` Details tab for Manivel to fill in the rest.

**Note:** `projects.project_type` is a new column (`TEXT CHECK (project_type IN ('sales', 'internal'))`, default `'sales'`). Migration 062 adds this column and backfills all existing rows to `'sales'`. The type filter is not exposed on the Projects list yet (future enhancement).

### 6.6 Project Actuals read-only embed

In `apps/erp/src/components/projects/stepper-steps/step-actuals.tsx`, replace the existing editable `VoucherTable` with a new `SiteExpensesReadonly` component.

Columns: `Voucher No` (link to `/expenses/[id]`) · `Engineer` · `Category` · `Description` (truncated) · `Amount ₹` (right, mono) · `Status` (badge) · `📎N` (link to first document).

Footer row: **Subtotal** across visible rows + toggle `"Include submitted/rejected in subtotal"` (default OFF — subtotal includes only `verified + approved` by default, matching the spec's "Only Approved or Verified amounts may optionally be included").

No edit / delete / status controls. BOQ margin calculation is unchanged (it already reads the aggregate; just from the renamed table).

## 7. Delivery plan

### 7.1 SQL migration — `062_expenses_module.sql`

Single atomic migration, sectioned with banner comments. Ordered steps:

1. `CREATE TABLE expense_categories` + seed 8 current categories
2. `ALTER TABLE employees ADD voucher_prefix` + backfill from `full_name` + unique partial index + `BEFORE INSERT/UPDATE` trigger for auto-derive
3. `ALTER TABLE project_site_expenses RENAME TO expenses`
4. Drop old `status` CHECK, add new 4-value CHECK; migrate `pending → submitted`, `auto_approved → approved`, keep `approved` and `rejected`
5. Add `verified_by/at`, `rejected_by/at`, `category_id` columns; backfill `category_id` from the old text `expense_category`
6. Drop old columns: `expense_category`, `employee_name`, `notes`
7. `CREATE TABLE expense_documents` + migrate existing `receipt_file_path` rows into it; drop the `receipt_file_path` column
8. Retro-backfill `voucher_number` via window function
9. `voucher_number` → `NOT NULL + UNIQUE`
10. `CREATE FUNCTION generate_voucher_number()` + `BEFORE INSERT` trigger on `expenses` (advisory-lock based)
11. Rewrite RLS: SELECT / INSERT / UPDATE / DELETE policies per role
12. Add indexes (§4.6)
13. Grant RLS policies for `expense_categories` + `expense_documents` tables
14. `ALTER TABLE projects ADD COLUMN project_type TEXT CHECK (project_type IN ('sales', 'internal')) DEFAULT 'sales'` + backfill `'sales'`

After migration applies cleanly on dev, regenerate `packages/types/database.ts`.

### 7.2 Code delivery

Ordered by dependency. Paths relative to repo root.

**New lib files:**
- `apps/erp/src/lib/expenses-actions.ts` — `submitExpense`, `updateExpense`, `verifyExpense`, `approveExpense`, `rejectExpense`, `deleteExpense`, `revertExpense`, `uploadExpenseDocument`, `deleteExpenseDocument`. All return `ActionResult<T>` per NEVER-DO rule #19.
- `apps/erp/src/lib/expenses-queries.ts` — `listExpenses` (with filters + pagination), `getExpense`, `getExpensesByProject`, `getExpenseKPIs`.
- `apps/erp/src/lib/expense-categories-actions.ts` — `addCategory`, `updateCategory`, `toggleCategoryActive`.
- `apps/erp/src/lib/projects-actions.ts` — add `createProject` server action (for `+ New Project` dialog). If the file doesn't exist yet, create it.

**New route tree:**
- `apps/erp/src/app/(erp)/expenses/page.tsx` — list with filters, KPIs, table, pagination
- `apps/erp/src/app/(erp)/expenses/[id]/page.tsx` — detail view
- `apps/erp/src/app/(erp)/expenses/categories/page.tsx` — admin category master
- `apps/erp/src/app/(erp)/vouchers/page.tsx` — convert to a redirect: `redirect('/expenses?status=submitted')`

**New components:**
- `apps/erp/src/components/expenses/add-expense-dialog.tsx`
- `apps/erp/src/components/expenses/edit-expense-dialog.tsx`
- `apps/erp/src/components/expenses/expense-table.tsx`
- `apps/erp/src/components/expenses/status-badge.tsx`
- `apps/erp/src/components/expenses/status-timeline.tsx`
- `apps/erp/src/components/expenses/documents-list.tsx`
- `apps/erp/src/components/expenses/verify-button.tsx`
- `apps/erp/src/components/expenses/approve-button.tsx`
- `apps/erp/src/components/expenses/reject-dialog.tsx`
- `apps/erp/src/components/expenses/revert-button.tsx`
- `apps/erp/src/components/expenses/delete-expense-button.tsx`
- `apps/erp/src/components/expenses/category-admin-table.tsx`
- `apps/erp/src/components/expenses/add-category-dialog.tsx`
- `apps/erp/src/components/projects/new-project-dialog.tsx`
- `apps/erp/src/components/projects/site-expenses-readonly.tsx` (the Actuals-step embed)

**Modify existing:**
- `apps/erp/src/components/projects/stepper-steps/step-actuals.tsx` — swap `VoucherTable` for `SiteExpensesReadonly`
- `apps/erp/src/app/(erp)/projects/page.tsx` — add `+ New Project` button (role-gated)
- `apps/erp/src/lib/roles.ts` — rename `vouchers` item → `expenses` (label: "Expenses", href: `/expenses`, icon: `Receipt`); add to `site_supervisor` sections; update `founder`, `project_manager`, `finance` sections

**Delete (at end, once verified unused):**
- `apps/erp/src/lib/site-expenses-actions.ts` — superseded by `expenses-actions.ts`
- `apps/erp/src/components/projects/forms/site-expense-form.tsx` — write-capable form no longer used in read-only Actuals
- `apps/erp/src/components/projects/forms/voucher-table-controls.tsx`
- `apps/erp/src/components/vouchers/voucher-actions.tsx`

### 7.3 Doc updates

- `docs/modules/expenses.md` — **new module doc** (overview, workflow, tables, screens, role matrix, gotchas, past decisions, role access summary)
- `docs/modules/projects.md` — update Actuals section (§7) to describe the read-only embed; add a note that voucher entry now happens in `/expenses`
- `docs/CURRENT_STATUS.md` — add row to "In flight this week" while building; remove when shipped
- `docs/CHANGELOG.md` — one line on ship

`CLAUDE.md` does not change — module-specific details belong in the module doc, not the root brief.

### 7.4 Verification

Pre-commit:
- `pnpm check-types` — 0 errors
- `pnpm lint` — 0 warnings across lintable packages
- `scripts/ci/check-forbidden-patterns.sh` — baseline not regressed

Manual smoke test (via `preview_start`):
1. Submit as `site_supervisor` → voucher number auto-generates as `{PREFIX}-001`
2. Verify the row as `project_manager` → status → `verified`, PM's name + timestamp on the timeline
3. Approve as `founder` → status → `approved`
4. Reject flow: submit → PM rejects with reason → row shows red rejected node with reason
5. Retry after reject: create new expense → gets the next sequence number in the series (not the rejected one)
6. Multi-doc upload: attach 3 PDFs to an expense, verify all visible on detail page
7. Role gate: `site_supervisor` sees only their own expenses in the list
8. Role gate: `site_supervisor` cannot see Verify / Approve buttons even via direct URL
9. Concurrency: two simultaneous submissions from the same engineer produce two distinct, consecutive voucher numbers (no collision)
10. Project Actuals page shows the read-only embed, filtered by `project_id`, with subtotal at the bottom
11. `+ New Project` dialog creates a `yet_to_start` project, redirects to detail
12. Employee form with a colliding `voucher_prefix` raises a clear error message

Data integrity check post-migration:
```sql
-- should return 0 rows
SELECT voucher_number, COUNT(*) FROM expenses GROUP BY voucher_number HAVING COUNT(*) > 1;

-- should return 0 rows
SELECT voucher_prefix, COUNT(*) FROM employees
WHERE is_active = TRUE AND voucher_prefix IS NOT NULL
GROUP BY voucher_prefix HAVING COUNT(*) > 1;

-- all expenses should have a category
SELECT COUNT(*) FROM expenses WHERE category_id IS NULL;

-- status values should only be the new 4
SELECT DISTINCT status FROM expenses;
```

## 8. Risks & gotchas

1. **Storage RLS for documents.** `expense_documents` paths live in the `project-files` bucket. Per `docs/modules/projects.md` gotcha #2, drag-drop operations are UPDATE on `storage.objects` and need an UPDATE policy. The bucket already has this policy (from migration 047), so nothing new — but the migration must NOT accidentally narrow it.
2. **Voucher prefix collision on employee import.** If two existing employees resolve to the same prefix during backfill, the unique index will reject the second row. The migration must catch this and fail loudly with a clear error message listing the colliding full names. Admin then updates the column for one of them before re-running.
3. **Legacy voucher rows without `submitted_by`.** Historical rows may have `submitted_by = NULL` (the column was nullable pre-migration-033). The retro-backfill must handle this: NULL-submitter rows get voucher_number `UNASSIGNED-###` (an explicit sentinel prefix) and are flagged in an admin-review list. Migration fails loudly if any exist and the admin hasn't assigned them.
4. **Prod migration window.** This is migration 062 on top of the already-deferred batch 013–061. It ships in the same prod-deploy window after employee testing week, not separately.
5. **Voucher prefix uniqueness is scoped to active employees.** Deactivating an employee frees their prefix. Intentional, but documented.
6. **Deleting old code.** The `/vouchers` page, `site-expenses-actions.ts`, `site-expense-form.tsx`, `voucher-table-controls.tsx` must be fully removed — no legacy write paths remaining. CI's forbidden-patterns check plus a manual grep for `project_site_expenses` (old name) ensures nothing references the deleted table name.
7. **Type regeneration must be in the same commit.** Per NEVER-DO rule #20: regenerate `packages/types/database.ts` immediately after the migration applies on dev, in the same commit.
8. **`decimal.js` for amounts on the client.** NEVER-DO rule #5 — no float math on `amount`. All KPI aggregations go through SQL RPCs (per NEVER-DO rule #12), not JavaScript `.reduce()`.

## 9. Past decisions referenced

- Migration 010 — original `project_site_expenses` table
- Migration 033 — voucher workflow fields (status, submitted_by/at, approved_by/at, rejected_reason, receipt_file_path)
- Migration 034 — `estimated_site_expenses_budget` (the BOI baseline for variance calc)
- Migration 038 — `actuals_locked` mechanism (the locked-in pattern we're mirroring for `verified`)
- Migration 051 — `marketing_manager` role added to `app_role` enum
- `docs/superpowers/specs/2026-04-17-docs-restructure-design.md` — the restructure this spec lives alongside
- `docs/modules/projects.md` §7 — Actuals step that we're stripping to read-only
