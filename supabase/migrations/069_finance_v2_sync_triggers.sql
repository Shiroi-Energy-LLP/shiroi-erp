-- Migration 069: ERP → Zoho sync enqueue triggers
-- See spec §5.3.
--
-- Strategy: one AFTER INSERT OR UPDATE trigger per synced table. Skip enqueue
-- when source='zoho_import' (imported from Zoho, already there) or when the
-- UPDATE only touched the zoho_*_id / updated_at columns (avoid ping-pong
-- from the sync worker stamping the zoho id back).
--
-- Note: contacts and vendors/projects don't have a 'source' column so we only
-- guard on the zoho_*_id-only update scenario for those tables.

BEGIN;

CREATE OR REPLACE FUNCTION enqueue_zoho_sync(
  p_entity_type zoho_sync_entity_type,
  p_entity_id   UUID,
  p_action      zoho_sync_action
) RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO zoho_sync_queue (entity_type, entity_id, action, status)
  VALUES (p_entity_type, p_entity_id, p_action, 'pending')
  ON CONFLICT DO NOTHING;
$$;

-- ============================================================================
-- contacts
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_contact_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('contact', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_contact_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('contact', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_sync_enqueue
  AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION trg_enqueue_contact_sync();

-- ============================================================================
-- vendors
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_vendor_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('vendor', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_vendor_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('vendor', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendors_sync_enqueue
  AFTER INSERT OR UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_vendor_sync();

-- ============================================================================
-- projects
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_project_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('project', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_project_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('project', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_sync_enqueue
  AFTER INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_project_sync();

-- ============================================================================
-- invoices
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_invoice_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN
    RETURN NEW; -- already in Zoho
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('invoice', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_invoice_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('invoice', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_sync_enqueue
  AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_invoice_sync();

-- ============================================================================
-- customer_payments
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_customer_payment_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('customer_payment', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_customer_payment_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('customer_payment', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER customer_payments_sync_enqueue
  AFTER INSERT OR UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_customer_payment_sync();

-- ============================================================================
-- purchase_orders
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_po_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('purchase_order', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_po_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('purchase_order', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_orders_sync_enqueue
  AFTER INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_po_sync();

-- ============================================================================
-- vendor_bills
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_bill_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('vendor_bill', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_bill_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('vendor_bill', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendor_bills_sync_enqueue
  AFTER INSERT OR UPDATE ON vendor_bills
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_bill_sync();

-- ============================================================================
-- vendor_payments
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_vendor_payment_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('vendor_payment', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_vendor_payment_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('vendor_payment', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendor_payments_sync_enqueue
  AFTER INSERT OR UPDATE ON vendor_payments
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_vendor_payment_sync();

-- ============================================================================
-- expenses (project-tagged only — general expenses stay ERP-only)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_expense_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  -- Skip general expenses: no project_id means it's company-wide overhead
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('expense', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_expense_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('expense', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER expenses_sync_enqueue
  AFTER INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_expense_sync();

COMMIT;
