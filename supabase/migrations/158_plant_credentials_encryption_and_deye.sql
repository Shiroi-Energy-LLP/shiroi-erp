-- Migration 158: Plant-credentials encryption + Deye brand normalization.
--
-- Why:
--   1. plant_monitoring_credentials.password is plaintext today. The
--      O&M page already restricts reads via RLS, but any service_role
--      query (Edge Function, admin script) sees raw passwords. We
--      switch to symmetric-encryption-at-rest using a Vault-managed
--      AES-256 key + pgcrypto's pgp_sym_encrypt/_decrypt. Same key
--      reused later by pending_project_imports (mig 159) and
--      plant_local_setup (mig 160).
--   2. Vivek's chat-pasted credentials dump made it clear: "Solarman"
--      in the brand column is actually the Deye-brand inverter using
--      the Solarman white-label portal. ~84 plants in his data fit
--      this. We add 'deye' to the brand CHECK constraints on three
--      tables and reclassify URLs containing solarmanpv.com → deye
--      in the auto-detect helper.
--   3. The Growatt Edge Function poller reads
--      plant_monitoring_credentials.username/password directly (see
--      supabase/functions/inverter-poll/index.ts:770-789). Once the
--      password column is encrypted, the poller breaks unless we
--      give it a SECURITY DEFINER RPC that decrypts on-demand. That
--      RPC is created here; the Edge Function update lands in the
--      same commit.
--
-- Design spec: docs/superpowers/specs/2026-06-05-historical-plants-import-design.md
--
-- Coordinated code change in the same commit:
--   supabase/functions/inverter-poll/index.ts:770-789 swaps
--   .from('plant_monitoring_credentials').select('username, password')
--   for .rpc('get_growatt_creds_for_project').

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Extensions
-- ═══════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Vault secret bootstrap (idempotent)
--    Same key reused by mig 159 + 160 — name is 'plant_credentials_key'.
-- ═══════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'plant_credentials_key') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'plant_credentials_key',
      'AES-256 symmetric key for plant_monitoring_credentials + pending_project_imports + plant_local_setup. Used by pgp_sym_encrypt/_decrypt.'
    );
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Key-fetch helper (SECURITY DEFINER, never callable from app code)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_plant_creds_key()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, vault, pg_temp
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name = 'plant_credentials_key'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_plant_creds_key() FROM PUBLIC, authenticated, anon;
-- Service role inherits via SUPABASE; intentionally NOT granted to authenticated.
-- The function is only called from OTHER SECURITY DEFINER functions inside the DB.

COMMENT ON FUNCTION public.fn_plant_creds_key() IS
  'Returns the AES-256 symmetric key for plant_credentials_key from Vault. Never callable directly from app code — invoked only by SECURITY DEFINER helpers (search_plant_monitoring_credentials, get_growatt_creds_for_project, approve_pending_import, etc.).';

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Encrypt plant_monitoring_credentials.password
--    Add new BYTEA column, backfill from plaintext, drop plaintext.
--    Done in one BEGIN/COMMIT so there's never a window of inconsistency.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE plant_monitoring_credentials
  ADD COLUMN password_encrypted BYTEA;

UPDATE plant_monitoring_credentials
SET password_encrypted = extensions.pgp_sym_encrypt(password, public.fn_plant_creds_key())
WHERE password_encrypted IS NULL;

ALTER TABLE plant_monitoring_credentials
  ALTER COLUMN password_encrypted SET NOT NULL;

ALTER TABLE plant_monitoring_credentials
  DROP COLUMN password;

COMMENT ON COLUMN plant_monitoring_credentials.password_encrypted IS
  'AES-256 ciphertext of the portal password, encrypted via pgp_sym_encrypt(password, fn_plant_creds_key()). Decrypted only via search_plant_monitoring_credentials() / get_growatt_creds_for_project() RPCs, both of which enforce role gating before returning plaintext.';

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Add 'deye' to brand CHECK constraints on three tables (additive)
--    Keep 'solarman' too for backward compat with any pre-mig rows we
--    haven't reclassified yet.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE plant_monitoring_credentials
  DROP CONSTRAINT IF EXISTS plant_monitoring_credentials_inverter_brand_check;
ALTER TABLE plant_monitoring_credentials
  ADD CONSTRAINT plant_monitoring_credentials_inverter_brand_check
  CHECK (inverter_brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis',
    'deye', 'solarman', 'goodwe', 'fimer', 'polycab', 'havells',
    'flin_energy', 'other'
  ));

ALTER TABLE inverters
  DROP CONSTRAINT IF EXISTS inverters_brand_check;
