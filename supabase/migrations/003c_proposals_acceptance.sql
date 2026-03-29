-- ============================================================
-- Migration 003c — Proposals Digital Acceptance & Analytics
-- File: supabase/migrations/003c_proposals_acceptance.sql
-- Description: Digital acceptance portal, OTP verification,
--              proposal analytics, payment schedule, and
--              proposal status history.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS proposal_status_history CASCADE;
--   DROP TABLE IF EXISTS proposal_analytics CASCADE;
--   DROP TABLE IF EXISTS proposal_payment_schedule CASCADE;
--   DROP TABLE IF EXISTS proposal_otp_log CASCADE;
--   DROP TABLE IF EXISTS proposal_digital_acceptance CASCADE;
-- Dependencies: 001_foundation.sql, 003a_proposals_core.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. proposal_digital_acceptance
-- Tracks the customer's digital acceptance of a proposal.
-- OTP verified acceptance = legally binding in India under
-- IT Act 2000. Immutable once accepted — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE proposal_digital_acceptance (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id             UUID NOT NULL UNIQUE REFERENCES proposals(id) ON DELETE RESTRICT,

  -- Portal access
  access_token            TEXT NOT NULL UNIQUE,
  -- Secure random token sent to customer via WhatsApp/email.
  -- Used to access the proposal portal without login.
  token_expires_at        TIMESTAMPTZ NOT NULL,
  -- Token valid for 72 hours from generation.

  -- Viewing tracking
  first_viewed_at         TIMESTAMPTZ,
  last_viewed_at          TIMESTAMPTZ,
  view_count              INT NOT NULL DEFAULT 0,
  viewed_from_ip          TEXT,
  viewed_from_device      TEXT,

  -- OTP acceptance
  otp_requested_at        TIMESTAMPTZ,
  otp_sent_to_phone       TEXT,
  otp_verified            BOOLEAN NOT NULL DEFAULT FALSE,
  otp_verified_at         TIMESTAMPTZ,

  -- Acceptance record
  accepted_at             TIMESTAMPTZ,
  accepted_by_name        TEXT,
  -- Name the customer entered at acceptance.
  accepted_from_ip        TEXT,
  acceptance_declaration  TEXT,
  -- The exact declaration text shown to customer at acceptance.
  -- Stored verbatim for legal record.

  -- Rejection via portal
  rejected_via_portal     BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason_portal TEXT,
  rejected_at             TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable after creation. No updated_at.
);

CREATE INDEX idx_digital_acceptance_proposal ON proposal_digital_acceptance(proposal_id);
CREATE INDEX idx_digital_acceptance_token    ON proposal_digital_acceptance(access_token);


-- ------------------------------------------------------------
-- 2. proposal_otp_log
-- Every OTP send attempt logged.
-- Immutable — Tier 3. Used for audit and debugging.
-- ------------------------------------------------------------
CREATE TABLE proposal_otp_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  acceptance_id       UUID NOT NULL REFERENCES proposal_digital_acceptance(id) ON DELETE CASCADE,

  phone               TEXT NOT NULL,
  otp_hash            TEXT NOT NULL,
  -- SHA-256 hash of OTP. Never store plain OTP.
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  -- OTP valid for 10 minutes.

  was_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at         TIMESTAMPTZ,
  attempts_count      INT NOT NULL DEFAULT 0,
  -- How many times customer tried to verify before success/lockout.

  delivery_status     TEXT CHECK (delivery_status IN (
    'sent', 'delivered', 'failed', 'undelivered'
  )),
  -- From WhatsApp/SMS delivery receipt.

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_otp_log_proposal    ON proposal_otp_log(proposal_id);
CREATE INDEX idx_otp_log_acceptance  ON proposal_otp_log(acceptance_id);


