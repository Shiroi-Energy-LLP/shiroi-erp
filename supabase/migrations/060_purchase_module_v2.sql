-- =========================================================================
-- Migration 060 — Purchase Module V2
-- Date: 2026-04-17
--
-- Replaces the current single-vendor BOQ → PO flow with a 5-stage competitive
-- pipeline: BOQ → RFQ → Quote Comparison → PO (founder-approved) → Dispatch.
--
-- Adds:
--   • 6 new tables (rfqs, rfq_items, rfq_invitations, rfq_quotes, rfq_awards,
--     procurement_audit_log)
--   • purchase_orders: 8 new columns (rfq_id, requires_approval, approval_status,
--     approval_rejection_reason, dispatched_at, acknowledged_at,
--     vendor_tracking_number, vendor_dispatch_date)
--   • purchase_order_items: 1 new column (rfq_quote_id)
--   • 17 new indexes
--   • rfq-excel-uploads storage bucket + RLS policies
--   • generate_rfq_number() helper with FY-scoped sequence
--   • fn_boq_auto_update_on_grn_complete trigger (cascades GRN acceptance to
--     PO status, BOQ procurement_status, project procurement_status, and
--     notifies the project manager when all materials are received)
--
-- Schema assumptions verified against live dev (Apr 17):
--   • goods_receipt_notes.overall_status CHECK: accepted|partially_accepted|rejected
--   • goods_receipt_notes.vendor_dc_id → vendor_delivery_challans.id
--   • vendor_delivery_challans.purchase_order_id → purchase_orders.id
--   • vendor_delivery_challan_items.po_item_id → purchase_order_items.id
--   • notifications(recipient_employee_id, title, body, notification_type,
--                   entity_type, entity_id) — recipient FK → employees.id
--   • projects.project_manager_id FK → employees.id (matches notifications FK)
--   • project_boq_items.procurement_status CHECK includes 'received'
--   • projects.procurement_status CHECK includes 'received'
--   • purchase_orders.status CHECK includes approved|sent|acknowledged|
--                                           partially_delivered|fully_delivered
--
-- NEVER-DO rule #17 compliance: every new filterable/joined column has an index.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. RFQ number generator (FY-scoped sequence)
-- -------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS rfq_number_seq_current_fy START 1;

CREATE OR REPLACE FUNCTION generate_rfq_number()
RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  fy_start_year INTEGER;
  fy_end_year INTEGER;
  fy_label TEXT;
  current_month INTEGER;
  seq_val BIGINT;
BEGIN
  current_month := EXTRACT(MONTH FROM NOW() AT TIME ZONE 'Asia/Kolkata');
  IF current_month >= 4 THEN
    fy_start_year := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata');
  ELSE
    fy_start_year := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Asia/Kolkata') - 1;
  END IF;
  fy_end_year := fy_start_year + 1;
  fy_label := fy_start_year::TEXT || '-' || SUBSTRING(fy_end_year::TEXT FROM 3 FOR 2);
  seq_val := nextval('rfq_number_seq_current_fy');
  RETURN 'RFQ-' || fy_label || '-' || LPAD(seq_val::TEXT, 4, '0');
END;
$$;

-- -------------------------------------------------------------------------
-- 2. rfqs — Request For Quote parent record
-- -------------------------------------------------------------------------
CREATE TABLE rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number TEXT NOT NULL UNIQUE DEFAULT generate_rfq_number(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'comparing', 'awarded', 'cancelled')),
  deadline TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rfqs_project_created ON rfqs(project_id, created_at DESC);
CREATE INDEX idx_rfqs_status ON rfqs(status);
CREATE INDEX idx_rfqs_created_by ON rfqs(created_by);

-- -------------------------------------------------------------------------
-- 3. rfq_items — snapshot of BOQ items at RFQ-creation time
-- (freezes qty/description/unit/category/price_book_rate so later BOQ edits
--  don't retroactively change vendor quotes)
-- -------------------------------------------------------------------------
CREATE TABLE rfq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES project_boq_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  item_description TEXT NOT NULL,
  unit TEXT NOT NULL,
  item_category TEXT NOT NULL,
  price_book_rate NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_id, boq_item_id)
);
CREATE INDEX idx_rfq_items_rfq ON rfq_items(rfq_id);
CREATE INDEX idx_rfq_items_boq ON rfq_items(boq_item_id);

