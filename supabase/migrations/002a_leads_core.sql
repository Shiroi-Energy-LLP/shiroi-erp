-- ============================================================
-- Migration 002a — Vendors + Lead Core
-- File: supabase/migrations/002a_leads_core.sql
-- Description: Vendor master, core lead table, activities,
--              status history, documents, site surveys,
--              assignments, and competitors.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS lead_competitors CASCADE;
--   DROP TABLE IF EXISTS lead_assignments CASCADE;
--   DROP TABLE IF EXISTS lead_site_surveys CASCADE;
--   DROP TABLE IF EXISTS lead_documents CASCADE;
--   DROP TABLE IF EXISTS lead_status_history CASCADE;
--   DROP TABLE IF EXISTS lead_activities CASCADE;
--   DROP TABLE IF EXISTS leads CASCADE;
--   DROP TABLE IF EXISTS vendors CASCADE;
--   DROP TYPE  IF EXISTS lead_status;
--   DROP TYPE  IF EXISTS lead_source;
-- Dependencies: 001_foundation.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Enums for leads domain
-- ------------------------------------------------------------
CREATE TYPE lead_source AS ENUM (
  'referral',
  'website',
  'builder_tie_up',
  'channel_partner',
  'cold_call',
  'exhibition',
  'social_media',
  'walkin'
);

CREATE TYPE lead_status AS ENUM (
  'new',
  'contacted',
  'site_survey_scheduled',
  'site_survey_done',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
  'on_hold',
  'disqualified'
);

CREATE TYPE system_type AS ENUM (
  'on_grid',
  'hybrid',
  'off_grid'
);

CREATE TYPE customer_segment AS ENUM (
  'residential',
  'commercial',
  'industrial'
);


