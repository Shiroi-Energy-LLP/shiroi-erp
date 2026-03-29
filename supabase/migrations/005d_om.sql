-- ============================================================
-- Migration 005d — O&M Domain
-- File: supabase/migrations/005d_om.sql
-- Description: O&M contracts, maintenance schedules, visit
--              checklists, service tickets, plants, plant
--              monitoring, pricing engine, and profitability.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS om_profitability CASCADE;
--   DROP TABLE IF EXISTS plant_daily_summaries CASCADE;
--   DROP TABLE IF EXISTS plant_data_readings CASCADE;
--   DROP TABLE IF EXISTS plants CASCADE;
--   DROP TABLE IF EXISTS om_service_tickets CASCADE;
--   DROP TABLE IF EXISTS om_visit_checklist_items CASCADE;
--   DROP TABLE IF EXISTS om_visit_reports CASCADE;
--   DROP TABLE IF EXISTS om_visit_schedules CASCADE;
--   DROP TABLE IF EXISTS om_pricing_rules CASCADE;
--   DROP TABLE IF EXISTS om_contracts CASCADE;
--   DROP TYPE IF EXISTS om_contract_status;
--   DROP TYPE IF EXISTS ticket_status;
-- Dependencies: 001_foundation.sql, 004a_projects_core.sql,
--               004d_projects_financials.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Enums for O&M domain
-- ------------------------------------------------------------
CREATE TYPE om_contract_status AS ENUM (
  'quoted',
  'active',
  'expired',
  'cancelled',
  'renewal_pending'
);

CREATE TYPE ticket_status AS ENUM (
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'escalated'
);


-- ------------------------------------------------------------
-- 2. om_contracts
-- Annual maintenance contract per customer per plant.
-- Year 1: 4 free quarterly visits (warranty period).
-- AMC auto-quoted and included in handover pack.
-- AMC price ceiling: 12% of customer's annual solar savings.
-- Target O&M gross margin: 30%.
-- ------------------------------------------------------------
CREATE TABLE om_contracts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  customer_profile_id     UUID REFERENCES profiles(id),
  created_by              UUID NOT NULL REFERENCES employees(id),

  contract_number         TEXT NOT NULL UNIQUE,
  -- Format: AMC-PROJ-087-Y1

  contract_type           TEXT NOT NULL CHECK (contract_type IN (
    'warranty_period',
    -- Year 1: free quarterly visits included in project.
    'amc_basic',
    -- Annual visits only.
    'amc_comprehensive',
    -- Visits + parts + emergency callouts.
    'pay_per_visit'
    -- No contract. Billed per visit.
  )),

  status                  om_contract_status NOT NULL DEFAULT 'quoted',

  -- Dates
  start_date              DATE NOT NULL,
  end_date                DATE NOT NULL,
  -- Typically 1 year. Renewable.

  -- Pricing
  annual_value            NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- 0 for warranty_period contracts.
  visits_included         INT NOT NULL DEFAULT 4,
  -- Number of scheduled visits included in contract.
  emergency_callouts_included INT NOT NULL DEFAULT 0,

  -- Renewal
  auto_renewal            BOOLEAN NOT NULL DEFAULT FALSE,
  renewal_reminder_days   INT NOT NULL DEFAULT 30,
  -- Alert X days before end_date.
  repricing_recommended   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Auto-set at renewal if actual margin < minimum threshold.

  -- Customer acceptance
  signed_by_customer      BOOLEAN NOT NULL DEFAULT FALSE,
  signed_at               TIMESTAMPTZ,
  contract_storage_path   TEXT,

  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER om_contracts_updated_at
  BEFORE UPDATE ON om_contracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_om_contracts_project  ON om_contracts(project_id);
CREATE INDEX idx_om_contracts_status   ON om_contracts(status);
CREATE INDEX idx_om_contracts_expiry   ON om_contracts(end_date)
  WHERE status = 'active';
CREATE INDEX idx_om_contracts_reprice  ON om_contracts(repricing_recommended)
  WHERE repricing_recommended = TRUE;


