-- =============================================================================
-- Migration 122 — Handover PDF path (C11) + DC digital certificates (C12)
-- =============================================================================

-- ── C11: handover PDF path on projects ───────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS handover_pdf_path TEXT;

-- ── C12: dc_certificates ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dc_certificates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  certificate_type         TEXT NOT NULL CHECK (certificate_type IN (
                             'dc_completion','handing_over','net_metering_submission'
                           )),
  signed_by_employee       UUID REFERENCES profiles(id),
  signed_by_customer_name  TEXT,
  signed_by_customer_phone TEXT,
  signed_at                TIMESTAMPTZ,
  otp_verified             BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address               TEXT,
  notes                    TEXT,
  pdf_path                 TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, certificate_type)
);

CREATE INDEX IF NOT EXISTS idx_dc_certs_project ON dc_certificates(project_id);

-- RLS
ALTER TABLE dc_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dc_certs_read" ON dc_certificates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "dc_certs_insert" ON dc_certificates
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder','project_manager','site_supervisor')
    )
  );

CREATE POLICY "dc_certs_update" ON dc_certificates
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder','project_manager','site_supervisor')
    )
  );
