-- supabase/migrations/099_zoho_attribution_audit.sql
-- ============================================================================
-- Migration 099 — zoho_attribution_audit table
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Append-only history of every triage decision (assign / exclude / skip /
-- reassign / undo). Built so multiple team members can triage in parallel
-- and each decision shows who made it.

BEGIN;

CREATE TABLE IF NOT EXISTS zoho_attribution_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('invoice','payment')),
  entity_id       UUID NOT NULL,
  from_project_id UUID REFERENCES projects(id),
  to_project_id   UUID REFERENCES projects(id),
  decision        TEXT NOT NULL CHECK (decision IN
                    ('assign','exclude','skip','reassign','undo_exclude','undo_skip')),
  made_by         UUID NOT NULL REFERENCES employees(id),
  made_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_zoho_attribution_audit_entity
  ON zoho_attribution_audit(entity_id);
CREATE INDEX IF NOT EXISTS idx_zoho_attribution_audit_made_by_date
  ON zoho_attribution_audit(made_by, made_at DESC);

-- RLS: same three roles that have access to the triage page.
ALTER TABLE zoho_attribution_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Triage roles can read audit"
  ON zoho_attribution_audit FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('founder','finance','marketing_manager')
    )
  );

CREATE POLICY "Triage roles can insert audit"
  ON zoho_attribution_audit FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('founder','finance','marketing_manager')
    )
  );

DO $$
BEGIN
  RAISE NOTICE '=== Migration 099 applied ===';
  RAISE NOTICE 'zoho_attribution_audit table created with RLS.';
END $$;

COMMIT;
