-- Migration 018: Saved Views — HubSpot-style view management
--
-- Each view saves: entity_type, name, filters, columns, sort, visibility
-- Users can create private or shared views per entity type (leads, proposals, projects, contacts, companies)

BEGIN;

CREATE TABLE saved_views (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('leads', 'proposals', 'projects', 'contacts', 'companies')),
  name           TEXT NOT NULL,
  owner_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visibility     TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'everyone')),
  is_default     BOOLEAN NOT NULL DEFAULT false,
  columns        JSONB NOT NULL DEFAULT '[]',      -- ordered list of column keys to show
  filters        JSONB NOT NULL DEFAULT '{}',      -- filter configuration
  sort_column    TEXT,
  sort_direction TEXT DEFAULT 'desc' CHECK (sort_direction IN ('asc', 'desc')),
  quick_filters  JSONB NOT NULL DEFAULT '[]',      -- which properties appear as quick filter pills
  position       INTEGER NOT NULL DEFAULT 0,        -- tab ordering
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_views_entity ON saved_views(entity_type);
CREATE INDEX idx_saved_views_owner ON saved_views(owner_id);

CREATE TRIGGER set_saved_views_updated_at
  BEFORE UPDATE ON saved_views
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: users can read shared views + their own; can only write their own
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_views_read"
  ON saved_views FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR visibility = 'everyone'
      OR visibility = 'team'
    )
  );

CREATE POLICY "saved_views_insert"
  ON saved_views FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

CREATE POLICY "saved_views_update"
  ON saved_views FOR UPDATE
  USING (auth.uid() IS NOT NULL AND owner_id = auth.uid());

CREATE POLICY "saved_views_delete"
  ON saved_views FOR DELETE
  USING (auth.uid() IS NOT NULL AND owner_id = auth.uid());

-- ============================================================
-- Seed default views for each entity type
-- Use a dummy UUID for system views (owner_id won't match anyone but visibility=everyone makes them readable)
-- ============================================================

-- We'll seed these via the app layer instead, since we need real profile IDs.
-- Default views will be created on first visit if none exist.

COMMIT;
