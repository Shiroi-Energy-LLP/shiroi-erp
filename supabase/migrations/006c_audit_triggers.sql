-- ============================================================
-- Migration 006c — Audit Log, Corrections, System Triggers
-- File: supabase/migrations/006c_audit_triggers.sql
-- Description: Universal audit log, site report corrections
--              (already created in 004c — skipped here),
--              invoice credit notes (already in 004d — skipped),
--              document numbering sequences, and all computed
--              table refresh triggers.
-- Date: 2026-03-29
-- Rollback:
--   DROP TRIGGER IF EXISTS trigger_refresh_leave_balance ON leave_ledger;
--   DROP TRIGGER IF EXISTS trigger_lock_daily_reports ON daily_site_reports;
--   DROP TRIGGER IF EXISTS trigger_lock_om_reports ON om_visit_reports;
--   DROP TRIGGER IF EXISTS trigger_refresh_cash_position ON customer_payments;
--   DROP TRIGGER IF EXISTS trigger_refresh_cash_position_po ON purchase_orders;
--   DROP TRIGGER IF EXISTS trigger_update_price_book_accuracy ON purchase_order_items;
--   DROP TRIGGER IF EXISTS trigger_update_proposal_totals ON proposal_bom_lines;
--   DROP TRIGGER IF EXISTS trigger_ceig_block ON net_metering_applications;
--   DROP TRIGGER IF EXISTS trigger_ir_test_ticket ON commissioning_reports;
--   DROP TRIGGER IF EXISTS trigger_ir_test_ticket_om ON om_visit_reports;
--   DROP FUNCTION IF EXISTS refresh_leave_balance();
--   DROP FUNCTION IF EXISTS refresh_project_cash_position(UUID);
--   DROP FUNCTION IF EXISTS update_price_book_accuracy();
--   DROP FUNCTION IF EXISTS update_proposal_totals();
--   DROP FUNCTION IF EXISTS enforce_ceig_block();
--   DROP FUNCTION IF EXISTS create_ir_test_ticket();
--   DROP FUNCTION IF EXISTS create_ir_test_ticket_om();
--   DROP FUNCTION IF EXISTS lock_report_after_48h();
--   DROP TABLE IF EXISTS record_audit_log CASCADE;
-- Dependencies: All prior migrations.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. record_audit_log
-- Universal change log for all Tier 1 edits.
-- Every UPDATE on a Tier 1 table writes a row here
-- in the same transaction as the update.
-- Immutable — Tier 3. Never deleted.
-- ------------------------------------------------------------
CREATE TABLE record_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What changed
  table_name      TEXT NOT NULL,
  record_id       UUID NOT NULL,
  operation       TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),

  -- Who changed it
  changed_by      UUID REFERENCES profiles(id),
  -- NULL for system-initiated changes.
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- What the values were
  previous_values JSONB,
  -- NULL for INSERT operations.
  new_values      JSONB,
  -- NULL for DELETE operations.

  -- Context
  ip_address      TEXT,
  user_agent      TEXT,
  session_id      TEXT

  -- No updated_at. Immutable forever.
);

CREATE INDEX idx_audit_log_table    ON record_audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_changed  ON record_audit_log(changed_by, changed_at DESC)
  WHERE changed_by IS NOT NULL;
CREATE INDEX idx_audit_log_date     ON record_audit_log(changed_at DESC);


-- RLS for audit log
ALTER TABLE record_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_read"
  ON record_audit_log FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR changed_by = auth.uid()
  );

CREATE POLICY "audit_log_insert"
  ON record_audit_log FOR INSERT
  WITH CHECK (TRUE);
  -- Written by triggers and service role. Open insert.


-- ------------------------------------------------------------
-- 2. Document numbering sequences
-- All sequences already created per domain migration.
-- This section creates any remaining sequences and a
-- helper function for formatted document numbers.
-- ------------------------------------------------------------

