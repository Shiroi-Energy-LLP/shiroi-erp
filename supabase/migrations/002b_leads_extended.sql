-- ============================================================
-- Migration 002b — Leads Extended
-- File: supabase/migrations/002b_leads_extended.sql
-- Description: VIP contacts, channel partners, referrals,
--              blacklisted phones, loss reasons, regulatory
--              contacts, lead source analytics, and form
--              interaction metrics.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS form_interaction_metrics CASCADE;
--   DROP TABLE IF EXISTS regulatory_ecosystem_contacts CASCADE;
--   DROP TABLE IF EXISTS lead_loss_reasons CASCADE;
--   DROP TABLE IF EXISTS lead_source_analytics CASCADE;
--   DROP TABLE IF EXISTS referral_rewards CASCADE;
--   DROP TABLE IF EXISTS lead_referrals CASCADE;
--   DROP TABLE IF EXISTS blacklisted_phones CASCADE;
--   DROP TABLE IF EXISTS channel_partner_leads CASCADE;
--   DROP TABLE IF EXISTS channel_partners CASCADE;
--   DROP TABLE IF EXISTS vip_contact_interactions CASCADE;
--   DROP TABLE IF EXISTS vip_contacts CASCADE;
-- Dependencies: 001_foundation.sql, 002a_leads_core.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. vip_contacts
-- Builders, architects, housing society secretaries.
-- Founder manages personally. System drafts, human sends.
-- ------------------------------------------------------------
CREATE TABLE vip_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  full_name         TEXT NOT NULL,
  company           TEXT,
  designation       TEXT,
  phone             TEXT NOT NULL,
  email             TEXT,
  whatsapp          TEXT,

  contact_type      TEXT NOT NULL CHECK (contact_type IN (
    'builder', 'architect', 'housing_society',
    'government_official', 'corporate_admin', 'other'
  )),

  relationship_owner UUID NOT NULL REFERENCES employees(id),
  -- Almost always Vivek (founder). Reassignable.

  city              TEXT,
  area              TEXT,

  -- Potential
  estimated_annual_referrals  INT,
  projects_referred_count     INT NOT NULL DEFAULT 0,
  total_referred_value        NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Engagement
  last_contacted_at TIMESTAMPTZ,
  next_touchpoint_date DATE,
  preferred_contact_method TEXT CHECK (preferred_contact_method IN (
    'call', 'whatsapp', 'email', 'in_person'
  )),

  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER vip_contacts_updated_at
  BEFORE UPDATE ON vip_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_vip_contacts_owner  ON vip_contacts(relationship_owner);
CREATE INDEX idx_vip_contacts_type   ON vip_contacts(contact_type);
CREATE INDEX idx_vip_contacts_active ON vip_contacts(is_active) WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 2. vip_contact_interactions
-- Every touchpoint with a VIP contact logged here.
-- Immutable after creation — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE vip_contact_interactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vip_contact_id    UUID NOT NULL REFERENCES vip_contacts(id) ON DELETE CASCADE,
  logged_by         UUID NOT NULL REFERENCES employees(id),

  interaction_type  TEXT NOT NULL CHECK (interaction_type IN (
    'call', 'whatsapp', 'email', 'lunch_meeting',
    'site_visit', 'event', 'gift_sent', 'note'
  )),

  summary           TEXT NOT NULL,
  outcome           TEXT,
  follow_up_date    DATE,

  interaction_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No updated_at — immutable log.
);

CREATE INDEX idx_vip_interactions_contact ON vip_contact_interactions(vip_contact_id, interaction_date DESC);


