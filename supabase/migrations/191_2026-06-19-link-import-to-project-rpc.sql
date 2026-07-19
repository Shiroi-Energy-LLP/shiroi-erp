-- Migration 191: link_pending_import_to_project RPC.
--
-- Powers the /om/import-review "Link" action: attach a staged plant's monitoring
-- credential (and one inverter row, ONLY if the project has none) to an EXISTING
-- project — without creating the duplicate project that approve_pending_import
-- makes for every non-exact match. Founder/project_manager only.
--
-- Spec: docs/superpowers/specs/2026-06-19-import-review-link-existing-project-design.md
-- Coordinated code: apps/erp/src/lib/import-review-actions.ts (linkPendingImportToProject)
--                   + the Import Review "Link" dialog.

BEGIN;

CREATE OR REPLACE FUNCTION public.link_pending_import_to_project(
  p_import_id UUID,
  p_project_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_role  app_role;
  v_row   pending_project_imports%ROWTYPE;
  v_brand TEXT;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager') THEN
    RAISE EXCEPTION 'forbidden: link_pending_import_to_project requires founder/project_manager, got %', v_role
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM pending_project_imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import row % not found', p_import_id;
  END IF;
  IF v_row.parent_import_id IS NOT NULL THEN
    RAISE EXCEPTION 'row % is a child-inverter row; link its parent (%) instead', p_import_id, v_row.parent_import_id;
  END IF;
  IF v_row.status_review NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'row % is %, cannot link', p_import_id, v_row.status_review;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;

  v_brand := COALESCE(NULLIF(v_row.portal_brand, ''), 'other');

  -- 1. Credential — only if the import carries a portal login. Copy the
  --    ciphertext directly: pending_project_imports.portal_password_encrypted
  --    and plant_monitoring_credentials.password_encrypted share the
  --    plant_credentials_key Vault secret, so no decrypt/re-encrypt is needed.
  IF NULLIF(v_row.portal_username, '') IS NOT NULL THEN
    INSERT INTO plant_monitoring_credentials (
      project_id, portal_url, username, password_encrypted, inverter_brand, notes
    )
    VALUES (
      p_project_id,
      v_row.portal_url,
      v_row.portal_username,
      v_row.portal_password_encrypted,
      v_brand,
      'Linked from import ' || p_import_id::text || ' (' || CURRENT_DATE::text || ')'
    )
    ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL DO NOTHING;
  END IF;

  -- 2. Inverter row — ONLY when the import has a serial AND the project has no
  --    inverters yet. inverters.serial_number is NOT NULL, and most Deye imports
  --    have no serial yet (those arrive via the Deye API backfill), so most links
  --    are credential-only; we add the inverter only when a serial is present.
  IF NULLIF(v_row.inverter_serial_number, '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM inverters WHERE project_id = p_project_id) THEN
    INSERT INTO inverters (
      project_id, brand, model, rated_capacity_kw, serial_number, commissioned_at, polling_enabled
    )
    VALUES (
      p_project_id,
      v_brand,
      NULLIF(v_row.inverter_model, ''),
      v_row.inverter_capacity_kw,
      NULLIF(v_row.inverter_serial_number, ''),
      v_row.commissioning_date,
      false
    );
  END IF;

  -- 3. Close the import out, linked to the chosen project.
  UPDATE pending_project_imports SET
    status_review        = 'imported',
    imported_project_id  = p_project_id,
    matched_project_id   = p_project_id,
    imported_at          = NOW(),
    reviewed_by          = auth.uid(),
    reviewed_at          = COALESCE(reviewed_at, NOW())
  WHERE id = p_import_id;

  RETURN p_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_pending_import_to_project(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_pending_import_to_project(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.link_pending_import_to_project(UUID, UUID) IS
  'Attaches a pending_project_imports plant credential (+ one inverter row if the project has none) to an EXISTING project, then marks the import imported. No new project created (unlike approve_pending_import). Founder/PM only. Password ciphertext copied via the shared plant_credentials_key Vault secret.';

COMMIT;
