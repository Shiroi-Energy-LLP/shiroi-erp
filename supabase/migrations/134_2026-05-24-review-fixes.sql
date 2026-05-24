-- Migration 134: Critical fixes from 2026-05-24 review pass
-- See docs/reviews/2026-05-24-comprehensive-review.md for context.
--
-- Five fixes, all marked CRITICAL by the review:
--   1. Repair fn_auto_create_referral_payout — was using NEW.stage (no such column;
--      leads has `status`) AND partner_type='internal' (no such enum value; the
--      flag is is_internal BOOLEAN from mig 109). Trigger has been silently
--      no-op / errored on every lead update since mig 131 landed.
--   2. RLS on customer_message_log — table holds outbound customer WhatsApp
--      content; without RLS every authenticated user could read it.
--   3. RLS on proposal_share_tokens — share tokens are read by the public
--      portal via the admin client; default-deny everyone else.
--   4. Lock down attendance_update RLS — the existing policy let an employee
--      update their own past attendance rows (flip absent→present, change
--      marked_by, etc.). Restrict to HR/founder only; insert path stays open
--      for self-marking.
--   5. Add increment_partner_commission(uuid, numeric) RPC — referenced by
--      markReferralPaid in app code; the call previously stored a serialized
--      builder object into channel_partners.lifetime_commission, corrupting
--      the column on every payout marked paid.
--
-- Plus one IMPORTANT finding:
--   6. UPDATE policy on inventory_cut_records — table had SELECT/INSERT/DELETE
--      but no UPDATE, so a typo in a cut record was unfixable. Grant founder+PM.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Repair the referral-payout trigger.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_auto_create_referral_payout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner_id UUID;
  v_commission_pct NUMERIC(5,2);
  v_base_amount NUMERIC(14,2);
  v_commission NUMERIC(14,2);
  v_is_internal BOOLEAN;
BEGIN
  -- Only fire when status transitions to 'won' (leads.status, not stage).
  IF NEW.status <> 'won' OR (OLD.status IS NOT NULL AND OLD.status = 'won') THEN
    RETURN NEW;
  END IF;

  IF NEW.channel_partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch partner; is_internal is the canonical flag (mig 109), not partner_type.
  SELECT id, COALESCE(default_commission_pct, 1.00), COALESCE(is_internal, FALSE)
    INTO v_partner_id, v_commission_pct, v_is_internal
    FROM channel_partners
    WHERE id = NEW.channel_partner_id;

  IF v_is_internal THEN
    RETURN NEW;
  END IF;

  v_base_amount := COALESCE(
    (SELECT total_after_discount FROM proposals WHERE lead_id = NEW.id ORDER BY created_at DESC LIMIT 1),
    NEW.base_quote_price,
    0
  );

  IF v_base_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_commission := ROUND(v_base_amount * v_commission_pct / 100, 2);

  IF EXISTS (SELECT 1 FROM referral_payouts WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO referral_payouts (
    channel_partner_id, lead_id, commission_pct, base_amount, commission_amount, status
  ) VALUES (
    v_partner_id, NEW.id, v_commission_pct, v_base_amount, v_commission, 'pending'
  );

  UPDATE channel_partners
    SET lifetime_referrals = COALESCE(lifetime_referrals, 0) + 1
    WHERE id = v_partner_id;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS on customer_message_log.
--    Sensitive: contains customer phones + outbound WhatsApp content.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE customer_message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_message_log_select ON customer_message_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'marketing_manager', 'om_technician')
    )
  );

-- Inserts come from the service role (n8n, edge functions); deny authenticated.
CREATE POLICY customer_message_log_service_only_write ON customer_message_log
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS on proposal_share_tokens.
--    Public page reads via admin client; deny authenticated by default.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE proposal_share_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY proposal_share_tokens_creator_read ON proposal_share_tokens
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'marketing_manager', 'designer', 'sales_engineer')
    )
  );

CREATE POLICY proposal_share_tokens_service_only_write ON proposal_share_tokens
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Lock down attendance_update — HR/founder only.
--    Previous policy let employees edit their own past rows.
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS attendance_update ON attendance;

CREATE POLICY attendance_update ON attendance
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'hr_manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'hr_manager')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RPC: increment_partner_commission.
--    Called by markReferralPaid to atomically bump lifetime_commission.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_partner_commission(
  p_partner_id UUID,
  p_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_total NUMERIC(14,2);
BEGIN
  UPDATE channel_partners
    SET lifetime_commission = COALESCE(lifetime_commission, 0) + COALESCE(p_amount, 0)
    WHERE id = p_partner_id
    RETURNING lifetime_commission INTO v_new_total;

  IF v_new_total IS NULL THEN
    RAISE EXCEPTION 'channel_partner % not found', p_partner_id;
  END IF;

  RETURN v_new_total;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_partner_commission(UUID, NUMERIC) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. UPDATE policy on inventory_cut_records.
--    Mig 121 shipped without one; cut record typos were unfixable.
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY inventory_cut_records_update ON inventory_cut_records
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'project_manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'project_manager')
    )
  );

COMMIT;