-- ------------------------------------------------------------
-- 2. vendors
-- Supplier master. Referenced by leads (site survey contacts)
-- and heavily by procurement domain (Migration 005).
-- Created here because leads domain references it first.
-- ------------------------------------------------------------
CREATE TABLE vendors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code           TEXT NOT NULL UNIQUE,
  -- Format: VEN-001, VEN-002 etc.

  company_name          TEXT NOT NULL,
  contact_person        TEXT,
  phone                 TEXT,
  email                 TEXT,
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT,
  state                 TEXT,
  pincode               TEXT,

  gstin                 TEXT,
  pan_number            TEXT,

  vendor_type           TEXT NOT NULL CHECK (vendor_type IN (
    'panel_supplier',
    'inverter_supplier',
    'structure_supplier',
    'cable_supplier',
    'electrical_supplier',
    'civil_contractor',
    'labour_contractor',
    'transport',
    'other'
  )),

  is_msme               BOOLEAN NOT NULL DEFAULT FALSE,
  -- MSME vendors: 45-day payment legal maximum. System alerts Day 40.

  is_preferred          BOOLEAN NOT NULL DEFAULT FALSE,
  is_blacklisted        BOOLEAN NOT NULL DEFAULT FALSE,
  blacklist_reason      TEXT,

  payment_terms_days    INT NOT NULL DEFAULT 30,
  -- Overridden per PO if needed. MSME cap enforced separately.

  bank_account_number   TEXT,
  bank_ifsc             TEXT,
  bank_name             TEXT,
  bank_account_name     TEXT,

  notes                 TEXT,

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_vendors_type      ON vendors(vendor_type);
CREATE INDEX idx_vendors_active    ON vendors(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_vendors_msme      ON vendors(is_msme) WHERE is_msme = TRUE;
CREATE INDEX idx_vendors_preferred ON vendors(is_preferred) WHERE is_preferred = TRUE;


-- ------------------------------------------------------------
-- 3. leads
-- Core lead record. One row per potential customer inquiry.
-- A lead becomes a project ONLY after: proposal accepted
-- AND advance payment received.
-- ------------------------------------------------------------
CREATE TABLE leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  customer_name         TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  -- Checked against blacklisted_phones on insert (app layer + DB trigger in 002b).
  email                 TEXT,
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT NOT NULL DEFAULT 'Chennai',
  state                 TEXT NOT NULL DEFAULT 'Tamil Nadu',
  pincode               TEXT,

  -- Lead classification
  source                lead_source NOT NULL,
  segment               customer_segment NOT NULL,
  system_type           system_type,
  estimated_size_kwp    NUMERIC(6,2),
  -- Rough estimate at inquiry stage. Confirmed in proposal.

  -- Status
  status                lead_status NOT NULL DEFAULT 'new',
  status_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Assignment
  assigned_to           UUID REFERENCES employees(id),
  -- Sales engineer responsible. Also tracked in lead_assignments.

  -- Qualification
  is_qualified          BOOLEAN NOT NULL DEFAULT FALSE,
  disqualification_reason TEXT,

  -- Conversion
  converted_to_project  BOOLEAN NOT NULL DEFAULT FALSE,
  converted_at          TIMESTAMPTZ,
  -- Populated when lead → project conversion happens.

  -- Follow-up
  next_followup_date    DATE,
  last_contacted_at     TIMESTAMPTZ,

  -- Automation pause flag
  -- All automation pauses when customer has open unresolved complaint.
  automation_paused     BOOLEAN NOT NULL DEFAULT FALSE,
  automation_pause_reason TEXT,

  -- HubSpot migration
  hubspot_deal_id       TEXT UNIQUE,
  -- Populated during data migration. NULL for all new leads.

  notes                 TEXT,

  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_leads_status       ON leads(status);
CREATE INDEX idx_leads_assigned     ON leads(assigned_to);
CREATE INDEX idx_leads_phone        ON leads(phone);
CREATE INDEX idx_leads_source       ON leads(source);
CREATE INDEX idx_leads_segment      ON leads(segment);
CREATE INDEX idx_leads_followup     ON leads(next_followup_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_converted    ON leads(converted_to_project) WHERE converted_to_project = FALSE;
CREATE INDEX idx_leads_hubspot      ON leads(hubspot_deal_id) WHERE hubspot_deal_id IS NOT NULL;


-- ------------------------------------------------------------
-- 4. lead_activities
-- Every touchpoint logged: calls, visits, emails, WhatsApp.
-- Tier 1 — freely editable within 48h, Tier 2 after.
-- ------------------------------------------------------------
CREATE TABLE lead_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  performed_by    UUID NOT NULL REFERENCES employees(id),

  activity_type   TEXT NOT NULL CHECK (activity_type IN (
    'call', 'whatsapp', 'email', 'site_visit',
    'meeting', 'proposal_sent', 'follow_up', 'note'
  )),

  summary         TEXT NOT NULL,
  outcome         TEXT,
  -- e.g. "interested", "needs time", "not reachable", "price concern"

  activity_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  duration_minutes INT,
  -- For calls and meetings.

  next_action     TEXT,
  next_action_date DATE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lead_activities_updated_at
  BEFORE UPDATE ON lead_activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_lead_activities_lead ON lead_activities(lead_id, activity_date DESC);
CREATE INDEX idx_lead_activities_by   ON lead_activities(performed_by);


-- ------------------------------------------------------------
-- 5. lead_status_history
-- Immutable log of every status change. Tier 3 — never edited.
-- Enables: time-in-stage analysis, funnel analytics.
-- ------------------------------------------------------------
CREATE TABLE lead_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  changed_by      UUID NOT NULL REFERENCES employees(id),

  from_status     lead_status,
  -- NULL on first entry (lead created).
  to_status       lead_status NOT NULL,

  reason          TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No updated_at — this table is immutable. No UPDATE ever runs on it.
);

CREATE INDEX idx_lead_status_history_lead ON lead_status_history(lead_id, changed_at DESC);


-- ------------------------------------------------------------
-- 6. lead_documents
-- Site survey photos, initial drawings, any docs at lead stage.
-- Full document registry comes in generated_documents (later).
-- ------------------------------------------------------------
CREATE TABLE lead_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  uploaded_by     UUID NOT NULL REFERENCES employees(id),

  document_type   TEXT NOT NULL CHECK (document_type IN (
    'site_photo', 'roof_drawing', 'electricity_bill',
    'existing_system_photo', 'other'
  )),

  file_name       TEXT NOT NULL,
  storage_path    TEXT NOT NULL UNIQUE,
  file_size_bytes BIGINT,
  mime_type       TEXT,

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable after upload. No updated_at.
);

CREATE INDEX idx_lead_documents_lead ON lead_documents(lead_id);


