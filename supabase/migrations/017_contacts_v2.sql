-- Migration 017: Contacts V2 — HubSpot-inspired redesign
--
-- Changes:
-- 1. Clears all bad backfill data (names were project names, not person names)
-- 2. Adds first_name/last_name, lifecycle_stage, owner_id, source to contacts
-- 3. Adds pan, industry, company_size, owner_id to companies
-- 4. Creates activities + activity_associations tables (engagement timeline)
-- 5. Auto-populates contacts.name from first_name + last_name via trigger

BEGIN;

-- ============================================================
-- 1. Clear ALL backfilled data (it was wrong)
--    MUST clear FK references BEFORE deleting parent rows
-- ============================================================
UPDATE leads SET company_id = NULL WHERE company_id IS NOT NULL;
UPDATE projects SET company_id = NULL WHERE company_id IS NOT NULL;
DELETE FROM entity_contacts;
DELETE FROM contact_company_roles;
DELETE FROM contacts;
DELETE FROM companies;

-- ============================================================
-- 2. Enhance contacts table
-- ============================================================
ALTER TABLE contacts ADD COLUMN first_name TEXT;
ALTER TABLE contacts ADD COLUMN last_name TEXT;
ALTER TABLE contacts ADD COLUMN secondary_phone TEXT;
ALTER TABLE contacts ADD COLUMN lifecycle_stage TEXT DEFAULT 'lead'
  CHECK (lifecycle_stage IN ('subscriber', 'lead', 'opportunity', 'customer', 'evangelist'));
ALTER TABLE contacts ADD COLUMN owner_id UUID REFERENCES profiles(id);
ALTER TABLE contacts ADD COLUMN source TEXT;

-- Auto-set display name from first_name + last_name
CREATE OR REPLACE FUNCTION set_contact_display_name()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.first_name IS NOT NULL THEN
    NEW.name = TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contact_display_name
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_contact_display_name();

-- ============================================================
-- 3. Enhance companies table
-- ============================================================
ALTER TABLE companies ADD COLUMN pan TEXT;
ALTER TABLE companies ADD COLUMN industry TEXT;
ALTER TABLE companies ADD COLUMN company_size TEXT
  CHECK (company_size IN ('small', 'medium', 'large'));
ALTER TABLE companies ADD COLUMN owner_id UUID REFERENCES profiles(id);

-- ============================================================
-- 4. Activities table (HubSpot-style engagements)
-- ============================================================
CREATE TABLE activities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type    TEXT NOT NULL CHECK (activity_type IN (
    'note', 'call', 'email', 'meeting', 'site_visit', 'whatsapp', 'task', 'status_change'
  )),
  title            TEXT,
  body             TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_minutes INTEGER,
  owner_id         UUID REFERENCES profiles(id),
  metadata         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activities_type ON activities(activity_type);
CREATE INDEX idx_activities_occurred_at ON activities(occurred_at DESC);
CREATE INDEX idx_activities_owner ON activities(owner_id);

CREATE TRIGGER set_activities_updated_at
  BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 5. Activity associations (link activity to any entity)
-- ============================================================
CREATE TABLE activity_associations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id    UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  entity_type    TEXT NOT NULL CHECK (entity_type IN (
    'contact', 'company', 'lead', 'proposal', 'project'
  )),
  entity_id      UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(activity_id, entity_type, entity_id)
);

CREATE INDEX idx_activity_assoc_entity ON activity_associations(entity_type, entity_id);
CREATE INDEX idx_activity_assoc_activity ON activity_associations(activity_id);

-- ============================================================
-- 6. RLS on new tables
-- ============================================================

-- activities: all authenticated can CRUD
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities_read"
  ON activities FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "activities_insert"
  ON activities FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "activities_update"
  ON activities FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "activities_delete"
  ON activities FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- activity_associations: all authenticated can CRD
ALTER TABLE activity_associations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_assoc_read"
  ON activity_associations FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "activity_assoc_insert"
  ON activity_associations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "activity_assoc_delete"
  ON activity_associations FOR DELETE
  USING (auth.uid() IS NOT NULL);

COMMIT;