-- Financial year helper function
-- Returns current financial year string e.g. '2025-26'
CREATE OR REPLACE FUNCTION get_financial_year()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  current_month INT := EXTRACT(MONTH FROM CURRENT_DATE);
  current_year  INT := EXTRACT(YEAR FROM CURRENT_DATE);
  fy_start      INT;
  fy_end        INT;
BEGIN
  -- Indian financial year: April 1 to March 31
  IF current_month >= 4 THEN
    fy_start := current_year;
    fy_end   := current_year + 1;
  ELSE
    fy_start := current_year - 1;
    fy_end   := current_year;
  END IF;
  RETURN fy_start::TEXT || '-' || RIGHT(fy_end::TEXT, 2);
END;
$$;

-- Formatted document number generator
-- Usage: SELECT generate_doc_number('PROP');
-- Returns: 'SHIROI/PROP/2025-26/0042'
CREATE OR REPLACE FUNCTION generate_doc_number(doc_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  seq_val BIGINT;
  fy      TEXT := get_financial_year();
BEGIN
  CASE doc_type
    WHEN 'PROP' THEN
      seq_val := nextval('proposal_number_seq');
    WHEN 'PROJ' THEN
      seq_val := nextval('project_number_seq');
    WHEN 'INV' THEN
      seq_val := nextval('invoice_number_seq');
    WHEN 'CN' THEN
      seq_val := nextval('credit_note_number_seq');
    WHEN 'REC' THEN
      seq_val := nextval('receipt_number_seq');
    WHEN 'PO' THEN
      seq_val := nextval('po_number_seq');
    WHEN 'PI' THEN
      seq_val := nextval('proforma_number_seq');
    ELSE
      RAISE EXCEPTION 'Unknown document type: %', doc_type;
  END CASE;

  RETURN 'SHIROI/' || doc_type || '/' || fy || '/' || LPAD(seq_val::TEXT, 4, '0');
END;
$$;


-- ------------------------------------------------------------
-- 3. Trigger: refresh leave balance
-- Fires after every INSERT on leave_ledger.
-- Updates leave_balances for the affected employee + type.
-- Runs in same transaction — balance always consistent.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_leave_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO leave_balances (employee_id, leave_type, balance_days, last_updated_at)
  VALUES (
    NEW.employee_id,
    NEW.leave_type,
    NEW.balance_after,
    NOW()
  )
  ON CONFLICT (employee_id, leave_type)
  DO UPDATE SET
    balance_days    = NEW.balance_after,
    last_updated_at = NOW();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_refresh_leave_balance
  AFTER INSERT ON leave_ledger
  FOR EACH ROW EXECUTE FUNCTION refresh_leave_balance();


-- ------------------------------------------------------------
-- 4. Trigger: refresh project cash position
-- Fires after INSERT on customer_payments and
-- after UPDATE on purchase_orders (amount_paid field).
-- Recomputes the affected project's cash position only.
-- Full portfolio recomputation takes too long at scale.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_project_cash_position()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id UUID;
  v_total_received      NUMERIC(14,2);
  v_total_invoiced      NUMERIC(14,2);
  v_total_outstanding   NUMERIC(14,2);
  v_total_po_value      NUMERIC(14,2);
  v_total_paid_vendors  NUMERIC(14,2);
  v_total_vendor_out    NUMERIC(14,2);
  v_net_position        NUMERIC(14,2);
BEGIN
  -- Get project_id from whichever table triggered this
  IF TG_TABLE_NAME = 'customer_payments' THEN
    v_project_id := NEW.project_id;
  ELSIF TG_TABLE_NAME = 'purchase_orders' THEN
    v_project_id := NEW.project_id;
  ELSIF TG_TABLE_NAME = 'invoices' THEN
    v_project_id := NEW.project_id;
  END IF;

  -- Compute inflows
  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(total_amount), 0)
  INTO v_total_received, v_total_invoiced
  FROM customer_payments cp
  JOIN invoices inv ON inv.id = cp.invoice_id
  WHERE cp.project_id = v_project_id;

  v_total_outstanding := v_total_invoiced - v_total_received;

  -- Compute outflows
  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(amount_paid), 0)
  INTO v_total_po_value, v_total_paid_vendors
  FROM purchase_orders
  WHERE project_id = v_project_id
    AND status NOT IN ('cancelled');

  v_total_vendor_out := v_total_po_value - v_total_paid_vendors;
  v_net_position     := v_total_received - v_total_paid_vendors;

  -- Upsert into project_cash_positions
  INSERT INTO project_cash_positions (
    project_id,
    total_invoiced, total_received, total_outstanding,
    total_po_value, total_paid_to_vendors, total_vendor_outstanding,
    net_cash_position, is_invested,
    invested_since,
    last_computed_at
  )
  VALUES (
    v_project_id,
    v_total_invoiced, v_total_received, v_total_outstanding,
    v_total_po_value, v_total_paid_vendors, v_total_vendor_out,
    v_net_position,
    v_net_position < 0,
    CASE WHEN v_net_position < 0 THEN CURRENT_DATE ELSE NULL END,
    NOW()
  )
  ON CONFLICT (project_id)
  DO UPDATE SET
    total_invoiced          = EXCLUDED.total_invoiced,
    total_received          = EXCLUDED.total_received,
    total_outstanding       = EXCLUDED.total_outstanding,
    total_po_value          = EXCLUDED.total_po_value,
    total_paid_to_vendors   = EXCLUDED.total_paid_to_vendors,
    total_vendor_outstanding = EXCLUDED.total_vendor_outstanding,
    net_cash_position       = EXCLUDED.net_cash_position,
    is_invested             = EXCLUDED.is_invested,
    invested_since          = CASE
      WHEN EXCLUDED.is_invested = TRUE
        AND project_cash_positions.invested_since IS NULL
      THEN CURRENT_DATE
      WHEN EXCLUDED.is_invested = FALSE
      THEN NULL
      ELSE project_cash_positions.invested_since
    END,
    last_computed_at        = NOW(),
    updated_at              = NOW();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_refresh_cash_position
  AFTER INSERT ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION refresh_project_cash_position();

