-- ============================================================
-- Migration 006b — Marketing Follow-ups + Document Management
-- File: supabase/migrations/006b_marketing_documents.sql
-- Description: Marketing drip sequences, campaign types,
--              delivery tracking, seasonal campaigns,
--              generated documents registry, proforma invoices,
--              payment receipts, HR letters, customer quarterly
--              reports, and finance reports.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS finance_reports CASCADE;
--   DROP TABLE IF EXISTS customer_quarterly_reports CASCADE;
--   DROP TABLE IF EXISTS hr_letters CASCADE;
--   DROP TABLE IF EXISTS payment_receipts CASCADE;
--   DROP TABLE IF EXISTS proforma_invoices CASCADE;
--   DROP TABLE IF EXISTS generated_documents CASCADE;
--   DROP TABLE IF EXISTS marketing_campaign_deliveries CASCADE;
--   DROP TABLE IF EXISTS marketing_campaigns CASCADE;
--   DROP TABLE IF EXISTS drip_sequence_enrollments CASCADE;
--   DROP TABLE IF EXISTS drip_sequence_steps CASCADE;
--   DROP TABLE IF EXISTS drip_sequences CASCADE;
-- Dependencies: 001_foundation.sql, 002a_leads_core.sql,
--               004a_projects_core.sql, 004d_projects_financials.sql,
--               005a_hr_master.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. drip_sequences
-- ------------------------------------------------------------
CREATE TABLE drip_sequences (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_name         TEXT NOT NULL UNIQUE,
  description           TEXT,

  trigger_event         TEXT NOT NULL CHECK (trigger_event IN (
    'lead_created',
    'site_survey_completed',
    'proposal_sent',
    'proposal_viewed',
    'proposal_expired',
    'won_post_commissioning',
    'amc_expiry_approaching',
    'seasonal_campaign',
    'custom'
  )),

  target_segment        customer_segment,
  target_source         lead_source,

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  total_steps           INT NOT NULL DEFAULT 0,

  created_by            UUID REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER drip_sequences_updated_at
  BEFORE UPDATE ON drip_sequences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_drip_sequences_active  ON drip_sequences(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_drip_sequences_trigger ON drip_sequences(trigger_event);


-- ------------------------------------------------------------
-- 2. drip_sequence_steps
-- ------------------------------------------------------------
CREATE TABLE drip_sequence_steps (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id           UUID NOT NULL REFERENCES drip_sequences(id) ON DELETE CASCADE,

  step_number           INT NOT NULL,
  delay_days            INT NOT NULL DEFAULT 0,

  channel               TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN (
    'whatsapp', 'email', 'sms', 'call_reminder'
  )),

  message_template      TEXT NOT NULL,
  message_type          TEXT NOT NULL CHECK (message_type IN (
    'follow_up', 'educational', 'offer',
    'reminder', 'feedback_request', 'referral_ask'
  )),

  variables_required    TEXT[] NOT NULL DEFAULT '{}',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER drip_steps_updated_at
  BEFORE UPDATE ON drip_sequence_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_drip_steps_sequence_order
  ON drip_sequence_steps(sequence_id, step_number);
CREATE INDEX idx_drip_steps_active ON drip_sequence_steps(is_active) WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 3. drip_sequence_enrollments
-- ------------------------------------------------------------
CREATE TABLE drip_sequence_enrollments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id           UUID NOT NULL REFERENCES drip_sequences(id),
  lead_id               UUID REFERENCES leads(id),
  project_id            UUID REFERENCES projects(id),

  enrolled_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_step          INT NOT NULL DEFAULT 1,
  next_step_due         DATE,

  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'paused', 'completed', 'unsubscribed', 'converted'
  )),

  paused_reason         TEXT,
  completed_at          TIMESTAMPTZ,
  unsubscribed_at       TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER drip_enrollments_updated_at
  BEFORE UPDATE ON drip_sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_drip_enrollments_lead_sequence
  ON drip_sequence_enrollments(sequence_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX idx_drip_enrollments_project_sequence
  ON drip_sequence_enrollments(sequence_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_drip_enrollments_due
  ON drip_sequence_enrollments(next_step_due) WHERE status = 'active';
CREATE INDEX idx_drip_enrollments_active
  ON drip_sequence_enrollments(status) WHERE status = 'active';


-- ------------------------------------------------------------
-- 4. marketing_campaigns
-- ------------------------------------------------------------
CREATE TABLE marketing_campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name         TEXT NOT NULL,
  description           TEXT,

  campaign_type         TEXT NOT NULL CHECK (campaign_type IN (
    'seasonal', 'subsidy_deadline', 'referral_push',
    'price_change', 'new_product', 'reactivation', 'other'
  )),

  target_segment        customer_segment,
  target_source         lead_source,
  target_status         TEXT,

  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,

  message_template      TEXT NOT NULL,
  channel               TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN (
    'whatsapp', 'email', 'sms', 'all'
  )),

  target_count          INT NOT NULL DEFAULT 0,
  sent_count            INT NOT NULL DEFAULT 0,
  responded_count       INT NOT NULL DEFAULT 0,
  converted_count       INT NOT NULL DEFAULT 0,

  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'scheduled', 'active', 'completed', 'cancelled'
  )),

  created_by            UUID REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER marketing_campaigns_updated_at
  BEFORE UPDATE ON marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_campaigns_status ON marketing_campaigns(status);