-- ------------------------------------------------------------
-- 3. om_pricing_rules
-- Visit cost baseline per type.
-- ₹1,100 local residential → ₹4,300+ outstation commercial.
-- Used to compute expected cost per visit for margin tracking.
-- ------------------------------------------------------------
CREATE TABLE om_pricing_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  segment               customer_segment NOT NULL,
  visit_type            TEXT NOT NULL CHECK (visit_type IN (
    'scheduled_local', 'scheduled_outstation',
    'emergency_local', 'emergency_outstation'
  )),
  system_size_min_kwp   NUMERIC(6,2) NOT NULL DEFAULT 0,
  system_size_max_kwp   NUMERIC(6,2),
  -- NULL = no upper limit.

  base_cost             NUMERIC(14,2) NOT NULL,
  -- Shiroi's internal cost for this visit type.
  travel_allowance      NUMERIC(14,2) NOT NULL DEFAULT 0,
  technician_count      INT NOT NULL DEFAULT 1,

  -- Customer charge (for pay_per_visit contracts)
  customer_charge       NUMERIC(14,2) NOT NULL,

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER om_pricing_rules_updated_at
  BEFORE UPDATE ON om_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_om_pricing_active ON om_pricing_rules(is_active)
  WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 4. om_visit_schedules
-- Planned maintenance visits per contract.
-- Year 1: 4 visits auto-created on commissioning.
-- ------------------------------------------------------------
CREATE TABLE om_visit_schedules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID NOT NULL REFERENCES om_contracts(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL REFERENCES projects(id),
  assigned_to           UUID REFERENCES employees(id),

  visit_number          INT NOT NULL,
  -- 1, 2, 3, 4 for quarterly visits.
  visit_type            TEXT NOT NULL CHECK (visit_type IN (
    'scheduled_quarterly', 'scheduled_annual',
    'emergency', 'follow_up'
  )),

  scheduled_date        DATE NOT NULL,
  scheduled_time_slot   TEXT CHECK (scheduled_time_slot IN (
    'morning', 'afternoon', 'full_day'
  )),

  status                TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'confirmed', 'completed',
    'rescheduled', 'cancelled', 'missed'
  )),

  -- Rescheduling
  rescheduled_from      DATE,
  reschedule_reason     TEXT,
  reschedule_count      INT NOT NULL DEFAULT 0,

  -- Supervisor on leave coverage
  backup_technician_id  UUID REFERENCES employees(id),

  completed_at          TIMESTAMPTZ,
  visit_report_id       UUID,
  -- FK to om_visit_reports added after table created below.

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER om_visit_schedules_updated_at
  BEFORE UPDATE ON om_visit_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_om_schedules_contract   ON om_visit_schedules(contract_id);
CREATE INDEX idx_om_schedules_assigned   ON om_visit_schedules(assigned_to);
CREATE INDEX idx_om_schedules_scheduled  ON om_visit_schedules(scheduled_date)
  WHERE status IN ('scheduled', 'confirmed');


