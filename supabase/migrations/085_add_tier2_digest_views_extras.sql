-- Migration 085: Additional Tier 2 digest views
--
-- Extends 083 with eight more views targeting the remaining digest bullets
-- across Sales (#21), Design, Projects (#22), Procurement (#23), Finance
-- (#23/24/26), O&M (#25), and HR (#27). Each view is small (digest-sized)
-- and returns display-ready fields so n8n formats without extra SQL.
--
-- Column convention: we expose `*_whatsapp_number` (not personal_phone) since
-- n8n will dial these numbers for WhatsApp sends. Backfill in 082 keeps
-- existing rows aligned; future HR updates to whatsapp_number land here
-- automatically. (083 still references personal_phone — that's intentional
-- for this pass; if/when HR starts diverging those columns we'll cut a
-- separate rename migration rather than silently update 083 view columns.)
--
-- Apply to dev first, verify, then prod. Views aren't included in database.ts
-- by default so no type regen is strictly required, but we regen anyway for
-- completeness.

-- ── v_digest_proposals_silent_3d ──
-- Tier 2 #21 (Sales head 8AM). Proposals that have been sent to customer
-- but no follow-up status change (viewed/negotiating/accepted) in 3+ days.
-- We match `status = 'sent'` specifically — viewed/negotiating are "good"
-- states (customer engaged).
CREATE OR REPLACE VIEW v_digest_proposals_silent_3d AS
SELECT
  pr.id AS proposal_id,
  pr.proposal_number,
  pr.sent_at,
  (EXTRACT(EPOCH FROM (NOW() - pr.sent_at)) / 86400)::int AS days_silent,
  pr.status,
  l.id AS lead_id,
  l.customer_name,
  l.phone AS customer_phone,
  l.city,
  l.estimated_size_kwp,
  prep.id AS prepared_by_id,
  prep.full_name AS prepared_by_name,
  prep.whatsapp_number AS prepared_by_whatsapp_number,
  sales.id AS sales_person_id,
  sales.full_name AS sales_person_name,
  sales.whatsapp_number AS sales_person_whatsapp_number
FROM proposals pr
LEFT JOIN leads l ON l.id = pr.lead_id
LEFT JOIN employees prep ON prep.id = pr.prepared_by
LEFT JOIN employees sales ON sales.id = l.assigned_to
WHERE pr.status = 'sent'
  AND pr.sent_at IS NOT NULL
  AND pr.sent_at < NOW() - INTERVAL '3 days'
ORDER BY pr.sent_at ASC;

COMMENT ON VIEW v_digest_proposals_silent_3d IS
  'Tier 2 #21 source — proposals sent to customer 3+ days ago with no status change since. Ordered oldest-first.';

-- ── v_digest_proposals_design_backlog ──
-- Tier 2 #22 (Design team head). Proposals still in draft 24h+ after
-- creation — design hasn't finished the first pass. Uses status_updated_at
-- as the "stuck since" indicator.
CREATE OR REPLACE VIEW v_digest_proposals_design_backlog AS
SELECT
  pr.id AS proposal_id,
  pr.proposal_number,
  pr.status_updated_at,
  (EXTRACT(EPOCH FROM (NOW() - pr.status_updated_at)) / 3600)::int AS hours_in_draft,
  l.id AS lead_id,
  l.customer_name,
  l.phone AS customer_phone,
  l.city,
  l.estimated_size_kwp,
  prep.id AS prepared_by_id,
  prep.full_name AS prepared_by_name,
  prep.whatsapp_number AS prepared_by_whatsapp_number
FROM proposals pr
LEFT JOIN leads l ON l.id = pr.lead_id
LEFT JOIN employees prep ON prep.id = pr.prepared_by
WHERE pr.status = 'draft'
  AND pr.status_updated_at < NOW() - INTERVAL '24 hours'
ORDER BY pr.status_updated_at ASC;

COMMENT ON VIEW v_digest_proposals_design_backlog IS
  'Tier 2 #22 source — proposals stuck in draft for 24h+. Surfaces the design team''s backlog for the morning digest.';

-- ── v_digest_milestones_overdue ──
-- Tier 2 #22 (Projects head 8AM). Project milestones whose planned_end_date
-- has passed but actual_end_date is not set. Excludes completed/skipped.
CREATE OR REPLACE VIEW v_digest_milestones_overdue AS
SELECT
  m.id AS milestone_id,
  m.milestone_name,
  m.planned_end_date,
  (CURRENT_DATE - m.planned_end_date) AS days_overdue,
  m.status,
  p.id AS project_id,
  p.project_number,
  p.customer_name,
  p.customer_phone,
  p.system_size_kwp,
  pm.id AS project_manager_id,
  pm.full_name AS project_manager_name,
  pm.whatsapp_number AS project_manager_whatsapp_number
FROM project_milestones m
JOIN projects p ON p.id = m.project_id
LEFT JOIN employees pm ON pm.id = p.project_manager_id
WHERE p.deleted_at IS NULL
  AND m.planned_end_date IS NOT NULL
  AND m.actual_end_date IS NULL
  AND m.status NOT IN ('completed', 'skipped')
  AND m.planned_end_date < CURRENT_DATE
ORDER BY m.planned_end_date ASC;

COMMENT ON VIEW v_digest_milestones_overdue IS
  'Tier 2 #22 source — project milestones past planned_end_date with no actual_end_date. Oldest first.';

-- ── v_digest_pos_pending_approval ──
-- Tier 2 #23 (Procurement / CEO digest). POs requiring approval that are
-- still in pending_approval state. CEO / founder approvals live here.
CREATE OR REPLACE VIEW v_digest_pos_pending_approval AS
SELECT
  po.id AS po_id,
  po.po_number,
  po.po_date,
  po.total_amount,
  po.approval_status,
  (CURRENT_DATE - po.po_date) AS days_pending,
  v.id AS vendor_id,
  v.company_name AS vendor_name,
  v.is_msme AS vendor_is_msme,
  pr.id AS project_id,
  pr.project_number,
  pr.customer_name,
  prep.id AS prepared_by_id,
  prep.full_name AS prepared_by_name,
  prep.whatsapp_number AS prepared_by_whatsapp_number
FROM purchase_orders po
LEFT JOIN vendors v ON v.id = po.vendor_id
LEFT JOIN projects pr ON pr.id = po.project_id
LEFT JOIN employees prep ON prep.id = po.prepared_by
WHERE po.requires_approval = true
  AND po.approval_status = 'pending_approval'
ORDER BY po.po_date ASC;

COMMENT ON VIEW v_digest_pos_pending_approval IS
  'Tier 2 #23 source — purchase orders in pending_approval state. Ordered oldest PO first.';

-- ── v_digest_vendor_payments_due_7d ──
-- Tier 2 #23/26 (Finance/Procurement). POs with payment_due_date in the
-- next 7 days and outstanding balance. MSME flag flows through for the
-- 45-day statutory reminder in the same digest.
CREATE OR REPLACE VIEW v_digest_vendor_payments_due_7d AS
SELECT
  po.id AS po_id,
  po.po_number,
  po.po_date,
  po.payment_due_date,
  (po.payment_due_date - CURRENT_DATE) AS days_until_due,
  po.total_amount,
  po.amount_paid,
  po.amount_outstanding,
  v.id AS vendor_id,
  v.company_name AS vendor_name,
  v.contact_person AS vendor_contact_person,
  v.phone AS vendor_phone,
  v.is_msme AS vendor_is_msme,
  pr.id AS project_id,
  pr.project_number,
  pr.customer_name
FROM purchase_orders po
LEFT JOIN vendors v ON v.id = po.vendor_id
LEFT JOIN projects pr ON pr.id = po.project_id
WHERE po.payment_due_date IS NOT NULL
  AND po.payment_due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')::date
  AND po.amount_outstanding > 0
  AND po.status NOT IN ('cancelled', 'draft')
ORDER BY po.payment_due_date ASC;

COMMENT ON VIEW v_digest_vendor_payments_due_7d IS
  'Tier 2 #23/26 source — vendor POs with payment_due_date in next 7 days and outstanding balance. MSME flag included for 45-day compliance callout.';

-- ── v_digest_invoices_due_7d ──
-- Tier 2 #24 (Finance head 8AM). Customer invoices with due_date within 7
-- days and outstanding balance (not yet overdue — separate view 083
-- handles >15d overdue).
CREATE OR REPLACE VIEW v_digest_invoices_due_7d AS
SELECT
  i.id AS invoice_id,
  i.invoice_number,
  i.invoice_date,
  i.due_date,
  (i.due_date - CURRENT_DATE) AS days_until_due,
  i.total_amount,
  i.amount_outstanding,
  i.status,
  p.id AS project_id,
  p.project_number,
  p.customer_name,
  p.customer_phone,
  sp.id AS sales_person_id,
  sp.full_name AS sales_person_name,
  sp.whatsapp_number AS sales_person_whatsapp_number
FROM invoices i
JOIN projects p ON p.id = i.project_id
LEFT JOIN leads l ON l.id = p.lead_id
LEFT JOIN employees sp ON sp.id = l.assigned_to
WHERE i.amount_outstanding > 0
  AND i.status NOT IN ('paid', 'cancelled')
  AND i.due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')::date
ORDER BY i.due_date ASC;

COMMENT ON VIEW v_digest_invoices_due_7d IS
  'Tier 2 #24 source — customer invoices due in next 7 days with outstanding balance. Pairs with v_digest_invoices_overdue_15d from 083.';

-- ── v_digest_om_tickets_open_48h ──
-- Tier 2 #25 (O&M head). Service tickets still open after 48+ hours, or
-- already SLA-breached. Surfaces the queue that needs escalation.
CREATE OR REPLACE VIEW v_digest_om_tickets_open_48h AS
SELECT
  t.id AS ticket_id,
  t.ticket_number,
  t.title,
  t.severity,
  t.status,
  t.created_at,
  (EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600)::int AS hours_open,
  t.sla_deadline,
  t.sla_breached,
  pr.id AS project_id,
  pr.project_number,
  pr.customer_name,
  pr.customer_phone,
  assignee.id AS assignee_id,
  assignee.full_name AS assignee_name,
  assignee.whatsapp_number AS assignee_whatsapp_number
FROM om_service_tickets t
LEFT JOIN projects pr ON pr.id = t.project_id
LEFT JOIN employees assignee ON assignee.id = t.assigned_to
WHERE t.status NOT IN ('resolved', 'closed')
  AND (
    t.created_at < NOW() - INTERVAL '48 hours'
    OR t.sla_breached = true
  )
ORDER BY t.severity DESC, t.created_at ASC;

COMMENT ON VIEW v_digest_om_tickets_open_48h IS
  'Tier 2 #25 source — open service tickets older than 48h OR already SLA-breached. Severity DESC so critical surface first.';

-- ── v_digest_leave_pending ──
-- Tier 2 #27 (HR head 8AM). Leave requests awaiting manager approval.
-- total_days computed from from_date / to_date since no stored column.
CREATE OR REPLACE VIEW v_digest_leave_pending AS
SELECT
  lr.id AS leave_id,
  lr.leave_type,
  lr.from_date,
  lr.to_date,
  ((lr.to_date - lr.from_date) + 1) AS total_days,
  lr.reason,
  lr.created_at AS submitted_at,
  (EXTRACT(EPOCH FROM (NOW() - lr.created_at)) / 86400)::int AS days_pending,
  emp.id AS employee_id,
  emp.full_name AS employee_name,
  emp.employee_code,
  emp.department,
  emp.whatsapp_number AS employee_whatsapp_number,
  mgr.id AS manager_id,
  mgr.full_name AS manager_name,
  mgr.whatsapp_number AS manager_whatsapp_number
FROM leave_requests lr
LEFT JOIN employees emp ON emp.id = lr.employee_id
LEFT JOIN employees mgr ON mgr.id = emp.reporting_to_id
WHERE lr.status = 'pending'
ORDER BY lr.created_at ASC;

COMMENT ON VIEW v_digest_leave_pending IS
  'Tier 2 #27 source — leave_requests in pending status. Grouped by manager in n8n for routing.';

-- ── Grant SELECT to authenticated + service_role ──
GRANT SELECT ON
  v_digest_proposals_silent_3d,
  v_digest_proposals_design_backlog,
  v_digest_milestones_overdue,
  v_digest_pos_pending_approval,
  v_digest_vendor_payments_due_7d,
  v_digest_invoices_due_7d,
  v_digest_om_tickets_open_48h,
  v_digest_leave_pending
TO authenticated, service_role;