-- ------------------------------------------------------------
-- 3. channel_partners
-- Brokers and aggregators with formal commission structures.
-- TDS deducted if annual commission > ₹10,000.
-- ------------------------------------------------------------
CREATE TABLE channel_partners (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  partner_name          TEXT NOT NULL,
  contact_person        TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  email                 TEXT,
  whatsapp              TEXT,

  partner_type          TEXT NOT NULL CHECK (partner_type IN (
    'individual_broker', 'aggregator', 'ngo',
    'housing_society', 'corporate', 'other'
  )),

  -- Commission structure
  commission_type       TEXT NOT NULL CHECK (commission_type IN (
    'per_kwp', 'percentage_of_revenue', 'fixed_per_deal'
  )),
  commission_rate       NUMERIC(8,2) NOT NULL,
  -- Per kWp amount, or percentage, or fixed amount depending on type.

  -- TDS tracking
  pan_number            TEXT,
  -- Required for TDS deduction above ₹10,000 annual.
  tds_applicable        BOOLEAN NOT NULL DEFAULT FALSE,
  annual_commission_ytd NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Resets every April 1. System sets tds_applicable when this crosses ₹10,000.

  -- Performance
  leads_referred_count  INT NOT NULL DEFAULT 0,
  leads_converted_count INT NOT NULL DEFAULT 0,
  total_commission_paid NUMERIC(14,2) NOT NULL DEFAULT 0,

  agreement_start_date  DATE,
  agreement_end_date    DATE,
  agreement_storage_path TEXT,

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER channel_partners_updated_at
  BEFORE UPDATE ON channel_partners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_channel_partners_active ON channel_partners(is_active) WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 4. channel_partner_leads
-- Links a lead to the channel partner who referred it.
-- ------------------------------------------------------------
CREATE TABLE channel_partner_leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_partner_id  UUID NOT NULL REFERENCES channel_partners(id),
  lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  referred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  commission_amount   NUMERIC(14,2),
  -- Calculated at proposal stage once size is confirmed.
  commission_paid     BOOLEAN NOT NULL DEFAULT FALSE,
  commission_paid_at  TIMESTAMPTZ,
  tds_deducted        NUMERIC(14,2),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_cp_leads_unique ON channel_partner_leads(channel_partner_id, lead_id);
CREATE INDEX idx_cp_leads_partner ON channel_partner_leads(channel_partner_id);
CREATE INDEX idx_cp_leads_lead    ON channel_partner_leads(lead_id);


-- ------------------------------------------------------------
-- 5. blacklisted_phones
-- Never reassigned. Never auto-messaged. Hard block on lead entry.
-- Immutable — Tier 3. No deletes ever.
-- ------------------------------------------------------------
CREATE TABLE blacklisted_phones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT NOT NULL UNIQUE,
  reason          TEXT NOT NULL,
  blacklisted_by  UUID NOT NULL REFERENCES employees(id),
  blacklisted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- No updated_at, no deleted_at — immutable forever.
  notes           TEXT
);

CREATE INDEX idx_blacklisted_phones_phone ON blacklisted_phones(phone);


-- ------------------------------------------------------------
-- 6. lead_referrals
-- Customer referrals. Separate from channel partners —
-- these are existing customers referring friends/family.
-- Reward: ₹3,000–5,000/kWp residential, commercial negotiated.
-- TDS above ₹10,000 annual.
-- ------------------------------------------------------------
CREATE TABLE lead_referrals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- Who referred
  referrer_name       TEXT NOT NULL,
  referrer_phone      TEXT NOT NULL,
  referrer_customer_profile_id UUID REFERENCES profiles(id),
  -- If the referrer is an existing customer with a profile.

  referred_at         DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Reward
  reward_amount       NUMERIC(14,2),
  -- Calculated once deal is won and system size confirmed.
  reward_paid         BOOLEAN NOT NULL DEFAULT FALSE,
  reward_paid_at      TIMESTAMPTZ,
  tds_deducted        NUMERIC(14,2),
  pan_number          TEXT,
  -- Required if reward triggers TDS threshold.

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lead_referrals_updated_at
  BEFORE UPDATE ON lead_referrals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_lead_referrals_lead     ON lead_referrals(lead_id);
CREATE INDEX idx_lead_referrals_referrer ON lead_referrals(referrer_phone);


-- ------------------------------------------------------------
-- 7. referral_rewards
-- Payment records for referral rewards. Immutable — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE referral_rewards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_referral_id  UUID NOT NULL REFERENCES lead_referrals(id),

  amount            NUMERIC(14,2) NOT NULL,
  tds_deducted      NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_paid          NUMERIC(14,2) NOT NULL,
  -- net_paid = amount - tds_deducted. Stored explicitly, never computed on read.

  payment_method    TEXT CHECK (payment_method IN (
    'bank_transfer', 'upi', 'cheque', 'cash'
  )),
  payment_reference TEXT,
  paid_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_by           UUID NOT NULL REFERENCES employees(id),

  reward_letter_storage_path TEXT,
  -- Path to the reward letter PDF in Supabase Storage.

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_referral_rewards_referral ON referral_rewards(lead_referral_id);