CREATE INDEX idx_campaigns_dates  ON marketing_campaigns(start_date, end_date)
  WHERE status IN ('scheduled', 'active');


-- ------------------------------------------------------------
-- 5. marketing_campaign_deliveries
-- ------------------------------------------------------------
CREATE TABLE marketing_campaign_deliveries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES marketing_campaigns(id),
  lead_id               UUID REFERENCES leads(id),
  project_id            UUID REFERENCES projects(id),
  sent_by_employee      UUID REFERENCES employees(id),

  sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel               TEXT NOT NULL,
  delivery_status       TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN (
    'sent', 'delivered', 'read', 'failed', 'bounced'
  )),

  responded             BOOLEAN NOT NULL DEFAULT FALSE,
  responded_at          TIMESTAMPTZ,
  response_summary      TEXT,
  converted             BOOLEAN NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaign_deliveries_campaign ON marketing_campaign_deliveries(campaign_id);
CREATE INDEX idx_campaign_deliveries_lead
  ON marketing_campaign_deliveries(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_campaign_deliveries_pending
  ON marketing_campaign_deliveries(responded) WHERE responded = FALSE;


-- ------------------------------------------------------------
-- 6. generated_documents
-- Central registry for ALL 60 document types.
-- ------------------------------------------------------------
CREATE TABLE generated_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  document_type         TEXT NOT NULL CHECK (document_type IN (
    'proposal_pdf', 'proforma_invoice', 'customer_tax_invoice',
    'credit_note', 'delivery_challan_outward', 'delivery_challan_signed',
    'purchase_order', 'po_amendment', 'letter_of_intent',
    'commissioning_report_unsigned', 'commissioning_report_signed',
    'handover_pack', 'warranty_certificate', 'amc_quote',
    'amc_contract_signed', 'om_visit_report', 'service_resolution_report',
    'quarterly_performance_report', 'payment_receipt', 'change_order',
    'subcontractor_work_order', 'referral_reward_letter',
    'qc_gate_report', 'non_conformance_report', 'bill_clearing_package',
    'cost_variance_report', 'payroll_export_csv', 'payroll_statement_pdf',
    'hr_offer_letter', 'hr_increment_letter', 'hr_ff_letter',
    'hr_experience_letter', 'hr_relieving_letter',
    'training_certificate', 'portfolio_cashflow_report',
    'om_profitability_report',
    'vendor_delivery_challan', 'vendor_tax_invoice', 'vendor_quotation',
    'ceig_approval_letter', 'discom_net_meter_sanction',
    'discom_objection_letter', 'panel_warranty_card',
    'inverter_warranty_card', 'insurance_policy',
    'site_survey_photo', 'installation_photo', 'qc_gate_photo',
    'commissioning_photo', 'om_visit_photo', 'signed_dc_scan',
    'drawn_signature', 'autocad_drawing', 'as_built_drawing'
  )),

  -- Provenance FKs — one non-null per row
  project_id            UUID REFERENCES projects(id),
  proposal_id           UUID REFERENCES proposals(id),
  vendor_id             UUID REFERENCES vendors(id),
  purchase_order_id     UUID REFERENCES purchase_orders(id),
  invoice_id            UUID REFERENCES invoices(id),
  employee_id           UUID REFERENCES employees(id),
  om_contract_id        UUID REFERENCES om_contracts(id),
  om_ticket_id          UUID REFERENCES om_service_tickets(id),
  customer_id           UUID REFERENCES profiles(id),
  referral_id           UUID REFERENCES lead_referrals(id),

  -- File details
  storage_path          TEXT NOT NULL UNIQUE,
  file_name             TEXT NOT NULL,
  file_size_bytes       BIGINT,
  mime_type             TEXT DEFAULT 'application/pdf',
  checksum_sha256       TEXT,

  -- Versioning
  version               INT NOT NULL DEFAULT 1,
  supersedes_id         UUID REFERENCES generated_documents(id),
  is_current            BOOLEAN NOT NULL DEFAULT TRUE,

  -- Generation
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by          UUID REFERENCES profiles(id),
  status                TEXT NOT NULL DEFAULT 'generated' CHECK (status IN (
    'generating', 'generated', 'sent', 'viewed', 'failed'
  )),
  source                TEXT NOT NULL DEFAULT 'erp_generated' CHECK (source IN (
    'erp_generated', 'field_upload', 'vendor_received', 'authority_received'
  )),

  -- Delivery
  sent_to_email         TEXT,
  sent_to_whatsapp      TEXT,
  sent_at               TIMESTAMPTZ,
  sent_by               UUID REFERENCES profiles(id),

  -- Signature tracking
  requires_signature    BOOLEAN NOT NULL DEFAULT FALSE,
  signed_by_name        TEXT,
  signed_at             TIMESTAMPTZ,
  signature_method      TEXT CHECK (signature_method IN (
    'otp_verified', 'drawn', 'physical_scan', 'digital_certificate'
  )),

  -- Access control
  is_confidential       BOOLEAN NOT NULL DEFAULT FALSE,
  accessible_to_customer BOOLEAN NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gd_project  ON generated_documents(project_id, document_type)
  WHERE project_id IS NOT NULL;
CREATE INDEX idx_gd_type_date ON generated_documents(document_type, generated_at DESC);
CREATE INDEX idx_gd_customer  ON generated_documents(customer_id, accessible_to_customer)
  WHERE customer_id IS NOT NULL;
CREATE INDEX idx_gd_current   ON generated_documents(is_current) WHERE is_current = TRUE;
CREATE INDEX idx_gd_proposal  ON generated_documents(proposal_id) WHERE proposal_id IS NOT NULL;
CREATE INDEX idx_gd_employee  ON generated_documents(employee_id) WHERE employee_id IS NOT NULL;


-- ------------------------------------------------------------
-- 7. proforma_invoices
-- ------------------------------------------------------------
CREATE TABLE proforma_invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  proposal_id             UUID REFERENCES proposals(id),
  raised_by               UUID NOT NULL REFERENCES employees(id),

  proforma_number         TEXT NOT NULL UNIQUE,
  amount                  NUMERIC(14,2) NOT NULL,
  gst_amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount            NUMERIC(14,2) NOT NULL,

  issued_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until             DATE NOT NULL,

  converted_to_invoice    BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_id              UUID REFERENCES invoices(id),
  converted_at            TIMESTAMPTZ,

  pdf_storage_path        TEXT,
  notes                   TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE proforma_number_seq START 1;

CREATE INDEX idx_proforma_project ON proforma_invoices(project_id);
CREATE INDEX idx_proforma_pending ON proforma_invoices(converted_to_invoice)
  WHERE converted_to_invoice = FALSE;


-- ------------------------------------------------------------
-- 8. payment_receipts
-- ------------------------------------------------------------
CREATE TABLE payment_receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id            UUID NOT NULL UNIQUE REFERENCES customer_payments(id),
  project_id            UUID NOT NULL REFERENCES projects(id),
  generated_by          UUID NOT NULL REFERENCES employees(id),

  receipt_number        TEXT NOT NULL UNIQUE,
  amount                NUMERIC(14,2) NOT NULL,
  payment_date          DATE NOT NULL,
  payment_method        TEXT NOT NULL,

  pdf_storage_path      TEXT NOT NULL,
  sent_to_customer      BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at               TIMESTAMPTZ,
  sent_via              TEXT CHECK (sent_via IN (
    'whatsapp', 'email', 'hand_delivered'
  )),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_receipts_project ON payment_receipts(project_id);
CREATE INDEX idx_payment_receipts_pending ON payment_receipts(sent_to_customer)
  WHERE sent_to_customer = FALSE;


-- ------------------------------------------------------------
-- 9. hr_letters
-- ------------------------------------------------------------
CREATE TABLE hr_letters (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  generated_by          UUID NOT NULL REFERENCES employees(id),

  letter_type           TEXT NOT NULL CHECK (letter_type IN (
    'offer_letter', 'appointment_letter', 'increment_letter',
    'promotion_letter', 'transfer_letter', 'warning_letter',
    'experience_letter', 'relieving_letter', 'ff_settlement'
  )),

  letter_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_date        DATE,
  designation           TEXT,
  department            TEXT,
  ctc_annual            NUMERIC(14,2),

  pdf_storage_path      TEXT NOT NULL,
  handed_over           BOOLEAN NOT NULL DEFAULT FALSE,
  handed_over_at        TIMESTAMPTZ,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hr_letters_employee ON hr_letters(employee_id);
CREATE INDEX idx_hr_letters_type     ON hr_letters(letter_type);


-- ------------------------------------------------------------
-- 10. customer_quarterly_reports
-- ------------------------------------------------------------
CREATE TABLE customer_quarterly_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id),
  plant_id              UUID NOT NULL REFERENCES plants(id),
  customer_profile_id   UUID REFERENCES profiles(id),
  generated_by          UUID REFERENCES employees(id),

  report_quarter        TEXT NOT NULL,
  report_year           INT NOT NULL,
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,

  expected_kwh          NUMERIC(10,2),
  actual_kwh            NUMERIC(10,2),
  performance_ratio_pct NUMERIC(5,2),
  co2_avoided_kg        NUMERIC(8,2),
  savings_amount        NUMERIC(14,2),

  ai_narrative          TEXT,
  ai_narrative_generated_at TIMESTAMPTZ,

  pdf_storage_path      TEXT,
  sent_to_customer      BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at               TIMESTAMPTZ,
  sent_via              TEXT CHECK (sent_via IN (
    'whatsapp', 'email', 'portal'
  )),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_quarterly_reports_plant_quarter
  ON customer_quarterly_reports(plant_id, report_quarter);
CREATE INDEX idx_quarterly_reports_project ON customer_quarterly_reports(project_id);
CREATE INDEX idx_quarterly_reports_pending ON customer_quarterly_reports(sent_to_customer)
  WHERE sent_to_customer = FALSE;


-- ------------------------------------------------------------
-- 11. finance_reports
-- ------------------------------------------------------------
CREATE TABLE finance_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_by          UUID REFERENCES employees(id),

  report_type           TEXT NOT NULL CHECK (report_type IN (
    'portfolio_cashflow', 'om_profitability', 'payroll_summary',
    'project_margin_summary', 'overdue_invoices',
    'vendor_payments_due', 'other'
  )),

  report_period_start   DATE NOT NULL,
  report_period_end     DATE NOT NULL,
  pdf_storage_path      TEXT,
  csv_storage_path      TEXT,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_finance_reports_type ON finance_reports(report_type, generated_at DESC);


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

ALTER TABLE drip_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drip_sequences_read"
  ON drip_sequences FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "drip_sequences_write"
  ON drip_sequences FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

ALTER TABLE drip_sequence_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drip_steps_read"
  ON drip_sequence_steps FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "drip_steps_write"
  ON drip_sequence_steps FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

ALTER TABLE drip_sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drip_enrollments_read"
  ON drip_sequence_enrollments FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "drip_enrollments_write"
  ON drip_sequence_enrollments FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_read"
  ON marketing_campaigns FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "campaigns_write"
  ON marketing_campaigns FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

ALTER TABLE marketing_campaign_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_deliveries_read"
  ON marketing_campaign_deliveries FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "campaign_deliveries_insert"
  ON marketing_campaign_deliveries FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

-- generated_documents: employees covered by specific role checks.
-- Customers see only their own accessible documents.
ALTER TABLE generated_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generated_docs_read"
  ON generated_documents FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager', 'sales_engineer',
       'hr_manager', 'site_supervisor', 'om_technician')
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'customer'
      AND accessible_to_customer = TRUE
      AND customer_id = auth.uid()
    )
  );

CREATE POLICY "generated_docs_insert"
  ON generated_documents FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager', 'sales_engineer', 'hr_manager')
  );

ALTER TABLE proforma_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proforma_read"
  ON proforma_invoices FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager', 'sales_engineer')
  );

CREATE POLICY "proforma_insert"
  ON proforma_invoices FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_receipts_read"
  ON payment_receipts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager')
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = payment_receipts.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "payment_receipts_insert"
  ON payment_receipts FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE hr_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_letters_read"
  ON hr_letters FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "hr_letters_insert"
  ON hr_letters FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE customer_quarterly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quarterly_reports_read"
  ON customer_quarterly_reports FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR customer_profile_id = auth.uid()
  );

CREATE POLICY "quarterly_reports_insert"
  ON customer_quarterly_reports FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

ALTER TABLE finance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance_reports_read"
  ON finance_reports FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

CREATE POLICY "finance_reports_insert"
  ON finance_reports FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

COMMIT;