-- Migration 045: CEIG scope toggle + commissioning engineer signature
-- Applied to: net_metering_applications, commissioning_reports

-- 1. CEIG scope: Shiroi or Client handling
ALTER TABLE net_metering_applications
  ADD COLUMN IF NOT EXISTS ceig_scope TEXT CHECK (ceig_scope IN ('shiroi', 'client'));

-- 2. Engineer signature path for commissioning reports
ALTER TABLE commissioning_reports
  ADD COLUMN IF NOT EXISTS engineer_signature_path TEXT;