-- ------------------------------------------------------------
-- 3. proposal_payment_schedule
-- Milestone-based payment schedule shown in proposal.
-- e.g. 30% advance, 40% on delivery, 20% on commissioning,
-- 10% retention.
-- Becomes the basis for invoice generation in projects domain.
-- ------------------------------------------------------------
CREATE TABLE proposal_payment_schedule (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,

  milestone_name      TEXT NOT NULL,
  -- e.g. 'Advance', 'On Material Delivery', 'On Commissioning', 'Retention'

  milestone_order     INT NOT NULL,
  -- Display and invoice trigger order.

  percentage          NUMERIC(5,2) NOT NULL,
  -- Must sum to 100 across all lines for a proposal.
  amount              NUMERIC(14,2) NOT NULL,
  -- Computed from percentage * proposal total. Stored explicitly.

  due_trigger         TEXT NOT NULL CHECK (due_trigger IN (
    'on_acceptance',
    'on_material_delivery',
    'mid_installation',
    'on_commissioning',
    'after_net_metering',
    'retention_period_end',
    'custom'
  )),
  custom_trigger_description TEXT,
  -- Required if due_trigger = 'custom'.

  due_days_after_trigger INT,
  -- How many days after trigger event payment is due.
  -- NULL = due immediately on trigger.

  invoice_type        TEXT CHECK (invoice_type IN (
    'proforma', 'tax_invoice'
  )),

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER proposal_payment_schedule_updated_at
  BEFORE UPDATE ON proposal_payment_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_payment_schedule_proposal ON proposal_payment_schedule(proposal_id, milestone_order);


-- ------------------------------------------------------------
-- 4. proposal_analytics
-- Aggregated proposal performance metrics per sales engineer
-- per month. Populated by nightly cron.
-- Used for: win rate tracking, average deal size, time to close.
-- ------------------------------------------------------------
CREATE TABLE proposal_analytics (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_year              TEXT NOT NULL,
  -- Format: '2025-03' (YYYY-MM).
  sales_engineer_id       UUID REFERENCES employees(id),
  -- NULL = company-wide aggregate row.

  -- Volume
  proposals_created       INT NOT NULL DEFAULT 0,
  proposals_sent          INT NOT NULL DEFAULT 0,
  proposals_accepted      INT NOT NULL DEFAULT 0,
  proposals_rejected      INT NOT NULL DEFAULT 0,
  proposals_expired       INT NOT NULL DEFAULT 0,

  -- Value
  total_quoted_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_won_value         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_lost_value        NUMERIC(14,2) NOT NULL DEFAULT 0,
  avg_deal_size           NUMERIC(14,2),
  avg_margin_pct          NUMERIC(5,2),

  -- Efficiency
  avg_days_to_acceptance  NUMERIC(6,1),
  avg_revisions_per_deal  NUMERIC(4,1),
  win_rate_pct            NUMERIC(5,2),

  -- Simulation
  pvwatts_used_count      INT NOT NULL DEFAULT 0,
  pvlib_fallback_count    INT NOT NULL DEFAULT 0,
  -- Tracks how often PVWatts fails and PVLib is used.

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER proposal_analytics_updated_at
  BEFORE UPDATE ON proposal_analytics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_proposal_analytics_month_eng
  ON proposal_analytics(month_year, sales_engineer_id);

CREATE INDEX idx_proposal_analytics_month ON proposal_analytics(month_year DESC);


-- ------------------------------------------------------------
-- 5. proposal_status_history
-- Immutable log of every proposal status change.
-- Tier 3 — never edited, never deleted.
-- Enables: time-in-stage analysis, conversion funnel.
-- ------------------------------------------------------------
CREATE TABLE proposal_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  changed_by      UUID REFERENCES employees(id),
  -- NULL if changed by system (e.g. auto-expire).

  from_status     proposal_status,
  -- NULL on first entry (proposal created).
  to_status       proposal_status NOT NULL,

  reason          TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_proposal_status_history_proposal
  ON proposal_status_history(proposal_id, changed_at DESC);


-- ------------------------------------------------------------
-- RLS — proposals acceptance and analytics tables
-- ------------------------------------------------------------

-- proposal_digital_acceptance: founder and sales read/write.
-- No customer RLS here — customers access via access_token
-- through a public edge function, not direct table access.
ALTER TABLE proposal_digital_acceptance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "digital_acceptance_read"
  ON proposal_digital_acceptance FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager', 'finance')
  );

CREATE POLICY "digital_acceptance_insert"
  ON proposal_digital_acceptance FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer')
  );

-- proposal_otp_log: founder only reads. Immutable.
ALTER TABLE proposal_otp_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "otp_log_read"
  ON proposal_otp_log FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  );

CREATE POLICY "otp_log_insert"
  ON proposal_otp_log FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer')
  );

-- proposal_payment_schedule
ALTER TABLE proposal_payment_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_schedule_read"
  ON proposal_payment_schedule FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager', 'finance')
  );

CREATE POLICY "payment_schedule_write"
  ON proposal_payment_schedule FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer')
  );

-- proposal_analytics: founder, sales, finance read.
-- Written by system (service role) only.
ALTER TABLE proposal_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proposal_analytics_read"
  ON proposal_analytics FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'finance', 'hr_manager')
  );

-- proposal_status_history: immutable log, read only.
ALTER TABLE proposal_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proposal_status_history_read"
  ON proposal_status_history FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager', 'finance')
  );

CREATE POLICY "proposal_status_history_insert"
  ON proposal_status_history FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

COMMIT;