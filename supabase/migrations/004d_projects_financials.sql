-- ============================================================
-- Migration 004d — Invoices, Payments, Cash Flow,
--                  Net Metering, Handover, Profitability
-- File: supabase/migrations/004d_projects_financials.sql
-- Description: Customer invoices, payment receipts, project
--              cash positions, net metering tracking, project
--              handovers, customer check-ins, project P&L,
--              cost variances, and portfolio snapshots.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS bom_correction_factor_updates CASCADE;
--   DROP TABLE IF EXISTS project_cost_variances CASCADE;
--   DROP TABLE IF EXISTS project_profitability CASCADE;
--   DROP TABLE IF EXISTS customer_checkins CASCADE;
--   DROP TABLE IF EXISTS project_handovers CASCADE;
--   DROP TABLE IF EXISTS liaison_objections CASCADE;
--   DROP TABLE IF EXISTS liaison_documents CASCADE;
--   DROP TABLE IF EXISTS net_metering_applications CASCADE;
--   DROP TABLE IF EXISTS company_cashflow_snapshots CASCADE;
--   DROP TABLE IF EXISTS project_cash_positions CASCADE;
--   DROP TABLE IF EXISTS customer_payments CASCADE;
--   DROP TABLE IF EXISTS invoice_credit_notes CASCADE;
--   DROP TABLE IF EXISTS invoices CASCADE;
-- Dependencies: 001_foundation.sql, 003a_proposals_core.sql,
--               004a_projects_core.sql, 004c_projects_site_reports.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. invoices
-- Customer invoices raised by Shiroi.
-- Immutable once sent — Tier 3.
-- Numbering: SHIROI/INV/2025-26/0178
-- ------------------------------------------------------------
CREATE TABLE invoices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  proposal_id           UUID REFERENCES proposals(id),
  raised_by             UUID NOT NULL REFERENCES employees(id),

  invoice_number        TEXT NOT NULL UNIQUE,
  invoice_type          TEXT NOT NULL CHECK (invoice_type IN (
    'proforma', 'tax_invoice', 'credit_note'
  )),

  milestone_name        TEXT,
  payment_schedule_id   UUID REFERENCES proposal_payment_schedule(id),

  subtotal_supply       NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotal_works        NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_supply_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_works_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount          NUMERIC(14,2) NOT NULL,
  amount_paid           NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_outstanding    NUMERIC(14,2) NOT NULL DEFAULT 0,

  invoice_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date              DATE NOT NULL,
  sent_at               TIMESTAMPTZ,
  sent_via              TEXT CHECK (sent_via IN (
    'email', 'whatsapp', 'hand_delivered', 'portal'
  )),

  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'
  )),
  paid_at               TIMESTAMPTZ,

  escalation_level      INT NOT NULL DEFAULT 0,
  last_escalated_at     TIMESTAMPTZ,
  legal_flagged         BOOLEAN NOT NULL DEFAULT FALSE,
  legal_flagged_at      TIMESTAMPTZ,

  pdf_storage_path      TEXT,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE invoice_number_seq START 1;

CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_invoices_status  ON invoices(status);
CREATE INDEX idx_invoices_overdue ON invoices(due_date, status)
  WHERE status IN ('sent', 'partially_paid');
CREATE INDEX idx_invoices_legal   ON invoices(legal_flagged)
  WHERE legal_flagged = TRUE;


-- ------------------------------------------------------------
-- 2. invoice_credit_notes
-- Issued against a sent invoice when correction needed.
-- Immutable — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE invoice_credit_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  project_id            UUID NOT NULL REFERENCES projects(id),
  raised_by             UUID NOT NULL REFERENCES employees(id),

  credit_note_number    TEXT NOT NULL UNIQUE,
  reason                TEXT NOT NULL,
  credit_amount         NUMERIC(14,2) NOT NULL,
  gst_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_credit          NUMERIC(14,2) NOT NULL,

  credit_note_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  pdf_storage_path      TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE credit_note_number_seq START 1;

CREATE INDEX idx_credit_notes_invoice ON invoice_credit_notes(invoice_id);
CREATE INDEX idx_credit_notes_project ON invoice_credit_notes(project_id);


