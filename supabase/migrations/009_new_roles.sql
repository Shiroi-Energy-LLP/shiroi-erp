-- ============================================================
-- Migration 009: Add designer and purchase_officer roles
-- File: supabase/migrations/009_new_roles.sql
-- Date: 2026-04-01
-- Author: Vivek + Claude
--
-- PURPOSE:
-- 1. Add 'designer' and 'purchase_officer' to the app_role enum
-- 2. Update RLS policies on relevant tables to grant appropriate access
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- When running in Supabase SQL Editor, this is fine (it runs outside txn).
-- If using psql or a migration tool, ensure the runner does NOT wrap
-- this file in BEGIN/COMMIT. If it does, split Step 1 into a separate file.
--
-- designer — receives qualified leads, creates system designs + AutoCAD
--   uploads, generates/approves automated proposals.
--   READ: leads (qualified+), proposals (own), lead_documents,
--         lead_site_surveys, price_book, bom_correction_factors
--   WRITE: proposals (own draft), lead_documents (design files)
--
-- purchase_officer — manages full PO lifecycle from BOM to delivery.
--   READ: purchase_orders, purchase_order_items, purchase_order_amendments,
--         vendors, price_book, rfq_requests, rfq_responses,
--         vendor_delivery_challans, vendor_delivery_challan_items,
--         goods_receipt_notes, grn_items, three_way_match,
--         bill_clearing_packages, dc_signatures
--   WRITE: purchase_orders, purchase_order_items, purchase_order_amendments,
--          rfq_requests, rfq_responses, vendor_delivery_challans,
--          vendor_delivery_challan_items, goods_receipt_notes, grn_items,
--          price_book, dc_signatures
-- ============================================================


-- ============================================================
-- STEP 1: Add new enum values
-- ============================================================
-- These statements CANNOT run inside a transaction. Supabase SQL Editor
-- runs each statement outside a transaction by default, so this is safe.
-- If your migration runner wraps in BEGIN/COMMIT, split this step out.

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'designer';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'purchase_officer';


-- ============================================================
-- STEP 2: Update RLS policies for DESIGNER role
-- ============================================================
-- After migration 008a, all policies already use get_my_role() and
-- get_my_employee_id(). We DROP and recreate the affected policies.

-- 2a. leads — designer gets read access (qualified leads and beyond)
-- Current: founder, hr_manager, finance, sales_engineer, project_manager
-- The 007d migration made sales_engineer see all leads. Designer should too
-- (they need to see qualified leads that are assigned to them for design).
DROP POLICY IF EXISTS "leads_read" ON leads;
CREATE POLICY "leads_read"
  ON leads FOR SELECT
  USING (
    get_my_role() IN ('founder', 'hr_manager', 'finance', 'sales_engineer', 'project_manager', 'designer')
  );

-- 2b. lead_documents — designer gets read + insert access
-- Current read: all non-customer roles (uses != 'customer' pattern)
-- The != 'customer' pattern already includes designer since designer is
-- not 'customer'. No change needed for read.
-- Current insert: all non-customer roles. Same — already includes designer.
-- No policy changes needed for lead_documents.

-- 2c. lead_site_surveys — designer gets read access
-- Current read: all non-customer roles (uses != 'customer' pattern).
-- Already includes designer. No change needed.

-- 2d. price_book — designer gets read access
-- Current read: all non-customer roles (uses != 'customer' pattern).
-- Already includes designer. No change needed.

-- 2e. bom_correction_factors — designer gets read access
-- Current read: all non-customer roles (uses != 'customer' pattern).
-- Already includes designer. No change needed.

-- 2f. proposals — designer gets read (own) + insert + update (own draft)
-- Current read: founder, hr_manager, finance, project_manager, sales_engineer, OR prepared_by = self
-- Add designer: can read proposals they prepared
DROP POLICY IF EXISTS "proposals_read" ON proposals;
CREATE POLICY "proposals_read"
  ON proposals FOR SELECT
  USING (
    get_my_role() IN ('founder', 'hr_manager', 'finance', 'project_manager', 'sales_engineer')
    OR prepared_by = get_my_employee_id()
    -- designer can see proposals they prepared (covered by prepared_by check)
  );