-- ------------------------------------------------------------
-- 5. om_visit_reports
-- Report submitted by technician after each visit.
-- Offline-first — written on mobile, synced later.
-- Tier 1 within 48h. Tier 2 after.
-- ------------------------------------------------------------
CREATE TABLE om_visit_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UUID generated on device.

  schedule_id           UUID NOT NULL REFERENCES om_visit_schedules(id),
  contract_id           UUID NOT NULL REFERENCES om_contracts(id),
  project_id            UUID NOT NULL REFERENCES projects(id),
  submitted_by          UUID NOT NULL REFERENCES employees(id),

  visit_date            DATE NOT NULL,
  visit_start_time      TIME,
  visit_end_time        TIME,
  duration_minutes      INT,

  -- System condition
  panels_inspected      BOOLEAN NOT NULL DEFAULT FALSE,
  panels_cleaned        BOOLEAN NOT NULL DEFAULT FALSE,
  inverter_checked      BOOLEAN NOT NULL DEFAULT FALSE,
  wiring_checked        BOOLEAN NOT NULL DEFAULT FALSE,
  earthing_checked      BOOLEAN NOT NULL DEFAULT FALSE,
  structure_checked     BOOLEAN NOT NULL DEFAULT FALSE,

  -- Readings
  dc_voltage_v          NUMERIC(7,2),
  ac_voltage_v          NUMERIC(7,2),
  current_generation_kw NUMERIC(7,2),
  -- Live reading at time of visit.
  meter_reading_kwh     NUMERIC(10,3),
  ir_test_result_mohm   NUMERIC(8,3),
  -- Below 0.5 MΩ → auto-create service ticket.

  -- Observations
  system_condition      TEXT NOT NULL CHECK (system_condition IN (
    'excellent', 'good', 'fair', 'poor', 'critical'
  )),
  observations          TEXT,
  -- Voice-to-text primary on mobile.

  -- Issues found
  issues_found          BOOLEAN NOT NULL DEFAULT FALSE,
  issue_summary         TEXT,
  -- Full issue logged in om_service_tickets.

  -- Parts used
  parts_replaced        BOOLEAN NOT NULL DEFAULT FALSE,
  parts_summary         TEXT,
  parts_cost            NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Customer interaction
  customer_present      BOOLEAN NOT NULL DEFAULT FALSE,
  customer_satisfaction TEXT CHECK (customer_satisfaction IN (
    'satisfied', 'neutral', 'dissatisfied'
  )),
  customer_signature_obtained BOOLEAN NOT NULL DEFAULT FALSE,
  customer_signature_path TEXT,

  -- AI narrative
  ai_narrative          TEXT,
  ai_narrative_generated_at TIMESTAMPTZ,

  -- PDF
  report_pdf_path       TEXT,

  -- Correction tracking
  has_correction        BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked             BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at             TIMESTAMPTZ,

  -- Offline sync
  sync_status           TEXT NOT NULL DEFAULT 'local_only' CHECK (sync_status IN (
    'local_only', 'syncing', 'synced', 'sync_failed'
  )),
  created_on_device_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER om_visit_reports_updated_at
  BEFORE UPDATE ON om_visit_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Link visit schedule back to its report
ALTER TABLE om_visit_schedules
  ADD CONSTRAINT fk_visit_report
  FOREIGN KEY (visit_report_id) REFERENCES om_visit_reports(id);

CREATE INDEX idx_om_visit_reports_contract ON om_visit_reports(contract_id);
CREATE INDEX idx_om_visit_reports_project  ON om_visit_reports(project_id);
CREATE INDEX idx_om_visit_reports_sync     ON om_visit_reports(sync_status)
  WHERE sync_status != 'synced';
CREATE INDEX idx_om_visit_reports_ir       ON om_visit_reports(ir_test_result_mohm)
  WHERE ir_test_result_mohm IS NOT NULL;


-- ------------------------------------------------------------
-- 6. om_visit_checklist_items
-- Detailed checklist items per visit report.
-- Separate from the boolean fields above —
-- these are granular line items for the formal checklist.
-- ------------------------------------------------------------
CREATE TABLE om_visit_checklist_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_report_id   UUID NOT NULL REFERENCES om_visit_reports(id) ON DELETE CASCADE,

  checklist_item    TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN (
    'panel', 'inverter', 'electrical', 'structure',
    'earthing', 'monitoring', 'safety', 'other'
  )),
  result            TEXT NOT NULL CHECK (result IN (
    'pass', 'fail', 'na', 'needs_attention'
  )),
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_checklist_items_report ON om_visit_checklist_items(visit_report_id);
CREATE INDEX idx_checklist_items_result ON om_visit_checklist_items(result)
  WHERE result IN ('fail', 'needs_attention');