-- ------------------------------------------------------------
-- 8. lead_loss_reasons
-- Structured reason when a lead is marked lost.
-- Queryable — not a free text field — enables loss analysis.
-- ------------------------------------------------------------
CREATE TABLE lead_loss_reasons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  logged_by       UUID NOT NULL REFERENCES employees(id),

  primary_reason  TEXT NOT NULL CHECK (primary_reason IN (
    'price_too_high',
    'chose_competitor',
    'no_budget',
    'delayed_decision',
    'roof_not_suitable',
    'no_net_metering',
    'building_issues',
    'customer_unresponsive',
    'project_cancelled',
    'other'
  )),

  competitor_id   UUID REFERENCES lead_competitors(id),
  -- If lost to a specific competitor tracked in lead_competitors.

  competitor_price  NUMERIC(14,2),
  price_gap         NUMERIC(14,2),
  -- How much cheaper was the competitor? For margin analysis.

  notes           TEXT,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable log. No updated_at.
);

CREATE INDEX idx_lead_loss_reasons_lead   ON lead_loss_reasons(lead_id);
CREATE INDEX idx_lead_loss_reasons_reason ON lead_loss_reasons(primary_reason);


-- ------------------------------------------------------------
-- 9. lead_source_analytics
-- Aggregated conversion metrics per source per month.
-- Populated by nightly cron — not written by application.
-- ------------------------------------------------------------
CREATE TABLE lead_source_analytics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_year            TEXT NOT NULL,
  -- Format: '2025-03' (YYYY-MM). Simpler than DATE for monthly aggregation.
  source                lead_source NOT NULL,
  segment               customer_segment NOT NULL,

  leads_count           INT NOT NULL DEFAULT 0,
  qualified_count       INT NOT NULL DEFAULT 0,
  proposals_sent_count  INT NOT NULL DEFAULT 0,
  won_count             INT NOT NULL DEFAULT 0,
  lost_count            INT NOT NULL DEFAULT 0,

  total_won_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
  avg_deal_size_kwp     NUMERIC(6,2),
  avg_days_to_close     NUMERIC(6,1),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_lsa_month_source ON lead_source_analytics(month_year, source, segment);
CREATE INDEX idx_lsa_month ON lead_source_analytics(month_year DESC);


-- ------------------------------------------------------------
-- 10. regulatory_ecosystem_contacts
-- DISCOM officers, CEIG inspectors, TNEB subdivision staff.
-- Institutional knowledge — stays in system when people leave.
-- ------------------------------------------------------------
CREATE TABLE regulatory_ecosystem_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  full_name         TEXT NOT NULL,
  designation       TEXT NOT NULL,
  organisation      TEXT NOT NULL,
  -- e.g. 'TNEB Chennai South', 'CEIG Tamil Nadu'

  contact_type      TEXT NOT NULL CHECK (contact_type IN (
    'discom_officer', 'ceig_inspector', 'tneb_subdivision',
    'municipal_official', 'fire_department', 'other'
  )),

  jurisdiction_area TEXT,
  -- Which areas/subdivisions this contact covers.

  phone             TEXT,
  email             TEXT,
  office_address    TEXT,

  -- Relationship
  relationship_quality TEXT CHECK (relationship_quality IN (
    'excellent', 'good', 'neutral', 'difficult'
  )),
  known_by          UUID REFERENCES employees(id),
  -- Which Shiroi employee has the relationship.

  -- Career tracking
  career_status     TEXT NOT NULL DEFAULT 'active' CHECK (career_status IN (
    'active', 'transferred', 'retired', 'unknown'
  )),
  -- When 'transferred': create task to identify new contact.
  transfer_noted_at TIMESTAMPTZ,
  replacement_contact_id UUID REFERENCES regulatory_ecosystem_contacts(id),

  notes             TEXT,
  -- Non-obvious info: preferred approach, known pain points, best time to call.

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER regulatory_contacts_updated_at
  BEFORE UPDATE ON regulatory_ecosystem_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_reg_contacts_type   ON regulatory_ecosystem_contacts(contact_type);
