-- ============================================================
-- Migration 024 — BOQ Items (Project-level) + Delivery Challans
-- File: supabase/migrations/024_boq_items_and_delivery_challans.sql
-- Date: 2026-04-07
--
-- Creates:
--   1. project_boq_items — item-level procurement tracking
--      (seeded from proposal_bom_lines, with procurement status)
--   2. delivery_challans — outgoing DCs created from BOQ items
--   3. delivery_challan_items — line items in each DC
-- ============================================================

BEGIN;

-- ── 1. BOQ Items (project-level copy of BOM with procurement status) ──

CREATE TABLE IF NOT EXISTS project_boq_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bom_line_id       UUID REFERENCES proposal_bom_lines(id), -- link back to source BOM line

  line_number       INTEGER NOT NULL DEFAULT 0,
  item_category     TEXT NOT NULL,
  item_description  TEXT NOT NULL,
  brand             TEXT,
  model             TEXT,

  -- Quantities
  quantity          NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit              TEXT NOT NULL DEFAULT 'nos',
  dispatched_qty    NUMERIC(10,2) NOT NULL DEFAULT 0, -- how much has been dispatched in challans
  received_qty      NUMERIC(10,2) NOT NULL DEFAULT 0, -- received at site

  -- Pricing
  unit_price        NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_rate          NUMERIC(5,2) NOT NULL DEFAULT 18,
  gst_type          TEXT NOT NULL DEFAULT 'supply' CHECK (gst_type IN ('supply', 'works_contract')),
  total_price       NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Procurement status
  procurement_status TEXT NOT NULL DEFAULT 'yet_to_finalize' CHECK (procurement_status IN (
    'yet_to_finalize', 'yet_to_place', 'order_placed', 'received', 'ready_to_dispatch', 'delivered'
  )),

  -- PO link
  purchase_order_id UUID REFERENCES purchase_orders(id),
  vendor_name       TEXT,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_boq_items_project ON project_boq_items(project_id);
CREATE INDEX IF NOT EXISTS idx_project_boq_items_status ON project_boq_items(procurement_status);

ALTER TABLE project_boq_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_boq_items_read"
  ON project_boq_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance', 'project_manager', 'purchase_officer', 'site_supervisor', 'designer')
    )
  );

CREATE POLICY "project_boq_items_write"
  ON project_boq_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'purchase_officer')
    )
  );

CREATE POLICY "project_boq_items_update"
  ON project_boq_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'purchase_officer')
    )
  );

CREATE POLICY "project_boq_items_delete"
  ON project_boq_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager')
    )
  );

CREATE TRIGGER set_project_boq_items_updated_at
  BEFORE UPDATE ON project_boq_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. Delivery Challans ──

CREATE TABLE IF NOT EXISTS delivery_challans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  dc_number         TEXT NOT NULL, -- e.g. SHIROI/DC/2025-26/0001
  dc_date           DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Transport details
  vehicle_number    TEXT,
  driver_name       TEXT,
  driver_phone      TEXT,
  transport_mode    TEXT CHECK (transport_mode IN ('own_vehicle', 'hired', 'courier', 'customer_pickup')),

  -- From / To
  dispatch_from     TEXT, -- warehouse / office
  dispatch_to       TEXT, -- site address

  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'dispatched', 'delivered', 'partial_delivery')),
  dispatched_at     TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,

  -- Sign-off
  dispatched_by     UUID REFERENCES employees(id),
  received_by_name  TEXT, -- name of person at site who received
  receiver_signature TEXT, -- base64 data URL

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_challans_project ON delivery_challans(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_status ON delivery_challans(status);

ALTER TABLE delivery_challans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_challans_read"
  ON delivery_challans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance', 'project_manager', 'purchase_officer', 'site_supervisor')
    )
  );

CREATE POLICY "delivery_challans_write"
  ON delivery_challans FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'purchase_officer')
    )
  );

CREATE POLICY "delivery_challans_update"
  ON delivery_challans FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'purchase_officer', 'site_supervisor')
    )
  );

CREATE TRIGGER set_delivery_challans_updated_at
  BEFORE UPDATE ON delivery_challans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. Delivery Challan Items ──

CREATE TABLE IF NOT EXISTS delivery_challan_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id        UUID NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
  boq_item_id       UUID NOT NULL REFERENCES project_boq_items(id),

  quantity          NUMERIC(10,2) NOT NULL, -- qty in this challan (can be partial)
  item_description  TEXT NOT NULL, -- snapshot for DC printout
  unit              TEXT NOT NULL DEFAULT 'nos',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_challan_items_challan ON delivery_challan_items(challan_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_items_boq ON delivery_challan_items(boq_item_id);

ALTER TABLE delivery_challan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_challan_items_read"
  ON delivery_challan_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance', 'project_manager', 'purchase_officer', 'site_supervisor')
    )
  );

CREATE POLICY "delivery_challan_items_write"
  ON delivery_challan_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'purchase_officer')
    )
  );

COMMIT;
