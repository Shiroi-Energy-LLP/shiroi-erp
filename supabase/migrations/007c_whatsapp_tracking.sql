-- ============================================================
-- Migration 007c — WhatsApp Delivery Tracking
-- File: supabase/migrations/007c_whatsapp_tracking.sql
-- Description: Add delivery_method_active to drip_sequence_steps
--              for Phase 1→2 toggle. Add message_delivery_log
--              for employee forwarding audit trail.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS message_delivery_log CASCADE;
--   ALTER TABLE drip_sequence_steps DROP COLUMN IF EXISTS delivery_method_active;
-- Dependencies: 006b_marketing_documents.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Add delivery_method_active to drip_sequence_steps
-- When Phase 2 (WATI.io) is live, flip this per step from
-- 'employee_forward' to 'direct_api'. No migration needed.
-- ------------------------------------------------------------
ALTER TABLE drip_sequence_steps
  ADD COLUMN delivery_method_active TEXT NOT NULL DEFAULT 'employee_forward'
  CHECK (delivery_method_active IN ('employee_forward', 'direct_api'));

COMMENT ON COLUMN drip_sequence_steps.delivery_method_active IS
  'employee_forward = Phase 1 (n8n → employee → customer). '
  'direct_api = Phase 2 (WATI.io BSP direct send). '
  'Flip per-step when Phase 2 goes live. No migration needed.';


-- ------------------------------------------------------------
-- 2. message_delivery_log
-- Tracks the employee leg of WhatsApp Phase 1.
-- n8n sends alert to employee → employee forwards to customer.
-- Without this, no visibility into whether messages reach customers.
-- Immutable — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE message_delivery_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What triggered this message
  entity_type           TEXT NOT NULL CHECK (entity_type IN (
    'lead', 'project', 'om_contract', 'campaign', 'drip_sequence'
  )),
  entity_id             UUID NOT NULL,

  -- Sequence context (if drip sequence)
  drip_sequence_id      UUID REFERENCES drip_sequences(id),
  drip_step_id          UUID REFERENCES drip_sequence_steps(id),
  enrollment_id         UUID REFERENCES drip_sequence_enrollments(id),

  -- Campaign context (if campaign)
  campaign_id           UUID REFERENCES marketing_campaigns(id),
  campaign_delivery_id  UUID REFERENCES marketing_campaign_deliveries(id),

  message_type          TEXT NOT NULL,
  -- e.g. 'proposal_followup', 'payment_reminder', 'project_update'

  -- Phase 1: employee forward model
  delivery_method       TEXT NOT NULL DEFAULT 'employee_forward' CHECK (
    delivery_method IN ('employee_forward', 'direct_api')
  ),

  -- Employee leg
  sent_to_employee_id   UUID REFERENCES employees(id),
  employee_phone        TEXT,
  n8n_sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When n8n sent the alert to the employee.
  n8n_delivery_status   TEXT CHECK (n8n_delivery_status IN (
    'sent', 'delivered', 'failed'
  )),

  -- Forward leg (Phase 1 only)
  employee_forwarded    BOOLEAN NOT NULL DEFAULT FALSE,
  forwarded_at          TIMESTAMPTZ,
  -- Populated when employee confirms forward (via n8n callback).

  -- Customer leg
  customer_phone        TEXT,
  customer_name         TEXT,
  delivery_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_confirmed_at TIMESTAMPTZ,

  -- Phase 2: direct API (WATI.io)
  wati_message_id       TEXT,
  -- WATI.io message ID for delivery receipt tracking.

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_msg_log_entity      ON message_delivery_log(entity_type, entity_id);
CREATE INDEX idx_msg_log_employee    ON message_delivery_log(sent_to_employee_id);
CREATE INDEX idx_msg_log_unforwarded ON message_delivery_log(employee_forwarded)
  WHERE employee_forwarded = FALSE AND delivery_method = 'employee_forward';
CREATE INDEX idx_msg_log_date        ON message_delivery_log(n8n_sent_at DESC);
CREATE INDEX idx_msg_log_campaign    ON message_delivery_log(campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_msg_log_drip        ON message_delivery_log(drip_sequence_id)
  WHERE drip_sequence_id IS NOT NULL;

ALTER TABLE message_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "msg_log_read"
  ON message_delivery_log FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
    OR sent_to_employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "msg_log_insert"
  ON message_delivery_log FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

COMMIT;