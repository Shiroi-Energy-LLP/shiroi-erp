-- supabase/migrations/093_orphan_read_rpcs.sql
-- ============================================================================
-- Migration 093 — Orphan triage read RPCs
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Three read RPCs that back the triage page:
--   - get_orphan_zoho_customer_summary() — left pane
--   - get_candidate_projects_for_zoho_customer(zoho_name) — right pane
--   - get_orphan_counts() — KPI strip + /cash banner

BEGIN;

CREATE OR REPLACE FUNCTION get_orphan_zoho_customer_summary()
RETURNS TABLE (
  zoho_customer_name        TEXT,
  invoice_count             INT,
  invoice_total             NUMERIC(14,2),
  payment_count             INT,
  payment_total             NUMERIC(14,2),
  candidate_project_count   INT
) AS $$
WITH orphan_invs AS (
  SELECT zoho_customer_name AS name, COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS total
    FROM invoices
   WHERE source = 'zoho_import'
     AND attribution_status = 'pending'
     AND zoho_customer_name IS NOT NULL
   GROUP BY zoho_customer_name
),
orphan_pays AS (
  SELECT zoho_customer_name AS name, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
    FROM customer_payments
   WHERE source = 'zoho_import'
     AND attribution_status = 'pending'
     AND zoho_customer_name IS NOT NULL
   GROUP BY zoho_customer_name
),
combined AS (
  SELECT COALESCE(i.name, p.name) AS name,
         COALESCE(i.n, 0)::INT AS inv_n,
         COALESCE(i.total, 0)  AS inv_total,
         COALESCE(p.n, 0)::INT AS pay_n,
         COALESCE(p.total, 0)  AS pay_total
    FROM orphan_invs i
    FULL OUTER JOIN orphan_pays p USING (name)
)
SELECT c.name,
       c.inv_n,
       c.inv_total,
       c.pay_n,
       c.pay_total,
       COALESCE((
         SELECT COUNT(*)::INT FROM projects pr
          WHERE LOWER(pr.customer_name) LIKE '%' || LOWER(SPLIT_PART(c.name, ' ', 1)) || '%'
       ), 0) AS candidate_project_count
  FROM combined c
 WHERE c.inv_n > 0 OR c.pay_n > 0
 ORDER BY (c.inv_total + c.pay_total) DESC;
$$ LANGUAGE sql STABLE SECURITY INVOKER;

----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_candidate_projects_for_zoho_customer(p_zoho_name TEXT)
RETURNS TABLE (
  project_id        UUID,
  project_number    TEXT,
  customer_name     TEXT,
  status            TEXT,
  system_size_kwp   NUMERIC,
  system_type       TEXT,
  contracted_value  NUMERIC(14,2),
  total_invoiced    NUMERIC(14,2),
  total_received    NUMERIC(14,2),
  net_cash_position NUMERIC(14,2),
  actual_start_date      DATE,
  actual_end_date    DATE
) AS $$
-- Token overlap: meaningful tokens of ERP customer must all appear in zoho name.
-- Stopwords mirrored from scripts/backfill-zoho-customer-attribution.ts.
WITH erp AS (
  SELECT id, customer_name, project_number, status,
         system_size_kwp, system_type, contracted_value,
         actual_start_date, actual_end_date,
         -- LOWER first so uppercase letters survive the punctuation-strip step.
         REGEXP_SPLIT_TO_ARRAY(REGEXP_REPLACE(LOWER(COALESCE(customer_name, '')), '[^a-z0-9 ]', ' ', 'g'), '\s+') AS toks
    FROM projects
),
filtered AS (
  SELECT e.*
    FROM erp e
   WHERE EXISTS (
     SELECT 1 FROM unnest(e.toks) t
      WHERE length(t) >= 2
        AND t NOT IN ('mr','mrs','ms','dr','shri','sri','sree','m','s','mss',
                      'pvt','private','ltd','limited','pl','plc','inc','co','company',
                      'corp','corporation','and','enterprises','enterprise',
                      'projects','project','group','holdings','holding','india','indian',
                      'p','the','of','kw','kwp')
        AND LOWER(p_zoho_name) LIKE '%' || t || '%'
   )
)
SELECT f.id,
       f.project_number,
       f.customer_name,
       f.status,
       f.system_size_kwp,
       f.system_type,
       f.contracted_value,
       COALESCE(pcp.total_invoiced, 0),
       COALESCE(pcp.total_received, 0),
       COALESCE(pcp.net_cash_position, 0),
       f.actual_start_date,
       f.actual_end_date
  FROM filtered f
  LEFT JOIN project_cash_positions pcp ON pcp.project_id = f.id
 ORDER BY f.actual_start_date DESC NULLS LAST;
$$ LANGUAGE sql STABLE SECURITY INVOKER;

----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_orphan_counts()
RETURNS TABLE (
  pending_invoice_count   INT,
  pending_invoice_total   NUMERIC(14,2),
  pending_payment_count   INT,
  pending_payment_total   NUMERIC(14,2),
  excluded_count          INT,
  excluded_total          NUMERIC(14,2),
  deferred_count          INT
) AS $$
SELECT
  (SELECT COUNT(*)::INT FROM invoices
    WHERE source = 'zoho_import' AND attribution_status = 'pending'),
  (SELECT COALESCE(SUM(total_amount), 0) FROM invoices
    WHERE source = 'zoho_import' AND attribution_status = 'pending'),
  (SELECT COUNT(*)::INT FROM customer_payments
    WHERE source = 'zoho_import' AND attribution_status = 'pending'),
  (SELECT COALESCE(SUM(amount), 0) FROM customer_payments
    WHERE source = 'zoho_import' AND attribution_status = 'pending'),
  ((SELECT COUNT(*)::INT FROM invoices
     WHERE source = 'zoho_import' AND attribution_status = 'excluded')
   +
   (SELECT COUNT(*)::INT FROM customer_payments
     WHERE source = 'zoho_import' AND attribution_status = 'excluded')),
  ((SELECT COALESCE(SUM(total_amount), 0) FROM invoices
     WHERE source = 'zoho_import' AND attribution_status = 'excluded')
   +
   (SELECT COALESCE(SUM(amount), 0) FROM customer_payments
     WHERE source = 'zoho_import' AND attribution_status = 'excluded')),
  ((SELECT COUNT(*)::INT FROM invoices
     WHERE source = 'zoho_import' AND attribution_status = 'deferred')
   +
   (SELECT COUNT(*)::INT FROM customer_payments
     WHERE source = 'zoho_import' AND attribution_status = 'deferred'));
$$ LANGUAGE sql STABLE SECURITY INVOKER;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 093 applied ===';
END $$;

COMMIT;