-- -------------------------------------------------------------------------
-- 4. rfq_invitations — one row per vendor invited to quote
-- -------------------------------------------------------------------------
CREATE TABLE rfq_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  access_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'viewed', 'submitted', 'declined', 'expired')),
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  submission_mode TEXT
    CHECK (submission_mode IN ('vendor_portal', 'manual_entry', 'excel_upload')),
  submitted_by_user_id UUID REFERENCES profiles(id),
  excel_file_path TEXT,
  sent_via_channels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_id, vendor_id)
);
CREATE INDEX idx_rfq_invitations_rfq ON rfq_invitations(rfq_id);
CREATE INDEX idx_rfq_invitations_vendor ON rfq_invitations(vendor_id);
CREATE INDEX idx_rfq_invitations_status_expiry ON rfq_invitations(status, expires_at)
  WHERE status IN ('pending', 'sent', 'viewed');

-- -------------------------------------------------------------------------
-- 5. rfq_quotes — vendor's per-item price response
-- total_price is computed by the app at insert time (NUMERIC, not STORED GENERATED,
-- because a STORED generated column cannot reference another row/column for qty).
-- -------------------------------------------------------------------------
CREATE TABLE rfq_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_invitation_id UUID NOT NULL REFERENCES rfq_invitations(id) ON DELETE CASCADE,
  rfq_item_id UUID NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.0 CHECK (gst_rate >= 0 AND gst_rate <= 28),
  total_price NUMERIC(14,2) NOT NULL,
  payment_terms TEXT NOT NULL
    CHECK (payment_terms IN ('advance', '30_days', '60_days', 'against_delivery')),
  delivery_period_days INTEGER NOT NULL CHECK (delivery_period_days >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rfq_invitation_id, rfq_item_id)
);
CREATE INDEX idx_rfq_quotes_invitation ON rfq_quotes(rfq_invitation_id);
CREATE INDEX idx_rfq_quotes_item ON rfq_quotes(rfq_item_id);

-- -------------------------------------------------------------------------
-- 6. rfq_awards — which vendor won which line item
-- CHECK: was_auto_selected = TRUE OR override_reason IS NOT NULL
-- -------------------------------------------------------------------------
CREATE TABLE rfq_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  rfq_item_id UUID NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  winning_invitation_id UUID NOT NULL REFERENCES rfq_invitations(id) ON DELETE RESTRICT,
  was_auto_selected BOOLEAN NOT NULL DEFAULT TRUE,
  override_reason TEXT,
  awarded_by UUID NOT NULL REFERENCES profiles(id),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  UNIQUE (rfq_item_id),
  CHECK (was_auto_selected = TRUE OR override_reason IS NOT NULL)
);
CREATE INDEX idx_rfq_awards_rfq ON rfq_awards(rfq_id);
CREATE INDEX idx_rfq_awards_invitation ON rfq_awards(winning_invitation_id);
CREATE INDEX idx_rfq_awards_po ON rfq_awards(purchase_order_id);