-- Current insert: founder, sales_engineer, project_manager
-- Add designer
DROP POLICY IF EXISTS "proposals_insert" ON proposals;
CREATE POLICY "proposals_insert"
  ON proposals FOR INSERT
  WITH CHECK (
    get_my_role() IN ('founder', 'sales_engineer', 'project_manager', 'designer')
  );

-- Current update: founder OR (sales_engineer AND not accepted/rejected)
-- Add designer with same draft restriction
DROP POLICY IF EXISTS "proposals_update" ON proposals;
CREATE POLICY "proposals_update"
  ON proposals FOR UPDATE
  USING (
    get_my_role() = 'founder'
    OR (
      get_my_role() IN ('sales_engineer', 'designer')
      AND prepared_by = get_my_employee_id()
      AND status NOT IN ('accepted', 'rejected')
    )
  );


-- ============================================================
-- STEP 3: Update RLS policies for PURCHASE_OFFICER role
-- ============================================================

-- 3a. purchase_orders — read + write
DROP POLICY IF EXISTS "po_read" ON purchase_orders;
CREATE POLICY "po_read"
  ON purchase_orders FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "po_write" ON purchase_orders;
CREATE POLICY "po_write"
  ON purchase_orders FOR ALL
  USING (
    get_my_role() IN ('founder', 'project_manager', 'purchase_officer')
  );

-- 3b. purchase_order_items — read + write
DROP POLICY IF EXISTS "po_items_read" ON purchase_order_items;
CREATE POLICY "po_items_read"
  ON purchase_order_items FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "po_items_write" ON purchase_order_items;
CREATE POLICY "po_items_write"
  ON purchase_order_items FOR ALL
  USING (
    get_my_role() IN ('founder', 'project_manager', 'purchase_officer')
  );

-- 3c. purchase_order_amendments — read + insert
DROP POLICY IF EXISTS "po_amendments_read" ON purchase_order_amendments;
CREATE POLICY "po_amendments_read"
  ON purchase_order_amendments FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "po_amendments_insert" ON purchase_order_amendments;
CREATE POLICY "po_amendments_insert"
  ON purchase_order_amendments FOR INSERT
  WITH CHECK (
    get_my_role() IN ('founder', 'project_manager', 'purchase_officer')
  );

-- 3d. vendors — read (already != 'customer', so purchase_officer already included)
-- No change needed for read.
-- Write: add purchase_officer (they manage vendor relationships for POs)
DROP POLICY IF EXISTS "vendors_write" ON vendors;
CREATE POLICY "vendors_write"
  ON vendors FOR ALL
  USING (
    get_my_role() IN ('founder', 'finance', 'project_manager', 'purchase_officer')
  );

-- 3e. price_book — write access for purchase_officer (they update pricing)
-- Current write: founder, sales_engineer
DROP POLICY IF EXISTS "price_book_write" ON price_book;
CREATE POLICY "price_book_write"
  ON price_book FOR ALL
  USING (
    get_my_role() IN ('founder', 'sales_engineer', 'purchase_officer')
  );

-- 3f. rfq_requests — read + write
DROP POLICY IF EXISTS "rfq_requests_read" ON rfq_requests;
CREATE POLICY "rfq_requests_read"
  ON rfq_requests FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "rfq_requests_write" ON rfq_requests;
CREATE POLICY "rfq_requests_write"
  ON rfq_requests FOR ALL
  USING (
    get_my_role() IN ('founder', 'project_manager', 'purchase_officer')
  );

-- 3g. rfq_responses — read + insert
DROP POLICY IF EXISTS "rfq_responses_read" ON rfq_responses;
CREATE POLICY "rfq_responses_read"
  ON rfq_responses FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "rfq_responses_insert" ON rfq_responses;
CREATE POLICY "rfq_responses_insert"
  ON rfq_responses FOR INSERT
  WITH CHECK (
    get_my_role() IN ('founder', 'project_manager', 'purchase_officer')
  );

-- 3h. vendor_delivery_challans — read + write
DROP POLICY IF EXISTS "vendor_dc_read" ON vendor_delivery_challans;
CREATE POLICY "vendor_dc_read"
  ON vendor_delivery_challans FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "vendor_dc_write" ON vendor_delivery_challans;
CREATE POLICY "vendor_dc_write"
  ON vendor_delivery_challans FOR ALL
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'purchase_officer')
  );

