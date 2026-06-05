-- Migration 159: pending_project_imports staging table + approve RPC.
--
-- Why:
--   ~210 historical plants (192 completed-not-in-DB after multi-inverter
--   cluster expansion) need an interactive review screen before landing
--   in `projects`. This staging table holds them all with full
--   enrichment (portal creds, LAN creds, Jio modem creds, data-logger
--   MAC + PK, inverter SNs, AMC schedules) — all password fields
--   encrypted at rest via the same Vault key as plant_monitoring_credentials.
--
--   The /om/import-review UI reads + edits this table. On Approve,
--   approve_pending_import(p_id) cascades:
--     stub lead → stub proposal → projects → inverters (parent + children)
--     → plant_monitoring_credentials → plant_local_setup (mig 160).
--
--   Why stub lead + proposal: projects.proposal_id and projects.lead_id
--   are NOT NULL with FK constraints. Legacy plants have no lead/proposal
--   in the system, so we mint minimal stub rows that satisfy invariants.
--   The proposal goes status='draft' first, then UPDATE to 'accepted'
--   after the project insert (trigger_proposal_accepted_create_project
--   has idempotency that skips if a project already exists for the lead).
--
-- Design spec: docs/superpowers/specs/2026-06-05-historical-plants-import-design.md

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. pending_project_imports table
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE pending_project_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  project_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  source_sheets JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_multi_inverter_parent BOOLEAN NOT NULL DEFAULT false,
  parent_import_id UUID REFERENCES pending_project_imports(id) ON DELETE CASCADE,

  -- Match outcome
  matched_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  matched_customer_name TEXT,
  match_confidence TEXT NOT NULL DEFAULT 'none'
    CHECK (match_confidence IN ('exact','fuzzy','none')),
  match_score NUMERIC(4,3) NOT NULL DEFAULT 0,

  -- Review lifecycle
  status_review TEXT NOT NULL DEFAULT 'pending'
    CHECK (status_review IN ('pending','approved','rejected','imported','error')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  imported_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ,
  import_error TEXT,
  rejection_reason TEXT,
  create_amc_contract BOOLEAN NOT NULL DEFAULT false,

  -- Project facts
  source_status TEXT,
  source_year INT,
  system_size_kwp NUMERIC(8,2),
  system_type TEXT,
  net_meter TEXT,
  rooftop_sqft NUMERIC,
  industry TEXT,
  category TEXT,
  mounting_type TEXT,
  cable_make TEXT,
  la_scope TEXT,
  lifetime_kwh NUMERIC,
  project_cost NUMERIC(14,2),
  actual_cost NUMERIC(14,2),
  profit_inr NUMERIC(14,2),

  -- Hardware
  panel_make TEXT,
  panel_model TEXT,
  panel_wattage NUMERIC,
  panel_qty INT,
  inverter_make TEXT,
  inverter_model TEXT,
  inverter_capacity_kw NUMERIC(8,2),
  inverter_qty INT,
  inverter_serial_number TEXT,
  inverter_power_module_sn TEXT,
  acdb_sn TEXT,
  dcdb_sn TEXT,

  -- Location + contact
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT DEFAULT 'Tamil Nadu',
  pincode TEXT,
  google_maps_url TEXT,
  folder_link TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  commissioning_date DATE,

  -- Online monitoring credentials (encrypted via fn_plant_creds_key)
  portal_brand TEXT,
  portal_url TEXT,
  portal_username TEXT,
  portal_password_encrypted BYTEA,

  -- Local LAN credentials (encrypted)
  local_login_ip TEXT,
  local_admin_user TEXT,
  local_admin_password_encrypted BYTEA,
  local_user TEXT,
  local_user_password_encrypted BYTEA,

  -- Internet (encrypted)
  internet_type TEXT,
  jio_password_encrypted BYTEA,
  jio_primary_sim TEXT,
  jio_backup_sim TEXT,

  -- Data logger
  datalogger_mac TEXT,
  datalogger_pk TEXT,

  -- AMC (optional cascade — gated by create_amc_contract)
  amc_type TEXT,
  amc_visits JSONB DEFAULT '[]'::jsonb,

  -- Audit
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

-- Indexes
CREATE INDEX idx_pending_imports_status ON pending_project_imports (status_review);
CREATE INDEX idx_pending_imports_match ON pending_project_imports (match_confidence) WHERE status_review = 'pending';
CREATE INDEX idx_pending_imports_year ON pending_project_imports (source_year) WHERE status_review = 'pending';
CREATE INDEX idx_pending_imports_brand ON pending_project_imports (portal_brand) WHERE status_review = 'pending';
CREATE INDEX idx_pending_imports_parent ON pending_project_imports (parent_import_id) WHERE parent_import_id IS NOT NULL;
CREATE INDEX idx_pending_imports_source_status ON pending_project_imports (source_status) WHERE status_review = 'pending';
CREATE UNIQUE INDEX idx_pending_imports_normalized_active
  ON pending_project_imports (normalized_name)
  WHERE status_review IN ('pending','approved') AND parent_import_id IS NULL;

COMMENT ON TABLE pending_project_imports IS
  'Staging table for the historical plants import. /om/import-review UI reads + edits this; on Approve, approve_pending_import RPC cascades into projects + inverters + plant_monitoring_credentials + plant_local_setup. All password_encrypted BYTEA columns share the plant_credentials_key Vault secret.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. RLS
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE pending_project_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_imports_select ON pending_project_imports FOR SELECT TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role, 'om_technician'::app_role]));