CREATE TRIGGER trigger_refresh_cash_position_po
  AFTER UPDATE OF amount_paid ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION refresh_project_cash_position();

CREATE TRIGGER trigger_refresh_cash_position_inv
  AFTER INSERT OR UPDATE OF total_amount ON invoices
  FOR EACH ROW EXECUTE FUNCTION refresh_project_cash_position();


-- ------------------------------------------------------------
-- 5. Trigger: update price book accuracy
-- Fires after INSERT on purchase_order_items.
-- Records variance between book price and actual price.
-- When 3+ purchases exceed 5% variance → sets
-- update_recommended = TRUE on price_book.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_price_book_accuracy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_book_price        NUMERIC(14,2);
  v_variance_pct      NUMERIC(5,2);
  v_exceeds           BOOLEAN := FALSE;
  v_exceed_count      INT;
BEGIN
  -- Only process if linked to price_book
  IF NEW.price_book_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT base_price INTO v_book_price
  FROM price_book WHERE id = NEW.price_book_id;

  IF v_book_price IS NULL OR v_book_price = 0 THEN
    RETURN NEW;
  END IF;

  v_variance_pct := ((NEW.unit_price - v_book_price) / v_book_price) * 100;
  v_exceeds      := ABS(v_variance_pct) > 5;

  -- Log the accuracy record
  INSERT INTO price_book_accuracy (
    price_book_id, purchase_order_id, po_item_id,
    book_price, actual_price, variance_pct, exceeds_threshold
  ) VALUES (
    NEW.price_book_id, NEW.purchase_order_id, NEW.id,
    v_book_price, NEW.unit_price, v_variance_pct, v_exceeds
  );

  -- Update price_book with latest actual price
  UPDATE price_book SET
    last_purchase_price  = NEW.unit_price,
    price_variance_pct   = v_variance_pct,
    updated_at           = NOW()
  WHERE id = NEW.price_book_id;

  -- Count threshold exceedances
  IF v_exceeds THEN
    SELECT COUNT(*) INTO v_exceed_count
    FROM price_book_accuracy
    WHERE price_book_id = NEW.price_book_id
      AND exceeds_threshold = TRUE;

    IF v_exceed_count >= 3 THEN
      UPDATE price_book SET
        purchases_above_threshold = v_exceed_count,
        update_recommended        = TRUE,
        updated_at                = NOW()
      WHERE id = NEW.price_book_id;
    ELSE
      UPDATE price_book SET
        purchases_above_threshold = v_exceed_count,
        updated_at                = NOW()
      WHERE id = NEW.price_book_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_price_book_accuracy
  AFTER INSERT ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION update_price_book_accuracy();