-- -------------------------------------------------------------------------
-- 7. procurement_audit_log — append-only audit trail
-- -------------------------------------------------------------------------
CREATE TABLE procurement_audit_log (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('rfq', 'rfq_invitation', 'rfq_quote', 'rfq_award',
                           'purchase_order', 'boq_item')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES profiles(id),
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_entity ON procurement_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor ON procurement_audit_log(actor_id, created_at DESC);

-- -------------------------------------------------------------------------
-- 8. purchase_orders — add approval gate + dispatch tracking columns
-- -------------------------------------------------------------------------
ALTER TABLE purchase_orders
  ADD COLUMN rfq_id UUID REFERENCES rfqs(id),
  ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (approval_status IN ('pending_approval', 'approved', 'rejected', 'not_required')),
  ADD COLUMN approval_rejection_reason TEXT,
  ADD COLUMN dispatched_at TIMESTAMPTZ,
  ADD COLUMN acknowledged_at TIMESTAMPTZ,
  ADD COLUMN vendor_tracking_number TEXT,
  ADD COLUMN vendor_dispatch_date DATE;

CREATE INDEX idx_po_approval_status ON purchase_orders(approval_status);
CREATE INDEX idx_po_rfq ON purchase_orders(rfq_id);

-- Backfill: existing POs predate the approval gate — mark as not_required.
UPDATE purchase_orders
SET requires_approval = FALSE,
    approval_status = 'not_required'
WHERE created_at < NOW();

-- -------------------------------------------------------------------------
-- 9. purchase_order_items — back-reference to winning quote
-- -------------------------------------------------------------------------
ALTER TABLE purchase_order_items
  ADD COLUMN rfq_quote_id UUID REFERENCES rfq_quotes(id);
CREATE INDEX idx_poi_rfq_quote ON purchase_order_items(rfq_quote_id);

-- -------------------------------------------------------------------------
-- 10. Storage bucket for vendor Excel quote uploads
-- -------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rfq-excel-uploads',
  'rfq-excel-uploads',
  FALSE,
  10485760,  -- 10 MB
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies (mirror project-files pattern from migration 054 —
-- use get_my_role() helper which is STABLE + SECURITY DEFINER → caches per stmt)
CREATE POLICY rfq_excel_read ON storage.objects FOR SELECT
  USING (
    bucket_id = 'rfq-excel-uploads'
    AND get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role])
  );
CREATE POLICY rfq_excel_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'rfq-excel-uploads'
    AND get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role])
  );
CREATE POLICY rfq_excel_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'rfq-excel-uploads'
    AND get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role])
  );
CREATE POLICY rfq_excel_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'rfq-excel-uploads'
    AND get_my_role() = 'founder'::app_role
  );

-- -------------------------------------------------------------------------
-- 11. Enable RLS on all new tables
-- -------------------------------------------------------------------------
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_audit_log ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- 12. RLS policies
--
-- RFQ lifecycle tables (rfqs, rfq_items, rfq_invitations, rfq_quotes, rfq_awards):
--   • founder + purchase_officer: full CRUD
--   • project_manager + site_supervisor: SELECT (read-only visibility into
--     what's been ordered for their projects)
--   • DELETE: founder only
--
-- Note: the public vendor portal (/vendor-portal/rfq/[token]) uses
-- createAdminClient() which bypasses RLS. That route performs its own token
-- validation (access_token + expires_at > NOW()) as defense-in-depth.
-- -------------------------------------------------------------------------

-- rfqs
CREATE POLICY rfqs_select ON rfqs FOR SELECT
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role, 'purchase_officer'::app_role,
    'project_manager'::app_role, 'site_supervisor'::app_role
  ]));
CREATE POLICY rfqs_insert ON rfqs FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfqs_update ON rfqs FOR UPDATE
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfqs_delete ON rfqs FOR DELETE
  USING (get_my_role() = 'founder'::app_role);

-- rfq_items
CREATE POLICY rfq_items_select ON rfq_items FOR SELECT
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role, 'purchase_officer'::app_role,
    'project_manager'::app_role, 'site_supervisor'::app_role
  ]));
CREATE POLICY rfq_items_insert ON rfq_items FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfq_items_update ON rfq_items FOR UPDATE
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfq_items_delete ON rfq_items FOR DELETE
  USING (get_my_role() = 'founder'::app_role);

-- rfq_invitations
CREATE POLICY rfq_invitations_select ON rfq_invitations FOR SELECT
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role, 'purchase_officer'::app_role,
    'project_manager'::app_role, 'site_supervisor'::app_role
  ]));
CREATE POLICY rfq_invitations_insert ON rfq_invitations FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfq_invitations_update ON rfq_invitations FOR UPDATE
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfq_invitations_delete ON rfq_invitations FOR DELETE
  USING (get_my_role() = 'founder'::app_role);

-- rfq_quotes
CREATE POLICY rfq_quotes_select ON rfq_quotes FOR SELECT
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role, 'purchase_officer'::app_role,
    'project_manager'::app_role, 'site_supervisor'::app_role
  ]));
