-- ============================================================
-- Migration 010 — Lead Status Enum + Phone Index Fix +
--                  Project Site Expenses + Storage Bucket
-- File: supabase/migrations/010_project_site_expenses.sql
-- Date: 2026-04-02
-- Applied: 2026-04-02 (dev)
--
-- Four changes:
--   1. Add 'converted' value to lead_status enum (run separately —
--      ALTER TYPE ADD VALUE cannot run inside a transaction).
--   2. Fix leads phone uniqueness index: exclude 'converted' status
--      so repeat customers can create new leads after first project.
--   3. Create project_site_expenses table for voucher-level site costs.
--   4. Create project-files storage bucket for PDFs, photos, documents.
--
-- Execution note:
--   Must be run in TWO steps because ALTER TYPE ADD VALUE cannot
--   be used inside a transaction or before the value is committed.
--
--   Step 1: ALTER TYPE lead_status ADD VALUE ... (alone)
--   Step 2: BEGIN; ... COMMIT; (everything else)
--
-- Rollback:
--   -- enum values cannot be removed; would need full type recreation
--   DROP TABLE IF EXISTS project_site_expenses;
--   DROP INDEX IF EXISTS idx_leads_phone_unique;
--   CREATE UNIQUE INDEX idx_leads_phone_unique ON leads(phone)
--     WHERE deleted_at IS NULL AND status NOT IN ('disqualified', 'lost');
--   DELETE FROM storage.buckets WHERE id = 'project-files';
-- Dependencies: 001_foundation.sql, 002a_leads_core.sql,
--               004a_projects_core.sql, 007d_leads_fixes.sql
-- ============================================================

-- ── Step 1 (must run outside transaction) ────────────────────
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'converted' AFTER 'won';

-- ── Step 2 (transactional) ───────────────────────────────────
BEGIN;

-- ────────────────────────────────────────────────────────────
-- 2. Fix phone uniqueness — allow repeat customers
-- ────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_leads_phone_unique;

CREATE UNIQUE INDEX idx_leads_phone_unique
  ON leads(phone)
  WHERE deleted_at IS NULL
    AND status NOT IN ('disqualified', 'lost', 'converted');

COMMENT ON INDEX idx_leads_phone_unique IS
  'Prevents duplicate active leads for the same phone number. '
  'Disqualified, lost, and converted leads are excluded so the same phone '
  'can re-enter the pipeline as a new lead for repeat customers.';

-- ────────────────────────────────────────────────────────────
-- 3. Project Site Expenses table
-- ────────────────────────────────────────────────────────────
-- Lightweight table for voucher-level site costs (transport,
-- materials, petty cash). Migrated from per-project Google
-- Sheets "Expenses" tab.

CREATE TABLE IF NOT EXISTS project_site_expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  description   TEXT,
  employee_name TEXT,
  expense_date  DATE,
  voucher_no    TEXT,
  amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_site_expenses_project ON project_site_expenses(project_id);

ALTER TABLE project_site_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_site_expenses_read"
  ON project_site_expenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance', 'project_manager', 'purchase_officer', 'site_supervisor')
    )
  );

CREATE POLICY "project_site_expenses_write"
  ON project_site_expenses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance', 'project_manager')
    )
  );

CREATE POLICY "project_site_expenses_update"
  ON project_site_expenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance')
    )
  );

CREATE TRIGGER set_updated_at_project_site_expenses
  BEFORE UPDATE ON project_site_expenses
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. Project Files storage bucket
-- ────────────────────────────────────────────────────────────
-- Stores PDFs, photos, documents for projects.
-- Path convention: project-files/{project_id}/{file_type}/{filename}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-files',
  'project-files',
  false,
  52428800,  -- 50MB max file size
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
CREATE POLICY "project_files_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'project-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance', 'project_manager', 'purchase_officer', 'site_supervisor', 'designer')
    )
  );

CREATE POLICY "project_files_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'project-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );

CREATE POLICY "project_files_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'project-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'founder'
    )
  );

COMMIT;
