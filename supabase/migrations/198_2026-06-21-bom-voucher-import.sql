-- Migration 198: BOM + Voucher import pipeline.
--
-- Why:
--   Shiroi has ~48 hand-maintained per-project BOM sheets (se-master-file)
--   carrying a CONTRACTED price track, an ACTUAL spend track, and voucher /
--   bill-collection tracking. The contracted side is already in
--   proposal_bom_lines (~24.7k rows); the actuals + vouchers are captured
--   NOWHERE. project_boq_items (procurement side, tied to projects) is empty
--   for history (62 of 480 projects have any BOQ rows).
--
--   This migration adds the staging + write path for an upload -> parse ->
--   auto-match -> human-review -> confirm pipeline (UI: /bom-review/import),
--   mirroring the historical-plants importer (pending_project_imports, mig 159).
--   Matching is human-reviewed; nothing is blind-written.
--
-- Design spec: docs/superpowers/specs/2026-06-21-bom-voucher-import-design.md
-- Coordinated code: apps/erp/src/lib/bom-import-actions.ts + bom-sheet-parser.ts
--                   + /bom-review/import UI + scripts/seed-bom-imports.ts

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Extend project_boq_items: actual spend track + voucher tracking
--    (contracted side already lives in quantity/unit_price/total_price/gst_rate)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.project_boq_items
  ADD COLUMN IF NOT EXISTS actual_quantity    NUMERIC,
  ADD COLUMN IF NOT EXISTS actual_unit_price  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS actual_total_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS voucher_no         TEXT,
  ADD COLUMN IF NOT EXISTS bill_status        TEXT NOT NULL DEFAULT 'na'
    CHECK (bill_status IN ('need_bill','submitted','na'));

COMMENT ON COLUMN public.project_boq_items.actual_quantity    IS 'Actual qty procured (BOM import "Act" track).';
COMMENT ON COLUMN public.project_boq_items.actual_unit_price  IS 'Actual unit rate (pre-GST).';
COMMENT ON COLUMN public.project_boq_items.actual_total_price IS 'Actual line total incl. GST.';
COMMENT ON COLUMN public.project_boq_items.voucher_no         IS 'Material-transfer / expense voucher reference (MT/VN).';
COMMENT ON COLUMN public.project_boq_items.bill_status        IS 'GST-bill collection state: need_bill | submitted | na.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. pending_bom_imports staging table (one row per uploaded project sheet)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pending_bom_imports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id  UUID NOT NULL,
  source_file_name TEXT NOT NULL,
  sheet_name       TEXT NOT NULL,
  project_name     TEXT NOT NULL,
  normalized_name  TEXT NOT NULL,

  -- Match outcome (computed at seed/upload time via match_project_by_name)
  matched_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  match_confidence   TEXT NOT NULL DEFAULT 'none'
                     CHECK (match_confidence IN ('exact','fuzzy','none')),
  match_score        NUMERIC(4,3) NOT NULL DEFAULT 0,
  match_candidates   JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Parsed payload
  header       JSONB NOT NULL DEFAULT '{}'::jsonb,
  parsed_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  line_count   INT NOT NULL DEFAULT 0,

  -- Lifecycle
  status_review TEXT NOT NULL DEFAULT 'pending'
                CHECK (status_review IN ('pending','imported','rejected','error')),
  imported_boi_id     UUID REFERENCES public.project_bois(id) ON DELETE SET NULL,
  imported_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  imported_at   TIMESTAMPTZ,
  import_error  TEXT,
  rejection_reason TEXT,
  reviewed_by   UUID REFERENCES public.profiles(id),
  reviewed_at   TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_pending_bom_imports_status ON public.pending_bom_imports (status_review);
CREATE INDEX IF NOT EXISTS idx_pending_bom_imports_batch  ON public.pending_bom_imports (import_batch_id);
CREATE INDEX IF NOT EXISTS idx_pending_bom_imports_match  ON public.pending_bom_imports (match_confidence) WHERE status_review = 'pending';
-- One active (pending) row per (file, sheet) — re-import allowed after import/reject.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_bom_imports_uniq_active
  ON public.pending_bom_imports (source_file_name, sheet_name) WHERE status_review = 'pending';

COMMENT ON TABLE public.pending_bom_imports IS
  'Staging for the BOM + voucher import. /bom-review/import reads + reviews this; on Confirm, approve_bom_import cascades parsed_lines into a project_bois + project_boq_items. parsed_lines element shape: see the design spec / bom-sheet-parser.ts ParsedBomLine.';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RLS — founder + project_manager (Manivel) read/insert/update; service all
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.pending_bom_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY pbi_select ON public.pending_bom_imports FOR SELECT TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role]));
CREATE POLICY pbi_insert ON public.pending_bom_imports FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role]));
CREATE POLICY pbi_update ON public.pending_bom_imports FOR UPDATE TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role]));
CREATE POLICY pbi_service ON public.pending_bom_imports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. updated_at trigger
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_pending_bom_imports_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_pending_bom_imports_updated_at ON public.pending_bom_imports;
CREATE TRIGGER trg_pending_bom_imports_updated_at
  BEFORE UPDATE ON public.pending_bom_imports
  FOR EACH ROW EXECUTE FUNCTION public.fn_pending_bom_imports_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. match_project_by_name — fuzzy candidates via pg_trgm similarity
