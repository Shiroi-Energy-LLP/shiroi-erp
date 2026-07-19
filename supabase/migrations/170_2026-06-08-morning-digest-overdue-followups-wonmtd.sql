-- Migration 170 — morning-digest data: overdue deals, today's follow-ups, won MTD.
-- "Today"/"this month" computed in IST. Money aggregated in SQL (never JS reduce).
BEGIN;

-- 4a. Open leads overdue on follow-up OR expected close (all owners)
CREATE OR REPLACE VIEW v_digest_leads_overdue AS
SELECT
  l.id AS lead_id, l.customer_name, l.estimated_size_kwp,
  l.next_followup_date, l.expected_close_date,
  e.full_name AS owner_name,
  GREATEST(0, (now() AT TIME ZONE 'Asia/Kolkata')::date - l.next_followup_date) AS followup_overdue_days,
  GREATEST(0, (now() AT TIME ZONE 'Asia/Kolkata')::date - l.expected_close_date) AS close_overdue_days
FROM leads l
LEFT JOIN employees e ON e.id = l.assigned_to
WHERE l.deleted_at IS NULL
  AND l.status NOT IN ('won','lost','on_hold','disqualified','converted')
  AND ( (l.next_followup_date IS NOT NULL AND l.next_followup_date < (now() AT TIME ZONE 'Asia/Kolkata')::date)
     OR (l.expected_close_date IS NOT NULL AND l.expected_close_date < (now() AT TIME ZONE 'Asia/Kolkata')::date) )
ORDER BY LEAST(COALESCE(l.next_followup_date,'9999-12-31'::date),
               COALESCE(l.expected_close_date,'9999-12-31'::date));
COMMENT ON VIEW v_digest_leads_overdue IS 'Open leads whose follow-up or expected-close date is before today (IST). Drives the morning action block.';
GRANT SELECT ON public.v_digest_leads_overdue TO authenticated, service_role;

-- 4b. Open sales-domain tasks due today (lead tasks + sales-category project tasks)
CREATE OR REPLACE VIEW v_digest_followup_tasks_today AS
SELECT
  t.id, t.title, t.category, t.due_date, t.entity_type, t.entity_id,
  e.full_name AS assignee_name,
  CASE WHEN t.entity_type='lead' THEN l.customer_name
       WHEN t.entity_type='project' THEN pr.customer_name END AS customer_name
FROM tasks t
LEFT JOIN employees e ON e.id = t.assigned_to
LEFT JOIN leads l ON t.entity_type='lead' AND l.id = t.entity_id
LEFT JOIN projects pr ON t.entity_type='project' AND pr.id = t.entity_id
WHERE t.deleted_at IS NULL AND t.is_completed = FALSE
  AND t.due_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  AND ( t.entity_type='lead'
        OR (t.entity_type='project' AND t.category IN ('payment_followup','payment_escalation','advance_payment','general')) )
ORDER BY e.full_name NULLS LAST, t.title;
COMMENT ON VIEW v_digest_followup_tasks_today IS 'Open sales-domain tasks due today (IST), grouped by assignee. Drives the morning action block.';
GRANT SELECT ON public.v_digest_followup_tasks_today TO authenticated, service_role;

-- 4c. Value won this calendar month-to-date (IST). Value = accepted proposal total, else base_quote_price.
CREATE OR REPLACE FUNCTION get_won_value_mtd()
RETURNS TABLE(won_count bigint, won_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH won_this_month AS (
    SELECT DISTINCT ON (h.lead_id) h.lead_id
    FROM lead_status_history h
    WHERE h.to_status = 'won'
      AND (h.changed_at AT TIME ZONE 'Asia/Kolkata')
            >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))
    ORDER BY h.lead_id, h.changed_at DESC
  )
  SELECT count(*)::bigint,
         COALESCE(SUM(COALESCE(p.total_after_discount, l.base_quote_price, 0)), 0)
  FROM won_this_month w
  JOIN leads l ON l.id = w.lead_id AND l.deleted_at IS NULL AND l.status='won'
  LEFT JOIN LATERAL (
    SELECT total_after_discount FROM proposals
    WHERE lead_id = w.lead_id AND status='accepted'
    ORDER BY created_at DESC LIMIT 1
  ) p ON true;
$fn$;
GRANT EXECUTE ON FUNCTION get_won_value_mtd() TO authenticated, service_role;

COMMIT;