CREATE POLICY rfq_quotes_insert ON rfq_quotes FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfq_quotes_update ON rfq_quotes FOR UPDATE
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfq_quotes_delete ON rfq_quotes FOR DELETE
  USING (get_my_role() = 'founder'::app_role);

-- rfq_awards
CREATE POLICY rfq_awards_select ON rfq_awards FOR SELECT
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role, 'purchase_officer'::app_role,
    'project_manager'::app_role, 'site_supervisor'::app_role
  ]));
CREATE POLICY rfq_awards_insert ON rfq_awards FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfq_awards_update ON rfq_awards FOR UPDATE
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'purchase_officer'::app_role]));
CREATE POLICY rfq_awards_delete ON rfq_awards FOR DELETE
  USING (get_my_role() = 'founder'::app_role);

-- procurement_audit_log: founder-only read, any authenticated user can insert
-- (the logProcurementAudit helper sets actor_id; RLS can't enforce who the
-- actor is vs auth.uid() at insert time without per-row checking, which is
-- expensive — the app is the trust boundary here, with the table acting as
-- an append-only record).
CREATE POLICY audit_select ON procurement_audit_log FOR SELECT
  USING (get_my_role() = 'founder'::app_role);
CREATE POLICY audit_insert ON procurement_audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- -------------------------------------------------------------------------
-- 13. Trigger: cascade GRN acceptance → PO status, BOQ status, project status
--
-- Fires on INSERT or UPDATE of goods_receipt_notes. When a GRN transitions to
-- overall_status ∈ ('accepted', 'partially_accepted'):
--
--   (a) Update purchase_order_items.quantity_delivered by summing
--       vendor_delivery_challan_items.quantity_delivered across all DCs for
--       the same PO item (only counting DCs linked to accepted GRNs).
--   (b) Flip purchase_orders.status to 'fully_delivered' if every PO item has
--       delivered >= ordered, else 'partially_delivered' (unless already in a
--       terminal state).
--   (c) Flip project_boq_items.procurement_status to 'received' for items in
--       this PO (linked via rfq_awards → rfq_items → boq_item_id).
--   (d) If all project BOQ items are received, mark projects.procurement_status
--       = 'received' and notify the project manager.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_boq_auto_update_on_grn_complete()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_po_id UUID;
  v_project_id UUID;
  v_all_delivered BOOLEAN;
  v_all_boq_received BOOLEAN;
  v_pm_employee_id UUID;
