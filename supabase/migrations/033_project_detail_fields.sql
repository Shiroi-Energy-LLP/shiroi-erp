-- ====================================================================
-- Migration 033 — Project detail fields + vouchers
--
-- Goals (per project details page overhaul spec):
--   1. Add the editable fields the new details page needs that the
--      projects table doesn't have today:
--        - scope_la, scope_civil, scope_meter (shiroi | client)
--        - cable_brand, cable_model
--        - billing_address, location_map_link
--        - order_date (rename of UI label "planned_start" in the box,
--          but stored separately so we don't lose project planning
--          dates)
--        - primary_contact_id (FK to contacts for the contact picker
--          in the Customer Information box)
--   2. Extend project_site_expenses with voucher fields so PMs can
--      approve/reject site expense vouchers (travel etc.) from a
--      consolidated queue.
--   3. Index site_expenses for the approval queue page.
--
-- Idempotent: every ALTER uses IF NOT EXISTS, indexes use IF NOT EXISTS.
-- Safe to re-run.
-- ====================================================================

-- ── 1. projects: new editable fields ────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS scope_la TEXT
    CHECK (scope_la IS NULL OR scope_la IN ('shiroi', 'client')),
  ADD COLUMN IF NOT EXISTS scope_civil TEXT
    CHECK (scope_civil IS NULL OR scope_civil IN ('shiroi', 'client')),
  ADD COLUMN IF NOT EXISTS scope_meter TEXT
    CHECK (scope_meter IS NULL OR scope_meter IN ('shiroi', 'client')),
  ADD COLUMN IF NOT EXISTS cable_brand TEXT,
  ADD COLUMN IF NOT EXISTS cable_model TEXT,
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS location_map_link TEXT,
  ADD COLUMN IF NOT EXISTS order_date DATE,
  ADD COLUMN IF NOT EXISTS primary_contact_id UUID;

-- FK for primary_contact_id (guarded — only add if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_primary_contact_id_fkey'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_primary_contact_id_fkey
      FOREIGN KEY (primary_contact_id)
      REFERENCES contacts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN projects.scope_la IS 'Scope of Lightning Arrestor: shiroi | client';
COMMENT ON COLUMN projects.scope_civil IS 'Scope of Civil Work: shiroi | client';
COMMENT ON COLUMN projects.scope_meter IS 'Scope of Net Meter installation: shiroi | client';
COMMENT ON COLUMN projects.cable_brand IS 'Primary cable brand (mirrors BOM)';
COMMENT ON COLUMN projects.cable_model IS 'Primary cable model';
COMMENT ON COLUMN projects.billing_address IS 'Billing address (may differ from site address)';
COMMENT ON COLUMN projects.location_map_link IS 'Google Maps URL for the site';
COMMENT ON COLUMN projects.order_date IS 'Date the order was received (shown in Timeline box)';
COMMENT ON COLUMN projects.primary_contact_id IS 'FK to contacts — the primary customer contact shown on the detail page';

-- Backfill order_date from planned_start_date → created_at
UPDATE projects
SET order_date = COALESCE(planned_start_date, created_at::date)
WHERE order_date IS NULL;

-- ── 2. project_site_expenses: voucher workflow fields ───────────────
--
-- project_site_expenses was created in migration 010. Extend it with
-- the fields the voucher approval queue needs. Existing rows get
-- status='auto_approved' so they aren't held up by the new workflow.

ALTER TABLE project_site_expenses
  ADD COLUMN IF NOT EXISTS voucher_number TEXT,
  ADD COLUMN IF NOT EXISTS expense_category TEXT
    CHECK (expense_category IS NULL OR expense_category IN (
      'travel', 'food', 'lodging', 'site_material', 'tools',
      'consumables', 'labour_advance', 'miscellaneous'
    )),
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'auto_approved')),
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS receipt_file_path TEXT;

COMMENT ON COLUMN project_site_expenses.voucher_number IS 'Voucher reference (manual entry, no uniqueness enforced)';
COMMENT ON COLUMN project_site_expenses.expense_category IS 'Category for reporting and filtering';
COMMENT ON COLUMN project_site_expenses.status IS 'Workflow status: pending → approved/rejected. Existing rows = auto_approved';
COMMENT ON COLUMN project_site_expenses.submitted_by IS 'Employee who submitted the voucher';
COMMENT ON COLUMN project_site_expenses.approved_by IS 'PM or founder who approved/rejected';

-- Mark existing rows as auto_approved so the queue only shows new submissions
UPDATE project_site_expenses
SET status = 'auto_approved'
WHERE status IS NULL OR status = 'pending';

-- Index for the approval queue (pending vouchers first)
CREATE INDEX IF NOT EXISTS idx_project_site_expenses_status
  ON project_site_expenses(status, submitted_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_project_site_expenses_project
  ON project_site_expenses(project_id);

-- ── 3. RLS reaffirm ─────────────────────────────────────────────────
-- project_site_expenses RLS already enabled in migration 010. No
-- changes needed — pending vouchers inherit the same policies.

-- ====================================================================
-- Verification (run manually after applying):
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'projects'
--     AND column_name IN (
--       'scope_la','scope_civil','scope_meter','cable_brand',
--       'cable_model','billing_address','location_map_link',
--       'order_date','primary_contact_id'
--     )
--   ORDER BY column_name;
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'project_site_expenses'
--     AND column_name IN (
--       'voucher_number','expense_category','status','submitted_by',
--       'submitted_at','approved_by','approved_at','rejected_reason',
--       'receipt_file_path'
--     )
--   ORDER BY column_name;
-- ====================================================================