-- ------------------------------------------------------------
-- 3. customer_payments
-- Every payment received from customer.
-- Immutable once recorded — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE customer_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  invoice_id            UUID REFERENCES invoices(id),
  recorded_by           UUID NOT NULL REFERENCES employees(id),

  receipt_number        TEXT NOT NULL UNIQUE,
  amount                NUMERIC(14,2) NOT NULL,
  payment_date          DATE NOT NULL,
  payment_method        TEXT NOT NULL CHECK (payment_method IN (
    'bank_transfer', 'upi', 'cheque', 'cash', 'dd'
  )),
  payment_reference     TEXT,
  bank_name             TEXT,
  cheque_date           DATE,
  is_advance            BOOLEAN NOT NULL DEFAULT FALSE,
  receipt_pdf_path      TEXT,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE receipt_number_seq START 1;

CREATE INDEX idx_customer_payments_project ON customer_payments(project_id);
CREATE INDEX idx_customer_payments_invoice ON customer_payments(invoice_id);
CREATE INDEX idx_customer_payments_date    ON customer_payments(payment_date DESC);


-- ------------------------------------------------------------
-- 4. project_cash_positions
-- Computed summary of each project's cash position.
-- Refreshed on every payment event + hourly cron.
-- ------------------------------------------------------------
CREATE TABLE project_cash_positions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL UNIQUE REFERENCES projects(id),

  total_contracted            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_invoiced              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_received              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_outstanding           NUMERIC(14,2) NOT NULL DEFAULT 0,

  total_po_value              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paid_to_vendors       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_vendor_outstanding    NUMERIC(14,2) NOT NULL DEFAULT 0,

  net_cash_position           NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_invested                 BOOLEAN NOT NULL DEFAULT FALSE,
  invested_since              DATE,
  days_invested               INT NOT NULL DEFAULT 0,

  uninvoiced_milestone_alert  BOOLEAN NOT NULL DEFAULT FALSE,
  uninvoiced_since            TIMESTAMPTZ,

  last_computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER project_cash_positions_updated_at
  BEFORE UPDATE ON project_cash_positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_cash_positions_invested ON project_cash_positions(is_invested)
  WHERE is_invested = TRUE;
CREATE INDEX idx_cash_positions_alert    ON project_cash_positions(uninvoiced_milestone_alert)
  WHERE uninvoiced_milestone_alert = TRUE;


