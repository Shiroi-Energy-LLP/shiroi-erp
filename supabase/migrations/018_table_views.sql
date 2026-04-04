-- Migration 018: Table Views — HubSpot-style saved views for all list pages
--
-- Stores per-user saved views (filter + column + sort configurations)
-- for leads, proposals, projects, contacts, companies, etc.

BEGIN;

CREATE TABLE table_views (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who owns this view
  owner_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Which entity page this view is for
  entity_type    TEXT NOT NULL CHECK (entity_type IN (
    'leads', 'proposals', 'projects', 'contacts', 'companies',
    'vendors', 'purchase_orders', 'invoices', 'tasks'
  )),
  -- View config
  name           TEXT NOT NULL,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  visibility     TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'team', 'everyone')),
  -- The actual saved configuration (JSON)
  columns        JSONB NOT NULL DEFAULT '[]',      -- ordered array of column keys
  filters        JSONB NOT NULL DEFAULT '{}',       -- filter key-value pairs
  sort_column    TEXT,
  sort_direction TEXT DEFAULT 'desc' CHECK (sort_direction IN ('asc', 'desc')),
  quick_filters  JSONB NOT NULL DEFAULT '[]',      -- array of property keys shown as quick filters
  page_size      INTEGER NOT NULL DEFAULT 50,
  -- Metadata
  position       INTEGER NOT NULL DEFAULT 0,        -- tab order
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_table_views_owner ON table_views(owner_id);
CREATE INDEX idx_table_views_entity ON table_views(entity_type);
CREATE INDEX idx_table_views_visibility ON table_views(visibility);

CREATE TRIGGER set_table_views_updated_at
  BEFORE UPDATE ON table_views
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: users can see their own views + views with visibility 'everyone'
ALTER TABLE table_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "table_views_read"
  ON table_views FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (owner_id = auth.uid() OR visibility = 'everyone')
  );

CREATE POLICY "table_views_insert"
  ON table_views FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

CREATE POLICY "table_views_update"
  ON table_views FOR UPDATE
  USING (auth.uid() IS NOT NULL AND owner_id = auth.uid());

CREATE POLICY "table_views_delete"
  ON table_views FOR DELETE
  USING (auth.uid() IS NOT NULL AND owner_id = auth.uid());

-- ============================================================
-- Seed default views for leads (visible to everyone)
-- We'll use a placeholder owner_id — in production, replace with the founder's profile ID
-- For now, these are inserted by the backfill script
-- ============================================================

COMMIT;
