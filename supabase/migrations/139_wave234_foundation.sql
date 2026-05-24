-- =============================================================================
-- Migration 139 — Wave 2-4 foundations: schema for 8 AI features
-- =============================================================================
-- Part A — Wave 2: monthly_performance_reports + customer_outreach_queue AI cols
-- Part B — Wave 3: rag_ingest_state + sales_territories + leads.ai_score cols
--                  + lead_win_loss_patterns
-- Part C — Wave 4: plant_anomaly_log + qc_photo_findings
--                  + vendor_bills AI extraction cols + vendor-invoices-inbound bucket
-- =============================================================================

-- =============================================================================
-- Part A — Wave 2 schema
-- =============================================================================

-- A4: monthly customer performance reports
CREATE TABLE IF NOT EXISTS monthly_performance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_year INT NOT NULL,
  report_month INT NOT NULL CHECK (report_month BETWEEN 1 AND 12),
  -- Generation data
  actual_kwh_generated NUMERIC(10,2) NOT NULL DEFAULT 0,
  expected_kwh_pvlib NUMERIC(10,2),
  variance_pct NUMERIC(5,2),
  top_generation_date DATE,
  top_generation_kwh NUMERIC(10,2),
  -- Customer-facing
  estimated_savings_inr NUMERIC(14,2),
  ai_narrative TEXT,
  -- Audit
  ai_tokens_in INT,
  ai_tokens_out INT,
  ai_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  whatsapp_template TEXT,
  whatsapp_message_id TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, report_year, report_month)
);

CREATE INDEX idx_monthly_perf_project
  ON monthly_performance_reports (project_id, report_year DESC, report_month DESC);

ALTER TABLE monthly_performance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY monthly_perf_read ON monthly_performance_reports FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('founder','om_technician','project_manager')
  ));

CREATE POLICY monthly_perf_service_write ON monthly_performance_reports
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- F2: per-drip AI personalisation columns on customer_outreach_queue
ALTER TABLE customer_outreach_queue
  ADD COLUMN IF NOT EXISTS ai_personalisation JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_personalised_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_personalisation_model TEXT,
  ADD COLUMN IF NOT EXISTS ai_personalisation_tokens INT;

-- =============================================================================
-- Part B — Wave 3 schema
-- =============================================================================

-- RAG Phase 2: state tracker per source for incremental ingestion
CREATE TABLE IF NOT EXISTS rag_ingest_state (
  source_type TEXT PRIMARY KEY,  -- matches rag_chunks.source_type CHECK
  last_ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_row_id TEXT,        -- the last source row id that was ingested
  chunks_indexed INT NOT NULL DEFAULT 0,
  last_run_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (last_run_status IN ('idle','running','success','error')),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rag_ingest_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY rag_ingest_state_read ON rag_ingest_state FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'founder'
  ));

CREATE POLICY rag_ingest_state_service_write ON rag_ingest_state
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Pre-seed state rows for the structured-source types
INSERT INTO rag_ingest_state (source_type) VALUES
  ('proposal'), ('service_ticket'), ('lead_activity'), ('price_book_item')
ON CONFLICT (source_type) DO NOTHING;

-- F5: sales territory map (city → assignee)
CREATE TABLE IF NOT EXISTS sales_territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_name TEXT NOT NULL,        -- e.g., "Chennai South", "Coimbatore", "Madurai"
  cities TEXT[] NOT NULL DEFAULT '{}', -- normalized lowercase city names
  segment TEXT,                         -- optional: 'residential' / 'commercial' / 'industrial' filter
  default_assignee_employee_id UUID REFERENCES employees(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_territories_active ON sales_territories (active, territory_name);

ALTER TABLE sales_territories ENABLE ROW LEVEL SECURITY;

CREATE POLICY territories_read ON sales_territories FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY territories_founder_write ON sales_territories FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('founder','marketing_manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('founder','marketing_manager')
  ));

-- C1: AI lead scoring fields on leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_score INT CHECK (ai_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ai_score_reason TEXT,
  ADD COLUMN IF NOT EXISTS ai_scored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_scored_model TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_ai_score
  ON leads (ai_score DESC NULLS LAST)
  WHERE status NOT IN ('won','lost','disqualified','converted');

-- C2: win/loss pattern reports
CREATE TABLE IF NOT EXISTS lead_win_loss_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  segment TEXT,                         -- 'residential' / 'commercial' / 'industrial' / NULL = all
  total_leads_won INT NOT NULL DEFAULT 0,
  total_leads_lost INT NOT NULL DEFAULT 0,
  total_value_won NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_value_lost NUMERIC(14,2) NOT NULL DEFAULT 0,
  ai_narrative TEXT NOT NULL,
  ai_pricing_insight TEXT,
  top_loss_reasons JSONB NOT NULL DEFAULT '[]',
  similar_won_examples JSONB NOT NULL DEFAULT '[]',  -- from RAG Phase 2 retrieval
  ai_tokens_used INT,
  ai_model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_winloss_period ON lead_win_loss_patterns (period_start DESC, period_end DESC);

ALTER TABLE lead_win_loss_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY winloss_read ON lead_win_loss_patterns FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('founder','marketing_manager')
  ));

