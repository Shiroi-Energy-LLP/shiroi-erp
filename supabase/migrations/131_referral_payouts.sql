-- Migration 131: Full referral / channel partner payout system
-- referral_payouts tracks per-deal commission owed to channel_partners.
-- Trigger auto-creates a pending payout when a lead is won with a non-internal partner.

CREATE TABLE IF NOT EXISTS referral_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_partner_id UUID NOT NULL REFERENCES channel_partners(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  project_id UUID REFERENCES projects(id),
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  base_amount NUMERIC(14,2) NOT NULL,
  commission_amount NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_referral_payouts_partner ON referral_payouts(channel_partner_id);
CREATE INDEX idx_referral_payouts_status ON referral_payouts(status, created_at);
CREATE INDEX idx_referral_payouts_lead ON referral_payouts(lead_id);

-- Extend channel_partners with payout / portal fields
ALTER TABLE channel_partners ADD COLUMN IF NOT EXISTS default_commission_pct NUMERIC(5,2) DEFAULT 1.00;
ALTER TABLE channel_partners ADD COLUMN IF NOT EXISTS bank_account_number TEXT;  -- sensitive: masked in UI
ALTER TABLE channel_partners ADD COLUMN IF NOT EXISTS bank_ifsc TEXT;
ALTER TABLE channel_partners ADD COLUMN IF NOT EXISTS portal_token TEXT;
ALTER TABLE channel_partners ADD COLUMN IF NOT EXISTS lifetime_referrals INT DEFAULT 0;
ALTER TABLE channel_partners ADD COLUMN IF NOT EXISTS lifetime_commission NUMERIC(14,2) DEFAULT 0;

-- Unique partial index on portal_token (non-null only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_partners_portal_token
  ON channel_partners(portal_token)
  WHERE portal_token IS NOT NULL;

-- Trigger: auto-create pending payout when lead is won with a non-internal channel_partner
CREATE OR REPLACE FUNCTION fn_auto_create_referral_payout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_partner_id UUID;
  v_commission_pct NUMERIC(5,2);
  v_base_amount NUMERIC(14,2);
  v_commission NUMERIC(14,2);
  v_is_internal BOOLEAN;
BEGIN
  -- Only fire when stage transitions to 'won'
  IF NEW.stage <> 'won' OR OLD.stage = 'won' THEN
    RETURN NEW;
  END IF;

  -- Must have a channel_partner assigned
  IF NEW.channel_partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch partner details
  SELECT id, default_commission_pct, COALESCE(partner_type = 'internal', FALSE)
    INTO v_partner_id, v_commission_pct, v_is_internal
    FROM channel_partners
    WHERE id = NEW.channel_partner_id;

  -- Skip internal partners (e.g. direct / generic client)
  IF v_is_internal THEN
    RETURN NEW;
  END IF;

  -- Base amount = proposal total (use base_quote_price as fallback)
  v_base_amount := COALESCE(
    (SELECT total_after_discount FROM proposals WHERE lead_id = NEW.id ORDER BY created_at DESC LIMIT 1),
    NEW.base_quote_price,
    0
  );

  IF v_base_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_commission := ROUND(v_base_amount * v_commission_pct / 100, 2);

  -- Avoid duplicate payout for same lead
  IF EXISTS (SELECT 1 FROM referral_payouts WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO referral_payouts (
    channel_partner_id, lead_id, commission_pct, base_amount, commission_amount, status
  ) VALUES (
    v_partner_id, NEW.id, v_commission_pct, v_base_amount, v_commission, 'pending'
  );

  -- Increment lifetime counters (non-critical, fire-and-forget style)
  UPDATE channel_partners
    SET lifetime_referrals = COALESCE(lifetime_referrals, 0) + 1
    WHERE id = v_partner_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_referral_payout ON leads;
CREATE TRIGGER trg_auto_referral_payout
  AFTER UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_create_referral_payout();

-- RLS: referral_payouts readable by founder + finance + marketing_manager
ALTER TABLE referral_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_payouts_select ON referral_payouts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'finance', 'marketing_manager')
    )
  );

CREATE POLICY referral_payouts_insert ON referral_payouts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'finance')
    )
  );

CREATE POLICY referral_payouts_update ON referral_payouts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'finance')
    )
  );
