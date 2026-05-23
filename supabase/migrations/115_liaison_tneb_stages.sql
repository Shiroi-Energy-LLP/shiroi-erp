-- Migration 114: Liaison TNEB stage rename + awaiting-client flag + ceig_scope to projects

-- ── 1. Add ceig_scope to projects ──────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ceig_scope TEXT NOT NULL DEFAULT 'shiroi'
    CHECK (ceig_scope IN ('shiroi', 'client'));

-- Backfill from existing NMAs where the application already set ceig_scope
UPDATE projects p
SET ceig_scope = nma.ceig_scope
FROM net_metering_applications nma
WHERE nma.project_id = p.id
  AND nma.ceig_scope IS NOT NULL
  AND nma.ceig_scope IN ('shiroi', 'client');

-- ── 2. Drop old ceig_scope from net_metering_applications ──────────────────
ALTER TABLE net_metering_applications
  DROP COLUMN IF EXISTS ceig_scope;

-- ── 3. Rename discom_status CHECK values ───────────────────────────────────
ALTER TABLE net_metering_applications
  DROP CONSTRAINT IF EXISTS net_metering_applications_discom_status_check;

UPDATE net_metering_applications SET discom_status = 'tneb_verified'
  WHERE discom_status = 'under_review';
UPDATE net_metering_applications SET discom_status = 'tneb_inspected'
  WHERE discom_status = 'site_inspection_scheduled';
UPDATE net_metering_applications SET discom_status = 'tneb_estimated'
  WHERE discom_status = 'approved';
UPDATE net_metering_applications SET discom_status = 'installation_completed'
  WHERE discom_status = 'net_meter_installed';

ALTER TABLE net_metering_applications
  ADD CONSTRAINT net_metering_applications_discom_status_check
    CHECK (discom_status IN (
      'pending',
      'applied',
      'tneb_verified',
      'tneb_inspected',
      'tneb_estimated',
      'installation_completed',
      'service_effected',
      'rejected',
      'objection_raised'
    ));

-- ── 4. Add awaiting-client columns ─────────────────────────────────────────
ALTER TABLE net_metering_applications
  ADD COLUMN IF NOT EXISTS awaiting_client_details BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS awaiting_client_since   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS awaiting_client_note    TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_nma_awaiting_client
  ON net_metering_applications (awaiting_client_details)
  WHERE awaiting_client_details = TRUE;

-- ── 5. Add get_liaison_summary() RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_liaison_summary()
RETURNS TABLE (
  total            BIGINT,
  awaiting_client  BIGINT,
  ceig_pending     BIGINT,
  ceig_in_process  BIGINT,
  tneb_active      BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT                                                                                AS total,
    COUNT(*) FILTER (WHERE awaiting_client_details = TRUE)::BIGINT                                 AS awaiting_client,
    COUNT(*) FILTER (WHERE ceig_required = TRUE AND ceig_status = 'pending')::BIGINT               AS ceig_pending,
    COUNT(*) FILTER (WHERE ceig_required = TRUE
                       AND ceig_status IN ('applied', 'inspection_scheduled'))::BIGINT             AS ceig_in_process,
    COUNT(*) FILTER (WHERE discom_status IN (
                       'applied', 'tneb_verified', 'tneb_inspected',
                       'tneb_estimated', 'installation_completed'))::BIGINT                        AS tneb_active
  FROM net_metering_applications;
$$;

GRANT EXECUTE ON FUNCTION get_liaison_summary() TO authenticated;
