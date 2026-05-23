-- Migration 114: Active-project queue digest view for projects manager (Manivel)
--
-- Surfaces projects in yet_to_start | in_progress | holding_shiroi status with
-- their PM and time-in-stage. Drives workflow #22 (renamed to "Active project
-- queue"). Follows the v_digest_milestones_overdue pattern from migration 083.

CREATE OR REPLACE VIEW v_digest_projects_active_for_pm AS
SELECT
  p.id AS project_id,
  p.project_number,
  p.customer_name,
  p.system_size_kwp,
  p.status,
  -- Stage order key: yet_to_start (0) before in_progress (1) before holding_shiroi (2)
  CASE p.status
    WHEN 'yet_to_start' THEN 0
    WHEN 'in_progress' THEN 1
    WHEN 'holding_shiroi' THEN 2
  END AS status_sort_order,
  -- How long the project has been in its current status (days)
  GREATEST(0, (CURRENT_DATE - p.status_updated_at::date)) AS days_in_status,
  pm.id AS project_manager_id,
  pm.full_name AS project_manager_name,
  pm.whatsapp_number AS project_manager_whatsapp_number
FROM projects p
LEFT JOIN employees pm ON pm.id = p.project_manager_id
WHERE p.deleted_at IS NULL
  AND p.status IN ('yet_to_start','in_progress','holding_shiroi')
ORDER BY status_sort_order, days_in_status DESC;

COMMENT ON VIEW v_digest_projects_active_for_pm IS
  'Active-project queue for the projects manager (Manivel). Excludes order_received (still in handoff), holding_client (not actionable for PM), waiting_net_metering (liaison concern), and completed. Ordered: yet_to_start first, then in_progress, then holding_shiroi; within group by days_in_status desc. Drives n8n workflow #22.';

GRANT SELECT ON public.v_digest_projects_active_for_pm TO authenticated, service_role;
