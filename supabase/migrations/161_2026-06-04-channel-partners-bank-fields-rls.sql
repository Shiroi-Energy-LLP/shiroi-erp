-- Migration 161 — 2026-06-04
-- Security finding S13 (from 2026-05-30 RLS review):
--   `channel_partners.bank_account_number` + `bank_ifsc` are sensitive PII (added
--   in migration 131). The existing `channel_partners_read` policy from
--   migration 052 grants SELECT on the BASE table to founder, sales_engineer,
--   finance and marketing_manager. Sales engineers and the marketing manager
--   should NOT be able to read bank fields — those are needed only by founder
--   and finance (for payout processing).
--
-- Pragmatic fix (conservative — no policy changes in this migration):
--   1. Add a security_invoker view `channel_partners_safe` that exposes every
--      column EXCEPT `bank_account_number` and `bank_ifsc`. Existing callers
--      that don't need bank fields can migrate to this view at their leisure.
--   2. The view inherits RLS via Postgres 15+ `security_invoker = true`, so
--      the existing `channel_partners_read` policy continues to apply through
--      the view (any role with base-table read access can read the view).
--   3. No policy changes in this migration — base-table reads stay open to all
--      four roles so we don't break callers that haven't migrated yet.
--
-- TODO (follow-up migration, after callers have been migrated to the view):
--   Tighten `channel_partners_read` on the BASE table so it only grants SELECT
--   to founder + finance:
--     DROP POLICY channel_partners_read ON channel_partners;
--     CREATE POLICY channel_partners_read ON channel_partners
--       FOR SELECT USING (
--         get_my_role() = ANY (ARRAY['founder'::app_role, 'finance'::app_role])
--       );
--   Sales engineers and the marketing manager must then read via
--   `channel_partners_safe`.

CREATE OR REPLACE VIEW public.channel_partners_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  partner_name,
  contact_person,
  phone,
  email,
  whatsapp,
  partner_type,
  commission_type,
  commission_rate,
  pan_number,
  tds_applicable,
  annual_commission_ytd,
  leads_referred_count,
  leads_converted_count,
  total_commission_paid,
  agreement_start_date,
  agreement_end_date,
  agreement_storage_path,
  is_active,
  deleted_at,
  created_at,
  updated_at,
  is_internal,
  default_commission_pct,
  -- bank_account_number INTENTIONALLY OMITTED (S13)
  -- bank_ifsc            INTENTIONALLY OMITTED (S13)
  portal_token,
  lifetime_referrals,
  lifetime_commission
FROM public.channel_partners
WHERE deleted_at IS NULL;

COMMENT ON VIEW public.channel_partners_safe IS
  'S13 (2026-05-30 review): bank-field-free projection of channel_partners. '
  'Use this from any code path that does NOT need bank_account_number / '
  'bank_ifsc. security_invoker=true so the base-table channel_partners_read '
  'RLS policy applies through the view. See migration 161 header for the '
  'follow-up plan to tighten the base-table policy once callers migrate.';

GRANT SELECT ON public.channel_partners_safe TO authenticated;
