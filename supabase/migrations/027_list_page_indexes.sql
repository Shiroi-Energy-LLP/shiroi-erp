-- Migration 027: Add created_at indexes for paginated list pages
-- Fixes timeout on /projects, /leads, /contacts, /whatsapp-import
-- Same pattern as proposals fix (commit 4bdb489)

-- Projects: default sort is created_at DESC
CREATE INDEX IF NOT EXISTS idx_projects_created_at
  ON projects(created_at DESC);

-- Leads: default sort is created_at DESC
CREATE INDEX IF NOT EXISTS idx_leads_created_at
  ON leads(created_at DESC);

-- Contacts: default sort is created_at DESC
CREATE INDEX IF NOT EXISTS idx_contacts_created_at
  ON contacts(created_at DESC);

-- WhatsApp import queue: sorts by message_timestamp DESC
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_timestamp
  ON whatsapp_import_queue(message_timestamp DESC);
