-- Migration 073: bug_reports table + profiles founder-admin RLS policy
-- Part of the User Settings Page feature.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Enum types
-- ─────────────────────────────────────────────────────────────────────────
CREATE TYPE bug_report_category AS ENUM ('bug', 'feature_request', 'question', 'other');
CREATE TYPE bug_report_severity AS ENUM ('low', 'medium', 'high');
CREATE TYPE bug_report_status   AS ENUM ('open', 'in_progress', 'resolved');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. bug_reports table
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE bug_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  category    bug_report_category NOT NULL,
  severity    bug_report_severity NOT NULL,
  description TEXT NOT NULL,
  page_url    TEXT,
  user_agent  TEXT,
  status      bug_report_status NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_bug_reports_user_created    ON bug_reports (user_id, created_at DESC);
CREATE INDEX idx_bug_reports_status_created  ON bug_reports (status,  created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. bug_reports RLS
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- Users insert their own reports.
CREATE POLICY "bug_reports_insert_own"
  ON bug_reports FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users see their own; founders see everyone's.
CREATE POLICY "bug_reports_select_own_or_founder"
  ON bug_reports FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'founder'
    )
  );

-- Only founders can update (status transitions + resolved_at).
CREATE POLICY "bug_reports_update_founder_only"
  ON bug_reports FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'founder'
    )
  );

-- (No DELETE policy — reports are append-only from the app.)

-- ─────────────────────────────────────────────────────────────────────────
-- 4. profiles — additive policy so founders can UPDATE role + is_active
--    on any profile row. Existing self-update policies remain untouched.
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY "profiles_update_any_by_founder"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'founder'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Grants (keep consistent with existing tables)
-- ─────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT         ON bug_reports TO authenticated;
GRANT UPDATE                 ON bug_reports TO authenticated;