-- ------------------------------------------------------------
-- 7. lead_site_surveys
-- Roof assessment done before proposal. One per lead typically,
-- but can have multiple if site conditions change.
-- ------------------------------------------------------------
CREATE TABLE lead_site_surveys (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  surveyed_by           UUID NOT NULL REFERENCES employees(id),

  survey_date           DATE NOT NULL,

  -- Roof details
  roof_type             TEXT CHECK (roof_type IN (
    'flat_rcc', 'sloped_rcc', 'tin_sheet', 'mangalore_tile',
    'asbestos', 'metal_deck', 'other'
  )),
  roof_area_sqft        NUMERIC(8,2),
  usable_area_sqft      NUMERIC(8,2),
  -- Usable after accounting for shading, setbacks, HVAC units etc.

  shading_assessment    TEXT CHECK (shading_assessment IN (
    'none', 'minimal', 'moderate', 'severe'
  )),
  shading_notes         TEXT,

  -- Structure
  structure_type        TEXT CHECK (structure_type IN (
    'rcc_column', 'elevated_ms', 'ground_mount', 'carport', 'other'
  )),
  structure_by          TEXT CHECK (structure_by IN (
    'shiroi', 'client', 'builder'
  )),

  -- Electrical
  existing_load_kw      NUMERIC(6,2),
  sanctioned_load_kw    NUMERIC(6,2),
  discom_name           TEXT DEFAULT 'TNEB',
  meter_type            TEXT CHECK (meter_type IN (
    'single_phase', 'three_phase'
  )),
  net_metering_eligible BOOLEAN,

  -- Recommended system
  recommended_size_kwp  NUMERIC(6,2),
  recommended_system_type system_type,

  notes                 TEXT,
  is_final              BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE when survey is approved and used as basis for proposal.

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lead_site_surveys_updated_at
  BEFORE UPDATE ON lead_site_surveys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_lead_site_surveys_lead ON lead_site_surveys(lead_id);


-- ------------------------------------------------------------
-- 8. lead_assignments
-- Tracks which sales engineer owns a lead and when ownership
-- changed. Enables: workload analysis, commission attribution.
-- ------------------------------------------------------------
CREATE TABLE lead_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to     UUID NOT NULL REFERENCES employees(id),
  assigned_by     UUID NOT NULL REFERENCES employees(id),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at   TIMESTAMPTZ,
  -- NULL = currently active assignment.
  reason          TEXT
);

CREATE INDEX idx_lead_assignments_lead     ON lead_assignments(lead_id);
CREATE INDEX idx_lead_assignments_employee ON lead_assignments(assigned_to);
CREATE INDEX idx_lead_assignments_active   ON lead_assignments(lead_id)
  WHERE unassigned_at IS NULL;


-- ------------------------------------------------------------
-- 9. lead_competitors
-- Competitor quotes seen during a deal.
-- Enables: win/loss analysis by competitor and price point.
-- ------------------------------------------------------------
CREATE TABLE lead_competitors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  competitor_name   TEXT NOT NULL,
  quoted_amount     NUMERIC(14,2),
  quoted_size_kwp   NUMERIC(6,2),
  lost_to_them      BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE if this competitor is why we lost the deal.

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_competitors_lead ON lead_competitors(lead_id);


-- ------------------------------------------------------------
-- RLS — leads domain core tables
-- ------------------------------------------------------------

-- vendors: all internal roles can read. Only founder/hr_manager/finance write.
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendors_read"
  ON vendors FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "vendors_write"
  ON vendors FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance', 'project_manager')
  );

-- leads: sales engineers see own leads. Founder/hr_manager see all.
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_read"
  ON leads FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager', 'finance')
    OR assigned_to = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'sales_engineer'
  );

CREATE POLICY "leads_insert"
  ON leads FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "leads_update"
  ON leads FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR assigned_to = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

-- lead_activities: same as leads
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_activities_read"
  ON lead_activities FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager', 'finance')
    OR performed_by = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'sales_engineer'
  );

CREATE POLICY "lead_activities_write"
  ON lead_activities FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

-- lead_status_history: read-only for all internal roles. No update/delete.
ALTER TABLE lead_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_status_history_read"
  ON lead_status_history FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "lead_status_history_insert"
  ON lead_status_history FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

-- lead_documents
ALTER TABLE lead_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_documents_read"
  ON lead_documents FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "lead_documents_insert"
  ON lead_documents FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

-- lead_site_surveys
ALTER TABLE lead_site_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_site_surveys_read"
  ON lead_site_surveys FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "lead_site_surveys_write"
  ON lead_site_surveys FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

-- lead_assignments
ALTER TABLE lead_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_assignments_read"
  ON lead_assignments FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "lead_assignments_write"
  ON lead_assignments FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

-- lead_competitors
ALTER TABLE lead_competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_competitors_read"
  ON lead_competitors FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager', 'finance')
  );

CREATE POLICY "lead_competitors_write"
  ON lead_competitors FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

COMMIT;