ALTER TABLE inverters
  ADD CONSTRAINT inverters_brand_check
  CHECK (brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius',
    'deye', 'solarman', 'goodwe', 'fimer', 'polycab', 'havells',
    'flin_energy', 'other'
  ));

ALTER TABLE inverter_monitoring_credentials
  DROP CONSTRAINT IF EXISTS inverter_monitoring_credentials_brand_check;
ALTER TABLE inverter_monitoring_credentials
  ADD CONSTRAINT inverter_monitoring_credentials_brand_check
  CHECK (brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius',
    'deye', 'solarman', 'goodwe', 'fimer', 'polycab', 'havells',
    'flin_energy', 'other'
  ));

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Update plant_monitoring_detect_brand: solarmanpv.com → 'deye'
--    (Previously mapped to 'solarman' per mig 116.)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.plant_monitoring_detect_brand(portal_url TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN portal_url IS NULL OR portal_url = '' THEN 'other'
    WHEN lower(portal_url) LIKE '%isolarcloud%' THEN 'sungrow'
    WHEN lower(portal_url) LIKE '%growatt%' THEN 'growatt'
    WHEN lower(portal_url) LIKE '%solarmanpv%' OR lower(portal_url) LIKE '%solarman%' THEN 'deye'
    WHEN lower(portal_url) LIKE '%semsportal%' OR lower(portal_url) LIKE '%goodwe%' THEN 'goodwe'
    WHEN lower(portal_url) LIKE '%auroravision%' OR lower(portal_url) LIKE '%fimer%' THEN 'fimer'
    WHEN lower(portal_url) LIKE '%polycabmonitoring%' THEN 'polycab'
    WHEN lower(portal_url) LIKE '%havells%' THEN 'havells'
    WHEN lower(portal_url) LIKE '%power-datacenter%' OR lower(portal_url) LIKE '%flinenergy%' THEN 'flin_energy'
    WHEN lower(portal_url) LIKE '%fronius%' OR lower(portal_url) LIKE '%solarweb%' THEN 'fronius'
    WHEN lower(portal_url) LIKE '%soliscloud%' OR lower(portal_url) LIKE '%solis%' THEN 'solis'
    WHEN lower(portal_url) LIKE '%sma%' OR lower(portal_url) LIKE '%sunnyportal%' THEN 'sma'
    WHEN lower(portal_url) LIKE '%fusionsolar%' OR lower(portal_url) LIKE '%huawei%' THEN 'huawei'
    ELSE 'other'
  END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Reclassify the existing dev rows that point at solarmanpv.com but
--    have inverter_brand='solarman' or 'other' (the pre-mig classification).
-- ═══════════════════════════════════════════════════════════════════════
UPDATE plant_monitoring_credentials
SET inverter_brand = 'deye'
WHERE inverter_brand IN ('solarman', 'other')
  AND portal_url ILIKE '%solarmanpv%';

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Update fn_sync_plant_monitoring_from_commissioning to encrypt at insert
--    The trigger that auto-creates a plant_monitoring_credentials row
--    when a commissioning_report's status reaches 'submitted'/'finalized'
--    now encrypts the password before INSERT.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_sync_plant_monitoring_from_commissioning()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id UUID;
BEGIN
  IF (NEW.status NOT IN ('submitted', 'finalized'))
     OR (NEW.status IS NOT DISTINCT FROM OLD.status) THEN
    RETURN NEW;
  END IF;

  IF NEW.monitoring_portal_link IS NULL
     OR NEW.monitoring_login IS NULL
     OR NEW.monitoring_password IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_employee_id
    FROM public.employees
    WHERE profile_id = auth.uid()
    LIMIT 1;

  INSERT INTO public.plant_monitoring_credentials (
    project_id, commissioning_report_id,
    portal_url, username, password_encrypted,
    inverter_brand,
    created_by, updated_by
  )
  VALUES (
    NEW.project_id, NEW.id,
    NEW.monitoring_portal_link,
    NEW.monitoring_login,
    extensions.pgp_sym_encrypt(NEW.monitoring_password, public.fn_plant_creds_key()),
    public.plant_monitoring_detect_brand(NEW.monitoring_portal_link),
    v_employee_id, v_employee_id
  )
  ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL
  DO UPDATE SET
    username = EXCLUDED.username,
    password_encrypted = EXCLUDED.password_encrypted,
    commissioning_report_id = EXCLUDED.commissioning_report_id,
    inverter_brand = EXCLUDED.inverter_brand,
    updated_by = EXCLUDED.created_by;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. search_plant_monitoring_credentials RPC: return decrypted password
--    Same role gate (founder / project_manager / om_technician) inside
--    the function body. Decryption happens server-side; only authorized
--    callers ever see plaintext.
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.search_plant_monitoring_credentials(TEXT, UUID, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.search_plant_monitoring_credentials(
  p_query TEXT DEFAULT NULL,
  p_project_id UUID DEFAULT NULL,
  p_brand TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  commissioning_report_id UUID,
  inverter_brand TEXT,
  portal_url TEXT,
  username TEXT,
  password TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ,
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  project_customer_name TEXT,
  project_number TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role app_role;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager', 'om_technician') THEN
    RAISE EXCEPTION 'forbidden: plant_monitoring_credentials access denied for role %', v_role
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      c.id,
      c.project_id,
      c.commissioning_report_id,
      c.inverter_brand,
      c.portal_url,
      c.username,
      extensions.pgp_sym_decrypt(c.password_encrypted, public.fn_plant_creds_key())::TEXT AS password,
      c.notes,
      c.created_at,
      c.created_by,
      c.updated_at,
      c.updated_by,
      c.deleted_at,
      c.deleted_by,
      p.customer_name AS project_customer_name,
      p.project_number
    FROM public.plant_monitoring_credentials c
    LEFT JOIN public.projects p ON p.id = c.project_id
    WHERE c.deleted_at IS NULL
      AND (p_project_id IS NULL OR c.project_id = p_project_id)
      AND (p_brand IS NULL OR c.inverter_brand = p_brand)
      AND (
        p_query IS NULL
        OR length(trim(p_query)) = 0
        OR c.username ILIKE '%' || p_query || '%'
        OR c.notes    ILIKE '%' || p_query || '%'
      )
  ),
  total AS (SELECT COUNT(*)::BIGINT AS cnt FROM filtered)
  SELECT
    f.id, f.project_id, f.commissioning_report_id, f.inverter_brand,
    f.portal_url, f.username, f.password, f.notes,
    f.created_at, f.created_by, f.updated_at, f.updated_by,
    f.deleted_at, f.deleted_by,
    f.project_customer_name, f.project_number,
    t.cnt AS total_count
  FROM filtered f
  CROSS JOIN total t
  ORDER BY f.created_at DESC
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. New get_growatt_creds_for_project RPC — for the Edge Function poller
--     Called from supabase/functions/inverter-poll/index.ts in place of
--     the direct .select('username, password') query.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_growatt_creds_for_project(p_project_id UUID)
RETURNS TABLE (username TEXT, password TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    username,
    extensions.pgp_sym_decrypt(password_encrypted, public.fn_plant_creds_key())::TEXT AS password
  FROM public.plant_monitoring_credentials
  WHERE project_id = p_project_id
    AND inverter_brand IN ('growatt')
    AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_growatt_creds_for_project(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_growatt_creds_for_project(UUID) TO service_role;

COMMENT ON FUNCTION public.get_growatt_creds_for_project(UUID) IS
  'Returns decrypted (username, password) for a project Growatt credential. Called from the inverter-poll Edge Function. service_role only.';

-- ═══════════════════════════════════════════════════════════════════════
-- 11. Extend get_plant_monitoring_summary with brand_deye count
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_plant_monitoring_summary();

CREATE OR REPLACE FUNCTION public.get_plant_monitoring_summary()
RETURNS TABLE (
  total_count BIGINT,
  brand_sungrow BIGINT,
  brand_growatt BIGINT,
  brand_sma BIGINT,
  brand_huawei BIGINT,
  brand_fronius BIGINT,
  brand_solis BIGINT,
  brand_deye BIGINT,
  brand_goodwe BIGINT,
  brand_fimer BIGINT,
  brand_polycab BIGINT,
  brand_havells BIGINT,
  brand_flin_energy BIGINT,
  brand_other BIGINT,
  missing_count BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH creds AS (
    SELECT inverter_brand, project_id
    FROM public.plant_monitoring_credentials
    WHERE deleted_at IS NULL
  ),
  projects_with_finalized_commissioning AS (
    SELECT DISTINCT project_id
    FROM public.commissioning_reports
    WHERE status IN ('submitted', 'finalized')
      AND project_id IS NOT NULL
  ),
  projects_with_creds AS (
    SELECT DISTINCT project_id FROM creds
  )
  SELECT
    (SELECT COUNT(*) FROM creds)::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'sungrow')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'growatt')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'sma')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'huawei')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'fronius')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'solis')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand IN ('deye', 'solarman'))::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'goodwe')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'fimer')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'polycab')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'havells')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'flin_energy')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'other' OR inverter_brand IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM projects_with_finalized_commissioning p
      WHERE NOT EXISTS (SELECT 1 FROM projects_with_creds c WHERE c.project_id = p.project_id)
    )::BIGINT;
$$;

COMMIT;