--    Drives seed-time auto-match + the review UI "alternative candidates".
--    SECURITY DEFINER so it ranks across ALL projects; returns only
--    name/number/score (already visible to internal staff).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.match_project_by_name(
  p_name TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  project_id     UUID,
  customer_name  TEXT,
  project_number TEXT,
  score          NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.id, p.customer_name, p.project_number,
         ROUND(similarity(p.customer_name, p_name)::numeric, 3) AS score
  FROM public.projects p
  WHERE p.customer_name IS NOT NULL
    AND similarity(p.customer_name, p_name) > 0.1
  ORDER BY similarity(p.customer_name, p_name) DESC, p.customer_name
  LIMIT GREATEST(p_limit, 1);
END $$;

REVOKE ALL ON FUNCTION public.match_project_by_name(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_project_by_name(TEXT, INT) TO authenticated, service_role;

COMMENT ON FUNCTION public.match_project_by_name(TEXT, INT) IS
  'Top-N fuzzy project matches by customer_name (pg_trgm similarity). Used by the BOM import seed/upload to auto-match and to list alternative candidates.';

-- ═══════════════════════════════════════════════════════════════════════
-- 6. approve_bom_import — cascade a staged sheet into a project's BOM
--    Accepts the FINAL (reviewer-edited) lines + chosen project, so no
--    per-cell staging writes are needed. Founder/PM only.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_bom_import(
  p_id UUID,
  p_project_id UUID,
  p_lines JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     app_role;
  v_row      public.pending_bom_imports%ROWTYPE;
  v_emp      UUID;
  v_boi_id   UUID;
  v_boi_num  INT;
  v_line     JSONB;
  v_idx      INT;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'project_manager') THEN
    RAISE EXCEPTION 'forbidden: approve_bom_import requires founder/project_manager, got %', v_role
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.pending_bom_imports WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bom import row % not found', p_id; END IF;
  IF v_row.status_review <> 'pending' THEN
    RAISE EXCEPTION 'bom import % is %, cannot import', p_id, v_row.status_review;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'no lines to import for %', p_id;
  END IF;

  SELECT id INTO v_emp FROM public.employees WHERE profile_id = auth.uid();

  -- One BOI container per import (provenance in notes)
  SELECT COALESCE(MAX(boi_number), 0) + 1 INTO v_boi_num
  FROM public.project_bois WHERE project_id = p_project_id;

  INSERT INTO public.project_bois (project_id, boi_number, status, prepared_by, notes)
  VALUES (
    p_project_id, v_boi_num, 'locked', v_emp,
    'Imported from ' || v_row.source_file_name || ' / ' || v_row.sheet_name || ' on ' || CURRENT_DATE::text
  )
  RETURNING id INTO v_boi_id;

  -- Lines
  v_idx := 0;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.project_boq_items (
      project_id, boi_id, line_number,
      item_category, item_description, brand, vendor_name,
      quantity, unit, unit_price, gst_rate, gst_type, total_price,
      actual_quantity, actual_unit_price, actual_total_price,
      voucher_no, bill_status, procurement_status, notes
    ) VALUES (
      p_project_id, v_boi_id,
      COALESCE((v_line->>'line_number')::int, v_idx),
      COALESCE(NULLIF(v_line->>'item_category', ''), 'Other'),
      COALESCE(NULLIF(v_line->>'item_description', ''), 'Item'),
      NULLIF(v_line->>'make', ''),
      NULLIF(v_line->>'vendor_name', ''),
      COALESCE((v_line->>'quantity')::numeric, 0),
      COALESCE(NULLIF(v_line->>'unit', ''), 'Nos'),
      COALESCE((v_line->>'unit_price')::numeric, 0),
      COALESCE((v_line->>'gst_rate')::numeric, 0),
      'supply',
      COALESCE((v_line->>'total_price')::numeric, 0),
      NULLIF(v_line->>'actual_quantity', '')::numeric,
      NULLIF(v_line->>'actual_unit_price', '')::numeric,
      NULLIF(v_line->>'actual_total_price', '')::numeric,
      NULLIF(v_line->>'voucher_no', ''),
      COALESCE(NULLIF(v_line->>'bill_status', ''), 'na'),
      'yet_to_finalize',
      NULLIF(v_line->>'remarks', '')
    );
  END LOOP;

  UPDATE public.pending_bom_imports SET
    status_review       = 'imported',
    imported_boi_id     = v_boi_id,
    imported_project_id = p_project_id,
    matched_project_id  = p_project_id,
    imported_at         = NOW(),
    reviewed_by         = auth.uid(),
    reviewed_at         = COALESCE(reviewed_at, NOW())
  WHERE id = p_id;

  RETURN v_boi_id;

EXCEPTION WHEN OTHERS THEN
  UPDATE public.pending_bom_imports SET
    status_review = 'error',
    import_error  = SQLERRM,
    reviewed_by   = auth.uid(),
    reviewed_at   = NOW()
  WHERE id = p_id;
  RAISE;
END $$;

REVOKE ALL ON FUNCTION public.approve_bom_import(UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_bom_import(UUID, UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.approve_bom_import(UUID, UUID, JSONB) IS
  'Cascades a pending_bom_imports sheet into one project_bois + its project_boq_items (contracted + actual + voucher). Accepts reviewer-edited lines + chosen project. Founder/PM only. On error marks the staging row status_review=error with import_error.';

COMMIT;
