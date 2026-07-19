-- Migration 204 — morning-digest v3 (Vivek's July-17 message spec).
-- (Authored as 203; renumbered to 204 — mig 203 was taken by the Jul-18
-- tasks-write RLS migration that landed on main first. Applied to dev Jul-17
-- as "morning_digest_work_done_names_won_yesterday".)
-- 1. "Work done" lines must carry the lead/project (customer) name — bare task
--    titles like "to follow" were meaningless in the 7AM WhatsApp digest.
-- 2. New "Won yesterday" list (closed_date = yesterday IST).
-- 3. "Due before today" reuses existing v_digest_leads_overdue (mig 170).
-- Consumed by apps/erp/src/lib/ai/briefing-action-block.ts (service_role) and
-- the n8n workflow-19 fallback compose.
BEGIN;

-- 1. Tasks completed in the last 24h, with the customer name of the lead or
--    project they belong to. Lead tasks link via entity_id; project tasks via
--    project_id (canonical FK since mig 007f) falling back to entity_id.
CREATE OR REPLACE VIEW v_digest_tasks_done_24h AS
SELECT
  t.id,
  t.title,
  t.category,
  t.entity_type,
  t.completed_at,
  e.full_name AS assignee_name,
  CASE WHEN t.entity_type = 'lead'    THEN l.customer_name
       WHEN t.entity_type = 'project' THEN pr.customer_name
  END AS customer_name,
  pr.project_number
FROM tasks t
LEFT JOIN employees e ON e.id = t.assigned_to
LEFT JOIN leads l ON t.entity_type = 'lead' AND l.id = t.entity_id
LEFT JOIN projects pr ON t.entity_type = 'project' AND pr.id = COALESCE(t.project_id, t.entity_id)
WHERE t.deleted_at IS NULL
  AND t.is_completed = TRUE
  AND t.completed_at >= now() - interval '24 hours'
ORDER BY t.completed_at DESC;
COMMENT ON VIEW v_digest_tasks_done_24h IS
  'Tasks completed in the last 24h with the customer name of their lead/project. Drives the "Work done" list in the founder morning digest.';
GRANT SELECT ON public.v_digest_tasks_done_24h TO authenticated, service_role;

-- The view filters completed tasks by completed_at daily; no index covered
-- that predicate (idx_tasks_* are all open-task partials). NEVER-DO #17.
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at
  ON tasks (completed_at DESC)
  WHERE is_completed = TRUE AND deleted_at IS NULL;

-- 2. Leads Won yesterday (IST). closed_date is the actual Won date stamped by
--    trg_set_lead_close_date_on_status (mig 200), indexed there.
CREATE OR REPLACE VIEW v_digest_leads_won_yesterday AS
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
  AND l.closed_date = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1
ORDER BY l.customer_name;
COMMENT ON VIEW v_digest_leads_won_yesterday IS
  'Leads Won yesterday (IST). Drives the "Won yesterday" list in the founder morning digest.';
GRANT SELECT ON public.v_digest_leads_won_yesterday TO authenticated, service_role;

COMMIT;
