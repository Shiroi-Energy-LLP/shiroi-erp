-- Migration 116: Inverter integration V1
--
-- (Originally drafted as "103" in the inverter integration plan; renumbered
-- to 116 because 103 was already taken by 103_fix_po_status_check_add_dispatched
-- and the highest existing migration is 115_liaison_tneb_stages.)
--
-- Extends migration 050 to support:
--   1. Six additional inverter brands seen in real Shiroi installs that
--      were not in the original CHECK constraint (deye/solarman, goodwe,
--      fimer, polycab, havells, flin_energy). Without this extension the
--      bulk-import in Phase 2 cannot land most rows.
--   2. OAuth2 token storage for Sungrow (and any future OAuth vendor).
--      Tokens live in inverter_monitoring_credentials.config JSONB so we
--      don't need a per-vendor column.
--   3. inverter_oauth_states — short-lived (15 min) state tokens to
--      defend the OAuth2 callback against CSRF.

BEGIN;

-- ── Extend brand CHECK on inverters table ────────────────────────────
ALTER TABLE inverters
  DROP CONSTRAINT IF EXISTS inverters_brand_check;
ALTER TABLE inverters
  ADD CONSTRAINT inverters_brand_check
  CHECK (brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius',
    'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy',
    'other'
  ));

-- ── Extend brand CHECK on inverter_monitoring_credentials ────────────
ALTER TABLE inverter_monitoring_credentials
  DROP CONSTRAINT IF EXISTS inverter_monitoring_credentials_brand_check;
ALTER TABLE inverter_monitoring_credentials
  ADD CONSTRAINT inverter_monitoring_credentials_brand_check
  CHECK (brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius',
    'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy',
    'other'
  ));

-- ── Extend brand CHECK on plant_monitoring_credentials ───────────────
-- This was added by migration 059 with a narrower list. We need the same
-- expanded list so the Phase 2 bulk import can succeed.
ALTER TABLE plant_monitoring_credentials
  DROP CONSTRAINT IF EXISTS plant_monitoring_credentials_inverter_brand_check;
ALTER TABLE plant_monitoring_credentials
  ADD CONSTRAINT plant_monitoring_credentials_inverter_brand_check
  CHECK (inverter_brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis',
    'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy',
    'other'
  ));

-- ── Extend brand auto-detect helper to cover new portal URLs ─────────
CREATE OR REPLACE FUNCTION public.plant_monitoring_detect_brand(portal_url TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN portal_url IS NULL OR portal_url = '' THEN 'other'
    WHEN lower(portal_url) LIKE '%isolarcloud%' THEN 'sungrow'
    WHEN lower(portal_url) LIKE '%growatt%' THEN 'growatt'
    WHEN lower(portal_url) LIKE '%solarmanpv%' OR lower(portal_url) LIKE '%solarman%' THEN 'solarman'
    WHEN lower(portal_url) LIKE '%semsportal%' OR lower(portal_url) LIKE '%goodwe%' THEN 'goodwe'
    WHEN lower(portal_url) LIKE '%auroravision%' OR lower(portal_url) LIKE '%fimer%' THEN 'fimer'
    WHEN lower(portal_url) LIKE '%polycabmonitoring%' THEN 'polycab'
    WHEN lower(portal_url) LIKE '%havells%' THEN 'havells'
    WHEN lower(portal_url) LIKE '%power-datacenter%' OR lower(portal_url) LIKE '%flinenergy%' THEN 'flin_energy'
    WHEN lower(portal_url) LIKE '%fronius%' OR lower(portal_url) LIKE '%solarweb%' THEN 'fronius'
    WHEN lower(portal_url) LIKE '%soliscloud%' OR lower(portal_url) LIKE '%solis%' THEN 'solis'
    WHEN lower(portal_url) LIKE '%sma%' OR lower(portal_url) LIKE '%sunnyportal%' THEN 'sma'
    WHEN lower(portal_url) LIKE '%fusionsolar%' OR lower(portal_url) LIKE '%huawei%' THEN 'huawei'
    ELSE 'other'
  END;
$$;

COMMENT ON FUNCTION public.plant_monitoring_detect_brand(TEXT) IS
  'Classifies monitoring portal URL into one of 13 known brands. Used by trigger + server actions so classification is consistent.';

-- ── inverter_oauth_states table — anti-CSRF for OAuth2 callback ──────
CREATE TABLE IF NOT EXISTS inverter_oauth_states (
  state_token TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  credentials_id UUID NOT NULL REFERENCES inverter_monitoring_credentials(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inverter_oauth_states_created
  ON inverter_oauth_states (created_at);

ALTER TABLE inverter_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY inverter_oauth_states_rw_founder ON inverter_oauth_states
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('founder', 'om_technician'))
  );

CREATE POLICY inverter_oauth_states_service ON inverter_oauth_states
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE inverter_oauth_states IS
  'Short-lived state tokens used to defend OAuth2 callbacks against CSRF. Created when /api/integrations/<brand>/authorize is hit; consumed by the callback. Rows older than 15 minutes are considered expired.';

-- ── Cleanup: drop expired OAuth states nightly ───────────────────────
CREATE OR REPLACE FUNCTION drop_expired_inverter_oauth_states()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  deleted INT;
BEGIN
  WITH expired AS (
    DELETE FROM inverter_oauth_states
    WHERE created_at < NOW() - interval '15 minutes'
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted FROM expired;
  RETURN deleted;
END;
$$;

SELECT cron.schedule(
  'inverter-oauth-states-cleanup',
  '17 * * * *',
  'SELECT drop_expired_inverter_oauth_states();'
);

COMMIT;
