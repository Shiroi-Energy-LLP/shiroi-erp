-- ============================================================================
-- Migration 114 — Seed "Generic Client" channel_partner
-- Date: 2026-05-23
--
-- Vivek wanted a third referrer option for the leads dropdown — a generic
-- catch-all for "referred by some customer but I don't know which one".
-- Tagged is_internal=FALSE so it shows up under the "Referred by Clients"
-- filter chip alongside future named-customer referrers.
--
-- Idempotent: skips if the row already exists (so re-runs across envs are
-- safe).
-- ============================================================================

INSERT INTO channel_partners (
  partner_name,
  contact_person,
  phone,
  partner_type,
  commission_type,
  commission_rate,
  is_internal,
  is_active
)
SELECT
  'Generic Client',
  '—',
  '—',
  'referral',
  'fixed_per_deal',
  0,
  FALSE,
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM channel_partners WHERE partner_name = 'Generic Client'
);

COMMENT ON TABLE channel_partners IS
  'Channel partners (referrers). Internal seeds: Vivek Sridhar (Founder), Management Referral. External seeds: Generic Client.';
