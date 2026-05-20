-- ============================================================================
-- Migration 111 — system_settings singleton + org-wide proposal-gate toggle
-- Date: 2026-05-20
--
-- Why we need this:
--   Mig 109 added leads.proposal_gate_bypassed (per-lead). Vivek's actual
--   ask on May 19 was to "pause this rule with a toggle for ALL projects
--   till we get the data sorted" — an org-wide kill switch for the
--   cleanup phase, not a per-lead flag. The per-lead toggle works but
--   doesn't help bulk historical cleanup because Vivek would need to flip
--   it on each lead before flipping status.
--
-- This migration:
--   1. Creates a singleton system_settings table (id BOOL PRIMARY KEY
--      pattern enforces exactly one row).
--   2. Adds proposal_gate_enabled BOOLEAN NOT NULL DEFAULT TRUE plus
--      audit columns (updated_at, updated_by).
--   3. Seeds the singleton row.
--   4. RLS: read by any authenticated, update by founder only.
--   5. Updates fn_block_lead_won_without_proposal: short-circuit when
--      system_settings.proposal_gate_enabled = FALSE. Leaves the
--      per-lead leads.proposal_gate_bypassed escape hatch in place
--      (both work — singleton off-switch beats per-lead bypass).
--
-- Reversibility:
--   Vivek flips the toggle back ON in /settings → System once historical
--   cleanup is done. The trigger logic stays — no migration needed to
--   restore enforcement.
-- ============================================================================

BEGIN;

-- ── (1) Singleton system_settings table ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.system_settings (
  -- BOOLEAN PRIMARY KEY = exactly one row trick.
  id                       BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),

  -- Proposal gate — when FALSE, lead.status can transition to 'won' even
  -- without a proposal row. Used during historical-cleanup phase.
  proposal_gate_enabled    BOOLEAN NOT NULL DEFAULT TRUE,

  -- Audit
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by               UUID NULL REFERENCES public.employees(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.system_settings IS
  'Singleton row (id=TRUE) holding org-wide ERP flags. Add new feature flags as columns here.';
COMMENT ON COLUMN public.system_settings.proposal_gate_enabled IS
  'When FALSE, fn_block_lead_won_without_proposal short-circuits and allows Won transitions without a proposal. Use during historical-cleanup phase. Flip back to TRUE when done.';

-- Seed the singleton if it doesn't exist (idempotent).
INSERT INTO public.system_settings (id, proposal_gate_enabled)
VALUES (TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── (2) RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_settings_read ON public.system_settings;
CREATE POLICY system_settings_read ON public.system_settings FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS system_settings_update ON public.system_settings;
CREATE POLICY system_settings_update ON public.system_settings FOR UPDATE
USING (get_my_role() = 'founder'::app_role)
WITH CHECK (get_my_role() = 'founder'::app_role);

-- No INSERT/DELETE policies — singleton is seeded above and the BOOLEAN PK
-- prevents accidental duplicates.

-- ── (3) Update trigger function to honour singleton flag ──────────────────

CREATE OR REPLACE FUNCTION public.fn_block_lead_won_without_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
DECLARE
  v_has_proposal     BOOLEAN;
  v_gate_enabled     BOOLEAN;
BEGIN
  -- Only fire on the not-won → won transition.
  IF NEW.status != 'won' OR OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  -- Per-lead escape hatch (mig 109).
  IF NEW.proposal_gate_bypassed IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Org-wide kill switch (mig 111).
  SELECT proposal_gate_enabled INTO v_gate_enabled
  FROM system_settings WHERE id = TRUE;

  IF v_gate_enabled IS FALSE THEN
    RETURN NEW;
  END IF;

  -- Normal enforcement: lead must have at least one proposal.
  SELECT EXISTS (
    SELECT 1 FROM proposals WHERE lead_id = NEW.id
  ) INTO v_has_proposal;

  IF NOT v_has_proposal THEN
    RAISE EXCEPTION
      'Cannot mark lead as Won without a proposal. Create a Quick Quote (Path A) or a detailed proposal (Path B) first. (Founder can disable the gate org-wide in /settings → System for cleanup phases.)'
      USING ERRCODE = 'check_violation',
            HINT = 'Use the Quick Quote button in the lead header, the Quote tab to compose a detailed proposal, the per-lead "Skip proposal gate" toggle, or the org-wide toggle in /settings → System.';
  END IF;

  RETURN NEW;
END;
$func$;

COMMIT;