CREATE POLICY winloss_service_write ON lead_win_loss_patterns
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- =============================================================================
-- Part C — Wave 4 schema
-- =============================================================================

-- B3: plant performance anomaly log
CREATE TABLE IF NOT EXISTS plant_anomaly_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN (
    'underperformance','sudden_drop','offline_too_long','data_gap','overperformance_suspect'
  )),
  detected_for_date DATE NOT NULL,
  expected_kwh NUMERIC(10,2),
  actual_kwh NUMERIC(10,2),
  deviation_pct NUMERIC(5,2),
  consecutive_days INT NOT NULL DEFAULT 1,
  ai_narrative TEXT,
  ai_suggested_cause TEXT,
  ai_suggested_action TEXT,
  ai_tokens_used INT,
  ai_model TEXT,
  ticket_id UUID REFERENCES om_service_tickets(id),
  notified_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, anomaly_type, detected_for_date)
);

CREATE INDEX idx_anomaly_project_date
  ON plant_anomaly_log (project_id, detected_for_date DESC);

CREATE INDEX idx_anomaly_unresolved
  ON plant_anomaly_log (created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE plant_anomaly_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY anomaly_read ON plant_anomaly_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('founder','om_technician','project_manager')
  ));

CREATE POLICY anomaly_service_write ON plant_anomaly_log
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- B2: AI photo QC findings on milestone_photos
CREATE TABLE IF NOT EXISTS qc_photo_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_photo_id UUID NOT NULL REFERENCES milestone_photos(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  finding_type TEXT NOT NULL CHECK (finding_type IN (
    'panel_alignment','cable_routing','mms_structural','panel_count_mismatch',
    'safety_concern','image_quality_low','no_issue'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  ai_description TEXT NOT NULL,
  ai_suggested_action TEXT,
  confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  ai_tokens_used INT,
  ai_model TEXT NOT NULL,
  pm_reviewed_at TIMESTAMPTZ,
  pm_reviewed_by UUID REFERENCES profiles(id),
  pm_decision TEXT CHECK (pm_decision IN ('accepted','dismissed_false_positive','escalated')),
  pm_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qc_findings_photo ON qc_photo_findings (milestone_photo_id);
CREATE INDEX idx_qc_findings_project ON qc_photo_findings (project_id, created_at DESC);
CREATE INDEX idx_qc_findings_pending_review
  ON qc_photo_findings (created_at DESC)
  WHERE pm_reviewed_at IS NULL AND severity IN ('warning','critical');

ALTER TABLE qc_photo_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY qc_findings_read ON qc_photo_findings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('founder','project_manager','site_supervisor')
  ));

CREATE POLICY qc_findings_review_update ON qc_photo_findings FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('founder','project_manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('founder','project_manager')
  ));

CREATE POLICY qc_findings_service_write ON qc_photo_findings
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- D3: vendor invoice AI extraction fields on vendor_bills
ALTER TABLE vendor_bills
  ADD COLUMN IF NOT EXISTS ai_extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_confidence_score NUMERIC(3,2)
    CHECK (ai_confidence_score BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS ai_source_email_id TEXT,
  ADD COLUMN IF NOT EXISTS ai_source_attachment_path TEXT,
  ADD COLUMN IF NOT EXISTS ai_model TEXT,
  ADD COLUMN IF NOT EXISTS ai_extracted_data JSONB,
  ADD COLUMN IF NOT EXISTS ai_status TEXT
    CHECK (ai_status IN ('pending_review','approved','rejected','manual_entry'));

CREATE INDEX IF NOT EXISTS idx_vendor_bills_ai_pending
  ON vendor_bills (ai_extracted_at DESC)
  WHERE ai_status = 'pending_review';

-- Storage bucket for incoming vendor invoice emails
INSERT INTO storage.buckets (id, name, public)
  VALUES ('vendor-invoices-inbound', 'vendor-invoices-inbound', false)
ON CONFLICT (id) DO NOTHING;
