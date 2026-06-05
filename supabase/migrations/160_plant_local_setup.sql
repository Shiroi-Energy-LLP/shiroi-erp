-- Migration 160: plant_local_setup table.
--
-- Why:
--   The SE_PASSWORD sheet in Vivek's master workbook surfaces operational
--   info that has no home in the existing schema: local LAN admin/user
--   credentials (192.168.117.1), Jio modem password + primary/backup SIM,
--   data-logger MAC + PK (Fimer hardware), ACDB/DCDB serials. None of
--   this fits in plant_monitoring_credentials (which is for portal
--   logins) or in inverters (which is per-inverter telemetry). It's
--   per-PLANT operational state used by O&M when troubleshooting a
--   site that's down.
--
--   One row per project. Encrypted password fields share the
--   plant_credentials_key Vault secret created in mig 158.
--
-- Design spec: docs/superpowers/specs/2026-06-05-historical-plants-import-design.md

BEGIN;

CREATE TABLE plant_local_setup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,

  -- Local network access (192.168.x.x for the inverter web UI)
  local_login_ip TEXT,
  local_admin_user TEXT,
  local_admin_password_encrypted BYTEA,
  local_user TEXT,
  local_user_password_encrypted BYTEA,

  -- Internet connectivity at site
  internet_type TEXT, -- 'Jio Modem' / 'Wifi' / 'LAN' / 'Router'
  jio_password_encrypted BYTEA,
  jio_primary_sim TEXT,
  jio_backup_sim TEXT,

  -- Data logger hardware (Fimer + similar)
  datalogger_mac TEXT,
  datalogger_pk TEXT,

  -- Equipment SNs (one rep SN per category; per-inverter SNs live in inverters)
  acdb_sn TEXT,
  dcdb_sn TEXT,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_plant_local_setup_project ON plant_local_setup (project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_plant_local_setup_datalogger_mac ON plant_local_setup (datalogger_mac) WHERE deleted_at IS NULL AND datalogger_mac IS NOT NULL;

COMMENT ON TABLE plant_local_setup IS
  'Per-plant operational info: local LAN creds, Jio modem creds, data logger MAC/PK, ACDB/DCDB SNs. One row per project. Password fields encrypted via plant_credentials_key Vault secret (shared with plant_monitoring_credentials).';

ALTER TABLE plant_local_setup ENABLE ROW LEVEL SECURITY;

CREATE POLICY plant_local_setup_select ON plant_local_setup FOR SELECT TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role, 'om_technician'::app_role]));

CREATE POLICY plant_local_setup_modify ON plant_local_setup FOR ALL TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role]));

CREATE POLICY plant_local_setup_service ON plant_local_setup FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_plant_local_setup_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