-- ------------------------------------------------------------
-- 5. company_cashflow_snapshots
-- Nightly portfolio-level snapshot. Immutable — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE company_cashflow_snapshots (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date                 DATE NOT NULL UNIQUE,

  active_projects_count         INT NOT NULL DEFAULT 0,
  invested_projects_count       INT NOT NULL DEFAULT 0,
  total_contracted_value        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_invoiced                NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_received                NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_outstanding             NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paid_to_vendors         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_vendor_outstanding      NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_working_capital_deployed  NUMERIC(14,2) NOT NULL DEFAULT 0,
  overdue_invoices_count        INT NOT NULL DEFAULT 0,
  overdue_invoices_value        NUMERIC(14,2) NOT NULL DEFAULT 0,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cashflow_snapshots_date ON company_cashflow_snapshots(snapshot_date DESC);


-- ------------------------------------------------------------
-- 6. net_metering_applications
-- ------------------------------------------------------------
CREATE TABLE net_metering_applications (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL UNIQUE REFERENCES projects(id),
  managed_by                  UUID REFERENCES employees(id),

  ceig_required               BOOLEAN NOT NULL DEFAULT FALSE,
  ceig_application_date       DATE,
  ceig_inspection_date        DATE,
  ceig_approval_date          DATE,
  ceig_certificate_number     TEXT,
  ceig_approval_storage_path  TEXT,
  ceig_status                 TEXT NOT NULL DEFAULT 'not_applicable' CHECK (ceig_status IN (
    'not_applicable', 'pending', 'applied', 'inspection_scheduled',
    'approved', 'rejected', 'reapplied'
  )),
  ceig_rejection_reason       TEXT,

  discom_name                 TEXT NOT NULL DEFAULT 'TNEB',
  discom_application_date     DATE,
  discom_application_number   TEXT,
  discom_status               TEXT NOT NULL DEFAULT 'pending' CHECK (discom_status IN (
    'pending', 'applied', 'under_review', 'site_inspection_scheduled',
    'approved', 'net_meter_installed', 'rejected', 'objection_raised'
  )),

  net_meter_installed         BOOLEAN NOT NULL DEFAULT FALSE,
  net_meter_installed_date    DATE,
  net_meter_serial_number     TEXT,
  net_meter_sanction_path     TEXT,

  last_followup_date          DATE,
  next_followup_date          DATE,
  followup_count              INT NOT NULL DEFAULT 0,

  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER net_metering_updated_at
  BEFORE UPDATE ON net_metering_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_net_metering_project  ON net_metering_applications(project_id);
CREATE INDEX idx_net_metering_status   ON net_metering_applications(discom_status);
CREATE INDEX idx_net_metering_followup ON net_metering_applications(next_followup_date)
  WHERE discom_status NOT IN ('net_meter_installed', 'approved');


-- ------------------------------------------------------------
-- 7. liaison_documents
-- ------------------------------------------------------------
CREATE TABLE liaison_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  net_metering_id   UUID NOT NULL REFERENCES net_metering_applications(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id),
  uploaded_by       UUID REFERENCES employees(id),

  document_type     TEXT NOT NULL CHECK (document_type IN (
    'application_form', 'single_line_diagram', 'load_calculation',
    'ownership_proof', 'eb_bill', 'ceig_certificate',
    'discom_sanction', 'net_meter_installation', 'objection_response',
    'other'
  )),

  document_name     TEXT NOT NULL,
  storage_path      TEXT NOT NULL UNIQUE,
  file_size_bytes   BIGINT,
  submitted_date    DATE,
  submitted_to      TEXT,

  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'submitted', 'accepted', 'rejected', 'resubmitted'
  )),
  rejection_reason  TEXT,
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER liaison_docs_updated_at
  BEFORE UPDATE ON liaison_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_liaison_docs_nm      ON liaison_documents(net_metering_id);
CREATE INDEX idx_liaison_docs_project ON liaison_documents(project_id);
CREATE INDEX idx_liaison_docs_status  ON liaison_documents(status);


