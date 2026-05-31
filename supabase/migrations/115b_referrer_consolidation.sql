-- ============================================================================
-- Migration 115 — Referrer option consolidation
-- Date: 2026-05-23
--
-- Vivek's call after a day with the inline picker:
--   "Once done VIP is good. I don't need to show 'Vivek Sridhar referral'
--    there. Only one referral — Management Referral. And Customer Referral
--    as the option (instead of Generic Client)."
--
-- Steps (already applied on dev via MCP; this file captures the change for
-- prod parity):
--   1. Reassign any leads pointing at "Vivek Sridhar (Founder)" to
--      "Management Referral" so we don't lose audit trail.
--   2. Deactivate (soft-disable) the Vivek seed. Not deleted — keeps
--      historical FK integrity intact.
--   3. Rename mig 114's "Generic Client" → "Customer Referral".
--
-- End state (3 rows in channel_partners, 2 active):
--   - Management Referral  · is_internal=TRUE  · active   → VIP pill
--   - Customer Referral    · is_internal=FALSE · active   → Customer pill
--   - Vivek Sridhar (Founder) · is_internal=TRUE · inactive → hidden from picker
-- ============================================================================

-- (1) Reassign leads off Vivek's seed
WITH mgmt AS (
  SELECT id FROM channel_partners WHERE partner_name = 'Management Referral' LIMIT 1
)
UPDATE leads
SET channel_partner_id = (SELECT id FROM mgmt)
WHERE channel_partner_id IN (
  SELECT id FROM channel_partners WHERE partner_name = 'Vivek Sridhar (Founder)'
);

-- (2) Soft-deactivate Vivek's seed. Picker filters by is_active=TRUE so it
--     disappears from dropdowns automatically.
UPDATE channel_partners
SET is_active = FALSE
WHERE partner_name = 'Vivek Sridhar (Founder)';

-- (3) Rename the external catch-all
UPDATE channel_partners
SET partner_name = 'Customer Referral'
WHERE partner_name = 'Generic Client';
