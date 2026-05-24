-- Migration 129: Customer WhatsApp message log
-- Tracks all outbound customer-facing WhatsApp template messages sent via Meta API.
-- Pairs with n8n workflows 40-47 (F1 customer drip sequences).

CREATE TABLE IF NOT EXISTS customer_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  lead_id UUID REFERENCES leads(id),
  recipient_phone TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_vars JSONB,
  meta_wamid TEXT,                         -- WhatsApp message ID from Meta delivery
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','read','failed')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_msg_log_project ON customer_message_log(project_id);
CREATE INDEX idx_customer_msg_log_meta_wamid ON customer_message_log(meta_wamid);
CREATE INDEX idx_customer_msg_log_status ON customer_message_log(status, created_at);
