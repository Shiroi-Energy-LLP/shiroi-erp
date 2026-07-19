-- Migration 204: Zoho Books live API sync — inbound pull state + voucher-only outbound push
-- See docs/superpowers/specs/2026-07-16-zoho-live-api-sync-design.md
--
-- Summary:
--  1. zoho_sync_state   — per-entity inbound watermark + page cursor (seeded, 12 entities)
--  2. zoho_sync_runs    — run log for the admin UI (/settings/zoho-sync)
--  3. RLS on both       — SELECT founder/finance; writes via service role only
--  4. zoho_account_codes.erp_expense_category — maps ERP voucher categories → Zoho expense accounts
--  5. claim_zoho_voucher_batch(p_limit) — SKIP LOCKED claim of approved-voucher queue rows
--  6. Restrict outbound sync to vouchers: drop the 8 non-expense enqueue triggers (mig 069)
--     and mark their pending queue rows 'skipped'. Zoho is now the inbound source of truth
--     for finance entries; echoing ERP copies back would duplicate them in Zoho.
--  7. Drop stale mig-072 RPCs (claim_next_sync_batch / ack_sync_batch) — they reference
--     columns/statuses the live zoho_sync_queue never had; zero callers.
--
-- The expenses enqueue trigger (expenses_sync_enqueue, migs 069+105) is KEPT — it is the
-- entry point of the voucher push. Rows wait in the queue until the voucher is approved
-- (the claim RPC joins on expenses.status = 'approved').

BEGIN;

-- ============================================================================
-- Section 1: zoho_sync_state — inbound watermark per Zoho module
-- ============================================================================

CREATE TABLE zoho_sync_state (
  entity            TEXT PRIMARY KEY,
  watermark         TIMESTAMPTZ,           -- max last_modified_time seen; NULL = never synced (full scan)
  page_cursor       INT NOT NULL DEFAULT 1, -- resume page for in-progress full scans
  last_run_at       TIMESTAMPTZ,
  last_run_status   TEXT CHECK (last_run_status IN ('ok','error','partial')),
  last_error        TEXT,
  total_rows_synced BIGINT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE zoho_sync_state IS
  'Per-Zoho-module incremental pull state for the zoho-sync Edge Function. '
  'watermark = max last_modified_time upserted; page_cursor resumes bounded full scans.';

INSERT INTO zoho_sync_state (entity) VALUES
  ('chartofaccounts'),
  ('taxes'),
  ('items'),
  ('contacts'),
  ('vendors'),
  ('purchaseorders'),
  ('invoices'),
  ('customerpayments'),
  ('bills'),
  ('vendorpayments'),
  ('expenses'),
  ('creditnotes');

-- ============================================================================
-- Section 2: zoho_sync_runs — run log
-- ============================================================================

CREATE TABLE zoho_sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode          TEXT NOT NULL CHECK (mode IN ('pull','push')),
  entity        TEXT,                       -- NULL for push runs (always vouchers)
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  status        TEXT CHECK (status IN ('ok','error','partial')),
  rows_fetched  INT NOT NULL DEFAULT 0,
  rows_upserted INT NOT NULL DEFAULT 0,
  error         TEXT
);

CREATE INDEX idx_zoho_sync_runs_started_at ON zoho_sync_runs (started_at DESC);

-- ============================================================================
-- Section 3: RLS — founder/finance read; writes only via service role
-- ============================================================================

ALTER TABLE zoho_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_sync_runs  ENABLE ROW LEVEL SECURITY;

CREATE POLICY zoho_sync_state_select ON zoho_sync_state
  FOR SELECT USING (current_app_role() IN ('founder','finance'));

CREATE POLICY zoho_sync_runs_select ON zoho_sync_runs
  FOR SELECT USING (current_app_role() IN ('founder','finance'));

-- No INSERT/UPDATE/DELETE policies: only the service role (Edge Function) writes.

-- ============================================================================
-- Section 4: voucher category → Zoho expense account mapping
-- ============================================================================

ALTER TABLE zoho_account_codes
  ADD COLUMN erp_expense_category TEXT;

COMMENT ON COLUMN zoho_account_codes.erp_expense_category IS
  'expense_categories.code this Zoho account books vouchers for. NULL = not a voucher target; '
  'unmapped categories fall back to the ZOHO_DEFAULT_EXPENSE_ACCOUNT_ID Edge secret.';

CREATE INDEX idx_zoho_account_codes_erp_expense_category
  ON zoho_account_codes (erp_expense_category)
  WHERE erp_expense_category IS NOT NULL;

