-- Migration 058: Plant Monitoring credentials
--
-- New module under O&M. Stores portal login credentials (URL, username, password)
-- for every solar plant. Auto-synced from commissioning_reports via an AFTER
-- UPDATE trigger that fires on status transition to 'submitted' or 'finalized'.
--
-- Design spec: docs/superpowers/specs/2026-04-16-plant-monitoring-design.md

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Brand-detection helper (used by trigger and by server actions)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.plant_monitoring_detect_brand(portal_url TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN portal_url IS NULL THEN NULL
    WHEN lower(portal_url) LIKE '%isolarcloud%' THEN 'sungrow'
    WHEN lower(portal_url) LIKE '%growatt%' THEN 'growatt'
    WHEN lower(portal_url) LIKE '%sunnyportal%' OR lower(portal_url) LIKE '%sma-%' OR lower(portal_url) LIKE '%ennexos%' THEN 'sma'
    WHEN lower(portal_url) LIKE '%fusionsolar%' OR lower(portal_url) LIKE '%huawei%' THEN 'huawei'
    WHEN lower(portal_url) LIKE '%fronius%' OR lower(portal_url) LIKE '%solarweb%' THEN 'fronius'
    WHEN lower(portal_url) LIKE '%soliscloud%' OR lower(portal_url) LIKE '%solis%' THEN 'solis'
    ELSE 'other'
  END;
$$;

COMMENT ON FUNCTION public.plant_monitoring_detect_brand(TEXT)
  IS 'Classify a monitoring portal URL into one of: sungrow, growatt, sma, huawei, fronius, solis, other. Used by trigger + server actions so classification is consistent.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. plant_monitoring_credentials table
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.plant_monitoring_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  commissioning_report_id UUID REFERENCES public.commissioning_reports(id) ON DELETE SET NULL,

  inverter_brand TEXT CHECK (inverter_brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis', 'other'
  )),

  portal_url TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.employees(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.plant_monitoring_credentials
  IS 'Centralised portal credentials for every commissioned solar plant. Auto-populated from commissioning_reports via trigger; manually editable by founder + project_manager.';

-- Unique: one active credential per (project, portal_url). Supports the
-- ON CONFLICT clause in the trigger and prevents duplicate auto-syncs.
CREATE UNIQUE INDEX IF NOT EXISTS plant_monitoring_credentials_unique_active
  ON public.plant_monitoring_credentials (project_id, portal_url)
  WHERE deleted_at IS NULL;

-- Query-path indexes (rule #17 — any filterable column gets an index)
CREATE INDEX IF NOT EXISTS plant_monitoring_credentials_project_idx
  ON public.plant_monitoring_credentials (project_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS plant_monitoring_credentials_created_at_idx
  ON public.plant_monitoring_credentials (created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS plant_monitoring_credentials_brand_idx
  ON public.plant_monitoring_credentials (inverter_brand) WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. updated_at trigger
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_plant_monitoring_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plant_monitoring_updated_at ON public.plant_monitoring_credentials;
CREATE TRIGGER trg_plant_monitoring_updated_at
  BEFORE UPDATE ON public.plant_monitoring_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_plant_monitoring_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Sync trigger from commissioning_reports
--    Fires on status transition to submitted or finalized, upserts on
--    (project_id, portal_url).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_sync_plant_monitoring_from_commissioning()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_employee_id UUID;
BEGIN
  -- Only act when status newly transitions to submitted/finalized
  IF (NEW.status NOT IN ('submitted', 'finalized'))
     OR (NEW.status IS NOT DISTINCT FROM OLD.status) THEN
    RETURN NEW;
  END IF;

  -- All three fields required — ignore partial entries
  IF NEW.monitoring_portal_link IS NULL
     OR NEW.monitoring_login IS NULL
     OR NEW.monitoring_password IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map auth.uid() -> employees.id (same pattern as migration 055)
  SELECT id INTO v_employee_id
    FROM public.employees
    WHERE profile_id = auth.uid()
    LIMIT 1;

  INSERT INTO public.plant_monitoring_credentials (
    project_id, commissioning_report_id,
    portal_url, username, password,
    inverter_brand,
    created_by, updated_by
  )
  VALUES (
    NEW.project_id, NEW.id,
    NEW.monitoring_portal_link, NEW.monitoring_login, NEW.monitoring_password,
    public.plant_monitoring_detect_brand(NEW.monitoring_portal_link),
    v_employee_id, v_employee_id
  )
  ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL
  DO UPDATE SET
    username = EXCLUDED.username,
    password = EXCLUDED.password,
    commissioning_report_id = EXCLUDED.commissioning_report_id,
    inverter_brand = EXCLUDED.inverter_brand,
    updated_by = EXCLUDED.created_by;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_plant_monitoring_from_commissioning ON public.commissioning_reports;
CREATE TRIGGER trg_sync_plant_monitoring_from_commissioning
  AFTER UPDATE OF status, monitoring_portal_link, monitoring_login, monitoring_password
  ON public.commissioning_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_plant_monitoring_from_commissioning();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Summary RPC (rule #12 — no JS aggregation)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_plant_monitoring_summary()
RETURNS TABLE (
  total_count BIGINT,
  brand_sungrow BIGINT,
  brand_growatt BIGINT,
  brand_sma BIGINT,
  brand_huawei BIGINT,
  brand_fronius BIGINT,
  brand_solis BIGINT,
  brand_other BIGINT,
  missing_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
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
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'other' OR inverter_brand IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM projects_with_finalized_commissioning p
      WHERE NOT EXISTS (SELECT 1 FROM projects_with_creds c WHERE c.project_id = p.project_id)
    )::BIGINT;
$$;

COMMENT ON FUNCTION public.get_plant_monitoring_summary()
  IS 'Returns aggregates for the Plant Monitoring summary cards: total count, per-brand counts, and count of projects with finalized commissioning but no credentials row.';

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Row-Level Security
--    Uses public.get_my_role() (STABLE SECURITY DEFINER) per migration 054.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.plant_monitoring_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plant_monitoring_select ON public.plant_monitoring_credentials;
CREATE POLICY plant_monitoring_select
  ON public.plant_monitoring_credentials
  FOR SELECT
  USING (
    public.get_my_role() = ANY (ARRAY[
      'founder'::app_role,
      'project_manager'::app_role,
      'om_technician'::app_role
    ])
  );

DROP POLICY IF EXISTS plant_monitoring_insert ON public.plant_monitoring_credentials;
CREATE POLICY plant_monitoring_insert
  ON public.plant_monitoring_credentials
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY[
      'founder'::app_role,
      'project_manager'::app_role
    ])
  );

DROP POLICY IF EXISTS plant_monitoring_update ON public.plant_monitoring_credentials;
CREATE POLICY plant_monitoring_update
  ON public.plant_monitoring_credentials
  FOR UPDATE
  USING (
    public.get_my_role() = ANY (ARRAY[
      'founder'::app_role,
      'project_manager'::app_role
    ])
  );

-- No DELETE policy = physical deletes are blocked. We soft-delete via UPDATE.