-- ------------------------------------------------------------
-- 7. om_service_tickets
-- Issues raised from visit reports or by customers directly.
-- SLA enforced by system. Escalation matrix applied.
-- ------------------------------------------------------------
CREATE TABLE om_service_tickets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  contract_id           UUID REFERENCES om_contracts(id),
  visit_report_id       UUID REFERENCES om_visit_reports(id),
  -- NULL if ticket raised directly by customer.
  raised_by_employee    UUID REFERENCES employees(id),
  raised_by_customer    UUID REFERENCES profiles(id),
  -- One of these two must be non-null.
  assigned_to           UUID REFERENCES employees(id),

  ticket_number         TEXT NOT NULL UNIQUE,
  -- Format: TKT-PROJ-087-001

  issue_type            TEXT NOT NULL CHECK (issue_type IN (
    'no_generation', 'low_generation', 'inverter_fault',
    'panel_damage', 'wiring_issue', 'earthing_issue',
    'monitoring_offline', 'physical_damage', 'warranty_claim',
    'billing_issue', 'other'
  )),

  severity              TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN (
    'low', 'medium', 'high', 'critical'
  )),

  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,

  status                ticket_status NOT NULL DEFAULT 'open',

  -- SLA
  sla_hours             INT NOT NULL DEFAULT 48,
  -- Critical: 4h, High: 24h, Medium: 48h, Low: 72h.
  sla_deadline          TIMESTAMPTZ,
  sla_breached          BOOLEAN NOT NULL DEFAULT FALSE,
  sla_breached_at       TIMESTAMPTZ,

  -- Resolution
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES employees(id),
  resolution_notes      TEXT,
  resolution_visit_id   UUID REFERENCES om_visit_reports(id),

  -- Parts used in resolution
  parts_used            BOOLEAN NOT NULL DEFAULT FALSE,
  parts_cost            NUMERIC(14,2) NOT NULL DEFAULT 0,
  parts_covered_by_warranty BOOLEAN NOT NULL DEFAULT FALSE,

  -- Warranty claim
  is_warranty_claim     BOOLEAN NOT NULL DEFAULT FALSE,
  warranty_claim_number TEXT,

  -- IR test auto-ticket flag
  auto_created_ir_test  BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE when created automatically from IR test below 0.5 MΩ.

  -- Recurring fault detection
  recurring_fault       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Set when same fault_type appears 3+ times on this project.
  -- Flags for warranty claim review.

  -- Automation pause
  -- All marketing automation pauses when customer has open complaint.
  closes_automation_pause BOOLEAN NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER om_service_tickets_updated_at
  BEFORE UPDATE ON om_service_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE SEQUENCE ticket_number_seq START 1;

CREATE INDEX idx_tickets_project   ON om_service_tickets(project_id);
CREATE INDEX idx_tickets_status    ON om_service_tickets(status);
CREATE INDEX idx_tickets_assigned  ON om_service_tickets(assigned_to);
CREATE INDEX idx_tickets_sla       ON om_service_tickets(sla_deadline)
  WHERE status NOT IN ('resolved', 'closed');
CREATE INDEX idx_tickets_open      ON om_service_tickets(project_id)
  WHERE status NOT IN ('resolved', 'closed');
CREATE INDEX idx_tickets_recurring ON om_service_tickets(recurring_fault)
  WHERE recurring_fault = TRUE;