BEGIN
  -- Idempotency: only fire on transitions into accepted/partially_accepted
  IF NEW.overall_status NOT IN ('accepted', 'partially_accepted') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.overall_status IS NOT DISTINCT FROM NEW.overall_status THEN
    RETURN NEW;
  END IF;

  -- Find PO via the DC chain (goods_receipt_notes.vendor_dc_id →
  -- vendor_delivery_challans.purchase_order_id)
  SELECT vdc.purchase_order_id INTO v_po_id
  FROM vendor_delivery_challans vdc
  WHERE vdc.id = NEW.vendor_dc_id;

  IF v_po_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- (a) Refresh purchase_order_items.quantity_delivered from accepted DCs.
  -- A PO item's delivered_qty = sum of DC-line quantities where the parent
  -- GRN was accepted/partially_accepted.
  UPDATE purchase_order_items poi
  SET quantity_delivered = COALESCE(delivered.total, 0),
      quantity_pending = GREATEST(poi.quantity_ordered - COALESCE(delivered.total, 0), 0),
      updated_at = NOW()
  FROM (
    SELECT
      vdci.po_item_id,
      SUM(vdci.quantity_delivered) AS total
    FROM vendor_delivery_challan_items vdci
    JOIN vendor_delivery_challans vdc ON vdc.id = vdci.vendor_dc_id
    JOIN goods_receipt_notes grn ON grn.vendor_dc_id = vdc.id
    WHERE vdc.purchase_order_id = v_po_id
      AND vdci.po_item_id IS NOT NULL
      AND grn.overall_status IN ('accepted', 'partially_accepted')
    GROUP BY vdci.po_item_id
  ) delivered
  WHERE poi.id = delivered.po_item_id
    AND poi.purchase_order_id = v_po_id;

  -- (b) Compute PO-level delivery completeness
  SELECT COALESCE(bool_and(poi.quantity_delivered >= poi.quantity_ordered), FALSE)
  INTO v_all_delivered
  FROM purchase_order_items poi
  WHERE poi.purchase_order_id = v_po_id;

  IF v_all_delivered THEN
    UPDATE purchase_orders
    SET status = 'fully_delivered',
        actual_delivery_date = COALESCE(actual_delivery_date, CURRENT_DATE),
        updated_at = NOW()
    WHERE id = v_po_id
      AND status NOT IN ('cancelled', 'closed');
  ELSE
    UPDATE purchase_orders
    SET status = 'partially_delivered',
        updated_at = NOW()
    WHERE id = v_po_id
      AND status NOT IN ('fully_delivered', 'cancelled', 'closed');
  END IF;

  -- (c) Flip BOQ items to 'received' for this PO.
  -- Two paths: (1) RFQ-sourced POs via rfq_awards → rfq_items → boq_item_id,
  -- (2) Quick POs via purchase_order_items.boq_item_id direct link.
  UPDATE project_boq_items pbi
  SET procurement_status = 'received',
      procurement_received_date = CURRENT_DATE,
      updated_at = NOW()
  FROM rfq_awards ra
  JOIN rfq_items ri ON ri.id = ra.rfq_item_id
  WHERE ra.purchase_order_id = v_po_id
    AND pbi.id = ri.boq_item_id
    AND pbi.procurement_status NOT IN ('received', 'delivered');

  UPDATE project_boq_items pbi
  SET procurement_status = 'received',
      procurement_received_date = CURRENT_DATE,
      updated_at = NOW()
  FROM purchase_order_items poi
  WHERE poi.purchase_order_id = v_po_id
    AND poi.boq_item_id = pbi.id
    AND pbi.procurement_status NOT IN ('received', 'delivered');

  -- (d) Project-level: if every BOQ item is received, notify PM.
  SELECT po.project_id INTO v_project_id
  FROM purchase_orders po
  WHERE po.id = v_po_id;

  IF v_project_id IS NOT NULL THEN
    SELECT bool_and(procurement_status IN ('received', 'delivered'))
    INTO v_all_boq_received
    FROM project_boq_items
    WHERE project_id = v_project_id;

    IF v_all_boq_received IS TRUE THEN
      UPDATE projects
      SET procurement_status = 'received',
          procurement_received_date = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = v_project_id
        AND (procurement_status IS NULL OR procurement_status <> 'received');

      -- projects.project_manager_id FK → employees.id matches
      -- notifications.recipient_employee_id FK → employees.id, so direct.
      SELECT project_manager_id INTO v_pm_employee_id
      FROM projects
      WHERE id = v_project_id;

      IF v_pm_employee_id IS NOT NULL THEN
        INSERT INTO notifications (
          recipient_employee_id, title, body,
          notification_type, entity_type, entity_id
        )
        VALUES (
          v_pm_employee_id,
          'All materials received',
          'Project materials fully received — ready to dispatch to site.',
          'procurement', 'project', v_project_id
        );
      END IF;
    ELSIF v_all_boq_received IS FALSE THEN
      -- Partial receipt: set project to partially_received if not already terminal
      UPDATE projects
      SET procurement_status = 'partially_received',
          updated_at = NOW()
      WHERE id = v_project_id
        AND (procurement_status IS NULL OR procurement_status NOT IN ('received', 'partially_received'));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_boq_auto_update_on_grn_complete ON goods_receipt_notes;
CREATE TRIGGER trg_boq_auto_update_on_grn_complete
  AFTER INSERT OR UPDATE ON goods_receipt_notes
  FOR EACH ROW
  EXECUTE FUNCTION fn_boq_auto_update_on_grn_complete();

-- -------------------------------------------------------------------------
-- 14. updated_at maintenance triggers for new tables
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_purchase_v2_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rfqs_updated_at
  BEFORE UPDATE ON rfqs
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_v2_set_updated_at();

CREATE TRIGGER trg_rfq_invitations_updated_at
  BEFORE UPDATE ON rfq_invitations
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_v2_set_updated_at();

COMMIT;
