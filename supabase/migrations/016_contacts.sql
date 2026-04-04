-- Migration 016: Contacts Database
-- Companies + Contacts (people) as separate entities
-- Linked to leads/proposals/projects via entity_contacts

BEGIN;

-- ============================================================
-- 1. companies table
-- ============================================================
CREATE TABLE companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  segment         customer_segment NOT NULL DEFAULT 'commercial',
  gstin           TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT DEFAULT 'Tamil Nadu',
  pincode         TEXT,
  website         TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_companies_name ON companies (name);
CREATE INDEX idx_companies_segment ON companies (segment);

CREATE TRIGGER set_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. contacts table (a person)
-- ============================================================
CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  designation     TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_name ON contacts (name);
CREATE INDEX idx_contacts_phone ON contacts (phone);
CREATE INDEX idx_contacts_email ON contacts (email);

CREATE TRIGGER set_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. contact_company_roles (person <-> company with role + dates)
-- ============================================================
CREATE TABLE contact_company_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_title      TEXT NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  started_at      DATE,
  ended_at        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ccr_contact ON contact_company_roles (contact_id);
CREATE INDEX idx_ccr_company ON contact_company_roles (company_id);

-- ============================================================
-- 4. entity_contacts (contact <-> lead/proposal/project)
-- ============================================================
CREATE TABLE entity_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('lead', 'proposal', 'project')),
  entity_id       UUID NOT NULL,
  role_label      TEXT,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, entity_type, entity_id)
);

CREATE INDEX idx_ec_entity ON entity_contacts (entity_type, entity_id);
CREATE INDEX idx_ec_contact ON entity_contacts (contact_id);

-- ============================================================
-- 5. Add company_id FK to leads and projects
-- ============================================================
ALTER TABLE leads ADD COLUMN company_id UUID REFERENCES companies(id);
ALTER TABLE projects ADD COLUMN company_id UUID REFERENCES companies(id);

CREATE INDEX idx_leads_company ON leads (company_id);
CREATE INDEX idx_projects_company ON projects (company_id);

-- ============================================================
-- 6. RLS policies
-- ============================================================

-- companies: all authenticated can read and write
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies_read"
  ON companies FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "companies_insert"
  ON companies FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "companies_update"
  ON companies FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- contacts: all authenticated can read and write
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_read"
  ON contacts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "contacts_insert"
  ON contacts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "contacts_update"
  ON contacts FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- contact_company_roles: all authenticated
ALTER TABLE contact_company_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ccr_read"
  ON contact_company_roles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "ccr_insert"
  ON contact_company_roles FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "ccr_update"
  ON contact_company_roles FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "ccr_delete"
  ON contact_company_roles FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- entity_contacts: all authenticated
ALTER TABLE entity_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ec_read"
  ON entity_contacts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "ec_insert"
  ON entity_contacts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "ec_delete"
  ON entity_contacts FOR DELETE
  USING (auth.uid() IS NOT NULL);

COMMIT;