-- ------------------------------------------------------------
-- 8. plants
-- Physical solar installation record.
-- One plant per commissioned project.
-- Powers the customer app and O&M scheduling.
-- ------------------------------------------------------------
CREATE TABLE plants (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE RESTRICT,
  customer_profile_id     UUID REFERENCES profiles(id),

  -- Plant identity
  plant_name              TEXT NOT NULL,
  -- e.g. "Ramesh Kumar — Velachery Residence"

  -- Location
  address_line1           TEXT NOT NULL,
  address_line2           TEXT,
  city                    TEXT NOT NULL,
  state                   TEXT NOT NULL DEFAULT 'Tamil Nadu',
  pincode                 TEXT,
  latitude                NUMERIC(9,6),
  longitude               NUMERIC(9,6),

  -- System details (from commissioning)
  system_size_kwp         NUMERIC(6,2) NOT NULL,
  system_type             system_type NOT NULL,
  panel_count             INT NOT NULL,
  panel_brand             TEXT,
  panel_model             TEXT,
  inverter_brand          TEXT,
  inverter_model          TEXT,
  inverter_serial_number  TEXT,
  battery_brand           TEXT,
  battery_capacity_kwh    NUMERIC(6,2),

  -- Commissioning
  commissioned_date       DATE NOT NULL,
  warranty_expiry_date    DATE NOT NULL,
  -- Typically commissioned_date + 5 years for panels.

  -- Monitoring
  monitoring_provider     TEXT CHECK (monitoring_provider IN (
    'sungrow', 'growatt', 'goodwe', 'manual', 'none'
  )),
  monitoring_plant_id     TEXT,
  -- Plant ID in the inverter manufacturer's monitoring portal.
  monitoring_active       BOOLEAN NOT NULL DEFAULT FALSE,
  last_monitoring_sync    TIMESTAMPTZ,

  -- Performance baseline
  expected_annual_kwh     NUMERIC(10,2),
  -- From commissioning simulation.
  degradation_rate_pct    NUMERIC(4,2) DEFAULT 0.60,

  -- Net metering
  net_metering_active     BOOLEAN NOT NULL DEFAULT FALSE,
  net_meter_number        TEXT,
  discom_name             TEXT DEFAULT 'TNEB',

  -- Status
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  decommissioned_at       DATE,
  decommission_reason     TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER plants_updated_at
  BEFORE UPDATE ON plants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_plants_project   ON plants(project_id);
CREATE INDEX idx_plants_customer  ON plants(customer_profile_id);
CREATE INDEX idx_plants_active    ON plants(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_plants_monitoring ON plants(monitoring_active)
  WHERE monitoring_active = TRUE;


-- ------------------------------------------------------------
-- 9. plant_data_readings
-- Raw monitoring data pulled every 15 minutes from
-- Sungrow/Growatt APIs. Never aggregated in place —
-- raw data preserved, aggregations in plant_daily_summaries.
-- NULL = no data available (not zero generation).
-- ------------------------------------------------------------
CREATE TABLE plant_data_readings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id              UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,

  reading_timestamp     TIMESTAMPTZ NOT NULL,
  -- 15-minute interval timestamp.

  -- Power readings
  ac_power_kw           NUMERIC(8,3),
  -- NULL if API unreachable. NOT zero.
  dc_power_kw           NUMERIC(8,3),
  dc_voltage_v          NUMERIC(7,2),
  dc_current_a          NUMERIC(7,2),
  ac_voltage_v          NUMERIC(7,2),
  ac_frequency_hz       NUMERIC(5,2),

  -- Energy
  energy_kwh_today      NUMERIC(10,3),
  -- Cumulative kWh generated today at this reading time.
  energy_kwh_total      NUMERIC(12,3),
  -- Total lifetime kWh from inverter register.

  -- Inverter status
  inverter_status       TEXT,
  -- Raw status string from API. e.g. 'generating', 'standby', 'fault'
  fault_code            TEXT,
  -- Populated when inverter reports a fault.

  -- Data quality
  data_source           TEXT NOT NULL CHECK (data_source IN (
    'sungrow_api', 'growatt_api', 'manual_entry'
  )),
  is_estimated          BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE if reading was interpolated due to API gap.

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_plant_readings_plant     ON plant_data_readings(plant_id, reading_timestamp DESC);
CREATE INDEX idx_plant_readings_timestamp ON plant_data_readings(reading_timestamp DESC);
CREATE INDEX idx_plant_readings_fault     ON plant_data_readings(plant_id)
  WHERE fault_code IS NOT NULL;


-- ------------------------------------------------------------
-- 10. plant_daily_summaries
-- Nightly aggregation of plant_data_readings.
-- Quarterly reports read from here — not raw readings.
-- ------------------------------------------------------------
CREATE TABLE plant_daily_summaries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id              UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  summary_date          DATE NOT NULL,

  -- Generation
  energy_generated_kwh  NUMERIC(10,3),
  -- NULL if no data available for this day.
  peak_power_kw         NUMERIC(8,3),
  peak_power_time       TIME,

  -- Performance
  performance_ratio     NUMERIC(5,3),
  -- Actual / Expected. < 0.75 flags investigation.
  expected_kwh          NUMERIC(10,3),
  -- Degradation-adjusted expected for this day.

  -- Availability
  data_available_hours  NUMERIC(4,1),
  -- How many hours had monitoring data. 0 = total outage.
  inverter_fault_count  INT NOT NULL DEFAULT 0,

  -- Computed
  co2_avoided_kg        NUMERIC(8,2),
  -- energy_generated_kwh * 0.82 (India grid emission factor).

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE UNIQUE INDEX idx_plant_daily_unique
  ON plant_daily_summaries(plant_id, summary_date);
CREATE INDEX idx_plant_daily_plant ON plant_daily_summaries(plant_id, summary_date DESC);
CREATE INDEX idx_plant_daily_perf  ON plant_daily_summaries(performance_ratio)
  WHERE performance_ratio IS NOT NULL;


-- ------------------------------------------------------------
-- 11. om_profitability
-- O&M P&L per contract per year.
-- Refreshed after each visit report.
-- Target gross margin: 30%.
-- repricing_recommended auto-set at renewal if below threshold.
-- ------------------------------------------------------------
CREATE TABLE om_profitability (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID NOT NULL REFERENCES om_contracts(id) ON DELETE CASCADE,
  year_number           INT NOT NULL,
  -- 1, 2, 3 etc. Contract year.

  -- Revenue
  contract_value        NUMERIC(14,2) NOT NULL DEFAULT 0,
  additional_revenue    NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Extra charges: emergency callouts, parts not in contract.
  total_revenue         NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Costs
  visit_cost_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  parts_cost_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  travel_cost_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost            NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Margin
  gross_profit          NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_margin_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,

  -- Visits
  visits_completed      INT NOT NULL DEFAULT 0,
  visits_scheduled      INT NOT NULL DEFAULT 0,

  last_computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER om_profitability_updated_at
  BEFORE UPDATE ON om_profitability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_om_profitability_contract_year
  ON om_profitability(contract_id, year_number);
CREATE INDEX idx_om_profitability_margin ON om_profitability(gross_margin_pct);


-- ------------------------------------------------------------
-- RLS — O&M domain
-- ------------------------------------------------------------

ALTER TABLE om_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "om_contracts_read"
  ON om_contracts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR customer_profile_id = auth.uid()
  );

CREATE POLICY "om_contracts_write"
  ON om_contracts FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE om_pricing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "om_pricing_read"
  ON om_pricing_rules FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
  );

CREATE POLICY "om_pricing_write"
  ON om_pricing_rules FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE om_visit_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "om_schedules_read"
  ON om_visit_schedules FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR assigned_to = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "om_schedules_write"
  ON om_visit_schedules FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE om_visit_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "om_visit_reports_read"
  ON om_visit_reports FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
    OR submitted_by = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'om_technician'
  );

