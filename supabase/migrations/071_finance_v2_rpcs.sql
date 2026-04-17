-- Migration 071: Finance V2 RPCs
-- - get_project_profitability_v2 : per-project P&L including bills + expenses
-- - get_company_cash_summary_v2  : company cash + Zoho monthly subtraction
-- - get_msme_aging_summary       : bills bucketed by aging for dashboard strip
-- See spec §8.3, §8.4.
--
-- Notes:
-- - invoices uses amount_outstanding (not total_amount - amount_paid)
-- - vendor_bills.balance_due is a generated column (total_amount - amount_paid)
-- - expenses.amount is the payment amount; status='approved' means paid

BEGIN;

-- ============================================================================
-- get_project_profitability_v2
-- ============================================================================

CREATE OR REPLACE FUNCTION get_project_profitability_v2(p_project_id UUID DEFAULT NULL)
RETURNS TABLE (
  project_id              UUID,
  project_number          TEXT,
  customer_name           TEXT,
  status                  TEXT,
  contracted_value        NUMERIC,
  total_invoiced          NUMERIC,
  total_received          NUMERIC,
  total_ar_outstanding    NUMERIC,
  total_billed            NUMERIC,
  total_vendor_paid       NUMERIC,
  total_ap_outstanding    NUMERIC,
  total_expenses          NUMERIC,
  total_expenses_paid     NUMERIC,
  total_cost              NUMERIC,
  margin_amount           NUMERIC,
  margin_pct              NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH base AS (
    SELECT p.id, p.project_number, p.customer_name, p.status, p.contracted_value
    FROM projects p
    WHERE p_project_id IS NULL OR p.id = p_project_id
  ),
  inv AS (
    SELECT project_id,
           COALESCE(SUM(total_amount), 0)      AS invoiced,
           COALESCE(SUM(amount_paid), 0)        AS received,
           COALESCE(SUM(amount_outstanding), 0) AS ar_outstanding
    FROM invoices
    WHERE (p_project_id IS NULL OR project_id = p_project_id)
    GROUP BY project_id
  ),
  bill AS (
    SELECT project_id,
           COALESCE(SUM(total_amount), 0) AS billed,
           COALESCE(SUM(amount_paid), 0)  AS bills_paid
    FROM vendor_bills
    WHERE status <> 'cancelled'
      AND (p_project_id IS NULL OR project_id = p_project_id)
    GROUP BY project_id
  ),
  exp AS (
    SELECT project_id,
           COALESCE(SUM(amount), 0) AS expenses,
           COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) AS expenses_paid
    FROM expenses
    WHERE project_id IS NOT NULL
      AND (p_project_id IS NULL OR project_id = p_project_id)
    GROUP BY project_id
  )
  SELECT
    b.id,
    b.project_number,
    b.customer_name,
    b.status,
    COALESCE(b.contracted_value, 0),
    COALESCE(inv.invoiced, 0),
    COALESCE(inv.received, 0),
    COALESCE(inv.ar_outstanding, 0),
    COALESCE(bill.billed, 0),
    COALESCE(bill.bills_paid, 0),
    COALESCE(bill.billed, 0) - COALESCE(bill.bills_paid, 0),
    COALESCE(exp.expenses, 0),
    COALESCE(exp.expenses_paid, 0),
    COALESCE(bill.billed, 0) + COALESCE(exp.expenses, 0),
    COALESCE(b.contracted_value, 0) - (COALESCE(bill.billed, 0) + COALESCE(exp.expenses, 0)),
    CASE WHEN COALESCE(b.contracted_value, 0) > 0
      THEN ROUND(
        ((COALESCE(b.contracted_value, 0) - (COALESCE(bill.billed, 0) + COALESCE(exp.expenses, 0)))
          / b.contracted_value) * 100, 2)
      ELSE 0 END
  FROM base b
  LEFT JOIN inv  ON inv.project_id = b.id
  LEFT JOIN bill ON bill.project_id = b.id
  LEFT JOIN exp  ON exp.project_id = b.id
  ORDER BY b.project_number DESC;
$$;

-- ============================================================================
-- get_company_cash_summary_v2
-- Extends v1 by including vendor bills and Zoho monthly expense subtractions.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_company_cash_summary_v2()
RETURNS TABLE(
  total_receivables             NUMERIC,
  total_ap_bills                NUMERIC,
  total_ap_pos                  NUMERIC,
  total_project_expenses_paid   NUMERIC,
  zoho_monthly_company_expenses NUMERIC,
  open_reconciliation_count     BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COALESCE((SELECT SUM(amount_outstanding) FROM invoices), 0),
    COALESCE((SELECT SUM(balance_due) FROM vendor_bills WHERE status <> 'cancelled'), 0),
    COALESCE((SELECT SUM(amount_outstanding) FROM purchase_orders WHERE status NOT IN ('cancelled','draft')), 0),
    COALESCE((SELECT SUM(amount) FROM expenses WHERE status = 'approved' AND project_id IS NOT NULL), 0),
    COALESCE((
      SELECT SUM(debit_total - credit_total)
      FROM zoho_monthly_summary m
      JOIN zoho_account_codes a ON a.account_id = m.account_id
      WHERE a.account_type IN ('Expense','Other Expense')
        AND m.year = EXTRACT(YEAR FROM NOW() - INTERVAL '1 month')::INT
        AND m.month = EXTRACT(MONTH FROM NOW() - INTERVAL '1 month')::INT
    ), 0),
    (SELECT COUNT(*) FROM reconciliation_discrepancies WHERE status = 'open');
$$;

-- ============================================================================
-- get_msme_aging_summary — bill-based (replaces PO-delivery-based)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_msme_aging_summary()
RETURNS TABLE(
  bucket       TEXT,
  bill_count   BIGINT,
  total_amount NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH aging AS (
    SELECT
      b.id,
      b.balance_due,
      CURRENT_DATE - b.bill_date AS days_old
    FROM vendor_bills b
    JOIN vendors v ON v.id = b.vendor_id
    WHERE v.is_msme = true
      AND b.status NOT IN ('paid','cancelled')
  )
  SELECT bucket, COUNT(*)::BIGINT, COALESCE(SUM(balance_due), 0)
  FROM (
    SELECT
      CASE
        WHEN days_old <= 30 THEN '0-30'
        WHEN days_old <= 40 THEN '31-40'
        WHEN days_old <= 45 THEN '41-45'
        ELSE 'overdue'
      END AS bucket,
      balance_due
    FROM aging
  ) x
  GROUP BY bucket
  ORDER BY CASE bucket
    WHEN '0-30' THEN 1
    WHEN '31-40' THEN 2
    WHEN '41-45' THEN 3
    WHEN 'overdue' THEN 4
  END;
$$;

COMMIT;