-- ------------------------------------------------------------
-- 6. Trigger: update proposal totals
-- Fires after INSERT/UPDATE/DELETE on proposal_bom_lines.
-- Recomputes proposal financial summary fields.
-- Keeps proposals.subtotal_supply etc. always current.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_proposal_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proposal_id       UUID;
  v_subtotal_supply   NUMERIC(14,2) := 0;
  v_subtotal_works    NUMERIC(14,2) := 0;
  v_gst_supply        NUMERIC(14,2) := 0;
  v_gst_works         NUMERIC(14,2) := 0;
  v_shiroi_cost       NUMERIC(14,2) := 0;
  v_shiroi_revenue    NUMERIC(14,2) := 0;
BEGIN
  v_proposal_id := COALESCE(NEW.proposal_id, OLD.proposal_id);

  -- Aggregate from all active BOM lines for this proposal
  SELECT
    COALESCE(SUM(CASE WHEN gst_type = 'supply'
      AND scope_owner = 'shiroi' THEN total_price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN gst_type = 'works_contract'
      AND scope_owner = 'shiroi' THEN total_price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN gst_type = 'supply'
      AND scope_owner = 'shiroi' THEN gst_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN gst_type = 'works_contract'
      AND scope_owner = 'shiroi' THEN gst_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN scope_owner = 'shiroi'
      THEN COALESCE(corrected_cost, total_price) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN scope_owner = 'shiroi'
      THEN total_price ELSE 0 END), 0)
  INTO
    v_subtotal_supply, v_subtotal_works,
    v_gst_supply, v_gst_works,
    v_shiroi_cost, v_shiroi_revenue
  FROM proposal_bom_lines
  WHERE proposal_id = v_proposal_id;

  UPDATE proposals SET
    subtotal_supply       = v_subtotal_supply,
    subtotal_works        = v_subtotal_works,
    gst_supply_amount     = v_gst_supply,
    gst_works_amount      = v_gst_works,
    total_before_discount = v_subtotal_supply + v_subtotal_works
                            + v_gst_supply + v_gst_works,
    total_after_discount  = v_subtotal_supply + v_subtotal_works
                            + v_gst_supply + v_gst_works - discount_amount,
    shiroi_cost           = v_shiroi_cost,
    shiroi_revenue        = v_shiroi_revenue,
    gross_margin_amount   = v_shiroi_revenue - v_shiroi_cost,
    gross_margin_pct      = CASE
      WHEN v_shiroi_revenue > 0
      THEN ROUND(((v_shiroi_revenue - v_shiroi_cost) / v_shiroi_revenue) * 100, 2)
      ELSE 0
    END,
    updated_at            = NOW()
  WHERE id = v_proposal_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trigger_update_proposal_totals
  AFTER INSERT OR UPDATE OR DELETE ON proposal_bom_lines
  FOR EACH ROW EXECUTE FUNCTION update_proposal_totals();


-- ------------------------------------------------------------
-- 7. Trigger: CEIG block enforcement
-- Fires before INSERT/UPDATE on net_metering_applications.
-- Prevents TNEB submission when ceig_required = TRUE
-- and ceig_cleared = FALSE.
-- Hard system block — not just a UI warning.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_ceig_block()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ceig_required = TRUE
    AND NEW.ceig_cleared = FALSE
    AND NEW.discom_status NOT IN ('pending', 'not_started')
    AND OLD.discom_status IN ('pending')
  THEN
    RAISE EXCEPTION
      'CEIG clearance required before TNEB submission for systems >10kW. '
      'Set ceig_cleared = TRUE only after CEIG approval is received.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_ceig_block
  BEFORE UPDATE ON net_metering_applications
  FOR EACH ROW EXECUTE FUNCTION enforce_ceig_block();


