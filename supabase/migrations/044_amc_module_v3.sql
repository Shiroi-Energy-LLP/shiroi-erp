-- Migration 044: AMC Module V3 — Manivel's spec
-- Adds amc_category, duration, visit-level service fields, created_by/updated_by tracking

-- 1. Add amc_category to om_contracts (Free AMC / Paid AMC — simplified from contract_type)
ALTER TABLE om_contracts ADD COLUMN IF NOT EXISTS amc_category TEXT DEFAULT 'free_amc'
  CHECK (amc_category IN ('free_amc', 'paid_amc'));

-- 2. Add duration in months for paid AMC contracts
ALTER TABLE om_contracts ADD COLUMN IF NOT EXISTS amc_duration_months INT;

-- 3. Add created_by_profile / updated_by_profile for audit trail (profile_id based)
ALTER TABLE om_contracts ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id);

-- 4. Add visit-level service fields to om_visit_schedules
ALTER TABLE om_visit_schedules ADD COLUMN IF NOT EXISTS work_done TEXT;
ALTER TABLE om_visit_schedules ADD COLUMN IF NOT EXISTS issues_identified TEXT;
ALTER TABLE om_visit_schedules ADD COLUMN IF NOT EXISTS resolution_details TEXT;
ALTER TABLE om_visit_schedules ADD COLUMN IF NOT EXISTS customer_feedback TEXT;
ALTER TABLE om_visit_schedules ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES employees(id);
ALTER TABLE om_visit_schedules ADD COLUMN IF NOT EXISTS report_file_paths TEXT[] DEFAULT '{}';

-- 5. Backfill existing warranty_period contracts as free_amc
UPDATE om_contracts SET amc_category = 'free_amc' WHERE contract_type = 'warranty_period' AND amc_category IS NULL;
UPDATE om_contracts SET amc_category = 'paid_amc' WHERE contract_type != 'warranty_period' AND amc_category IS NULL;

-- 6. Index on amc_category for filtering
CREATE INDEX IF NOT EXISTS idx_om_contracts_category ON om_contracts(amc_category);