CREATE POLICY "om_visit_reports_insert"
  ON om_visit_reports FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

CREATE POLICY "om_visit_reports_update"
  ON om_visit_reports FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'project_manager')
    OR (
      submitted_by = (SELECT id FROM employees WHERE profile_id = auth.uid())
      AND is_locked = FALSE
    )
  );

ALTER TABLE om_visit_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checklist_items_read"
  ON om_visit_checklist_items FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
  );

CREATE POLICY "checklist_items_write"
  ON om_visit_checklist_items FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

ALTER TABLE om_service_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tickets_read"
  ON om_service_tickets FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR raised_by_customer = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = om_service_tickets.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "tickets_insert"
  ON om_service_tickets FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
    OR raised_by_customer = auth.uid()
  );

CREATE POLICY "tickets_update"
  ON om_service_tickets FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

ALTER TABLE plants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plants_read"
  ON plants FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR customer_profile_id = auth.uid()
  );

CREATE POLICY "plants_write"
  ON plants FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE plant_data_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plant_readings_read"
  ON plant_data_readings FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR EXISTS (
      SELECT 1 FROM plants p
      WHERE p.id = plant_data_readings.plant_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "plant_readings_insert"
  ON plant_data_readings FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'om_technician')
  );

ALTER TABLE plant_daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plant_daily_read"
  ON plant_daily_summaries FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR EXISTS (
      SELECT 1 FROM plants p
      WHERE p.id = plant_daily_summaries.plant_id
        AND p.customer_profile_id = auth.uid()
    )
  );

ALTER TABLE om_profitability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "om_profitability_read"
  ON om_profitability FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

CREATE POLICY "om_profitability_write"
  ON om_profitability FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

COMMIT;