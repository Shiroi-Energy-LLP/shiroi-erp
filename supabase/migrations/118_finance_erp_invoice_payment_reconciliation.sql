-- Migration 118: ERP-native invoice raising, payment recording, receivables reconciliation
-- Phase C2 + C3 + C4

-- ── C2: invoices table additions ──

-- Flag ERP-created invoices (vs Zoho-imported)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS erp_created BOOLEAN NOT NULL DEFAULT FALSE;

-- Simple description for line-item text (ERP-raised invoices)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description TEXT;

-- Consolidated tax amount column (alternative to separate gst_supply/gst_works split for simple invoices)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Index on erp_created for filtering ERP vs Zoho invoices
CREATE INDEX IF NOT EXISTS idx_invoices_erp_created ON invoices(erp_created);

-- Index on status+due_date for overdue queries
CREATE INDEX IF NOT EXISTS idx_invoices_status_due_date ON invoices(status, due_date);

-- Index on project_id for per-project invoice queries (may already exist)
CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON invoices(project_id);

-- ── C3: customer_payments table additions ──

-- Flag ERP-recorded payments (vs Zoho-imported)
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS erp_recorded BOOLEAN NOT NULL DEFAULT FALSE;

-- Index on project_id for per-project payment queries (may already exist)
CREATE INDEX IF NOT EXISTS idx_customer_payments_project_id ON customer_payments(project_id);

-- Index on invoice_id for per-invoice payment queries
CREATE INDEX IF NOT EXISTS idx_customer_payments_invoice_id ON customer_payments(invoice_id);

-- ── C4: get_receivables_reconciliation RPC ──

CREATE OR REPLACE FUNCTION get_receivables_reconciliation()
RETURNS TABLE (
  project_id        UUID,
  project_number    TEXT,
  customer_name     TEXT,
  project_status    TEXT,
  total_invoiced    NUMERIC,
  total_paid        NUMERIC,
  outstanding       NUMERIC,
  invoice_count     BIGINT,
  overdue_count     BIGINT,
  last_payment_date DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    p.id                                              AS project_id,
    p.project_number,
    p.customer_name,
    p.status::TEXT                                    AS project_status,
    COALESCE(SUM(i.total_amount), 0)                 AS total_invoiced,
    COALESCE(SUM(i.amount_paid), 0)                  AS total_paid,
    COALESCE(SUM(i.amount_outstanding), 0)           AS outstanding,
    COUNT(i.id)                                      AS invoice_count,
    COUNT(i.id) FILTER (
      WHERE i.due_date < CURRENT_DATE
        AND i.status NOT IN ('paid','cancelled')
    )                                                AS overdue_count,
    (
      SELECT MAX(cp.payment_date)
      FROM customer_payments cp
      WHERE cp.project_id = p.id
        AND cp.excluded_from_cash = FALSE
    )                                                AS last_payment_date
  FROM projects p
  LEFT JOIN invoices i
         ON i.project_id = p.id
        AND i.excluded_from_cash = FALSE
        AND i.status != 'cancelled'
  GROUP BY p.id, p.project_number, p.customer_name, p.status
  HAVING
    COALESCE(SUM(i.total_amount), 0) > 0
    OR p.status IN (
      'in_progress'::project_status,
      'completed'::project_status,
      'holding_client'::project_status,
      'waiting_net_metering'::project_status,
      'meter_client_scope'::project_status
    )
  ORDER BY COALESCE(SUM(i.amount_outstanding), 0) DESC;
$$;

-- Grant execute to authenticated users (RLS on underlying tables still applies)
GRANT EXECUTE ON FUNCTION get_receivables_reconciliation() TO authenticated;
