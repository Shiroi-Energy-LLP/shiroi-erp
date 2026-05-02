-- ============================================================================
-- Migration 088 — leads_update RLS hardening + payment-tracker RPC
-- Date: 2026-05-01
-- Why: (a) Prem (sales_engineer) silently failed to update unassigned leads
--      because leads_update only allowed founder/hr_manager/marketing_manager
--      OR assigned_to=self. leads_insert and leads_read both already include
--      sales_engineer; this aligns leads_update with the documented "full
--      access on leads and proposals" role definition.
--      (b) New /payments/tracker page needs an aggregate per-project rollup
--      of invoiced ₹ / sent ₹ / received ₹ / remaining ₹ — done in SQL per
--      NEVER-DO #12 (no money aggregation in JS).
-- ============================================================================

-- (a) RLS: add sales_engineer to leads_update
DROP POLICY IF EXISTS leads_update ON leads;
CREATE POLICY leads_update ON leads FOR UPDATE USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'marketing_manager'::app_role,
    'sales_engineer'::app_role
  ])
  OR assigned_to = get_my_employee_id()
);

-- (b) RPC: per-project payment tracker rows
CREATE OR REPLACE FUNCTION get_payment_tracker_rows()
RETURNS TABLE (
  project_id          UUID,
  project_number      TEXT,
  customer_name       TEXT,
  project_status      project_status,
  order_date          DATE,
  order_date_source   TEXT,
  completed_date      DATE,
  contracted_value    NUMERIC(14,2),
  total_invoiced      NUMERIC(14,2),
  total_invoice_sent  NUMERIC(14,2),
  total_received      NUMERIC(14,2),
  remaining           NUMERIC(14,2),
  days_since_order    INT,
  latest_payment_date DATE
)
LANGUAGE sql
STABLE
AS $$
  WITH inv AS (
    SELECT
      project_id,
      SUM(total_amount)                                   AS total_invoiced,
      SUM(total_amount) FILTER (WHERE sent_at IS NOT NULL) AS total_invoice_sent
    FROM invoices
    WHERE project_id IS NOT NULL
    GROUP BY project_id
  ),
  pay AS (
    SELECT
      project_id,
      SUM(amount)        AS total_received,
      MAX(payment_date)  AS latest_payment_date
    FROM customer_payments
    WHERE project_id IS NOT NULL
    GROUP BY project_id
  ),
  prop AS (
    SELECT lead_id, MIN(accepted_at)::date AS accepted_at
    FROM proposals
    WHERE status = 'accepted' AND accepted_at IS NOT NULL
    GROUP BY lead_id
  )
  SELECT
    p.id,
    p.project_number,
    p.customer_name,
    p.status,
    COALESCE(p.order_date, prop.accepted_at, p.created_at::date) AS order_date,
    CASE
      WHEN p.order_date     IS NOT NULL THEN 'order'
      WHEN prop.accepted_at IS NOT NULL THEN 'accepted'
      ELSE 'created'
    END AS order_date_source,
    COALESCE(p.commissioned_date, p.actual_end_date) AS completed_date,
    p.contracted_value,
    COALESCE(inv.total_invoiced, 0)     AS total_invoiced,
    COALESCE(inv.total_invoice_sent, 0) AS total_invoice_sent,
    COALESCE(pay.total_received, 0)     AS total_received,
    p.contracted_value - COALESCE(pay.total_received, 0) AS remaining,
    GREATEST(0,
      CURRENT_DATE - COALESCE(p.order_date, prop.accepted_at, p.created_at::date)
    )::int AS days_since_order,
    pay.latest_payment_date
  FROM projects p
  LEFT JOIN inv  ON inv.project_id = p.id
  LEFT JOIN pay  ON pay.project_id = p.id
  LEFT JOIN prop ON prop.lead_id   = p.lead_id
  WHERE p.contracted_value > 0
  ORDER BY COALESCE(p.order_date, prop.accepted_at, p.created_at::date) ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_payment_tracker_rows() TO authenticated;
