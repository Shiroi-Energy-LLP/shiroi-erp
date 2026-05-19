-- ============================================================================
-- Migration 109 — Marketing feedback batch (May 19, 2026)
-- ----------------------------------------------------------------------------
-- Vivek's May 19 feedback bundles 10 issues across /sales, dashboards, tasks,
-- the proposal gate, and the Quick Quote PDF. This migration ships the DB
-- pieces in one shot. UI changes ride alongside in apps/erp/.
--
-- Pieces:
--   1. leads.proposal_gate_bypassed — escape hatch on mig 107's Won-gate so
--      Prem can clean up historical leads that don't have a proposal row.
--   2. leads.margin_skipped_at / margin_skipped_by — audit trail for the new
--      "Mark Won (skip margin)" button.
--   3. Updated fn_block_lead_won_without_proposal to honour the bypass flag.
--   4. Widened get_expected_orders status filter so Prem's Expected Orders
--      card reflects leads in quick_quote_sent, detailed_proposal_sent,
--      design_confirmed, negotiation, closure_soon — not just the last two.
--   5. New RPC get_pipeline_close_window(start, end) — single round-trip
--      aggregate powering the clickable Closing-This-Week / This-Month
--      cards on /sales (count + total kWp + total ₹). Computed in SQL per
--      NEVER-DO #12.
--   6. Index on leads.estimated_size_kwp for the new kWp range filter.
--   7. channel_partners.is_internal flag + seed of "Vivek Sridhar (Founder)"
--      and "Management Referral" rows, so the /sales referrer filter has a
--      first-class concept of an in-house referrer.
-- ============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- 1. leads.proposal_gate_bypassed — historical cleanup escape hatch
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS proposal_gate_bypassed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN leads.proposal_gate_bypassed IS
  'When TRUE, fn_block_lead_won_without_proposal allows Won without a proposal. For historical cleanup only — UI toggle visible to founder + marketing_manager.';

-- ───────────────────────────────────────────────────────────────────
-- 2. leads.margin_skipped_at + margin_skipped_by — closure-band audit
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS margin_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS margin_skipped_by UUID REFERENCES employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN leads.margin_skipped_at IS
  'Set by markWonSkipMargin server action when a founder/marketing_manager bypasses the closure-band margin check on Won. NULL = normal closure-band path was followed.';

-- ───────────────────────────────────────────────────────────────────
-- 3. fn_block_lead_won_without_proposal — honour the bypass flag
--    (replaces mig 107's version verbatim except for the bypass check)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_block_lead_won_without_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
DECLARE
  v_has_proposal BOOLEAN;
BEGIN
  IF NEW.status != 'won' OR OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  -- New escape hatch: founder/marketing_manager can flip proposal_gate_bypassed
  -- to TRUE on a lead being cleaned up from historical data without proposals.
  IF NEW.proposal_gate_bypassed IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM proposals
    WHERE lead_id = NEW.id
  ) INTO v_has_proposal;

  IF NOT v_has_proposal THEN
    RAISE EXCEPTION
      'Cannot mark lead as Won without a proposal. Create a Quick Quote (Path A) or a detailed proposal (Path B) first, or set proposal_gate_bypassed=TRUE for historical cleanup.'
      USING ERRCODE = 'check_violation', HINT = 'Use the Quick Quote button in the lead header, the Quote tab to compose a detailed proposal, or the "Skip proposal gate" toggle (founder/marketing_manager only) for historical cleanup.';
  END IF;

  RETURN NEW;
END;
$func$;

-- ───────────────────────────────────────────────────────────────────
-- 4. Widen get_expected_orders status filter
--    (replaces mig 094's version; ORDER BY and shape unchanged)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_expected_orders(window_days INT)
RETURNS TABLE (
  lead_id             UUID,
  customer_name       TEXT,
  status              lead_status,
  estimated_size_kwp  NUMERIC(10,2),
  base_quote_price    NUMERIC(14,2),
  derived_value       NUMERIC(14,2),
  expected_close_date DATE,
  close_probability   INT,
  days_until          INT
)
LANGUAGE sql STABLE AS $$
  SELECT
    l.id,
    l.customer_name,
    l.status,
    l.estimated_size_kwp,
    l.base_quote_price,
    COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000)::NUMERIC(14,2) AS derived_value,
    l.expected_close_date,
    l.close_probability,
    GREATEST(0, l.expected_close_date - CURRENT_DATE)::int AS days_until
  FROM leads l
  WHERE l.status IN (
      'quick_quote_sent',
      'detailed_proposal_sent',
      'design_confirmed',
      'negotiation',
      'closure_soon'
    )
    AND l.deleted_at IS NULL
    AND l.is_archived = FALSE
    AND l.expected_close_date IS NOT NULL
    AND l.expected_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + window_days
  ORDER BY l.expected_close_date ASC NULLS LAST,
           COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_expected_orders(INT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 5. get_pipeline_close_window — clickable-card aggregate
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_pipeline_close_window(start_date DATE, end_date DATE)
RETURNS TABLE(
  lead_count  INT,
  total_kwp   NUMERIC(12,2),
  total_value NUMERIC(14,2)
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::INT,
    COALESCE(SUM(estimated_size_kwp), 0)::NUMERIC(12,2),
    COALESCE(SUM(COALESCE(base_quote_price, estimated_size_kwp * 60000)), 0)::NUMERIC(14,2)
  FROM leads
  WHERE status NOT IN ('won','lost','disqualified','converted')
    AND deleted_at IS NULL
    AND is_archived = FALSE
    AND expected_close_date BETWEEN start_date AND end_date;
$$;

GRANT EXECUTE ON FUNCTION get_pipeline_close_window(DATE, DATE) TO authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 6. Index for kWp range filter
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_estimated_size_kwp
  ON leads(estimated_size_kwp)
  WHERE deleted_at IS NULL AND is_archived = FALSE;

-- ───────────────────────────────────────────────────────────────────
-- 7. channel_partners.is_internal + Vivek/Management seeds
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN channel_partners.is_internal IS
  'TRUE for in-house referrers (Vivek, Management). Used by the /sales referrer filter as a top-level option distinct from external partners.';

-- Vivek as a first-class referral source (idempotent)
INSERT INTO channel_partners (
  id, partner_name, contact_person, phone, partner_type, is_internal,
  commission_type, commission_rate, tds_applicable, is_active, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'Vivek Sridhar (Founder)',
  'Vivek Sridhar',
  '9444414087',
  'referral',
  TRUE,
  'fixed_per_deal',
  0,
  FALSE,
  TRUE,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM channel_partners
  WHERE is_internal = TRUE AND partner_name ILIKE '%vivek%'
);

-- Generic Management bucket (idempotent)
INSERT INTO channel_partners (
  id, partner_name, contact_person, phone, partner_type, is_internal,
  commission_type, commission_rate, tds_applicable, is_active, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'Management Referral',
  'Shiroi Management',
  '0000000000',
  'referral',
  TRUE,
  'fixed_per_deal',
  0,
  FALSE,
  TRUE,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM channel_partners
  WHERE is_internal = TRUE AND partner_name = 'Management Referral'
);

COMMIT;