-- ------------------------------------------------------------
-- 8. liaison_objections
-- ------------------------------------------------------------
CREATE TABLE liaison_objections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  net_metering_id       UUID NOT NULL REFERENCES net_metering_applications(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL REFERENCES projects(id),
  logged_by             UUID NOT NULL REFERENCES employees(id),

  objection_source      TEXT NOT NULL CHECK (objection_source IN (
    'ceig', 'tneb', 'discom_field', 'municipal'
  )),
  objection_type        TEXT NOT NULL CHECK (objection_type IN (
    'document_missing', 'document_incorrect', 'site_inspection_issue',
    'load_calculation_error', 'single_line_diagram_error',
    'capacity_mismatch', 'ownership_dispute', 'technical_standard',
    'other'
  )),

  objection_description TEXT NOT NULL,
  objection_date        DATE NOT NULL,
  objection_letter_path TEXT,

  response_submitted    BOOLEAN NOT NULL DEFAULT FALSE,
  response_date         DATE,
  response_storage_path TEXT,
  resolved              BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_date         DATE,
  days_open             INT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER liaison_objections_updated_at
  BEFORE UPDATE ON liaison_objections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_objections_project ON liaison_objections(project_id);
CREATE INDEX idx_objections_open    ON liaison_objections(project_id)
  WHERE resolved = FALSE;
CREATE INDEX idx_objections_type    ON liaison_objections(objection_type);


-- ------------------------------------------------------------
-- 9. project_handovers
-- ------------------------------------------------------------
CREATE TABLE project_handovers (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                      UUID NOT NULL UNIQUE REFERENCES projects(id),
  commissioning_report_id         UUID NOT NULL REFERENCES commissioning_reports(id),
  prepared_by                     UUID NOT NULL REFERENCES employees(id),

  handover_date                   DATE NOT NULL,

  commissioning_report_included   BOOLEAN NOT NULL DEFAULT TRUE,
  warranty_certificate_included   BOOLEAN NOT NULL DEFAULT FALSE,
  amc_quote_included              BOOLEAN NOT NULL DEFAULT FALSE,
  as_built_drawing_included       BOOLEAN NOT NULL DEFAULT FALSE,
  user_manual_included            BOOLEAN NOT NULL DEFAULT FALSE,
  net_metering_docs_included      BOOLEAN NOT NULL DEFAULT FALSE,
  subsidy_docs_included           BOOLEAN NOT NULL DEFAULT FALSE,

  customer_acknowledged           BOOLEAN NOT NULL DEFAULT FALSE,
  customer_acknowledged_at        TIMESTAMPTZ,
  acknowledgement_method          TEXT CHECK (acknowledgement_method IN (
    'otp_verified', 'physical_signature', 'email_confirmation'
  )),

  amc_quote_sent                  BOOLEAN NOT NULL DEFAULT FALSE,
  amc_quote_sent_at               TIMESTAMPTZ,
  amc_converted                   BOOLEAN NOT NULL DEFAULT FALSE,

  handover_pack_storage_path      TEXT,
  notes                           TEXT,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER project_handovers_updated_at
  BEFORE UPDATE ON project_handovers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_handovers_project ON project_handovers(project_id);
CREATE INDEX idx_handovers_amc     ON project_handovers(amc_converted)
  WHERE amc_converted = FALSE AND amc_quote_sent = TRUE;


-- ------------------------------------------------------------
-- 10. customer_checkins
-- ------------------------------------------------------------
CREATE TABLE customer_checkins (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                UUID NOT NULL REFERENCES projects(id),
  customer_profile_id       UUID REFERENCES profiles(id),
  conducted_by              UUID REFERENCES employees(id),

  checkin_quarter           TEXT NOT NULL,
  checkin_date              DATE NOT NULL,
  checkin_type              TEXT NOT NULL CHECK (checkin_type IN (
    'quarterly_call', 'annual_visit', 'issue_followup'
  )),

  expected_generation_kwh   NUMERIC(10,2),
  actual_generation_kwh     NUMERIC(10,2),
  performance_ratio_pct     NUMERIC(5,2),

  satisfaction_score        INT CHECK (satisfaction_score BETWEEN 1 AND 5),
  nps_score                 INT CHECK (nps_score BETWEEN 0 AND 10),
  feedback_notes            TEXT,

  ai_narrative              TEXT,
  ai_narrative_generated_at TIMESTAMPTZ,

  referral_asked            BOOLEAN NOT NULL DEFAULT FALSE,
  referral_given            BOOLEAN NOT NULL DEFAULT FALSE,

  generation_drop_flagged   BOOLEAN NOT NULL DEFAULT FALSE,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER customer_checkins_updated_at
  BEFORE UPDATE ON customer_checkins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_checkins_project ON customer_checkins(project_id);
CREATE INDEX idx_checkins_quarter ON customer_checkins(checkin_quarter DESC);
CREATE INDEX idx_checkins_drop    ON customer_checkins(generation_drop_flagged)
  WHERE generation_drop_flagged = TRUE;


-- ------------------------------------------------------------
-- 11. project_profitability
-- ------------------------------------------------------------
CREATE TABLE project_profitability (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL UNIQUE REFERENCES projects(id),

  contracted_value        NUMERIC(14,2) NOT NULL,
  change_order_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_revenue           NUMERIC(14,2) NOT NULL,

  material_cost_actual    NUMERIC(14,2) NOT NULL DEFAULT 0,
  labour_cost_actual      NUMERIC(14,2) NOT NULL DEFAULT 0,
  transport_cost_actual   NUMERIC(14,2) NOT NULL DEFAULT 0,
  civil_cost_actual       NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_cost_actual       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost_actual       NUMERIC(14,2) NOT NULL DEFAULT 0,

  material_cost_estimated NUMERIC(14,2) NOT NULL DEFAULT 0,
  labour_cost_estimated   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost_estimated    NUMERIC(14,2) NOT NULL DEFAULT 0,

  gross_profit            NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_margin_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
  margin_vs_proposal_pct  NUMERIC(5,2),

  is_final                BOOLEAN NOT NULL DEFAULT FALSE,
  finalised_by            UUID REFERENCES employees(id),
  finalised_at            TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER project_profitability_updated_at
  BEFORE UPDATE ON project_profitability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_profitability_project ON project_profitability(project_id);
CREATE INDEX idx_profitability_final   ON project_profitability(is_final);
CREATE INDEX idx_profitability_margin  ON project_profitability(gross_margin_pct)
  WHERE is_final = TRUE;


-- ------------------------------------------------------------
-- 12. project_cost_variances
-- ------------------------------------------------------------
CREATE TABLE project_cost_variances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id),
  profitability_id    UUID NOT NULL REFERENCES project_profitability(id),

  item_category       TEXT NOT NULL CHECK (item_category IN (
    'panel', 'inverter', 'battery', 'structure',
    'dc_cable', 'ac_cable', 'conduit', 'earthing',
    'acdb', 'dcdb', 'net_meter', 'civil_work',
    'installation_labour', 'transport', 'other'
  )),

  estimated_cost      NUMERIC(14,2) NOT NULL,
  actual_cost         NUMERIC(14,2) NOT NULL,
  variance_amount     NUMERIC(14,2) NOT NULL,
  variance_pct        NUMERIC(6,2) NOT NULL,
  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cost_variances_project  ON project_cost_variances(project_id);
CREATE INDEX idx_cost_variances_category ON project_cost_variances(item_category);


-- ------------------------------------------------------------
-- 13. bom_correction_factor_updates
-- ------------------------------------------------------------
CREATE TABLE bom_correction_factor_updates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_factor_id  UUID NOT NULL REFERENCES bom_correction_factors(id),
  project_id            UUID NOT NULL REFERENCES projects(id),
  cost_variance_id      UUID NOT NULL REFERENCES project_cost_variances(id),

  previous_factor       NUMERIC(6,4) NOT NULL,
  new_factor            NUMERIC(6,4) NOT NULL,
  data_points_before    INT NOT NULL,
  data_points_after     INT NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bcf_updates_factor  ON bom_correction_factor_updates(correction_factor_id);
CREATE INDEX idx_bcf_updates_project ON bom_correction_factor_updates(project_id);


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_read"
  ON invoices FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager')
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = invoices.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "invoices_insert"
  ON invoices FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE invoice_credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_notes_read"
  ON invoice_credit_notes FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager')
  );

CREATE POLICY "credit_notes_insert"
  ON invoice_credit_notes FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_payments_read"
  ON customer_payments FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager')
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = customer_payments.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "customer_payments_insert"
  ON customer_payments FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE project_cash_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_positions_read"
  ON project_cash_positions FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) IN ('finance', 'project_manager')
      AND EXISTS (
        SELECT 1 FROM project_assignments pa
        JOIN employees e ON e.id = pa.employee_id
        WHERE pa.project_id = project_cash_positions.project_id
          AND e.profile_id = auth.uid()
          AND pa.unassigned_at IS NULL
      )
    )
  );

