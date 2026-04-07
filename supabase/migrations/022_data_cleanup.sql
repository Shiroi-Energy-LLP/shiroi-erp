-- Migration 022: Data Quality Cleanup + Processing Infrastructure
-- Applied: (pending)
-- Purpose:
--   1. Soft-delete 25 junk leads (Google Drive folder names with 14-digit fake phones)
--   2. Flag 76 real leads with placeholder phones (0000000xxx)
--   3. Deterministic fixes: project contract values, PO totals, converted flags
--   4. Create processing_jobs table for AI extraction pipeline
--   5. Create photo_tags table for AI photo tagging

-- ═══════════════════════════════════════════════════════════════════
-- 1. Soft-delete 25 junk leads (Google Drive folder names)
-- These have 14-digit phones (8888xxx / 9999xxx) and names like
-- "Shiroi Format", "Delivery challan", "PO", "catlog 2024"
-- None have linked projects. All are safely reversible via deleted_at.
-- ═══════════════════════════════════════════════════════════════════

-- First, remove entity_contacts links for these junk leads
DELETE FROM entity_contacts
WHERE entity_type = 'lead'
  AND entity_id IN (
    SELECT id FROM leads
    WHERE length(phone) > 10 AND phone ~ '^(8888|9999)'
  );

-- Soft-delete the junk leads
UPDATE leads
SET deleted_at = now(),
    notes = COALESCE(notes, '') || E'\n[DATA_CLEANUP 2026-04-07] Soft-deleted: Google Drive folder name imported as lead. Not a real customer.'
WHERE length(phone) > 10 AND phone ~ '^(8888|9999)';

-- Soft-delete orphaned proposals linked to junk leads (none have projects)
UPDATE proposals
SET status = 'expired'
WHERE lead_id IN (
    SELECT id FROM leads
    WHERE deleted_at IS NOT NULL
      AND length(phone) > 10 AND phone ~ '^(8888|9999)'
);

-- ═══════════════════════════════════════════════════════════════════
-- 2. Flag 76 real leads with placeholder phones (0000000xxx)
-- These ARE real customers with real projects — just missing phone numbers.
-- ═══════════════════════════════════════════════════════════════════

UPDATE leads
SET notes = COALESCE(notes, '') || E'\n[NEEDS_PHONE] Placeholder phone from Google Drive migration. Real customer — needs manual phone update.'
WHERE phone ~ '^0{7,}'
  AND deleted_at IS NULL
  AND (notes IS NULL OR notes NOT LIKE '%NEEDS_PHONE%');

-- ═══════════════════════════════════════════════════════════════════
-- 3. Deterministic fixes
-- ═══════════════════════════════════════════════════════════════════

-- 3a. Fill project contracted_value from linked proposal (111 projects missing)
UPDATE projects p
SET contracted_value = pr.total_after_discount,
    updated_at = now()
FROM proposals pr
WHERE p.proposal_id = pr.id
  AND (p.contracted_value IS NULL OR p.contracted_value = 0)
  AND pr.total_after_discount > 0;

-- 3b. Fill PO totals from line items (15 POs missing)
UPDATE purchase_orders po
SET total_amount = sub.line_total,
    updated_at = now()
FROM (
  SELECT purchase_order_id, COALESCE(SUM(total_price), 0) as line_total
  FROM purchase_order_items
  GROUP BY purchase_order_id
) sub
WHERE po.id = sub.purchase_order_id
  AND (po.total_amount IS NULL OR po.total_amount = 0)
  AND sub.line_total > 0;

-- 3c. Fix converted_to_project flag consistency
UPDATE leads
SET converted_to_project = true,
    updated_at = now()
WHERE status = 'converted'
  AND (converted_to_project IS NULL OR converted_to_project = false);

-- ═══════════════════════════════════════════════════════════════════
-- 4. Processing jobs table (tracks AI extraction pipeline progress)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  detected_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','skipped')),
  parse_method TEXT CHECK (parse_method IN (
    'xlsx_deterministic','docx_text','pdf_text','pptx_text',
    'ai_extraction','ai_vision','mime_fix_only','skipped'
  )),
  entity_type TEXT,
  entity_id UUID,
  extracted_data JSONB,
  confidence_score NUMERIC(3,2),
  error_message TEXT,
  tokens_used INTEGER DEFAULT 0,
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(bucket_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_entity ON processing_jobs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_method ON processing_jobs(parse_method);

-- Enable RLS
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- Only founder can see processing jobs
CREATE POLICY "Founder full access to processing_jobs"
  ON processing_jobs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'founder')
  );

-- ═══════════════════════════════════════════════════════════════════
-- 5. Photo tags table (AI-generated tags for searchable portfolio)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS photo_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_photo_id UUID NOT NULL REFERENCES site_photos(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  structure_type TEXT,
  roof_type TEXT,
  panel_orientation TEXT,
  building_type TEXT,
  segment TEXT,
  estimated_panel_count INTEGER,
  caption TEXT,
  photo_quality TEXT,
  ai_model TEXT DEFAULT 'claude-sonnet-4-20250514',
  confidence_score NUMERIC(3,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_tags_structure ON photo_tags(structure_type);
CREATE INDEX IF NOT EXISTS idx_photo_tags_segment ON photo_tags(segment);
CREATE INDEX IF NOT EXISTS idx_photo_tags_content ON photo_tags(content_type);
CREATE INDEX IF NOT EXISTS idx_photo_tags_building ON photo_tags(building_type);
CREATE INDEX IF NOT EXISTS idx_photo_tags_photo ON photo_tags(site_photo_id);

-- Enable RLS
ALTER TABLE photo_tags ENABLE ROW LEVEL SECURITY;

-- Read access for relevant roles
CREATE POLICY "Staff read access to photo_tags"
  ON photo_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('founder', 'sales_engineer', 'project_manager', 'designer', 'site_supervisor')
    )
  );

-- Only founder can manage photo tags
CREATE POLICY "Founder manage photo_tags"
  ON photo_tags FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'founder')
  );
