-- Migration 040: Commissioning report enhancements — per Manivel's spec
-- Multi-string electrical tests, monitoring details, performance ratio, finalized status

-- 1. Add new columns
ALTER TABLE commissioning_reports
  ADD COLUMN IF NOT EXISTS string_test_data JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS monitoring_portal_link TEXT,
  ADD COLUMN IF NOT EXISTS monitoring_login TEXT,
  ADD COLUMN IF NOT EXISTS monitoring_password TEXT,
  ADD COLUMN IF NOT EXISTS performance_ratio_pct NUMERIC(5,2);

-- 2. Expand status enum to include 'finalized'
ALTER TABLE commissioning_reports DROP CONSTRAINT IF EXISTS commissioning_reports_status_check;
ALTER TABLE commissioning_reports ADD CONSTRAINT commissioning_reports_status_check
  CHECK (status IN ('draft', 'unsigned', 'signed', 'submitted', 'finalized'));

COMMENT ON COLUMN commissioning_reports.string_test_data IS 'JSONB array of {inverter_no, string_no, vmp, isc, polarity_ok} per inverter string';
COMMENT ON COLUMN commissioning_reports.monitoring_portal_link IS 'URL for monitoring portal (e.g. Sungrow iSolarCloud)';
COMMENT ON COLUMN commissioning_reports.monitoring_login IS 'Login credentials for monitoring portal';
COMMENT ON COLUMN commissioning_reports.monitoring_password IS 'Password for monitoring portal';
COMMENT ON COLUMN commissioning_reports.performance_ratio_pct IS 'Performance ratio percentage (actual vs theoretical)';
