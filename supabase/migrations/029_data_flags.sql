-- ============================================================
-- Migration 029: Data Flags + Verified Columns
-- Purpose: Employee-facing data quality review system.
--   - data_flags table: flag any entity as wrong/duplicate/incomplete
--   - data_verified_by/at columns on leads, projects, proposals
-- Dependencies: 001_foundation (profiles, auth)
-- ============================================================

-- ── 1. data_flags table ──

CREATE TABLE IF NOT EXISTS data_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL,  -- lead, project, proposal, contact, company, vendor, po, bom_item, file, delivery_challan, invoice, payment
  entity_id       UUID NOT NULL,
  flag_type       TEXT NOT NULL CHECK (flag_type IN (
    'wrong_data', 'duplicate', 'incomplete', 'wrong_file',
    'wrong_category', 'wrong_amount', 'wrong_status', 'other'
  )),
  field_name      TEXT,           -- optional: which specific field is wrong
  notes           TEXT,
  flagged_by      UUID NOT NULL REFERENCES auth.users(id),
  flagged_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by     UUID REFERENCES auth.users(id),
  resolved_at     TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookup
CREATE INDEX idx_data_flags_entity
  ON data_flags (entity_type, entity_id)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_data_flags_unresolved
  ON data_flags (flagged_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_data_flags_flagged_by
  ON data_flags (flagged_by);

-- ── 2. RLS on data_flags ──

ALTER TABLE data_flags ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can create flags
CREATE POLICY "authenticated_insert_flags"
  ON data_flags FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Any authenticated user can read all flags (transparency)
CREATE POLICY "authenticated_read_flags"
  ON data_flags FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only founder, hr_manager, finance can resolve flags
CREATE POLICY "admin_resolve_flags"
  ON data_flags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'hr_manager', 'finance')
    )
  );

-- ── 3. Verified columns on key tables ──

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS data_verified_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS data_verified_at TIMESTAMPTZ;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS data_verified_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS data_verified_at TIMESTAMPTZ;

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS data_verified_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS data_verified_at TIMESTAMPTZ;

-- ── 4. Convenience function: count unresolved flags for an entity ──

CREATE OR REPLACE FUNCTION get_flag_count(p_entity_type TEXT, p_entity_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COUNT(*)::INTEGER
  FROM data_flags
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
    AND resolved_at IS NULL;
$$;

-- ── 5. Summary RPC for data quality dashboard ──

CREATE OR REPLACE FUNCTION get_data_flag_summary()
RETURNS TABLE (
  entity_type TEXT,
  total_flags BIGINT,
  unresolved_flags BIGINT,
  resolved_flags BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    entity_type,
    COUNT(*) AS total_flags,
    COUNT(*) FILTER (WHERE resolved_at IS NULL) AS unresolved_flags,
    COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved_flags
  FROM data_flags
  GROUP BY entity_type
  ORDER BY unresolved_flags DESC;
$$;
