-- Make project_id nullable on site_photos (allow photos linked to leads without projects)
ALTER TABLE site_photos ALTER COLUMN project_id DROP NOT NULL;

-- Add lead_id for photos linked directly to leads
ALTER TABLE site_photos ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id);

-- Ensure at least one of project_id or lead_id is set
ALTER TABLE site_photos ADD CONSTRAINT site_photos_has_entity
  CHECK (project_id IS NOT NULL OR lead_id IS NOT NULL);

COMMENT ON COLUMN site_photos.lead_id IS 'Lead ID for photos not yet linked to a project (pre-conversion leads)';
