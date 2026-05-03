-- ============================================================================
-- Migration 109 — documents index + lifecycle inheritance + leads.drive_folder_*
-- Date: 2026-05-02
-- Why: Files for a customer journey live in Drive + Supabase Storage with no
--      unified index. AI insights need queryable text + embeddings. Lifecycle
--      continuity (lead → proposal → project) requires polymorphic associations.
--      Hybrid storage: Drive for collab/large, Supabase for structured/sensitive,
--      documents table as the index.
--
--      Phase 1: table + lifecycle triggers (lead → proposal, proposal → project)
--               + leads.drive_folder_id|drive_folder_url + RLS + indexes.
--      Phase 2 (deferred): async extraction edge function, embedding population,
--               1,353-folder backfill.
--
-- Spec: docs/superpowers/specs/2026-05-02-documents-drive-lifecycle-design.md
-- Note: om_ticket_id column intentionally omitted — om_tickets table doesn't
--       exist yet; will be added when O&M module ships.
-- ============================================================================

BEGIN;

-- ── (0) pgvector extension ────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- ── (1) documents table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Polymorphic association — any subset may be set as the journey progresses.
  -- At least one must be non-null (CHECK below).
  lead_id     UUID NULL REFERENCES public.leads(id)     ON DELETE SET NULL,
  proposal_id UUID NULL REFERENCES public.proposals(id) ON DELETE SET NULL,
  project_id  UUID NULL REFERENCES public.projects(id)  ON DELETE SET NULL,

  -- Categorization (controlled vocab — see spec section "Categories")
  category    TEXT NOT NULL,
  subcategory TEXT NULL,

  -- Storage (hybrid: Drive for collaboration, Supabase for sensitive/AI)
  storage_backend  TEXT NOT NULL CHECK (storage_backend IN ('drive', 'supabase')),
  external_id      TEXT NULL,
  storage_path     TEXT NULL,
  external_url     TEXT NULL,
  parent_folder_id TEXT NULL,

  -- Metadata
  name       TEXT NOT NULL,
  mime_type  TEXT NULL,
  size_bytes BIGINT NULL,

  -- AI surface (populated async by phase 2)
  extracted_text TEXT NULL,
  embedding      vector(1536) NULL,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  ai_summary     TEXT NULL,

  -- Audit
  uploaded_by UUID NULL REFERENCES public.employees(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Backend integrity: drive needs external_id, supabase needs storage_path
  CONSTRAINT documents_storage_backend_integrity CHECK (
    (storage_backend = 'drive'    AND external_id  IS NOT NULL) OR
    (storage_backend = 'supabase' AND storage_path IS NOT NULL)
  ),

  -- At least one entity association
  CONSTRAINT documents_at_least_one_entity CHECK (
    lead_id IS NOT NULL OR proposal_id IS NOT NULL OR project_id IS NOT NULL
  ),

  -- Category controlled vocabulary
  CONSTRAINT documents_category_check CHECK (category IN (
    'site_survey_photo',
    'site_survey_report',
    'roof_layout',
    'electrical_sld',
    'cad_drawing',
    'sketchup_model',
    'proposal_pdf',
    'costing_sheet',
    'bom_excel',
    'kyc_document',
    'electricity_bill',
    'signed_proposal',
    'purchase_order',
    'invoice',
    'payment_receipt',
    'commissioning_report',
    'liaison_document',
    'as_built_drawing',
    'om_photo',
    'om_report',
    'misc'
  ))
);

COMMENT ON TABLE public.documents IS
  'Unified file index across the customer journey. Files live in either Drive (collab/large) or Supabase Storage (structured/sensitive); this table is the storage-agnostic index. Polymorphic association: lead/proposal/project. AI surface columns (extracted_text, embedding, ai_summary) populated async in phase 2.';

-- ── (2) Indexes ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_documents_lead     ON public.documents(lead_id)     WHERE lead_id     IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_proposal ON public.documents(proposal_id) WHERE proposal_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_project  ON public.documents(project_id)  WHERE project_id  IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_category ON public.documents(category)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_external_id ON public.documents(external_id) WHERE external_id IS NOT NULL;
-- IVFFlat for vector similarity once embeddings are populated (phase 2).
-- Created lazily — empty embedding column is fine; index just sits idle.
CREATE INDEX IF NOT EXISTS idx_documents_embedding
  ON public.documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ── (3) updated_at trigger ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.documents_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_documents_set_updated_at ON public.documents;
CREATE TRIGGER trg_documents_set_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_set_updated_at();

-- ── (4) Lifecycle inheritance triggers ────────────────────────────────────
-- When a proposal is created for a lead, all documents tied to that lead
-- inherit the proposal_id. Same when a project is created.

CREATE OR REPLACE FUNCTION public.inherit_documents_to_proposal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.documents
    SET proposal_id = NEW.id, updated_at = NOW()
    WHERE lead_id = NEW.lead_id
      AND proposal_id IS NULL
      AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_inherit_documents_to_proposal ON public.proposals;
CREATE TRIGGER trg_inherit_documents_to_proposal
  AFTER INSERT ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.inherit_documents_to_proposal();

CREATE OR REPLACE FUNCTION public.inherit_documents_to_project()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Inherit from lead-level documents
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.documents
    SET project_id = NEW.id, updated_at = NOW()
    WHERE lead_id = NEW.lead_id
      AND project_id IS NULL
      AND deleted_at IS NULL;
  END IF;
  -- Also inherit from proposal-level documents (when project's proposal_id is set)
  IF NEW.proposal_id IS NOT NULL THEN
    UPDATE public.documents
    SET project_id = NEW.id, updated_at = NOW()
    WHERE proposal_id = NEW.proposal_id
      AND project_id IS NULL
      AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_inherit_documents_to_project ON public.projects;
CREATE TRIGGER trg_inherit_documents_to_project
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.inherit_documents_to_project();

-- ── (5) leads.drive_folder_id, leads.drive_folder_url ────────────────────

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS drive_folder_id  TEXT NULL,
  ADD COLUMN IF NOT EXISTS drive_folder_url TEXT NULL;

COMMENT ON COLUMN public.leads.drive_folder_id  IS 'Google Drive folder ID for this customer journey. One folder per lead, inherited by proposals/projects via UI.';
COMMENT ON COLUMN public.leads.drive_folder_url IS 'Cached Drive webViewLink — surfaced in UI without an extra Drive API roundtrip.';

-- ── (6) Row-Level Security ────────────────────────────────────────────────

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user with access to the parent entity. Mirror the
-- existing RLS patterns: founder/marketing_manager/sales/design/PM have read.
-- Simplification for phase 1: all authenticated users can SELECT non-deleted
-- rows. Tighten in a follow-up spec when documents-RLS-by-entity-role is
-- audited end-to-end.

CREATE POLICY documents_select_all_auth ON public.documents
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

-- Insert: founder, marketing_manager, sales_engineer, design_engineer,
-- project_manager. Anyone in the sales/design/projects pipeline.
CREATE POLICY documents_insert_pipeline ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'marketing_manager', 'sales_engineer',
                       'designer', 'project_manager')
    )
  );

-- Update: same roles (e.g. tagging, soft-delete via deleted_at).
CREATE POLICY documents_update_pipeline ON public.documents
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'marketing_manager', 'sales_engineer',
                       'designer', 'project_manager')
    )
  );

-- Hard delete: founder only. Soft-delete (UPDATE deleted_at) covered by update policy.
CREATE POLICY documents_delete_founder ON public.documents
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'founder'
    )
  );

-- ── (7) GRANTs ────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;

COMMIT;
