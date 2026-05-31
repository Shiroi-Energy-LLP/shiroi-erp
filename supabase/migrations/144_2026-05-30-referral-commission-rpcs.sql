-- Migration 144: Referral commission KPI RPCs (this-month + lifetime).
--
-- referral-queries.ts:getReferralKpis() calls two RPCs to populate the
-- /referrals KPI strip:
--   1. get_referral_commission_this_month  → sum of commission_amount for
--      approved + paid payouts whose status-transition timestamp falls in
--      the current IST calendar month.
--   2. get_referral_commission_lifetime    → sum of commission_amount for
--      all paid payouts, ever.
--
-- Both RPCs return a single row { total NUMERIC } so the caller can read
-- `data.total` directly without aggregation in JS (NEVER-DO #12).
--
-- Neither existed; the queries were cast 'as never' and the KPI strip
-- has been permanently ₹0. Same authorization surface as the underlying
-- referral_payouts SELECT policy (mig 131): founder, finance,
-- marketing_manager. The RPCs themselves run SECURITY DEFINER but
-- restrict execution to those three roles inline; RLS is therefore
-- unnecessary on the function body. GRANT EXECUTE goes to authenticated,
-- and the role check is enforced via auth.uid() + profiles inside.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. get_referral_commission_this_month
--    Approved-or-paid commission accrued in the current IST calendar month.
--    Uses COALESCE(paid_at, approved_at) as the "transition" timestamp so
--    a row that was approved in May counts toward May even if it hasn't
--    been paid yet, and an approved-in-April / paid-in-May row counts as
--    May (the paid_at supersedes).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_referral_commission_this_month()
RETURNS TABLE (total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_start TIMESTAMPTZ;
  v_month_end TIMESTAMPTZ;
BEGIN
  -- Role gate: match the referral_payouts SELECT policy from mig 131.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role IN ('founder', 'finance', 'marketing_manager')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Compute IST month boundaries; convert back to UTC for comparison
  -- against the TIMESTAMPTZ columns.
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))
                   AT TIME ZONE 'Asia/Kolkata';
  v_month_end := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))
                  + INTERVAL '1 month') AT TIME ZONE 'Asia/Kolkata';

  RETURN QUERY
  SELECT COALESCE(SUM(commission_amount), 0)::NUMERIC AS total
  FROM referral_payouts
  WHERE status IN ('approved', 'paid')
    AND COALESCE(paid_at, approved_at) >= v_month_start
    AND COALESCE(paid_at, approved_at) <  v_month_end;
END;
$$;

GRANT EXECUTE ON FUNCTION get_referral_commission_this_month() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. get_referral_commission_lifetime
--    All paid commission, all time. (Lifetime here means "money that has
--    actually left the bank" — approved-but-not-paid is excluded.)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_referral_commission_lifetime()
RETURNS TABLE (total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role IN ('founder', 'finance', 'marketing_manager')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT COALESCE(SUM(commission_amount), 0)::NUMERIC AS total
  FROM referral_payouts
  WHERE status = 'paid';
END;
$$;

GRANT EXECUTE ON FUNCTION get_referral_commission_lifetime() TO authenticated;

COMMIT;