-- 3i. vendor_delivery_challan_items — read + write
DROP POLICY IF EXISTS "dc_items_read" ON vendor_delivery_challan_items;
CREATE POLICY "dc_items_read"
  ON vendor_delivery_challan_items FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "dc_items_write" ON vendor_delivery_challan_items;
CREATE POLICY "dc_items_write"
  ON vendor_delivery_challan_items FOR ALL
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'purchase_officer')
  );

-- 3j. dc_signatures — read + insert
DROP POLICY IF EXISTS "dc_signatures_read" ON dc_signatures;
CREATE POLICY "dc_signatures_read"
  ON dc_signatures FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "dc_signatures_insert" ON dc_signatures;
CREATE POLICY "dc_signatures_insert"
  ON dc_signatures FOR INSERT
  WITH CHECK (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'purchase_officer')
  );

-- 3k. goods_receipt_notes — read + write
DROP POLICY IF EXISTS "grn_read" ON goods_receipt_notes;
CREATE POLICY "grn_read"
  ON goods_receipt_notes FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "grn_write" ON goods_receipt_notes;
CREATE POLICY "grn_write"
  ON goods_receipt_notes FOR ALL
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'purchase_officer')
  );

-- 3l. grn_items — read + write
DROP POLICY IF EXISTS "grn_items_read" ON grn_items;
CREATE POLICY "grn_items_read"
  ON grn_items FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'finance', 'purchase_officer')
  );

DROP POLICY IF EXISTS "grn_items_write" ON grn_items;
CREATE POLICY "grn_items_write"
  ON grn_items FOR ALL
  USING (
    get_my_role() IN ('founder', 'project_manager', 'site_supervisor', 'purchase_officer')
  );

-- 3m. three_way_match — read access for purchase_officer
DROP POLICY IF EXISTS "three_way_match_read" ON three_way_match;
CREATE POLICY "three_way_match_read"
  ON three_way_match FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'finance', 'purchase_officer')
  );

-- three_way_match write stays as-is (founder, project_manager, finance)
-- purchase_officer reads but does not create/modify three-way matches

-- 3n. bill_clearing_packages — read access for purchase_officer
DROP POLICY IF EXISTS "bcp_read" ON bill_clearing_packages;
CREATE POLICY "bcp_read"
  ON bill_clearing_packages FOR SELECT
  USING (
    get_my_role() IN ('founder', 'project_manager', 'finance', 'purchase_officer')
  );

-- bill_clearing_packages write stays as-is (founder, project_manager)
-- purchase_officer reads but does not create bill clearing packages


-- ============================================================
-- STEP 4: Update profiles_read to include new roles
-- ============================================================
-- profiles_read_own: current allows id = auth.uid() OR founder/hr_manager.
-- New roles don't need special profiles access — they see their own profile
-- via id = auth.uid(). No change needed.


-- ============================================================
-- STEP 5: Update employees_read to include new roles
-- ============================================================
-- employees_read: current allows founder, hr_manager, own record, or
-- direct reports. New roles see their own record via profile_id = auth.uid().
-- No change needed.


-- ============================================================
-- STEP 6: handle_new_user trigger — no changes needed
-- ============================================================
-- The trigger defaults to 'customer' when metadata.role is missing.
-- When creating designer or purchase_officer accounts, the role will be
-- passed in raw_user_meta_data and cast to app_role. The COALESCE handles
-- the fallback. No code change required.


-- ============================================================
-- VERIFICATION QUERIES (run after migration to confirm)
-- ============================================================
-- 1. Check enum values include new roles:
--    SELECT unnest(enum_range(NULL::app_role));
--    Expected: should include 'designer' and 'purchase_officer'
--
-- 2. Check policies were updated (spot check):
--    SELECT polname, pg_get_expr(polqual, polrelid, true) AS using_expr
--    FROM pg_policy p
--    JOIN pg_class c ON c.oid = p.polrelid
--    WHERE c.relname = 'purchase_orders';
--    Expected: po_read and po_write should include 'purchase_officer'
--
-- 3. Check no policies still use old subquery pattern:
--    SELECT count(*) FROM pg_policy p
--    JOIN pg_class c ON c.oid = p.polrelid
--    JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public'
--      AND pg_get_expr(p.polqual, p.polrelid, true) LIKE '%profiles%role%uid%';
--    Expected: 0
