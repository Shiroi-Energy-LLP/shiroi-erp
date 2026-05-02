-- supabase/migrations/100_orphan_triage_functions.sql
-- ============================================================================
-- Migration 100 — atomic orphan-triage SQL helper functions
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- These helpers wrap the multi-row updates the triage UI needs so the cascade
-- (invoice → linked payments) is atomic. SECURITY INVOKER means the caller's
-- RLS still applies — no privilege escalation.
--
-- Each function returns rows in a fixed shape that the JS layer can map to
-- ActionResult<T>. On precondition failure, return a row with success = false
-- and a code so the JS layer can show the right toast.

BEGIN;

CREATE OR REPLACE FUNCTION assign_orphan_invoice(
  p_invoice_id UUID,
  p_project_id UUID,
  p_made_by    UUID,
  p_notes      TEXT
) RETURNS TABLE (
  success                  BOOLEAN,
  code                     TEXT,
  cascaded_payment_count   INT
) AS $$
DECLARE
  v_status     TEXT;
  v_source     TEXT;
  v_cascade_n  INT;
BEGIN
  SELECT attribution_status, source INTO v_status, v_source
    FROM invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'invoice_not_found', 0;
    RETURN;
  END IF;
  IF v_source <> 'zoho_import' THEN
    RETURN QUERY SELECT FALSE, 'not_zoho_import', 0;
    RETURN;
  END IF;
  IF v_status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, 'already_triaged', 0;
    RETURN;
  END IF;

  -- Update invoice
  UPDATE invoices
     SET project_id = p_project_id,
         attribution_status = 'assigned'
   WHERE id = p_invoice_id;

  -- Cascade only payments that are still NULL on project_id (preserve prior
  -- decisions from mig 087's direct-customer-name path).
  WITH cascaded AS (
    UPDATE customer_payments
       SET project_id = p_project_id,
           attribution_status = 'assigned'
     WHERE invoice_id = p_invoice_id
       AND project_id IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cascade_n FROM cascaded;

  -- Audit
  INSERT INTO zoho_attribution_audit
    (entity_type, entity_id, to_project_id, decision, made_by, notes)
    VALUES ('invoice', p_invoice_id, p_project_id, 'assign', p_made_by, p_notes);

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_cascade_n;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exclude_orphan_invoice(
  p_invoice_id UUID,
  p_made_by    UUID,
  p_notes      TEXT
) RETURNS TABLE (
  success                BOOLEAN,
  code                   TEXT,
  cascaded_payment_count INT
) AS $$
DECLARE
  v_status     TEXT;
  v_source     TEXT;
  v_cascade_n  INT;
BEGIN
  SELECT attribution_status, source INTO v_status, v_source
    FROM invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'invoice_not_found', 0;
    RETURN;
  END IF;
  IF v_source <> 'zoho_import' THEN
    RETURN QUERY SELECT FALSE, 'not_zoho_import', 0;
    RETURN;
  END IF;

  -- Allow excluding from any state except already-excluded
  IF v_status = 'excluded' THEN
    RETURN QUERY SELECT FALSE, 'already_excluded', 0;
    RETURN;
  END IF;

  UPDATE invoices
     SET excluded_from_cash = TRUE,
         attribution_status = 'excluded'
   WHERE id = p_invoice_id;

  -- Exclude ALL linked payments (regardless of project_id state) — payments
  -- for an excluded invoice should never count toward cash.
  WITH cascaded AS (
    UPDATE customer_payments
       SET excluded_from_cash = TRUE,
           attribution_status = 'excluded'
     WHERE invoice_id = p_invoice_id
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cascade_n FROM cascaded;

  INSERT INTO zoho_attribution_audit
    (entity_type, entity_id, decision, made_by, notes)
    VALUES ('invoice', p_invoice_id, 'exclude', p_made_by, p_notes);

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_cascade_n;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reassign_orphan_invoice(
  p_invoice_id     UUID,
  p_new_project_id UUID,
  p_made_by        UUID,
  p_notes          TEXT
) RETURNS TABLE (
  success                BOOLEAN,
  code                   TEXT,
  cascaded_payment_count INT
) AS $$
DECLARE
  v_old_project UUID;
  v_status      TEXT;
  v_source      TEXT;
  v_cascade_n   INT;
BEGIN
  SELECT project_id, attribution_status, source
    INTO v_old_project, v_status, v_source
    FROM invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'invoice_not_found', 0;
    RETURN;
  END IF;
  IF v_source <> 'zoho_import' THEN
    RETURN QUERY SELECT FALSE, 'not_zoho_import', 0;
    RETURN;
  END IF;
  IF v_status <> 'assigned' THEN
    RETURN QUERY SELECT FALSE, 'not_assigned_state', 0;
    RETURN;
  END IF;
  IF v_old_project = p_new_project_id THEN
    RETURN QUERY SELECT FALSE, 'same_project', 0;
    RETURN;
  END IF;

  UPDATE invoices
     SET project_id = p_new_project_id
   WHERE id = p_invoice_id;

  -- Move only the payments that were cascaded to the OLD project. Payments
  -- separately attributed elsewhere are left alone.
  WITH cascaded AS (
    UPDATE customer_payments
       SET project_id = p_new_project_id
     WHERE invoice_id = p_invoice_id
       AND project_id = v_old_project
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cascade_n FROM cascaded;

  INSERT INTO zoho_attribution_audit
    (entity_type, entity_id, from_project_id, to_project_id, decision, made_by, notes)
    VALUES ('invoice', p_invoice_id, v_old_project, p_new_project_id, 'reassign', p_made_by, p_notes);

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_cascade_n;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 100 applied ===';
  RAISE NOTICE 'assign_orphan_invoice, exclude_orphan_invoice, reassign_orphan_invoice created.';
END $$;

COMMIT;
