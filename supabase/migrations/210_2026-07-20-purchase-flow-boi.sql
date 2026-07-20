-- =============================================================================
-- Migration 210 — BOI-Manager-style quick purchase flow (columns + RPCs)
-- =============================================================================
-- Spec: docs/superpowers/specs/2026-07-20-purchase-flow-boi-manager-spec.md
-- Plan: docs/superpowers/plans/2026-07-20-purchase-flow-boi-manager.md (Task 1)
--
-- Replicates Manivel's Google-Sheets "Bill of Items Manager" purchase flow on
-- top of the existing project_boq_items / purchase_orders / price_book tables.
--
--  A. purchase_orders: vendor_id nullable + vendor_name/payment_terms/transport/
--     delivery_place columns; extend the EXISTING mig-067 source CHECK
--     ('erp','zoho_import') with 'boi_quick' (the plan's hypothetical 'v2' value
--     never existed — v2 POs are source='erp').
--  B. boi_po_number_seq + next_boi_po_number() → 'PO-0001' format, seeded above
--     any existing '^PO-\d+$' po_number. v2 keeps generate_doc_number('PO')
--     ('SHIROI/PO/<FY>/<n>' — disjoint namespace, no collision).
--  C. create_boi_po(...) — atomic: lock lines, validate, totals in SQL
--     (NEVER-DO #12), insert PO (status='approved', approval_status=
--     'not_required', requires_approval=FALSE — instant PO, no approval flow),
--     freeze line items (total_price INCLUDES GST per mig-151 CHECK), flip
--     lines to order_placed. p_prepared_by is employees.id (NOT profiles.id —
--     see the *_by FK footgun; resolve via getCurrentEmployeeId()).
--  D. delete_boi_po(p_po_id, p_revert) — spec §7 delete w/ optional status revert.
--  E. get_boi_status_totals(...) — status-wise money KPI row (spec §5.2);
--     'ready_to_dispatch' folds into 'received'; pg_trgm GIN expression index
--     backs the search filter (extension enabled in mig 190 — NEVER-DO #23).
--  F. get_purchase_project_rollup() — spec §3; Project Budget =
--     projects.contracted_value (the column financial-box.tsx edits).
--  G. site_supervisor INSERT policy on project_boq_items (intake, spec §11) —
--     yet_to_finalize lines only; get_my_role() helper per mig 008a/146.
--
-- SECURITY: RPCs are SECURITY INVOKER — they respect existing RLS
-- (po_write / project_boq_items_update: founder, project_manager,
-- purchase_officer). NOTE: 'finance' is price-visible but has NO write policy
-- on purchase_orders/project_boq_items, so finance cannot call C/D — flagged
-- to the app layer (Task 2 role gates must match).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Quick-PO metadata columns (sheet parity)
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_orders ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_name    TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms  TEXT,
  ADD COLUMN IF NOT EXISTS transport      TEXT,
  ADD COLUMN IF NOT EXISTS delivery_place TEXT;

COMMENT ON COLUMN purchase_orders.vendor_name IS
  'Free-text vendor name for boi_quick POs (sheet parity). vendor_id is best-effort matched against vendors.company_name and may be NULL.';
COMMENT ON COLUMN purchase_orders.payment_terms IS
  'Free-text payment terms for boi_quick POs (e.g. "Credit", "50% advance"). Distinct from the v2 payment_terms_days INT.';

-- Extend the existing mig-067 source CHECK ('erp','zoho_import') with 'boi_quick'.
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_source_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_source_check
  CHECK (source IN ('erp', 'zoho_import', 'boi_quick'));

CREATE INDEX IF NOT EXISTS idx_po_source_created
  ON purchase_orders(source, created_at DESC);

-- ---------------------------------------------------------------------------
-- B. PO-0001 numbering (seeded above any existing '^PO-\d+$' number)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS boi_po_number_seq;
SELECT setval('boi_po_number_seq',
  COALESCE((SELECT MAX((regexp_match(po_number, '^PO-(\d+)$'))[1]::INT)
            FROM purchase_orders WHERE po_number ~ '^PO-\d+$'), 0) + 1,
  false);
GRANT USAGE, SELECT ON SEQUENCE boi_po_number_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.next_boi_po_number() RETURNS TEXT
LANGUAGE sql
SET search_path = public
AS $$
  SELECT 'PO-' || lpad(nextval('boi_po_number_seq')::TEXT, 4, '0');
$$;

REVOKE ALL ON FUNCTION public.next_boi_po_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_boi_po_number() TO authenticated;

COMMENT ON FUNCTION public.next_boi_po_number() IS
  'Sequence-backed BOI quick-PO number (PO-0001 style). Seeded above the max existing ^PO-\d+$ po_number. Numbers are never reused (deleting a PO leaves a gap — deliberate delta from the sheet).';

-- ---------------------------------------------------------------------------
-- C. Atomic PO creation from selected BOI lines (spec §6.2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_boi_po(
  p_item_ids       UUID[],
  p_project_id     UUID,
  p_vendor_name    TEXT,
  p_delivery_date  DATE,
  p_payment_terms  TEXT,
  p_transport      TEXT,
  p_delivery_place TEXT,
  p_prepared_by    UUID          -- employees.id (NOT profile id — FK footgun)
) RETURNS TABLE(out_po_id UUID, out_po_number TEXT)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_po_id     UUID := gen_random_uuid();
  v_po_number TEXT;
  v_subtotal  NUMERIC(14,2);
  v_gst       NUMERIC(14,2);
  v_vendor_id UUID;
  v_found     INT;
BEGIN
  IF NULLIF(trim(COALESCE(p_vendor_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Vendor name is required';
  END IF;

  PERFORM 1 FROM project_boq_items WHERE id = ANY(p_item_ids) FOR UPDATE;
  SELECT COUNT(*) INTO v_found FROM project_boq_items WHERE id = ANY(p_item_ids);
  IF v_found <> COALESCE(array_length(p_item_ids, 1), 0) OR v_found = 0 THEN
    RAISE EXCEPTION 'Some selected items no longer exist (found %, expected %)',
      v_found, COALESCE(array_length(p_item_ids, 1), 0);
  END IF;

  -- Header totals = sums of the per-line ROUNDed values (keeps the header
  -- byte-consistent with the purchase_order_items rows and the mig-151 CHECK).
  SELECT SUM(ROUND(quantity * unit_price, 2)),
         SUM(ROUND(quantity * unit_price * COALESCE(gst_rate, 0) / 100, 2))
    INTO v_subtotal, v_gst
    FROM project_boq_items WHERE id = ANY(p_item_ids);

  SELECT id INTO v_vendor_id FROM vendors
   WHERE lower(company_name) = lower(trim(p_vendor_name))
     AND deleted_at IS NULL
   ORDER BY created_at
   LIMIT 1;

  v_po_number := next_boi_po_number();

  INSERT INTO purchase_orders (id, project_id, vendor_id, vendor_name, prepared_by,
    po_number, status, requires_approval, approval_status, po_date,
    expected_delivery_date, payment_terms, transport, delivery_place,
    subtotal, gst_amount, total_amount, amount_paid, amount_outstanding, source)
  VALUES (v_po_id, p_project_id, v_vendor_id, trim(p_vendor_name), p_prepared_by,
    v_po_number, 'approved', FALSE, 'not_required', CURRENT_DATE,
    p_delivery_date, p_payment_terms, p_transport, p_delivery_place,
    v_subtotal, v_gst, v_subtotal + v_gst, 0, v_subtotal + v_gst, 'boi_quick');

  -- Freeze line items (spec §6.3). mig-151 CHECK: total_price INCLUDES GST
  -- (quantity_ordered * unit_price + gst_amount, ±0.01).
  INSERT INTO purchase_order_items (purchase_order_id, boq_item_id, price_book_id,
    line_number, item_category, item_description, brand, model, hsn_code, unit,
    quantity_ordered, quantity_pending, unit_price, gst_rate, gst_amount, total_price)
  SELECT v_po_id, b.id, b.price_book_id,
    row_number() OVER (ORDER BY b.created_at, b.id),
    b.item_category, b.item_description, b.brand, b.model, b.hsn_code, b.unit,
    b.quantity, b.quantity, b.unit_price, b.gst_rate,
    ROUND(b.quantity * b.unit_price * COALESCE(b.gst_rate, 0) / 100, 2),
    ROUND(b.quantity * b.unit_price, 2)
      + ROUND(b.quantity * b.unit_price * COALESCE(b.gst_rate, 0) / 100, 2)
  FROM project_boq_items b WHERE b.id = ANY(p_item_ids);

  UPDATE project_boq_items
     SET purchase_order_id = v_po_id,
         procurement_status = 'order_placed',
         vendor_name = COALESCE(NULLIF(trim(p_vendor_name), ''), vendor_name),
         vendor_id  = COALESCE(v_vendor_id, vendor_id),
         updated_at = NOW()
   WHERE id = ANY(p_item_ids);

  RETURN QUERY SELECT v_po_id, v_po_number;
END $$;

REVOKE ALL ON FUNCTION public.create_boi_po(UUID[], UUID, TEXT, DATE, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_boi_po(UUID[], UUID, TEXT, DATE, TEXT, TEXT, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.create_boi_po(UUID[], UUID, TEXT, DATE, TEXT, TEXT, TEXT, UUID) IS
  'Atomic BOI quick-PO: locks the selected project_boq_items, computes totals in SQL, inserts a source=boi_quick purchase_orders row (status approved / approval not_required) + frozen purchase_order_items (total_price includes GST per mig-151), flips lines to order_placed. SECURITY INVOKER — po_write RLS applies (founder/project_manager/purchase_officer). p_prepared_by = employees.id.';

-- ---------------------------------------------------------------------------
-- D. PO delete with optional revert (spec §7)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_boi_po(p_po_id UUID, p_revert BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_revert THEN
    UPDATE project_boq_items
       SET procurement_status = 'yet_to_place', purchase_order_id = NULL, updated_at = NOW()
     WHERE purchase_order_id = p_po_id;
  ELSE
    UPDATE project_boq_items SET purchase_order_id = NULL, updated_at = NOW()
     WHERE purchase_order_id = p_po_id;
  END IF;
  DELETE FROM purchase_order_items WHERE purchase_order_id = p_po_id;
  DELETE FROM purchase_orders WHERE id = p_po_id;
END $$;

REVOKE ALL ON FUNCTION public.delete_boi_po(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_boi_po(UUID, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.delete_boi_po(UUID, BOOLEAN) IS
  'Deletes a BOI quick-PO + its frozen items. p_revert=TRUE also flips the linked project_boq_items back to yet_to_place; FALSE only detaches them (status kept). PO numbers are never reused. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- E. Status-wise money KPI row (spec §5.2 — every filter EXCEPT status applied;
--    ready_to_dispatch folds into received)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_boi_status_totals(
  p_project_id UUID DEFAULT NULL, p_category TEXT DEFAULT NULL,
  p_vendor TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL
) RETURNS TABLE(status TEXT, line_count BIGINT, total_amount NUMERIC)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN b.procurement_status = 'ready_to_dispatch' THEN 'received'
              ELSE b.procurement_status END AS status,
         COUNT(*),
         ROUND(SUM(b.quantity * b.unit_price * (1 + COALESCE(b.gst_rate, 0) / 100)), 2)
    FROM project_boq_items b
   WHERE (p_project_id IS NULL OR b.project_id = p_project_id)
     AND (p_category  IS NULL OR b.item_category = p_category)
     AND (p_vendor    IS NULL OR b.vendor_name = p_vendor)
     AND (p_search    IS NULL OR
          (COALESCE(b.item_description, '') || ' ' || COALESCE(b.brand, '') || ' ' ||
           COALESCE(b.item_category, '') || ' ' || COALESCE(b.vendor_name, ''))
          ILIKE '%' || p_search || '%')
   GROUP BY 1
$$;

REVOKE ALL ON FUNCTION public.get_boi_status_totals(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_boi_status_totals(UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_boi_status_totals(UUID, TEXT, TEXT, TEXT) IS
  'BOI workspace KPI row: per-status line count + GST-inclusive money total over project_boq_items with the non-status filters applied (spec §5.2). ready_to_dispatch is folded into received. SECURITY INVOKER — boq read RLS applies. NEVER-DO #12: money aggregation in SQL.';

-- pg_trgm GIN expression index backing the p_search ILIKE '%term%' filter
-- (extension enabled in mig 190; expression matches the RPC exactly).
CREATE INDEX IF NOT EXISTS idx_boq_items_search_trgm ON project_boq_items
  USING gin ((COALESCE(item_description, '') || ' ' || COALESCE(brand, '') || ' ' ||
              COALESCE(item_category, '') || ' ' || COALESCE(vendor_name, '')) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- F. Project rollup (spec §3 — Project Budget = projects.contracted_value,
--    the "Order Value" column financial-box.tsx edits)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_purchase_project_rollup()
RETURNS TABLE(project_id UUID, project_name TEXT, system_size NUMERIC,
              project_budget NUMERIC, boi_total NUMERIC, expenses_total NUMERIC,
              profit_pct NUMERIC)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH boi AS (
    SELECT b.project_id AS pid,
           ROUND(SUM(b.quantity * b.unit_price * (1 + COALESCE(b.gst_rate, 0) / 100)), 2) AS t
    FROM project_boq_items b GROUP BY 1),
  exp AS (
    -- All statuses included (sheet parity — the sheet has no approval concept).
    SELECT e.project_id AS pid, ROUND(SUM(e.amount), 2) AS t
    FROM expenses e WHERE e.project_id IS NOT NULL GROUP BY 1)
  SELECT p.id,
         COALESCE(NULLIF(p.project_name, ''), p.customer_name),
         p.system_size_kwp,
         p.contracted_value,
         COALESCE(boi.t, 0), COALESCE(exp.t, 0),
         CASE WHEN COALESCE(p.contracted_value, 0) = 0 THEN 0
              ELSE ROUND((p.contracted_value - (COALESCE(boi.t, 0) + COALESCE(exp.t, 0)))
                         / p.contracted_value * 100, 2) END
    FROM projects p
    LEFT JOIN boi ON boi.pid = p.id
    LEFT JOIN exp ON exp.pid = p.id
   WHERE p.deleted_at IS NULL
     AND (boi.pid IS NOT NULL OR exp.pid IS NOT NULL)
$$;

REVOKE ALL ON FUNCTION public.get_purchase_project_rollup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_project_rollup() TO authenticated;

COMMENT ON FUNCTION public.get_purchase_project_rollup() IS
  'Purchase rollup per project (spec §3): budget = contracted_value, BOI total = GST-inclusive sum of project_boq_items, expenses = all expenses rows (sheet parity), profit % = (budget − (BOI + expenses)) / budget. Only non-deleted projects that have BOI lines or expenses. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- G. Site-engineer intake: site_supervisor may INSERT yet_to_finalize lines
--    (spec §11). Policies are OR'd with mig-024 project_boq_items_write
--    (founder/project_manager/purchase_officer). get_my_role() per mig 008a/146.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS boq_items_site_intake ON project_boq_items;
CREATE POLICY boq_items_site_intake ON project_boq_items FOR INSERT
  TO authenticated
  WITH CHECK (procurement_status = 'yet_to_finalize'
              AND get_my_role() = 'site_supervisor'::app_role);

COMMIT;

-- =============================================================================
-- Verification (run after applying)
-- =============================================================================
--   SELECT next_boi_po_number();                       -- 'PO-000N'
--   SELECT * FROM get_boi_status_totals();             -- one row per status
--   SELECT * FROM get_purchase_project_rollup() LIMIT 3;
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'purchase_orders_source_check';   -- erp | zoho_import | boi_quick
--   -- If next_boi_po_number() was consumed only for testing, re-seed:
--   SELECT setval('boi_po_number_seq',
--     COALESCE((SELECT MAX((regexp_match(po_number, '^PO-(\d+)$'))[1]::INT)
--               FROM purchase_orders WHERE po_number ~ '^PO-\d+$'), 0) + 1, false);
-- =============================================================================
