-- Migration 070: vendor_payments → vendor_bills cascade
-- Recalculate vendor_bills.amount_paid and .status whenever a payment is
-- inserted, updated, or deleted.
-- Note: vendor_payments.amount is the payment amount column (not amount_paid).

BEGIN;

CREATE OR REPLACE FUNCTION recalc_vendor_bill_totals(p_bill_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_paid   NUMERIC(14,2);
  v_total  NUMERIC(14,2);
  v_status vendor_bill_status;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM vendor_payments WHERE vendor_bill_id = p_bill_id;

  SELECT total_amount INTO v_total FROM vendor_bills WHERE id = p_bill_id;
  IF v_total IS NULL THEN RETURN; END IF;  -- bill was deleted

  IF v_paid <= 0 THEN
    v_status := 'pending';
  ELSIF v_paid >= v_total THEN
    v_status := 'paid';
  ELSE
    v_status := 'partially_paid';
  END IF;

  UPDATE vendor_bills
  SET amount_paid = v_paid,
      status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE v_status END,
      updated_at = NOW()
  WHERE id = p_bill_id;
END;
$$;

CREATE OR REPLACE FUNCTION trg_cascade_vendor_payment_to_bill()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.vendor_bill_id IS NOT NULL THEN
      PERFORM recalc_vendor_bill_totals(OLD.vendor_bill_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.vendor_bill_id IS NOT NULL THEN
    PERFORM recalc_vendor_bill_totals(NEW.vendor_bill_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.vendor_bill_id IS DISTINCT FROM NEW.vendor_bill_id
    AND OLD.vendor_bill_id IS NOT NULL THEN
    PERFORM recalc_vendor_bill_totals(OLD.vendor_bill_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vendor_payment_cascade_bill
  AFTER INSERT OR UPDATE OR DELETE ON vendor_payments
  FOR EACH ROW
  EXECUTE FUNCTION trg_cascade_vendor_payment_to_bill();

COMMIT;
