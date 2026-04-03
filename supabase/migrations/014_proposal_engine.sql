-- Migration 014: Proposal engine — budgetary quotes, notifications
-- Applied: dev first, then prod via Supabase SQL Editor

-- 1. Add is_budgetary flag to proposals
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS is_budgetary BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN proposals.is_budgetary IS 'TRUE for auto-generated quick quotes from price book. FALSE for detailed designer proposals.';

-- 2. Add tariff escalation to proposal_simulations
ALTER TABLE proposal_simulations ADD COLUMN IF NOT EXISTS tariff_escalation_pct NUMERIC(4,2) DEFAULT 3.00;
COMMENT ON COLUMN proposal_simulations.tariff_escalation_pct IS 'Annual electricity tariff escalation rate for 25-year savings projections. Default 3%.';

-- 3. Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_employee_id UUID NOT NULL REFERENCES employees(id),
  title                 TEXT NOT NULL,
  body                  TEXT,
  notification_type     TEXT NOT NULL CHECK (notification_type IN (
    'alert', 'reminder', 'report', 'approval_required', 'info'
  )),
  entity_type           TEXT CHECK (entity_type IN (
    'proposal', 'project', 'lead', 'purchase_order', 'daily_report', 'employee', 'override_report'
  )),
  entity_id             UUID,
  is_read               BOOLEAN NOT NULL DEFAULT FALSE,
  read_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_employee_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(recipient_employee_id) WHERE is_read = FALSE;

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Employees can read their own notifications
CREATE POLICY "notifications_read_own"
  ON notifications FOR SELECT
  USING (recipient_employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid()));

-- Employees can mark their own as read
CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  USING (recipient_employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid()))
  WITH CHECK (recipient_employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid()));

-- System (admin) can insert notifications for anyone
CREATE POLICY "notifications_insert_system"
  ON notifications FOR INSERT
  WITH CHECK (TRUE);
  -- Insert is allowed for authenticated users (server actions run as the user)
  -- n8n uses admin client which bypasses RLS