CREATE POLICY pending_imports_update ON pending_project_imports FOR UPDATE TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role, 'om_technician'::app_role]));

CREATE POLICY pending_imports_service ON pending_project_imports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. updated_at trigger
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_pending_imports_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

CREATE TRIGGER trg_pending_imports_updated_at
  BEFORE UPDATE ON pending_project_imports
  FOR EACH ROW EXECUTE FUNCTION public.fn_pending_imports_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. seed_pending_project_import(p_data JSONB) RPC
--    Used by scripts/seed-pending-imports.ts. Takes plaintext passwords
--    in the JSON blob; encrypts them inside the function before INSERT.
--    Idempotent: UPSERT on (normalized_name) for non-child rows.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.seed_pending_project_import(p_data JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_key TEXT;
  v_existing_id UUID;
BEGIN
  v_key := public.fn_plant_creds_key();

  -- Idempotent UPSERT on normalized_name for non-child rows
  IF (p_data->>'parent_import_id') IS NULL THEN
    SELECT id INTO v_existing_id
    FROM pending_project_imports
    WHERE normalized_name = p_data->>'normalized_name'
      AND parent_import_id IS NULL
      AND status_review IN ('pending', 'approved');
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE pending_project_imports SET
      project_name = COALESCE(p_data->>'project_name', project_name),
      source_sheets = COALESCE((p_data->'source_sheets')::JSONB, source_sheets),
      matched_project_id = COALESCE((p_data->>'matched_project_id')::UUID, matched_project_id),
      matched_customer_name = COALESCE(p_data->>'matched_customer_name', matched_customer_name),
      match_confidence = COALESCE(p_data->>'match_confidence', match_confidence),
      match_score = COALESCE((p_data->>'match_score')::NUMERIC, match_score),
      source_status = COALESCE(p_data->>'source_status', source_status),
      source_year = COALESCE((p_data->>'source_year')::INT, source_year),
      system_size_kwp = COALESCE((p_data->>'system_size_kwp')::NUMERIC, system_size_kwp),
      system_type = COALESCE(p_data->>'system_type', system_type),
      net_meter = COALESCE(p_data->>'net_meter', net_meter),
      rooftop_sqft = COALESCE((p_data->>'rooftop_sqft')::NUMERIC, rooftop_sqft),
      industry = COALESCE(p_data->>'industry', industry),
      category = COALESCE(p_data->>'category', category),
      mounting_type = COALESCE(p_data->>'mounting_type', mounting_type),
      cable_make = COALESCE(p_data->>'cable_make', cable_make),
      la_scope = COALESCE(p_data->>'la_scope', la_scope),
      lifetime_kwh = COALESCE((p_data->>'lifetime_kwh')::NUMERIC, lifetime_kwh),
      project_cost = COALESCE((p_data->>'project_cost')::NUMERIC, project_cost),
      actual_cost = COALESCE((p_data->>'actual_cost')::NUMERIC, actual_cost),
      profit_inr = COALESCE((p_data->>'profit_inr')::NUMERIC, profit_inr),
      panel_make = COALESCE(p_data->>'panel_make', panel_make),
      panel_model = COALESCE(p_data->>'panel_model', panel_model),
      panel_wattage = COALESCE((p_data->>'panel_wattage')::NUMERIC, panel_wattage),
      panel_qty = COALESCE((p_data->>'panel_qty')::INT, panel_qty),
      inverter_make = COALESCE(p_data->>'inverter_make', inverter_make),
      inverter_model = COALESCE(p_data->>'inverter_model', inverter_model),
      inverter_capacity_kw = COALESCE((p_data->>'inverter_capacity_kw')::NUMERIC, inverter_capacity_kw),
      inverter_qty = COALESCE((p_data->>'inverter_qty')::INT, inverter_qty),
      inverter_serial_number = COALESCE(p_data->>'inverter_serial_number', inverter_serial_number),
      inverter_power_module_sn = COALESCE(p_data->>'inverter_power_module_sn', inverter_power_module_sn),
      acdb_sn = COALESCE(p_data->>'acdb_sn', acdb_sn),
      dcdb_sn = COALESCE(p_data->>'dcdb_sn', dcdb_sn),
      address_line1 = COALESCE(p_data->>'address_line1', address_line1),
      address_line2 = COALESCE(p_data->>'address_line2', address_line2),
      city = COALESCE(p_data->>'city', city),
      state = COALESCE(p_data->>'state', state),
      pincode = COALESCE(p_data->>'pincode', pincode),
      google_maps_url = COALESCE(p_data->>'google_maps_url', google_maps_url),
      folder_link = COALESCE(p_data->>'folder_link', folder_link),
      contact_name = COALESCE(p_data->>'contact_name', contact_name),
      contact_phone = COALESCE(p_data->>'contact_phone', contact_phone),
      contact_email = COALESCE(p_data->>'contact_email', contact_email),
      commissioning_date = COALESCE((p_data->>'commissioning_date')::DATE, commissioning_date),
      portal_brand = COALESCE(p_data->>'portal_brand', portal_brand),
      portal_url = COALESCE(p_data->>'portal_url', portal_url),
      portal_username = COALESCE(p_data->>'portal_username', portal_username),
      portal_password_encrypted = COALESCE(
        CASE WHEN p_data->>'portal_password' IS NOT NULL
             THEN extensions.pgp_sym_encrypt(p_data->>'portal_password', v_key)
        END,
        portal_password_encrypted),
      local_login_ip = COALESCE(p_data->>'local_login_ip', local_login_ip),
      local_admin_user = COALESCE(p_data->>'local_admin_user', local_admin_user),
      local_admin_password_encrypted = COALESCE(
        CASE WHEN p_data->>'local_admin_password' IS NOT NULL
             THEN extensions.pgp_sym_encrypt(p_data->>'local_admin_password', v_key)
        END,
        local_admin_password_encrypted),
      local_user = COALESCE(p_data->>'local_user', local_user),
      local_user_password_encrypted = COALESCE(
        CASE WHEN p_data->>'local_user_password' IS NOT NULL
             THEN extensions.pgp_sym_encrypt(p_data->>'local_user_password', v_key)
        END,
        local_user_password_encrypted),
      internet_type = COALESCE(p_data->>'internet_type', internet_type),
      jio_password_encrypted = COALESCE(
        CASE WHEN p_data->>'jio_password' IS NOT NULL
             THEN extensions.pgp_sym_encrypt(p_data->>'jio_password', v_key)
        END,
        jio_password_encrypted),
      jio_primary_sim = COALESCE(p_data->>'jio_primary_sim', jio_primary_sim),
      jio_backup_sim = COALESCE(p_data->>'jio_backup_sim', jio_backup_sim),
      datalogger_mac = COALESCE(p_data->>'datalogger_mac', datalogger_mac),
      datalogger_pk = COALESCE(p_data->>'datalogger_pk', datalogger_pk),
      amc_type = COALESCE(p_data->>'amc_type', amc_type),
      amc_visits = COALESCE((p_data->'amc_visits')::JSONB, amc_visits),
      remarks = COALESCE(p_data->>'remarks', remarks)
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO pending_project_imports (
    project_name, normalized_name, source_sheets, is_multi_inverter_parent, parent_import_id,
    matched_project_id, matched_customer_name, match_confidence, match_score,
    source_status, source_year, system_size_kwp, system_type, net_meter,
    rooftop_sqft, industry, category, mounting_type, cable_make, la_scope, lifetime_kwh,
    project_cost, actual_cost, profit_inr,
    panel_make, panel_model, panel_wattage, panel_qty,
    inverter_make, inverter_model, inverter_capacity_kw, inverter_qty,
    inverter_serial_number, inverter_power_module_sn, acdb_sn, dcdb_sn,
    address_line1, address_line2, city, state, pincode, google_maps_url, folder_link,
    contact_name, contact_phone, contact_email, commissioning_date,
    portal_brand, portal_url, portal_username, portal_password_encrypted,
    local_login_ip, local_admin_user, local_admin_password_encrypted,
    local_user, local_user_password_encrypted,
    internet_type, jio_password_encrypted, jio_primary_sim, jio_backup_sim,
    datalogger_mac, datalogger_pk, amc_type, amc_visits, remarks
  ) VALUES (
    p_data->>'project_name',
    p_data->>'normalized_name',
    COALESCE((p_data->'source_sheets')::JSONB, '[]'::jsonb),
    COALESCE((p_data->>'is_multi_inverter_parent')::BOOLEAN, false),
    NULLIF(p_data->>'parent_import_id', '')::UUID,
    NULLIF(p_data->>'matched_project_id', '')::UUID,
    p_data->>'matched_customer_name',
    COALESCE(p_data->>'match_confidence', 'none'),
    COALESCE((p_data->>'match_score')::NUMERIC, 0),
    p_data->>'source_status',
    NULLIF(p_data->>'source_year', '')::INT,
    NULLIF(p_data->>'system_size_kwp', '')::NUMERIC,
    p_data->>'system_type',
    p_data->>'net_meter',
    NULLIF(p_data->>'rooftop_sqft', '')::NUMERIC,
    p_data->>'industry',
    p_data->>'category',
    p_data->>'mounting_type',
    p_data->>'cable_make',
    p_data->>'la_scope',
    NULLIF(p_data->>'lifetime_kwh', '')::NUMERIC,
    NULLIF(p_data->>'project_cost', '')::NUMERIC,
    NULLIF(p_data->>'actual_cost', '')::NUMERIC,
    NULLIF(p_data->>'profit_inr', '')::NUMERIC,
    p_data->>'panel_make',
    p_data->>'panel_model',
    NULLIF(p_data->>'panel_wattage', '')::NUMERIC,
    NULLIF(p_data->>'panel_qty', '')::INT,
    p_data->>'inverter_make',
    p_data->>'inverter_model',
    NULLIF(p_data->>'inverter_capacity_kw', '')::NUMERIC,
    NULLIF(p_data->>'inverter_qty', '')::INT,
    p_data->>'inverter_serial_number',
    p_data->>'inverter_power_module_sn',
    p_data->>'acdb_sn',
    p_data->>'dcdb_sn',
    p_data->>'address_line1',
    p_data->>'address_line2',
    p_data->>'city',
    COALESCE(p_data->>'state', 'Tamil Nadu'),
    p_data->>'pincode',
    p_data->>'google_maps_url',
    p_data->>'folder_link',
    p_data->>'contact_name',
    p_data->>'contact_phone',
    p_data->>'contact_email',
    NULLIF(p_data->>'commissioning_date', '')::DATE,
    p_data->>'portal_brand',
    p_data->>'portal_url',
    p_data->>'portal_username',
    CASE WHEN p_data->>'portal_password' IS NOT NULL THEN extensions.pgp_sym_encrypt(p_data->>'portal_password', v_key) END,
    p_data->>'local_login_ip',
    p_data->>'local_admin_user',
    CASE WHEN p_data->>'local_admin_password' IS NOT NULL THEN extensions.pgp_sym_encrypt(p_data->>'local_admin_password', v_key) END,
    p_data->>'local_user',
    CASE WHEN p_data->>'local_user_password' IS NOT NULL THEN extensions.pgp_sym_encrypt(p_data->>'local_user_password', v_key) END,
    p_data->>'internet_type',
    CASE WHEN p_data->>'jio_password' IS NOT NULL THEN extensions.pgp_sym_encrypt(p_data->>'jio_password', v_key) END,
    p_data->>'jio_primary_sim',
    p_data->>'jio_backup_sim',
    p_data->>'datalogger_mac',
    p_data->>'datalogger_pk',
    p_data->>'amc_type',
    COALESCE((p_data->'amc_visits')::JSONB, '[]'::jsonb),
    p_data->>'remarks'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.seed_pending_project_import(JSONB) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.seed_pending_project_import(JSONB) TO service_role;

COMMENT ON FUNCTION public.seed_pending_project_import(JSONB) IS
  'Service-role-only RPC for the seed script. Encrypts password fields server-side, upserts on normalized_name for parent rows.';

-- ═══════════════════════════════════════════════════════════════════════
-- 5. RPC to update a single field (inline-edit-on-blur)
--    Encrypts the value if it's one of the password fields.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_pending_import_field(
  p_id UUID,
  p_field TEXT,
  p_value TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_role app_role;
  v_key TEXT;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager', 'om_technician') THEN
    RAISE EXCEPTION 'forbidden: pending_project_imports update denied for role %', v_role USING ERRCODE = '42501';
  END IF;

  -- Password fields: encrypt
  IF p_field IN ('portal_password', 'local_admin_password', 'local_user_password', 'jio_password') THEN
    v_key := public.fn_plant_creds_key();
    EXECUTE format(
      'UPDATE pending_project_imports SET %I = extensions.pgp_sym_encrypt($1, $2), updated_by = auth.uid() WHERE id = $3',
      p_field || '_encrypted'
    ) USING p_value, v_key, p_id;
    RETURN;
  END IF;

  -- Whitelist of editable scalar fields
  IF p_field NOT IN (
    'project_name', 'source_status', 'source_year',
    'system_size_kwp', 'system_type', 'net_meter',
    'rooftop_sqft', 'industry', 'category', 'mounting_type', 'cable_make', 'la_scope',
    'project_cost', 'actual_cost', 'profit_inr',
    'panel_make', 'panel_model', 'panel_wattage', 'panel_qty',
    'inverter_make', 'inverter_model', 'inverter_capacity_kw', 'inverter_qty',
    'inverter_serial_number', 'inverter_power_module_sn', 'acdb_sn', 'dcdb_sn',
    'address_line1', 'address_line2', 'city', 'state', 'pincode', 'google_maps_url', 'folder_link',
    'contact_name', 'contact_phone', 'contact_email', 'commissioning_date',
    'portal_brand', 'portal_url', 'portal_username',
    'local_login_ip', 'local_admin_user', 'local_user',
    'internet_type', 'jio_primary_sim', 'jio_backup_sim',
    'datalogger_mac', 'datalogger_pk', 'amc_type', 'remarks',
    'create_amc_contract', 'rejection_reason'
  ) THEN
    RAISE EXCEPTION 'field % not editable via update_pending_import_field', p_field;
  END IF;

  EXECUTE format(
    'UPDATE pending_project_imports SET %I = $1::TEXT::%s, updated_by = auth.uid() WHERE id = $2',
    p_field,
    CASE p_field
      WHEN 'source_year' THEN 'INT'
      WHEN 'panel_qty' THEN 'INT'
      WHEN 'inverter_qty' THEN 'INT'
      WHEN 'system_size_kwp' THEN 'NUMERIC(8,2)'
      WHEN 'rooftop_sqft' THEN 'NUMERIC'
      WHEN 'panel_wattage' THEN 'NUMERIC'
      WHEN 'inverter_capacity_kw' THEN 'NUMERIC(8,2)'
      WHEN 'project_cost' THEN 'NUMERIC(14,2)'
      WHEN 'actual_cost' THEN 'NUMERIC(14,2)'
      WHEN 'profit_inr' THEN 'NUMERIC(14,2)'
      WHEN 'commissioning_date' THEN 'DATE'
      WHEN 'create_amc_contract' THEN 'BOOLEAN'
      ELSE 'TEXT'
    END
  ) USING NULLIF(p_value, ''), p_id;
END $$;

REVOKE ALL ON FUNCTION public.update_pending_import_field(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pending_import_field(UUID, TEXT, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. approve_pending_import RPC — cascades into projects + inverters + creds
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_pending_import(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row pending_project_imports%ROWTYPE;
  v_child pending_project_imports%ROWTYPE;
  v_project_id UUID;
  v_lead_id UUID;
  v_proposal_id UUID;
  v_seq INT;
  v_proj_num TEXT;
  v_role app_role;
  v_default_pm_id UUID;
  v_brand TEXT;
BEGIN
  -- Founder OR project_manager can approve
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager') THEN
    RAISE EXCEPTION 'forbidden: approve_pending_import requires founder/project_manager, got %', v_role USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM pending_project_imports WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'row % not found', p_id; END IF;
  IF v_row.status_review NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'row % is %, cannot import', p_id, v_row.status_review;
  END IF;
  IF v_row.parent_import_id IS NOT NULL THEN
    RAISE EXCEPTION 'row % is a child-inverter row; approve its parent (%) instead', p_id, v_row.parent_import_id;
  END IF;

  -- If already matched to an existing project, just mark as imported with that id (no new project creation)
  IF v_row.matched_project_id IS NOT NULL AND v_row.match_confidence = 'exact' THEN
    UPDATE pending_project_imports SET
      status_review = 'imported',
      imported_project_id = v_row.matched_project_id,
      imported_at = NOW(),
      reviewed_by = auth.uid(),
      reviewed_at = COALESCE(reviewed_at, NOW())
    WHERE id = p_id;
    RETURN v_row.matched_project_id;
  END IF;

  -- Generate legacy project_number
  SELECT COALESCE(MAX(SUBSTRING(project_number FROM 'LEGACY/(\d+)')::INT), 0) + 1
  INTO v_seq FROM projects WHERE project_number LIKE 'SHIROI/PROJ/LEGACY/%';
  v_proj_num := 'SHIROI/PROJ/LEGACY/' || LPAD(v_seq::TEXT, 4, '0');

  -- Stub lead — minimal viable lead for FK satisfaction
  INSERT INTO leads (
    customer_name, phone, email,
    city, state, pincode,
    source, segment, status,
    is_qualified, converted_to_project
  ) VALUES (
    v_row.project_name,
    COALESCE(NULLIF(v_row.contact_phone, ''), '0000000000'),
    NULLIF(v_row.contact_email, ''),
    COALESCE(NULLIF(v_row.city, ''), 'Chennai'),
    COALESCE(v_row.state, 'Tamil Nadu'),
    v_row.pincode,
    'referral'::lead_source,
    CASE LOWER(COALESCE(v_row.category, ''))
      WHEN 'residential' THEN 'residential'::customer_segment
      WHEN 'commercial' THEN 'commercial'::customer_segment
      WHEN 'industrial' THEN 'industrial'::customer_segment
      ELSE 'residential'::customer_segment
    END,
    'converted'::lead_status,
    true, true
  ) RETURNING id INTO v_lead_id;

  -- Stub proposal (draft) — minimal viable
  INSERT INTO proposals (
    lead_id, proposal_number, prepared_by,
    system_size_kwp, system_type,
    valid_until, status,
    subtotal_supply, subtotal_works,
    gst_supply_amount, gst_works_amount,
    total_before_discount, total_after_discount,
    shiroi_cost, shiroi_revenue
  ) VALUES (
    v_lead_id,
    'SHIROI/QT/LEGACY/' || LPAD(v_seq::TEXT, 4, '0'),
    '27b71db9-1494-4bd6-b6d4-656b436b3f81'::UUID,
    COALESCE(v_row.system_size_kwp, 5),
    CASE LOWER(COALESCE(v_row.system_type, 'on_grid'))
      WHEN 'on_grid' THEN 'on_grid'::system_type
      WHEN 'on-grid' THEN 'on_grid'::system_type
      WHEN 'off_grid' THEN 'off_grid'::system_type
      WHEN 'off-grid' THEN 'off_grid'::system_type
      WHEN 'hybrid' THEN 'hybrid'::system_type
      ELSE 'on_grid'::system_type
    END,
    COALESCE(v_row.commissioning_date, CURRENT_DATE),
    'draft'::proposal_status,
    COALESCE(v_row.project_cost, 0), 0, 0, 0,
    COALESCE(v_row.project_cost, 0), COALESCE(v_row.project_cost, 0),
    COALESCE(v_row.actual_cost, 0), COALESCE(v_row.project_cost, 0)
  ) RETURNING id INTO v_proposal_id;

  -- Resolve default PM
  SELECT e.id INTO v_default_pm_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'project_manager' AND e.is_active = TRUE
  ORDER BY e.created_at DESC LIMIT 1;

  -- Insert project
  INSERT INTO projects (
    proposal_id, lead_id, project_number, project_manager_id,
    customer_name, customer_phone, customer_email,
    site_address_line1, site_address_line2, site_city, site_state, site_pincode,
    location_map_link,
    system_size_kwp, system_type,
    panel_brand, panel_model, panel_wattage, panel_count,
    inverter_brand, inverter_model, inverter_capacity_kw,
    contracted_value, advance_amount,
    commissioned_date, actual_end_date,
    status, completion_pct, notes
  ) VALUES (
    v_proposal_id, v_lead_id, v_proj_num, v_default_pm_id,
    v_row.project_name,
    COALESCE(NULLIF(v_row.contact_phone, ''), '0000000000'),
    NULLIF(v_row.contact_email, ''),
    v_row.address_line1, v_row.address_line2, v_row.city, COALESCE(v_row.state, 'Tamil Nadu'), v_row.pincode,
    v_row.google_maps_url,
    COALESCE(v_row.system_size_kwp, 5),
    CASE LOWER(COALESCE(v_row.system_type, 'on_grid'))
      WHEN 'on_grid' THEN 'on_grid'::system_type
      WHEN 'on-grid' THEN 'on_grid'::system_type
      WHEN 'off_grid' THEN 'off_grid'::system_type
      WHEN 'off-grid' THEN 'off_grid'::system_type
      WHEN 'hybrid' THEN 'hybrid'::system_type
      ELSE 'on_grid'::system_type
    END,
    v_row.panel_make, v_row.panel_model, v_row.panel_wattage, COALESCE(v_row.panel_qty, 0),
    v_row.inverter_make, v_row.inverter_model, v_row.inverter_capacity_kw,
    COALESCE(v_row.project_cost, 0), 0,
    v_row.commissioning_date, v_row.commissioning_date,
    'completed'::project_status, 100,
    NULLIF(CONCAT_WS(E'\n',
      v_row.remarks,
      CASE WHEN v_row.source_year IS NOT NULL THEN 'Legacy backfill — commissioned ' || v_row.source_year END,
      CASE WHEN v_row.source_status IS NOT NULL THEN 'Source status: ' || v_row.source_status END,
      CASE WHEN v_row.actual_cost IS NOT NULL THEN 'Actual cost: ₹' || v_row.actual_cost END,
      CASE WHEN v_row.profit_inr IS NOT NULL THEN 'Profit: ₹' || v_row.profit_inr END,
      CASE WHEN v_row.industry IS NOT NULL THEN 'Industry: ' || v_row.industry END,
      CASE WHEN v_row.mounting_type IS NOT NULL THEN 'Mounting: ' || v_row.mounting_type END,
      CASE WHEN v_row.la_scope IS NOT NULL THEN 'LA scope: ' || v_row.la_scope END,
      CASE WHEN v_row.folder_link IS NOT NULL THEN 'Folder: ' || v_row.folder_link END
    ), '')
  ) RETURNING id INTO v_project_id;

  -- Flip proposal to accepted; trigger fires but skips (idempotency: project exists for lead)
  UPDATE proposals SET status = 'accepted' WHERE id = v_proposal_id;

  -- Inverter for the parent row (only if make is known)
  v_brand := LOWER(COALESCE(v_row.portal_brand, v_row.inverter_make, ''));
  v_brand := CASE
    WHEN v_brand LIKE '%sungrow%' THEN 'sungrow'
    WHEN v_brand LIKE '%growatt%' THEN 'growatt'
    WHEN v_brand LIKE '%deye%' THEN 'deye'
    WHEN v_brand LIKE '%solarman%' THEN 'deye'
    WHEN v_brand LIKE '%goodwe%' THEN 'goodwe'
    WHEN v_brand LIKE '%fimer%' OR v_brand LIKE '%abb%' THEN 'fimer'
    WHEN v_brand LIKE '%polycab%' THEN 'polycab'
    WHEN v_brand LIKE '%havells%' THEN 'havells'
    WHEN v_brand LIKE '%fronius%' THEN 'fronius'
    WHEN v_brand LIKE '%flin%' THEN 'flin_energy'
    WHEN v_brand LIKE '%sma%' THEN 'sma'
    WHEN v_brand LIKE '%huawei%' THEN 'huawei'
    WHEN v_brand LIKE '%solis%' THEN 'solis'
    ELSE 'other'
  END;

  IF v_row.inverter_capacity_kw IS NOT NULL AND v_row.inverter_capacity_kw > 0 THEN
    INSERT INTO inverters (
      project_id, brand, model, rated_capacity_kw, serial_number, commissioned_at, polling_enabled
    ) VALUES (
      v_project_id, v_brand, v_row.inverter_model,
      v_row.inverter_capacity_kw, v_row.inverter_serial_number,
      v_row.commissioning_date, false
    );
  END IF;

  -- Child inverters
  FOR v_child IN SELECT * FROM pending_project_imports WHERE parent_import_id = p_id LOOP
    IF v_child.inverter_capacity_kw IS NULL OR v_child.inverter_capacity_kw <= 0 THEN CONTINUE; END IF;
    INSERT INTO inverters (
      project_id, brand, model, rated_capacity_kw, serial_number, commissioned_at, polling_enabled
    ) VALUES (
      v_project_id, v_brand, v_child.inverter_model,
      v_child.inverter_capacity_kw, v_child.inverter_serial_number,
      v_child.commissioning_date, false
    );
  END LOOP;

  -- Plant monitoring credentials (if portal info present)
  IF v_row.portal_url IS NOT NULL AND v_row.portal_username IS NOT NULL AND v_row.portal_password_encrypted IS NOT NULL THEN
    INSERT INTO plant_monitoring_credentials (
      project_id, portal_url, username, password_encrypted, inverter_brand
    ) VALUES (
      v_project_id, v_row.portal_url, v_row.portal_username,
      v_row.portal_password_encrypted,
      public.plant_monitoring_detect_brand(v_row.portal_url)
    )
    ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL DO NOTHING;
  END IF;

  -- Mark imported (parent + children)
  UPDATE pending_project_imports SET
    status_review = 'imported',
    imported_project_id = v_project_id,
    imported_at = NOW(),
    reviewed_by = auth.uid(),
    reviewed_at = COALESCE(reviewed_at, NOW())
  WHERE id = p_id;

  UPDATE pending_project_imports SET
    status_review = 'imported',
    imported_project_id = v_project_id,
    imported_at = NOW(),
    reviewed_by = auth.uid(),
    reviewed_at = COALESCE(reviewed_at, NOW())
  WHERE parent_import_id = p_id;

  RETURN v_project_id;

EXCEPTION WHEN OTHERS THEN
  UPDATE pending_project_imports SET
    status_review = 'error',
    import_error = SQLERRM,
    reviewed_by = auth.uid(),
    reviewed_at = NOW()
  WHERE id = p_id;
  RAISE;
END $$;

REVOKE ALL ON FUNCTION public.approve_pending_import(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_pending_import(UUID) TO authenticated;

COMMENT ON FUNCTION public.approve_pending_import(UUID) IS
  'Cascades a pending_project_imports row into projects + inverters + plant_monitoring_credentials (+ plant_local_setup after mig 160). Founder/PM only. Creates stub lead + proposal to satisfy FK constraints. On error, marks the row status_review=error with import_error message.';

-- ═══════════════════════════════════════════════════════════════════════
-- 7. reject_pending_import RPC
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reject_pending_import(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role app_role;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager', 'om_technician') THEN
    RAISE EXCEPTION 'forbidden: reject_pending_import denied for role %' USING ERRCODE = '42501';
  END IF;
  UPDATE pending_project_imports SET
    status_review = 'rejected',
    rejection_reason = p_reason,
    reviewed_by = auth.uid(),
    reviewed_at = NOW()
  WHERE id = p_id AND status_review IN ('pending', 'approved');
END $$;

REVOKE ALL ON FUNCTION public.reject_pending_import(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_pending_import(UUID, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. list_pending_imports RPC — drives the review UI table
--    Returns decrypted password fields (gate-checked) for display.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.list_pending_imports(
  p_status_review TEXT DEFAULT 'pending',
  p_match_confidence TEXT DEFAULT NULL,
  p_source_status TEXT DEFAULT NULL,
  p_source_year INT DEFAULT NULL,
  p_portal_brand TEXT DEFAULT NULL,
  p_query TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  id UUID,
  project_name TEXT,
  normalized_name TEXT,
  source_sheets JSONB,
  is_multi_inverter_parent BOOLEAN,
  parent_import_id UUID,
  child_count BIGINT,
  matched_project_id UUID,
  matched_customer_name TEXT,
  match_confidence TEXT,
  match_score NUMERIC,
  status_review TEXT,
  source_status TEXT,
  source_year INT,
  system_size_kwp NUMERIC,
  system_type TEXT,
  net_meter TEXT,
  industry TEXT,
  category TEXT,
  mounting_type TEXT,
  project_cost NUMERIC,
  actual_cost NUMERIC,
  profit_inr NUMERIC,
  panel_make TEXT,
  panel_model TEXT,
  panel_wattage NUMERIC,
  panel_qty INT,
  inverter_make TEXT,
  inverter_model TEXT,
  inverter_capacity_kw NUMERIC,
  inverter_qty INT,
  inverter_serial_number TEXT,
  inverter_power_module_sn TEXT,
  acdb_sn TEXT,
  dcdb_sn TEXT,
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  google_maps_url TEXT,
  folder_link TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  commissioning_date DATE,
  portal_brand TEXT,
  portal_url TEXT,
  portal_username TEXT,
  portal_password TEXT,
  local_login_ip TEXT,
  local_admin_user TEXT,
  local_admin_password TEXT,
  local_user TEXT,
  local_user_password TEXT,
  internet_type TEXT,
  jio_password TEXT,
  jio_primary_sim TEXT,
  jio_backup_sim TEXT,
  datalogger_mac TEXT,
  datalogger_pk TEXT,
  amc_type TEXT,
  amc_visits JSONB,
  remarks TEXT,
  import_error TEXT,
  rejection_reason TEXT,
  create_amc_contract BOOLEAN,
  imported_project_id UUID,
  reviewed_at TIMESTAMPTZ,
  total_count BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_role app_role; v_key TEXT;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager', 'om_technician') THEN
    RAISE EXCEPTION 'forbidden: list_pending_imports access denied for role %' USING ERRCODE = '42501';
  END IF;
  v_key := public.fn_plant_creds_key();

  RETURN QUERY
  WITH filtered AS (
    SELECT p.*
    FROM pending_project_imports p
    WHERE (p_status_review IS NULL OR p.status_review = p_status_review)
      AND (p_match_confidence IS NULL OR p.match_confidence = p_match_confidence)
      AND (p_source_status IS NULL OR p.source_status = p_source_status)
      AND (p_source_year IS NULL OR p.source_year = p_source_year)
      AND (p_portal_brand IS NULL OR p.portal_brand = p_portal_brand)
      AND (p.parent_import_id IS NULL) -- only parent rows in the list
      AND (p_query IS NULL OR length(trim(p_query)) = 0
        OR p.project_name ILIKE '%' || p_query || '%'
        OR p.contact_name ILIKE '%' || p_query || '%'
        OR p.contact_phone ILIKE '%' || p_query || '%'
        OR p.contact_email ILIKE '%' || p_query || '%'
        OR p.portal_username ILIKE '%' || p_query || '%')
  ),
  total AS (SELECT COUNT(*)::BIGINT AS cnt FROM filtered)
  SELECT
    f.id, f.project_name, f.normalized_name, f.source_sheets, f.is_multi_inverter_parent, f.parent_import_id,
    (SELECT COUNT(*) FROM pending_project_imports c WHERE c.parent_import_id = f.id)::BIGINT AS child_count,
    f.matched_project_id, f.matched_customer_name, f.match_confidence, f.match_score, f.status_review,
    f.source_status, f.source_year, f.system_size_kwp, f.system_type, f.net_meter,
    f.industry, f.category, f.mounting_type,
    f.project_cost, f.actual_cost, f.profit_inr,
    f.panel_make, f.panel_model, f.panel_wattage, f.panel_qty,
    f.inverter_make, f.inverter_model, f.inverter_capacity_kw, f.inverter_qty,
    f.inverter_serial_number, f.inverter_power_module_sn, f.acdb_sn, f.dcdb_sn,
    f.address_line1, f.city, f.state, f.pincode, f.google_maps_url, f.folder_link,
    f.contact_name, f.contact_phone, f.contact_email, f.commissioning_date,
    f.portal_brand, f.portal_url, f.portal_username,
    CASE WHEN f.portal_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(f.portal_password_encrypted, v_key)::TEXT END,
    f.local_login_ip, f.local_admin_user,
    CASE WHEN f.local_admin_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(f.local_admin_password_encrypted, v_key)::TEXT END,
    f.local_user,
    CASE WHEN f.local_user_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(f.local_user_password_encrypted, v_key)::TEXT END,
    f.internet_type,
    CASE WHEN f.jio_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(f.jio_password_encrypted, v_key)::TEXT END,
    f.jio_primary_sim, f.jio_backup_sim,
    f.datalogger_mac, f.datalogger_pk, f.amc_type, f.amc_visits,
    f.remarks, f.import_error, f.rejection_reason, f.create_amc_contract,
    f.imported_project_id, f.reviewed_at,
    t.cnt AS total_count
  FROM filtered f CROSS JOIN total t
  ORDER BY
    CASE f.match_confidence WHEN 'exact' THEN 0 WHEN 'fuzzy' THEN 1 ELSE 2 END,
    CASE LOWER(COALESCE(f.source_status, '')) WHEN 'completed' THEN 0 WHEN 'running' THEN 1 ELSE 2 END,
    f.project_name
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
END $$;

REVOKE ALL ON FUNCTION public.list_pending_imports(TEXT,TEXT,TEXT,INT,TEXT,TEXT,INT,INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_imports(TEXT,TEXT,TEXT,INT,TEXT,TEXT,INT,INT) TO authenticated;

COMMENT ON FUNCTION public.list_pending_imports IS
  'Drives the /om/import-review UI table. Returns decrypted password fields (role-gated). Only parent rows (non-child). Ordered by match confidence then by source_status (Completed first).';

-- ═══════════════════════════════════════════════════════════════════════
-- 9. get_pending_import_children RPC — for the multi-inverter expansion
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_pending_import_children(p_parent_id UUID)
RETURNS TABLE (
  id UUID, project_name TEXT, system_size_kwp NUMERIC,
  inverter_capacity_kw NUMERIC, inverter_serial_number TEXT,
  inverter_power_module_sn TEXT, acdb_sn TEXT, dcdb_sn TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role app_role;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager', 'om_technician') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.project_name, c.system_size_kwp,
         c.inverter_capacity_kw, c.inverter_serial_number,
         c.inverter_power_module_sn, c.acdb_sn, c.dcdb_sn
  FROM pending_project_imports c
  WHERE c.parent_import_id = p_parent_id
  ORDER BY c.project_name;
END $$;

REVOKE ALL ON FUNCTION public.get_pending_import_children(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_import_children(UUID) TO authenticated;

COMMIT;