CREATE INDEX idx_reg_contacts_status ON regulatory_ecosystem_contacts(career_status);
CREATE INDEX idx_reg_contacts_active ON regulatory_ecosystem_contacts(is_active) WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 11. form_interaction_metrics
-- Tracks time-to-complete and abandonment per form per employee.
-- Written by mobile app. Needs sync_status for offline-first.
-- Alert thresholds: daily_report >180s, lead_entry >90s,
-- om_checklist >420s (rolling 7-day average).
-- ------------------------------------------------------------
CREATE TABLE form_interaction_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id),

  form_type       TEXT NOT NULL CHECK (form_type IN (
    'daily_site_report', 'lead_entry', 'om_visit_checklist',
    'leave_request', 'site_photo_upload', 'other'
  )),

  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  -- NULL if abandoned.
  duration_seconds INT,
  -- Populated on completion: EXTRACT(EPOCH FROM completed_at - started_at).

  was_abandoned   BOOLEAN NOT NULL DEFAULT FALSE,
  abandon_at_step TEXT,
  -- Which step/field the user dropped off at.

  device_type     TEXT CHECK (device_type IN ('android', 'ios')),

  -- Offline-first sync
  sync_status     TEXT NOT NULL DEFAULT 'local_only' CHECK (sync_status IN (
    'local_only', 'syncing', 'synced', 'sync_failed'
  )),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_form_metrics_employee ON form_interaction_metrics(employee_id);
CREATE INDEX idx_form_metrics_type     ON form_interaction_metrics(form_type);
CREATE INDEX idx_form_metrics_date     ON form_interaction_metrics(started_at DESC);


-- ------------------------------------------------------------
-- RLS — leads extended tables
-- ------------------------------------------------------------

ALTER TABLE vip_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vip_contacts_read"
  ON vip_contacts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'hr_manager', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "vip_contacts_write"
  ON vip_contacts FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

ALTER TABLE vip_contact_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vip_interactions_read"
  ON vip_contact_interactions FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'hr_manager', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "vip_interactions_insert"
  ON vip_contact_interactions FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

ALTER TABLE channel_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_partners_read"
  ON channel_partners FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'finance')
  );

CREATE POLICY "channel_partners_write"
  ON channel_partners FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE channel_partner_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cp_leads_read"
  ON channel_partner_leads FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'finance')
  );

CREATE POLICY "cp_leads_write"
  ON channel_partner_leads FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer', 'finance')
  );

ALTER TABLE blacklisted_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blacklisted_phones_read"
  ON blacklisted_phones FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "blacklisted_phones_insert"
  ON blacklisted_phones FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager', 'sales_engineer')
  );

ALTER TABLE lead_referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_referrals_read"
  ON lead_referrals FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'finance')
  );

CREATE POLICY "lead_referrals_write"
  ON lead_referrals FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer', 'finance')
  );

ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "referral_rewards_read"
  ON referral_rewards FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

CREATE POLICY "referral_rewards_insert"
  ON referral_rewards FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

ALTER TABLE lead_loss_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_loss_reasons_read"
  ON lead_loss_reasons FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager', 'finance')
  );

CREATE POLICY "lead_loss_reasons_insert"
  ON lead_loss_reasons FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

ALTER TABLE lead_source_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_source_analytics_read"
  ON lead_source_analytics FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'finance', 'hr_manager')
  );

ALTER TABLE regulatory_ecosystem_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reg_contacts_read"
  ON regulatory_ecosystem_contacts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'sales_engineer', 'om_technician')
  );

CREATE POLICY "reg_contacts_write"
  ON regulatory_ecosystem_contacts FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'project_manager')
  );

ALTER TABLE form_interaction_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_metrics_read"
  ON form_interaction_metrics FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "form_metrics_insert"
  ON form_interaction_metrics FOR INSERT
  WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  );

COMMIT;