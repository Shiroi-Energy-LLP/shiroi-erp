-- Migration 202 — morning-digest v2 lead lists (Vivek's July-04 message spec).
-- Vivek's 7AM block becomes: leads closed last week (names) + work done (24h tasks)
-- + leads closing this week (names) — follow-up sections dropped from his message.
-- Prem's 8AM block becomes: follow-up-overdue leads (flagged) + closing-this-week
-- reminder. Both windows are rolling 7 days, computed in IST.
-- Consumed by apps/erp/src/lib/ai/briefing-action-block.ts (service_role).
BEGIN;

-- 1. Leads Won in the last 7 days (IST). closed_date is the actual Won date
--    stamped by trg_set_lead_close_date_on_status (mig 200), already indexed
--    there (idx_leads_closed_date).
CREATE OR REPLACE VIEW v_digest_leads_won_last_week AS
SELECT
  l.id AS lead_id,
  l.customer_name,
  l.estimated_size_kwp,
  l.closed_date,
  e.full_name AS owner_name
FROM leads l
LEFT JOIN employees e ON e.id = l.assigned_to
WHERE l.deleted_at IS NULL
  AND l.status = 'won'
  AND l.closed_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 7
ORDER BY l.closed_date DESC, l.customer_name;
COMMENT ON VIEW v_digest_leads_won_last_week IS
  'Leads Won in the last 7 days (IST, rolling). Drives the "Closed last week" list in the founder morning digest.';
GRANT SELECT ON public.v_digest_leads_won_last_week TO authenticated, service_role;

-- 2. Open leads forecast to close in the next 7 days (IST, rolling — today
--    through today+6). expected_close_date only ever holds a forecast for open
--    deals since mig 200 clears it on Won/lost/on_hold.
CREATE OR REPLACE VIEW v_digest_leads_closing_this_week AS
SELECT
  l.id AS lead_id,
  l.customer_name,
  l.estimated_size_kwp,
  l.expected_close_date,
  e.full_name AS owner_name
FROM leads l
LEFT JOIN employees e ON e.id = l.assigned_to
WHERE l.deleted_at IS NULL
  AND l.status NOT IN ('won','lost','on_hold','disqualified','converted')
  AND l.expected_close_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
  AND l.expected_close_date <  (now() AT TIME ZONE 'Asia/Kolkata')::date + 7
ORDER BY l.expected_close_date, l.customer_name;
COMMENT ON VIEW v_digest_leads_closing_this_week IS
  'Open leads with expected_close_date in the next 7 days (IST, rolling). Drives the "Closing this week" list in the founder + sales-head morning digests.';
GRANT SELECT ON public.v_digest_leads_closing_this_week TO authenticated, service_role;

COMMIT;