ALTER TABLE company_cashflow_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cashflow_snapshots_read"
  ON company_cashflow_snapshots FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE net_metering_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "net_metering_read"
  ON net_metering_applications FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = net_metering_applications.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "net_metering_write"
  ON net_metering_applications FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE liaison_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "liaison_docs_read"
  ON liaison_documents FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "liaison_docs_write"
  ON liaison_documents FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE liaison_objections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "liaison_objections_read"
  ON liaison_objections FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "liaison_objections_write"
  ON liaison_objections FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE project_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_handovers_read"
  ON project_handovers FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_handovers.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "project_handovers_write"
  ON project_handovers FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE customer_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkins_read"
  ON customer_checkins FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance', 'om_technician')
    OR customer_profile_id = auth.uid()
  );

CREATE POLICY "checkins_write"
  ON customer_checkins FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

ALTER TABLE project_profitability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profitability_read"
  ON project_profitability FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

CREATE POLICY "profitability_write"
  ON project_profitability FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE project_cost_variances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_variances_read"
  ON project_cost_variances FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

CREATE POLICY "cost_variances_insert"
  ON project_cost_variances FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE bom_correction_factor_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bcf_updates_read"
  ON bom_correction_factor_updates FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

CREATE POLICY "bcf_updates_insert"
  ON bom_correction_factor_updates FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  );

COMMIT;