-- ------------------------------------------------------------
-- 8. Trigger: IR test auto-ticket (commissioning)
-- Fires after INSERT/UPDATE on commissioning_reports.
-- When insulation_resistance_mohm < 0.5 →
-- auto-creates a critical service ticket.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_ir_test_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_number TEXT;
  v_project_number TEXT;
BEGIN
  -- Only trigger when IR test result is below threshold
  IF NEW.insulation_resistance_mohm IS NOT NULL
    AND NEW.insulation_resistance_mohm < 0.5
    AND (OLD IS NULL OR OLD.insulation_resistance_mohm IS NULL
         OR OLD.insulation_resistance_mohm >= 0.5)
  THEN
    SELECT project_number INTO v_project_number
    FROM projects WHERE id = NEW.project_id;

    v_ticket_number := 'TKT-' || v_project_number || '-IR-' ||
                       TO_CHAR(NOW(), 'YYYYMMDD');

    INSERT INTO om_service_tickets (
      project_id,
      ticket_number,
      issue_type,
      severity,
      title,
      description,
      status,
      sla_hours,
      sla_deadline,
      auto_created_ir_test
    ) VALUES (
      NEW.project_id,
      v_ticket_number,
      'wiring_issue',
      'critical',
      'IR Test Below Minimum — Immediate Inspection Required',
      'Insulation resistance test result of ' ||
        NEW.insulation_resistance_mohm || ' MΩ is below the 0.5 MΩ minimum. '
        'Immediate electrical inspection required before system can operate.',
      'open',
      4,
      -- Critical: 4-hour SLA
      NOW() + INTERVAL '4 hours',
      TRUE
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_ir_test_ticket
  AFTER INSERT OR UPDATE OF insulation_resistance_mohm ON commissioning_reports
  FOR EACH ROW EXECUTE FUNCTION create_ir_test_ticket();


-- ------------------------------------------------------------
-- 9. Trigger: IR test auto-ticket (O&M visits)
-- Same logic applied to O&M visit reports.
-- Annual IR test below 0.5 MΩ → critical ticket.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_ir_test_ticket_om()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_number TEXT;
  v_project_number TEXT;
  v_contract_id UUID;
BEGIN
  IF NEW.ir_test_result_mohm IS NOT NULL
    AND NEW.ir_test_result_mohm < 0.5
    AND (OLD IS NULL OR OLD.ir_test_result_mohm IS NULL
         OR OLD.ir_test_result_mohm >= 0.5)
  THEN
    SELECT project_number INTO v_project_number
    FROM projects WHERE id = NEW.project_id;

    v_ticket_number := 'TKT-' || v_project_number || '-IR-OM-' ||
                       TO_CHAR(NOW(), 'YYYYMMDD');

    INSERT INTO om_service_tickets (
      project_id,
      contract_id,
      visit_report_id,
      ticket_number,
      issue_type,
      severity,
      title,
      description,
      status,
      sla_hours,
      sla_deadline,
      auto_created_ir_test
    ) VALUES (
      NEW.project_id,
      NEW.contract_id,
      NEW.id,
      v_ticket_number,
      'wiring_issue',
      'critical',
      'IR Test Below Minimum During O&M Visit',
      'Insulation resistance test result of ' ||
        NEW.ir_test_result_mohm || ' MΩ is below the 0.5 MΩ minimum. '
        'Immediate electrical inspection required.',
      'open',
      4,
      NOW() + INTERVAL '4 hours',
      TRUE
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_ir_test_ticket_om
  AFTER INSERT OR UPDATE OF ir_test_result_mohm ON om_visit_reports
  FOR EACH ROW EXECUTE FUNCTION create_ir_test_ticket_om();


-- ------------------------------------------------------------
-- 10. Trigger: auto-lock daily site reports after 48h
-- This is called by a nightly cron job in n8n,
-- not a DB trigger (DB triggers can't fire on schedule).
-- The function is defined here for n8n to call via
-- Supabase Edge Function or direct RPC.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_stale_reports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Lock daily site reports older than 48h
  UPDATE daily_site_reports SET
    is_locked  = TRUE,
    locked_at  = NOW(),
    updated_at = NOW()
  WHERE is_locked = FALSE
    AND created_at < NOW() - INTERVAL '48 hours';

  -- Lock O&M visit reports older than 48h
  UPDATE om_visit_reports SET
    is_locked  = TRUE,
    locked_at  = NOW(),
    updated_at = NOW()
  WHERE is_locked = FALSE
    AND created_at < NOW() - INTERVAL '48 hours';

  -- Log the operation
  INSERT INTO system_logs (
    function_name, event_type, status, metadata
  ) VALUES (
    'lock_stale_reports', 'cron_complete', 'success',
    jsonb_build_object('locked_at', NOW())
  );
END;
$$;


-- ------------------------------------------------------------
-- 11. Trigger: nightly company cashflow snapshot
-- Called by n8n nightly cron via RPC.
-- Aggregates all project_cash_positions into one snapshot row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_cashflow_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_count    INT;
  v_invested_count  INT;
  v_total_contracted NUMERIC(14,2);
  v_total_invoiced  NUMERIC(14,2);
  v_total_received  NUMERIC(14,2);
  v_total_outstanding NUMERIC(14,2);
  v_total_paid_vendors NUMERIC(14,2);
  v_total_vendor_out NUMERIC(14,2);
  v_working_capital NUMERIC(14,2);
  v_overdue_count   INT;
  v_overdue_value   NUMERIC(14,2);
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE is_invested = TRUE),
    COALESCE(SUM(total_contracted), 0),
    COALESCE(SUM(total_invoiced), 0),
    COALESCE(SUM(total_received), 0),
    COALESCE(SUM(total_outstanding), 0),
    COALESCE(SUM(total_paid_to_vendors), 0),
    COALESCE(SUM(total_vendor_outstanding), 0),
    COALESCE(SUM(CASE WHEN net_cash_position < 0
      THEN ABS(net_cash_position) ELSE 0 END), 0)
  INTO
    v_active_count, v_invested_count,
    v_total_contracted, v_total_invoiced,
    v_total_received, v_total_outstanding,
    v_total_paid_vendors, v_total_vendor_out,
    v_working_capital
  FROM project_cash_positions
  JOIN projects p ON p.id = project_cash_positions.project_id
  WHERE p.status NOT IN ('completed', 'cancelled');

  SELECT COUNT(*), COALESCE(SUM(amount_outstanding), 0)
  INTO v_overdue_count, v_overdue_value
  FROM invoices
  WHERE status IN ('sent', 'partially_paid')
    AND due_date < CURRENT_DATE;

  INSERT INTO company_cashflow_snapshots (
    snapshot_date,
    active_projects_count,
    invested_projects_count,
    total_contracted_value,
    total_invoiced,
    total_received,
    total_outstanding,
    total_paid_to_vendors,
    total_vendor_outstanding,
    net_working_capital_deployed,
    overdue_invoices_count,
    overdue_invoices_value
  ) VALUES (
    CURRENT_DATE,
    v_active_count, v_invested_count,
    v_total_contracted, v_total_invoiced,
    v_total_received, v_total_outstanding,
    v_total_paid_vendors, v_total_vendor_out,
    v_working_capital,
    v_overdue_count, v_overdue_value
  )
  ON CONFLICT (snapshot_date)
  DO UPDATE SET
    active_projects_count        = EXCLUDED.active_projects_count,
    invested_projects_count      = EXCLUDED.invested_projects_count,
    total_contracted_value       = EXCLUDED.total_contracted_value,
    total_invoiced               = EXCLUDED.total_invoiced,
    total_received               = EXCLUDED.total_received,
    total_outstanding            = EXCLUDED.total_outstanding,
    total_paid_to_vendors        = EXCLUDED.total_paid_to_vendors,
    total_vendor_outstanding     = EXCLUDED.total_vendor_outstanding,
    net_working_capital_deployed = EXCLUDED.net_working_capital_deployed,
    overdue_invoices_count       = EXCLUDED.overdue_invoices_count,
    overdue_invoices_value       = EXCLUDED.overdue_invoices_value;

  INSERT INTO system_logs (
    function_name, event_type, status, metadata
  ) VALUES (
    'generate_cashflow_snapshot', 'cron_complete', 'success',
    jsonb_build_object(
      'snapshot_date', CURRENT_DATE,
      'active_projects', v_active_count,
      'invested_projects', v_invested_count
    )
  );
END;
$$;


-- ------------------------------------------------------------
-- 12. Trigger: update correction factor override rate
-- Fires after INSERT on proposal_correction_log.
-- Updates override_count and override_rate_pct on
-- bom_correction_factors. If rate > 80% → flags for review.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_correction_override_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_factor_id     UUID;
  v_total_uses    INT;
  v_override_count INT;
  v_override_rate NUMERIC(5,2);
BEGIN
  -- Find the correction factor for this category
  SELECT id INTO v_factor_id
  FROM bom_correction_factors
  WHERE item_category = NEW.item_category
    AND is_active = TRUE
  LIMIT 1;

  IF v_factor_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count total uses and overrides for this category
  SELECT COUNT(*) INTO v_total_uses
  FROM proposal_correction_log
  WHERE item_category = NEW.item_category;

  SELECT COUNT(*) INTO v_override_count
  FROM proposal_correction_log
  WHERE item_category = NEW.item_category
    AND override_factor != system_factor;

  v_override_rate := CASE
    WHEN v_total_uses > 0
    THEN ROUND((v_override_count::NUMERIC / v_total_uses) * 100, 2)
    ELSE 0
  END;

  UPDATE bom_correction_factors SET
    override_count      = v_override_count,
    override_rate_pct   = v_override_rate,
    flagged_for_review  = v_override_rate > 80,
    updated_at          = NOW()
  WHERE id = v_factor_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_override_rate
  AFTER INSERT ON proposal_correction_log
  FOR EACH ROW EXECUTE FUNCTION update_correction_override_rate();


-- ------------------------------------------------------------
-- 13. Trigger: update lead status timestamp
-- Fires when leads.status changes.
-- Writes to lead_status_history and updates status_updated_at.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_lead_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status != OLD.status THEN
    INSERT INTO lead_status_history (
      lead_id, changed_by, from_status, to_status
    ) VALUES (
      NEW.id,
      auth.uid()::UUID,
      OLD.status,
      NEW.status
    );

    NEW.status_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_lead_status_change
  BEFORE UPDATE OF status ON leads
  FOR EACH ROW EXECUTE FUNCTION log_lead_status_change();


-- ------------------------------------------------------------
-- 14. Trigger: update proposal status timestamp
-- Fires when proposals.status changes.
-- Writes to proposal_status_history.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_proposal_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status != OLD.status THEN
    INSERT INTO proposal_status_history (
      proposal_id, changed_by, from_status, to_status
    ) VALUES (
      NEW.id,
      auth.uid()::UUID,
      OLD.status,
      NEW.status
    );

    NEW.status_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_proposal_status_change
  BEFORE UPDATE OF status ON proposals
  FOR EACH ROW EXECUTE FUNCTION log_proposal_status_change();


-- ------------------------------------------------------------
-- 15. Trigger: update project status timestamp
-- Fires when projects.status changes.
-- Writes to project_status_history.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_project_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status != OLD.status THEN
    INSERT INTO project_status_history (
      project_id, changed_by, from_status, to_status
    ) VALUES (
      NEW.id,
      auth.uid()::UUID,
      OLD.status,
      NEW.status
    );

    NEW.status_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_project_status_change
  BEFORE UPDATE OF status ON projects
  FOR EACH ROW EXECUTE FUNCTION log_project_status_change();


COMMIT;