-- ============================================================================
-- Section 5: claim_zoho_voucher_batch — atomic SKIP LOCKED claim
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_zoho_voucher_batch(p_limit INT DEFAULT 25)
RETURNS TABLE (
  queue_id        UUID,
  expense_id      UUID,
  action          TEXT,
  retry_count     INT,
  voucher_number  TEXT,
  amount          NUMERIC,
  expense_date    DATE,
  description     TEXT,
  category_code   TEXT,
  zoho_expense_id TEXT,
  zoho_project_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE zoho_sync_queue q
    SET claimed_at      = NOW(),
        status          = 'syncing',
        attempt_count   = q.attempt_count + 1,
        last_attempt_at = NOW()
    WHERE q.id IN (
      SELECT q2.id
      FROM zoho_sync_queue q2
      JOIN expenses e ON e.id = q2.entity_id
      WHERE q2.entity_type = 'expense'
        AND q2.status      = 'pending'
        AND q2.claimed_at IS NULL
        AND q2.retry_count < 5
        AND e.status       = 'approved'
      ORDER BY q2.created_at
      LIMIT p_limit
      FOR UPDATE OF q2 SKIP LOCKED
    )
    RETURNING q.id, q.entity_id, q.action, q.retry_count
  )
  SELECT
    c.id            AS queue_id,
    c.entity_id     AS expense_id,
    c.action::TEXT  AS action,
    c.retry_count,
    e.voucher_number,
    e.amount,
    e.expense_date,
    e.description,
    ec.code         AS category_code,
    e.zoho_expense_id,
    zpm.zoho_project_id
  FROM claimed c
  JOIN expenses e             ON e.id = c.entity_id
  JOIN expense_categories ec  ON ec.id = e.category_id
  LEFT JOIN zoho_project_mapping zpm ON zpm.erp_project_id = e.project_id;
END;
$$;

COMMENT ON FUNCTION claim_zoho_voucher_batch(INT) IS
  'Atomically claims pending zoho_sync_queue voucher rows whose expense is approved. '
  'Called by the zoho-sync Edge Function (service role) in push mode. '
  'Replaces the stale mig-072 claim_next_sync_batch.';

-- Service-role only: revoke from app roles (queue RLS already restricts the table,
-- but the function is SECURITY DEFINER so it must not be callable by clients).
REVOKE EXECUTE ON FUNCTION claim_zoho_voucher_batch(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_zoho_voucher_batch(INT) FROM anon, authenticated;

-- ============================================================================
-- Section 6: outbound sync is vouchers-only — drop the 8 non-expense triggers
-- ============================================================================

DROP TRIGGER IF EXISTS contacts_sync_enqueue          ON contacts;
DROP TRIGGER IF EXISTS vendors_sync_enqueue           ON vendors;
DROP TRIGGER IF EXISTS projects_sync_enqueue          ON projects;
DROP TRIGGER IF EXISTS invoices_sync_enqueue          ON invoices;
DROP TRIGGER IF EXISTS customer_payments_sync_enqueue ON customer_payments;
DROP TRIGGER IF EXISTS purchase_orders_sync_enqueue   ON purchase_orders;
DROP TRIGGER IF EXISTS vendor_bills_sync_enqueue      ON vendor_bills;
DROP TRIGGER IF EXISTS vendor_payments_sync_enqueue   ON vendor_payments;

DROP FUNCTION IF EXISTS trg_enqueue_contact_sync();
DROP FUNCTION IF EXISTS trg_enqueue_vendor_sync();
DROP FUNCTION IF EXISTS trg_enqueue_project_sync();
DROP FUNCTION IF EXISTS trg_enqueue_invoice_sync();
DROP FUNCTION IF EXISTS trg_enqueue_customer_payment_sync();
DROP FUNCTION IF EXISTS trg_enqueue_po_sync();
DROP FUNCTION IF EXISTS trg_enqueue_bill_sync();
DROP FUNCTION IF EXISTS trg_enqueue_vendor_payment_sync();

-- Park the queue rows those triggers produced (nothing ever drained them).
UPDATE zoho_sync_queue
SET status = 'skipped'
WHERE entity_type <> 'expense'
  AND status = 'pending';

-- ============================================================================
-- Section 7: drop the stale mig-072 RPC pair (broken against live schema)
-- ============================================================================

DROP FUNCTION IF EXISTS claim_next_sync_batch(TEXT, INTEGER);
DROP FUNCTION IF EXISTS ack_sync_batch(JSONB);

COMMIT;
