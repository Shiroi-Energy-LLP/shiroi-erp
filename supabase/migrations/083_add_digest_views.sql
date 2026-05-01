-- Migration 083: SQL views for Tier 2 digest queries
--
-- Each view targets one bullet point in a morning WhatsApp digest (catalog Tier 2,
-- #19–#28). n8n cron workflows query these via the Supabase REST endpoint
-- `/rest/v1/<view_name>` using the service-role key. Keeping the logic in the DB
-- means the ERP owns the definition of "new lead" / "overdue" / "stale" and n8n
-- stays pure orchestration.
--
-- All views:
--   - Exclude soft-deleted rows (`deleted_at IS NULL`) where the column exists
--   - Return small result sets (digest-sized, not analytical)
--   - Include display-ready fields so n8n can format without SQL-side computation
--
-- Apply to dev first, verify, then prod. No type regen needed — views don't show
-- up in database.ts by default (Supabase types generator skips views unless
-- explicitly configured).

-- ── v_digest_leads_new_24h ──
-- Tier 2 #20 (Sales head 8AM). New leads created in the last 24 hours with the
-- salesperson they've been assigned to.
CREATE OR REPLACE VIEW v_digest_leads_new_24h AS
SELECT
  l.id AS lead_id,
  l.customer_name,
  l.phone,
  l.city,
  l.source,
  l.segment,
  l.estimated_size_kwp,
  l.created_at,
  e.id AS assigned_employee_id,
  e.full_name AS assigned_employee_name,
  e.personal_phone AS assigned_employee_phone
FROM leads l
LEFT JOIN employees e ON e.id = l.assigned_to
WHERE l.deleted_at IS NULL
  AND l.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY l.created_at DESC;

COMMENT ON VIEW v_digest_leads_new_24h IS
  'Tier 2 #20 digest source — leads created in the last 24h with assigned salesperson. n8n reads at 8AM IST.';

-- ── v_digest_leads_stale_24h ──
-- Tier 1 #3 (lead unacted >24h) + Tier 2 #20. Active leads whose status hasn't
-- changed in 24h+ and which aren't in a terminal state.
CREATE OR REPLACE VIEW v_digest_leads_stale_24h AS
SELECT
  l.id AS lead_id,
  l.customer_name,
  l.phone,
  l.status,
  l.status_updated_at,
  EXTRACT(EPOCH FROM (NOW() - l.status_updated_at)) / 3600 AS hours_since_update,
  e.id AS assigned_employee_id,
  e.full_name AS assigned_employee_name,
  e.personal_phone AS assigned_employee_phone
FROM leads l
LEFT JOIN employees e ON e.id = l.assigned_to
WHERE l.deleted_at IS NULL
  AND l.status NOT IN ('won', 'converted', 'lost', 'disqualified')
  AND l.status_updated_at < NOW() - INTERVAL '24 hours'
ORDER BY l.status_updated_at ASC;

COMMENT ON VIEW v_digest_leads_stale_24h IS
  'Tier 1 #3 / Tier 2 #20 source — active leads with no status change for 24h+. Ordered oldest first so n8n can cap at top-N.';

-- ── v_digest_projects_installs_today ──
-- Tier 2 #22 (Projects head 8AM). Projects where install is scheduled to start
-- today (IST). Uses planned_start_date as the source of truth.
CREATE OR REPLACE VIEW v_digest_projects_installs_today AS
SELECT
  p.id AS project_id,
  p.project_number,
  p.customer_name,
  p.customer_phone,
  p.system_size_kwp,
  p.site_city,
  p.site_address_line1,
  p.planned_start_date,
  p.status,
  pm.full_name AS project_manager_name,
  pm.personal_phone AS project_manager_phone,
  ss.full_name AS site_supervisor_name,
  ss.personal_phone AS site_supervisor_phone
FROM projects p
LEFT JOIN employees pm ON pm.id = p.project_manager_id
LEFT JOIN employees ss ON ss.id = p.site_supervisor_id
WHERE p.deleted_at IS NULL
  AND p.planned_start_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY p.site_city, p.project_number;

COMMENT ON VIEW v_digest_projects_installs_today IS
  'Tier 2 #22 source — projects where planned_start_date is today (IST). Includes PM + supervisor for WhatsApp roll-call.';

-- ── v_digest_projects_overdue_commissioning ──
-- Tier 3 #35 (installed but not commissioned >30d). Tracks projects that
-- completed installation but haven't been commissioned for over 30 days.
-- Note: project_status enum has no distinct 'installed' value — in this ERP,
-- commissioning is marked by commissioned_date being set, separate from
-- actual_end_date which records when install work finished. View uses those
-- two dates directly rather than status.
CREATE OR REPLACE VIEW v_digest_projects_overdue_commissioning AS
SELECT
  p.id AS project_id,
  p.project_number,
  p.customer_name,
  p.customer_phone,
  p.system_size_kwp,
  p.actual_end_date,
  p.status,
  (CURRENT_DATE - p.actual_end_date) AS days_since_install,
  pm.full_name AS project_manager_name,
  pm.personal_phone AS project_manager_phone
FROM projects p
LEFT JOIN employees pm ON pm.id = p.project_manager_id
WHERE p.deleted_at IS NULL
  AND p.actual_end_date IS NOT NULL
  AND p.commissioned_date IS NULL
  AND p.actual_end_date < (CURRENT_DATE - INTERVAL '30 days')
ORDER BY p.actual_end_date ASC;

COMMENT ON VIEW v_digest_projects_overdue_commissioning IS
  'Tier 3 #35 source — projects where install finished (actual_end_date set) but commissioned_date is NULL and actual_end_date is >30d old. Oldest first.';

-- ── v_digest_expenses_pending_approval ──
-- Tier 2 #27 (HR head / Manager digest). Expense claims submitted but not yet
-- approved, with submitter + manager for routing.
CREATE OR REPLACE VIEW v_digest_expenses_pending_approval AS
SELECT
  ex.id AS expense_id,
  ex.voucher_number,
  ex.amount,
  ex.description,
  ex.expense_date,
  ex.submitted_at,
  EXTRACT(EPOCH FROM (NOW() - ex.submitted_at)) / 86400 AS days_pending,
  cat.label AS category,
  pr.project_number,
  emp.id AS submitter_id,
  emp.full_name AS submitter_name,
  emp.personal_phone AS submitter_phone,
  mgr.id AS manager_id,
  mgr.full_name AS manager_name,
  mgr.personal_phone AS manager_phone
FROM expenses ex
LEFT JOIN expense_categories cat ON cat.id = ex.category_id
LEFT JOIN projects pr ON pr.id = ex.project_id
LEFT JOIN employees emp ON emp.id = ex.submitted_by
LEFT JOIN employees mgr ON mgr.id = emp.reporting_to_id
WHERE ex.status = 'submitted'
ORDER BY ex.submitted_at ASC;

COMMENT ON VIEW v_digest_expenses_pending_approval IS
  'Tier 2 #27 source — submitted expense claims awaiting manager approval. Grouped by manager in n8n.';

-- ── v_digest_invoices_overdue_15d ──
-- Tier 3 #31 / Tier 2 #24 (Finance head). Customer invoices with outstanding
-- balance, due date passed by more than 15 days.
CREATE OR REPLACE VIEW v_digest_invoices_overdue_15d AS
SELECT
  i.id AS invoice_id,
  i.invoice_number,
  i.invoice_date,
  i.due_date,
  (CURRENT_DATE - i.due_date) AS days_overdue,
  i.total_amount,
  i.amount_outstanding,
  i.project_id,
  p.project_number,
  p.customer_name,
  p.customer_phone,
  sp.id AS sales_person_id,
  sp.full_name AS sales_person_name,
  sp.personal_phone AS sales_person_phone
FROM invoices i
JOIN projects p ON p.id = i.project_id
LEFT JOIN leads l ON l.id = p.lead_id
LEFT JOIN employees sp ON sp.id = l.assigned_to
WHERE i.amount_outstanding > 0
  AND i.due_date < (CURRENT_DATE - INTERVAL '15 days')
ORDER BY i.due_date ASC;

COMMENT ON VIEW v_digest_invoices_overdue_15d IS
  'Tier 2 #24 / Tier 3 #31 source — customer invoices with outstanding balance >15d past due. Includes original salesperson for follow-up.';

-- ── v_digest_employees_birthday_today ──
-- Tier 2 #27 (HR head) / Tier 4 #49 (customer birthdays are a separate view).
-- Employees whose DoB month-day matches today (IST), active only.
CREATE OR REPLACE VIEW v_digest_employees_birthday_today AS
SELECT
  e.id AS employee_id,
  e.employee_code,
  e.full_name,
  e.department,
  e.designation,
  e.personal_phone,
  e.personal_email,
  e.date_of_birth,
  EXTRACT(YEAR FROM AGE(e.date_of_birth)) AS age_today
FROM employees e
WHERE e.is_active
  AND e.date_of_birth IS NOT NULL
  AND TO_CHAR(e.date_of_birth, 'MM-DD') = TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'MM-DD')
ORDER BY e.full_name;

COMMENT ON VIEW v_digest_employees_birthday_today IS
  'Tier 2 #27 source — active employees whose DoB matches today (IST). n8n composes the team birthday message.';

-- ── Grant SELECT to authenticated role so PostgREST can expose these ──
-- service-role already has access; this grant is for clarity when testing from the SQL editor.
GRANT SELECT ON
  v_digest_leads_new_24h,
  v_digest_leads_stale_24h,
  v_digest_projects_installs_today,
  v_digest_projects_overdue_commissioning,
  v_digest_expenses_pending_approval,
  v_digest_invoices_overdue_15d,
  v_digest_employees_birthday_today
TO authenticated, service_role;
