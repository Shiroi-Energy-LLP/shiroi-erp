-- supabase/migrations/025_whatsapp_import_queue.sql
-- Review queue for WhatsApp import records pending human approval

CREATE TABLE whatsapp_import_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source metadata
  chat_profile          TEXT NOT NULL CHECK (chat_profile IN ('marketing', 'llp', 'shiroi_energy', 'site')),
  message_hash          TEXT NOT NULL,
  message_timestamp     TIMESTAMPTZ NOT NULL,
  sender_name           TEXT NOT NULL,
  raw_message_text      TEXT,
  media_filenames       TEXT[],

  -- Extraction result
  extraction_type       TEXT NOT NULL CHECK (extraction_type IN (
    'customer_payment', 'vendor_payment', 'purchase_order', 'boq_item',
    'task', 'activity', 'contact', 'site_photo', 'daily_report', 'unknown'
  )),
  extracted_data        JSONB NOT NULL DEFAULT '{}',
  confidence_score      NUMERIC(4,3),
  matched_project_id    UUID REFERENCES projects(id),
  matched_lead_id       UUID REFERENCES leads(id),
  matched_project_name  TEXT,

  -- Review status
  review_status         TEXT NOT NULL DEFAULT 'pending'
                        CHECK (review_status IN ('pending', 'approved', 'rejected', 'auto_inserted')),
  reviewed_by           UUID REFERENCES employees(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,

  -- If approved, where did it land?
  inserted_table        TEXT,
  inserted_id           UUID,

  -- Financial flag
  requires_finance_review BOOLEAN NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_whatsapp_queue_hash ON whatsapp_import_queue(message_hash);
CREATE INDEX idx_whatsapp_queue_status ON whatsapp_import_queue(review_status);
CREATE INDEX idx_whatsapp_queue_profile ON whatsapp_import_queue(chat_profile);
CREATE INDEX idx_whatsapp_queue_project ON whatsapp_import_queue(matched_project_id);
CREATE INDEX idx_whatsapp_queue_type ON whatsapp_import_queue(extraction_type);

ALTER TABLE whatsapp_import_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "founder_pm_finance_read_queue"
  ON whatsapp_import_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('founder', 'project_manager', 'finance', 'purchase_officer')
    )
  );

CREATE POLICY "founder_pm_finance_update_queue"
  ON whatsapp_import_queue FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('founder', 'project_manager', 'finance', 'purchase_officer')
    )
  );

CREATE POLICY "admin_insert_queue"
  ON whatsapp_import_queue FOR INSERT
  WITH CHECK (true);
