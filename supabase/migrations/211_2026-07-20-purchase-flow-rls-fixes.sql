-- =============================================================================
-- Migration 211 — Purchase-flow (BOI Manager) RLS + RPC review fixes
-- =============================================================================
-- Spec: docs/superpowers/specs/2026-07-20-purchase-flow-boi-manager-spec.md
-- Plan: docs/superpowers/plans/2026-07-20-purchase-flow-boi-manager.md
-- Review-fix batch applied BEFORE the UI tasks (follows mig 210).
--
--  1. projects_read: add purchase_officer to the role array (the BOI workspace,
--     PO log and rollup all embed/read projects; without this every
--     purchase_officer query silently returned zero projects). Recreated
--     byte-identical otherwise (assignment/customer arms untouched).
--  2. get_purchase_project_rollup(): SECURITY INVOKER → SECURITY DEFINER with
--     an in-function role gate (founder/project_manager/purchase_officer/
--     finance). Rationale: the rollup's expenses_total must include ALL
--     employees' expenses (sheet parity), but expenses RLS only shows
--     purchase_officer their own submitted rows — DEFINER lets the SUM span
--     the table without widening raw expenses RLS.
--  3. PostgREST aggregate functions: pgrst.db_aggregates_enabled='true' on the
--     authenticator role. The PO-log KPI uses `total_amount.sum()`
--     (purchase-flow-queries.ts getBoiPos); review confirmed PostgREST returns
--     PGRST123 ("use of aggregate functions is not allowed") without it.
--  4. create_boi_po(): guard against double-linking — if any selected line
--     already has purchase_order_id set, raise with the existing PO number(s)
--     instead of silently re-pointing the line (which orphaned the old PO's
--     linkage and corrupted both POs' item states).
--  5. Data-plane price leak: price_book_read loses site_supervisor (spec §1 —
--     site engineers must never read price data; the intake/search paths now
--     use the admin client server-side with price columns never selected).
--     project_boq_items_read KEEPS site_supervisor — evidence: the
--     /projects/[id]?tab=boq and ?tab=bom surfaces (StepBoq/StepBom →
--     getStepBoqData/getBoiItems in project-stepper-queries.ts) read
--     project_boq_items with the user-context client, site_supervisor reaches
--     them via the Projects nav item (roles.ts SECTIONS_BY_ROLE) for their
--     assigned projects, and the tab router has no per-role gate. Removing the
--     role would blank those tabs. (Flagged: those tabs expose unit_price to
--     site supervisors — pre-existing, needs a product decision, not an RLS
--     one-liner.) The mig-210 boq_items_site_intake INSERT policy stays.
--  6. quickCreateProject support (plan delta — combobox "type a brand-new
--     project" is a user requirement):
--       a. projects.lead_id / projects.proposal_id become NULLABLE. A quick
--          project minted from the purchase flow has no sales origin; the
--          only alternative (stub lead + stub proposal per project) would
--          pollute the sales pipeline and fire lead automations.
--       b. projects_insert: add purchase_officer (was founder/project_manager/
--          sales_engineer only).
--
-- Types impact: 6a changes projects Row/Insert nullability →
-- packages/types/database.ts regenerated in the same commit (NEVER-DO #20).
-- Function signatures are unchanged.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. projects_read + purchase_officer
--    (previous qual verified via pg_get_expr before this migration; only the
--    role array changes)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS projects_read ON projects;
CREATE POLICY projects_read ON projects FOR SELECT
  USING (
    (get_my_role() = ANY (ARRAY[
      'founder'::app_role, 'finance'::app_role, 'hr_manager'::app_role,
      'project_manager'::app_role, 'marketing_manager'::app_role,
      'designer'::app_role, 'purchase_officer'::app_role
    ]))
    OR (project_manager_id = get_my_employee_id())
    OR (site_supervisor_id = get_my_employee_id())
    OR (EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = projects.id
        AND pa.employee_id = get_my_employee_id()
        AND pa.unassigned_at IS NULL
    ))
    OR ((get_my_role() = 'customer'::app_role)
        AND (customer_profile_id = (SELECT auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- 2. get_purchase_project_rollup() → SECURITY DEFINER + in-function role gate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_purchase_project_rollup()
RETURNS TABLE(project_id UUID, project_name TEXT, system_size NUMERIC,
              project_budget NUMERIC, boi_total NUMERIC, expenses_total NUMERIC,
              profit_pct NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gate first: DEFINER bypasses RLS, so the function must do its own check.
  -- (IS NOT TRUE also catches the NULL role of a JWT with no profile row.)
  IF (get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role,
                                 'purchase_officer'::app_role, 'finance'::app_role]))
     IS NOT TRUE THEN
    RAISE EXCEPTION 'get_purchase_project_rollup: not authorized';
  END IF;

  RETURN QUERY
  WITH boi AS (
    SELECT b.project_id AS pid,
           ROUND(SUM(b.quantity * b.unit_price * (1 + COALESCE(b.gst_rate, 0) / 100)), 2) AS t
    FROM project_boq_items b GROUP BY 1),
  exp AS (
    -- All statuses + all submitters (sheet parity) — the reason this function
    -- is SECURITY DEFINER: expenses RLS would hide other employees' rows.
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
     AND (boi.pid IS NOT NULL OR exp.pid IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION public.get_purchase_project_rollup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_project_rollup() TO authenticated;

COMMENT ON FUNCTION public.get_purchase_project_rollup() IS
  'Purchase rollup per project (spec §3): budget = contracted_value, BOI total = GST-inclusive sum of project_boq_items, expenses = ALL expenses rows regardless of submitter/status (sheet parity), profit % = (budget − (BOI + expenses)) / budget. SECURITY DEFINER so the expense sum spans employees without widening raw expenses RLS; in-function gate: founder/project_manager/purchase_officer/finance only.';

-- ---------------------------------------------------------------------------
-- 3. Enable PostgREST aggregate functions (PO-log KPI total_amount.sum())
--    Review confirmed PGRST123 without this. PostgREST reloads its config on
--    the NOTIFY; allow a moment before the first aggregate query succeeds.
-- ---------------------------------------------------------------------------
ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true';

-- ---------------------------------------------------------------------------
-- 4. create_boi_po(): double-link guard (raise with the existing PO number)
--    Full CREATE OR REPLACE — body identical to mig 210 plus the guard.
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
  v_po_id        UUID := gen_random_uuid();
  v_po_number    TEXT;
  v_subtotal     NUMERIC(14,2);
  v_gst          NUMERIC(14,2);
  v_vendor_id    UUID;
  v_found        INT;
  v_existing_pos TEXT;
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

  -- Mig-211 guard: refuse lines already frozen into a PO (double-linking
  -- re-pointed the line and corrupted both POs' item states).
  SELECT string_agg(DISTINCT po.po_number, ', ' ORDER BY po.po_number)
    INTO v_existing_pos
    FROM project_boq_items b
    JOIN purchase_orders po ON po.id = b.purchase_order_id
   WHERE b.id = ANY(p_item_ids);
  IF v_existing_pos IS NOT NULL THEN
    RAISE EXCEPTION 'Some selected items are already on PO % — deselect them or delete that PO first',
      v_existing_pos;
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

COMMENT ON FUNCTION public.create_boi_po(UUID[], UUID, TEXT, DATE, TEXT, TEXT, TEXT, UUID) IS
  'Atomic BOI quick-PO: locks the selected project_boq_items, refuses lines already linked to a PO (mig 211 guard, names the existing PO), computes totals in SQL, inserts a source=boi_quick purchase_orders row (status approved / approval not_required) + frozen purchase_order_items (total_price includes GST per mig-151), flips lines to order_placed. SECURITY INVOKER — po_write RLS applies (founder/project_manager/purchase_officer). p_prepared_by = employees.id.';

-- ---------------------------------------------------------------------------
-- 5. price_book_read: remove site_supervisor (spec §1 — data-plane price
--    stripping). Semantics otherwise identical: NULL role (no profile row)
--    still denies because <> ALL over NULL is NULL.
--    project_boq_items_read is intentionally UNCHANGED — see header note.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS price_book_read ON price_book;
CREATE POLICY price_book_read ON price_book FOR SELECT
  USING (get_my_role() <> ALL (ARRAY['customer'::app_role, 'site_supervisor'::app_role]));

-- ---------------------------------------------------------------------------
-- 6. quickCreateProject support (plan delta — see header)
-- ---------------------------------------------------------------------------
-- 6a. Quick projects have no sales origin.
ALTER TABLE projects ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE projects ALTER COLUMN proposal_id DROP NOT NULL;

COMMENT ON COLUMN projects.lead_id IS
  'NULL for projects minted outside the sales pipeline (BOI quick purchase flow, mig 211). All sales-cascade-created projects still set it.';
COMMENT ON COLUMN projects.proposal_id IS
  'NULL for projects minted outside the sales pipeline (BOI quick purchase flow, mig 211). All sales-cascade-created projects still set it.';

-- 6b. purchase_officer may insert (quickCreateProject action; app layer gates
--     to PURCHASE_WRITE_ROLES = founder/project_manager/purchase_officer).
DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects FOR INSERT
  WITH CHECK (
    (SELECT profiles.role FROM profiles WHERE profiles.id = (SELECT auth.uid()))
    = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role,
                 'sales_engineer'::app_role, 'purchase_officer'::app_role])
  );

COMMIT;

-- NOTIFY must follow the config change; PostgREST picks it up asynchronously.
NOTIFY pgrst, 'reload config';

-- =============================================================================
-- Verification (run after applying)
-- =============================================================================
--   SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname='projects_read';
--     -- contains purchase_officer
--   SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname='price_book_read';
--     -- <> ALL (customer, site_supervisor)
--   SELECT prosecdef FROM pg_proc WHERE proname='get_purchase_project_rollup'; -- true
--   SELECT setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole
--    WHERE r.rolname='authenticator'; -- includes pgrst.db_aggregates_enabled=true
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_name='projects' AND column_name IN ('lead_id','proposal_id'); -- YES
-- =============================================================================