CREATE TRIGGER trg_plant_local_setup_updated_at
  BEFORE UPDATE ON plant_local_setup
  FOR EACH ROW EXECUTE FUNCTION public.fn_plant_local_setup_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- RPC: get_plant_local_setup — returns decrypted creds for O&M display
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_plant_local_setup(p_project_id UUID)
RETURNS TABLE (
  id UUID, project_id UUID,
  local_login_ip TEXT, local_admin_user TEXT, local_admin_password TEXT,
  local_user TEXT, local_user_password TEXT,
  internet_type TEXT, jio_password TEXT, jio_primary_sim TEXT, jio_backup_sim TEXT,
  datalogger_mac TEXT, datalogger_pk TEXT,
  acdb_sn TEXT, dcdb_sn TEXT, notes TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_role app_role; v_key TEXT;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager', 'om_technician') THEN
    RAISE EXCEPTION 'forbidden: get_plant_local_setup denied' USING ERRCODE = '42501';
  END IF;
  v_key := public.fn_plant_creds_key();
  RETURN QUERY
  SELECT s.id, s.project_id, s.local_login_ip, s.local_admin_user,
    CASE WHEN s.local_admin_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(s.local_admin_password_encrypted, v_key)::TEXT END,
    s.local_user,
    CASE WHEN s.local_user_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(s.local_user_password_encrypted, v_key)::TEXT END,
    s.internet_type,
    CASE WHEN s.jio_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(s.jio_password_encrypted, v_key)::TEXT END,
    s.jio_primary_sim, s.jio_backup_sim,
    s.datalogger_mac, s.datalogger_pk, s.acdb_sn, s.dcdb_sn, s.notes
  FROM plant_local_setup s
  WHERE s.project_id = p_project_id AND s.deleted_at IS NULL
  LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.get_plant_local_setup(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plant_local_setup(UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Update approve_pending_import to cascade into plant_local_setup too
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_pending_import(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row pending_project_imports%ROWTYPE;
  v_child pending_project_imports%ROWTYPE;
  v_project_id UUID; v_lead_id UUID; v_proposal_id UUID;
  v_seq INT; v_proj_num TEXT;
  v_role app_role; v_default_pm_id UUID; v_brand TEXT;
BEGIN
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
  IF v_row.matched_project_id IS NOT NULL AND v_row.match_confidence = 'exact' THEN
    UPDATE pending_project_imports SET status_review = 'imported', imported_project_id = v_row.matched_project_id,
      imported_at = NOW(), reviewed_by = auth.uid(), reviewed_at = COALESCE(reviewed_at, NOW())
    WHERE id = p_id;
    RETURN v_row.matched_project_id;
  END IF;
  SELECT COALESCE(MAX(SUBSTRING(project_number FROM 'LEGACY/(\d+)')::INT), 0) + 1
  INTO v_seq FROM projects WHERE project_number LIKE 'SHIROI/PROJ/LEGACY/%';
  v_proj_num := 'SHIROI/PROJ/LEGACY/' || LPAD(v_seq::TEXT, 4, '0');

  INSERT INTO leads (customer_name, phone, email, city, state, pincode, source, segment, status, is_qualified, converted_to_project)
  VALUES (
    v_row.project_name,
    COALESCE(NULLIF(v_row.contact_phone, ''), '0000000000'),
    NULLIF(v_row.contact_email, ''),
    COALESCE(NULLIF(v_row.city, ''), 'Chennai'),
    COALESCE(v_row.state, 'Tamil Nadu'),
    v_row.pincode,
    'referral'::lead_source,
    CASE LOWER(COALESCE(v_row.category, '')) WHEN 'residential' THEN 'residential'::customer_segment WHEN 'commercial' THEN 'commercial'::customer_segment WHEN 'industrial' THEN 'industrial'::customer_segment ELSE 'residential'::customer_segment END,
    'converted'::lead_status, true, true
  ) RETURNING id INTO v_lead_id;

  INSERT INTO proposals (lead_id, proposal_number, prepared_by, system_size_kwp, system_type, valid_until, status, subtotal_supply, subtotal_works, gst_supply_amount, gst_works_amount, total_before_discount, total_after_discount, shiroi_cost, shiroi_revenue)
  VALUES (
    v_lead_id, 'SHIROI/QT/LEGACY/' || LPAD(v_seq::TEXT, 4, '0'),
    '27b71db9-1494-4bd6-b6d4-656b436b3f81'::UUID,
    COALESCE(v_row.system_size_kwp, 5),
    CASE LOWER(COALESCE(v_row.system_type, 'on_grid')) WHEN 'on_grid' THEN 'on_grid'::system_type WHEN 'on-grid' THEN 'on_grid'::system_type WHEN 'off_grid' THEN 'off_grid'::system_type WHEN 'off-grid' THEN 'off_grid'::system_type WHEN 'hybrid' THEN 'hybrid'::system_type ELSE 'on_grid'::system_type END,
    COALESCE(v_row.commissioning_date, CURRENT_DATE),
    'draft'::proposal_status,
    COALESCE(v_row.project_cost, 0), 0, 0, 0,
    COALESCE(v_row.project_cost, 0), COALESCE(v_row.project_cost, 0),
    COALESCE(v_row.actual_cost, 0), COALESCE(v_row.project_cost, 0)
  ) RETURNING id INTO v_proposal_id;

  SELECT e.id INTO v_default_pm_id FROM employees e JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'project_manager' AND e.is_active = TRUE ORDER BY e.created_at DESC LIMIT 1;

  INSERT INTO projects (proposal_id, lead_id, project_number, project_manager_id, customer_name, customer_phone, customer_email, site_address_line1, site_address_line2, site_city, site_state, site_pincode, location_map_link, system_size_kwp, system_type, panel_brand, panel_model, panel_wattage, panel_count, inverter_brand, inverter_model, inverter_capacity_kw, contracted_value, advance_amount, commissioned_date, actual_end_date, status, completion_pct, notes)
  VALUES (
    v_proposal_id, v_lead_id, v_proj_num, v_default_pm_id,
    v_row.project_name,
    COALESCE(NULLIF(v_row.contact_phone, ''), '0000000000'),
    NULLIF(v_row.contact_email, ''),
    v_row.address_line1, v_row.address_line2, v_row.city, COALESCE(v_row.state, 'Tamil Nadu'), v_row.pincode,
    v_row.google_maps_url,
    COALESCE(v_row.system_size_kwp, 5),
    CASE LOWER(COALESCE(v_row.system_type, 'on_grid')) WHEN 'on_grid' THEN 'on_grid'::system_type WHEN 'on-grid' THEN 'on_grid'::system_type WHEN 'off_grid' THEN 'off_grid'::system_type WHEN 'off-grid' THEN 'off_grid'::system_type WHEN 'hybrid' THEN 'hybrid'::system_type ELSE 'on_grid'::system_type END,
    v_row.panel_make, v_row.panel_model, v_row.panel_wattage, COALESCE(v_row.panel_qty, 0),
    v_row.inverter_make, v_row.inverter_model, v_row.inverter_capacity_kw,
    COALESCE(v_row.project_cost, 0), 0,
    v_row.commissioning_date, v_row.commissioning_date,
    'completed'::project_status, 100,
    NULLIF(CONCAT_WS(E'\n',
      v_row.remarks,
      CASE WHEN v_row.source_year IS NOT NULL THEN 'Legacy backfill - commissioned ' || v_row.source_year END,
      CASE WHEN v_row.source_status IS NOT NULL THEN 'Source status: ' || v_row.source_status END,
      CASE WHEN v_row.actual_cost IS NOT NULL THEN 'Actual cost: Rs ' || v_row.actual_cost END,
      CASE WHEN v_row.profit_inr IS NOT NULL THEN 'Profit: Rs ' || v_row.profit_inr END,
      CASE WHEN v_row.industry IS NOT NULL THEN 'Industry: ' || v_row.industry END,
      CASE WHEN v_row.mounting_type IS NOT NULL THEN 'Mounting: ' || v_row.mounting_type END,
      CASE WHEN v_row.la_scope IS NOT NULL THEN 'LA scope: ' || v_row.la_scope END,
      CASE WHEN v_row.folder_link IS NOT NULL THEN 'Folder: ' || v_row.folder_link END
    ), '')
  ) RETURNING id INTO v_project_id;

  UPDATE proposals SET status = 'accepted' WHERE id = v_proposal_id;

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
    INSERT INTO inverters (project_id, brand, model, rated_capacity_kw, serial_number, commissioned_at, polling_enabled)
    VALUES (v_project_id, v_brand, v_row.inverter_model, v_row.inverter_capacity_kw, v_row.inverter_serial_number, v_row.commissioning_date, false);
  END IF;

  FOR v_child IN SELECT * FROM pending_project_imports WHERE parent_import_id = p_id LOOP
    IF v_child.inverter_capacity_kw IS NULL OR v_child.inverter_capacity_kw <= 0 THEN CONTINUE; END IF;
    INSERT INTO inverters (project_id, brand, model, rated_capacity_kw, serial_number, commissioned_at, polling_enabled)
    VALUES (v_project_id, v_brand, v_child.inverter_model, v_child.inverter_capacity_kw, v_child.inverter_serial_number, v_child.commissioning_date, false);
  END LOOP;

  IF v_row.portal_url IS NOT NULL AND v_row.portal_username IS NOT NULL AND v_row.portal_password_encrypted IS NOT NULL THEN
    INSERT INTO plant_monitoring_credentials (project_id, portal_url, username, password_encrypted, inverter_brand)
    VALUES (v_project_id, v_row.portal_url, v_row.portal_username, v_row.portal_password_encrypted, public.plant_monitoring_detect_brand(v_row.portal_url))
    ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL DO NOTHING;
  END IF;

  -- NEW in mig 160: plant_local_setup cascade
  IF v_row.local_login_ip IS NOT NULL OR v_row.datalogger_mac IS NOT NULL
     OR v_row.local_admin_password_encrypted IS NOT NULL OR v_row.jio_password_encrypted IS NOT NULL THEN
    INSERT INTO plant_local_setup (
      project_id, local_login_ip,
      local_admin_user, local_admin_password_encrypted,
      local_user, local_user_password_encrypted,
      internet_type, jio_password_encrypted, jio_primary_sim, jio_backup_sim,
      datalogger_mac, datalogger_pk, acdb_sn, dcdb_sn
    ) VALUES (
      v_project_id, v_row.local_login_ip,
      v_row.local_admin_user, v_row.local_admin_password_encrypted,
      v_row.local_user, v_row.local_user_password_encrypted,
      v_row.internet_type, v_row.jio_password_encrypted, v_row.jio_primary_sim, v_row.jio_backup_sim,
      v_row.datalogger_mac, v_row.datalogger_pk, v_row.acdb_sn, v_row.dcdb_sn
    ) ON CONFLICT (project_id) DO NOTHING;
  END IF;

  UPDATE pending_project_imports SET status_review = 'imported', imported_project_id = v_project_id,
    imported_at = NOW(), reviewed_by = auth.uid(), reviewed_at = COALESCE(reviewed_at, NOW())
  WHERE id = p_id;

  UPDATE pending_project_imports SET status_review = 'imported', imported_project_id = v_project_id,
    imported_at = NOW(), reviewed_by = auth.uid(), reviewed_at = COALESCE(reviewed_at, NOW())
  WHERE parent_import_id = p_id;

  RETURN v_project_id;

EXCEPTION WHEN OTHERS THEN
  UPDATE pending_project_imports SET status_review = 'error', import_error = SQLERRM,
    reviewed_by = auth.uid(), reviewed_at = NOW()
  WHERE id = p_id;
  RAISE;
END $$;

COMMIT;
