-- Migration 127: Milestone photos + Customer outreach queue
-- E9: photo gates with GPS verification (haversine validation in SQL)
-- E10: AI-generated quarterly customer check-in outreach queue

BEGIN;

-- ── E9: milestone_photos ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS milestone_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone TEXT NOT NULL CHECK (milestone IN (
    'panel_install_start',
    'panel_install_complete',
    'inverter_install',
    'commissioning',
    'post_commissioning'
  )),
  uploaded_by UUID REFERENCES profiles(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  storage_path TEXT NOT NULL,
  -- GPS from browser/mobile geolocation API
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  -- From image EXIF if available
  exif_timestamp TIMESTAMPTZ,
  -- Validation result: was the photo taken within 100m of site?
  location_verified BOOLEAN,
  location_distance_m NUMERIC(10, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestone_photos_project
  ON milestone_photos (project_id, milestone);
CREATE INDEX IF NOT EXISTS idx_milestone_photos_uploaded_at
  ON milestone_photos (uploaded_at DESC);

ALTER TABLE milestone_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY milestone_photos_read ON milestone_photos
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('founder', 'project_manager', 'site_supervisor', 'om_technician')
    )
  );

CREATE POLICY milestone_photos_insert ON milestone_photos
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );

COMMENT ON TABLE milestone_photos IS
  'Photos uploaded at project installation milestones. GPS coordinates validated against site location via haversine formula to prevent off-site photo uploads.';

-- ── Haversine distance function (meters) ─────────────────────────────

CREATE OR REPLACE FUNCTION haversine_distance_m(
  lat1 NUMERIC, lon1 NUMERIC,
  lat2 NUMERIC, lon2 NUMERIC
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    2 * 6371000 * asin(
      sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) *
        power(sin(radians(lon2 - lon1) / 2), 2)
      )
    )
$$;

COMMENT ON FUNCTION haversine_distance_m IS
  'Returns distance in meters between two lat/lon coordinates using the haversine formula. Used for milestone photo GPS verification (100m gate).';

-- ── E10: customer_outreach_queue ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_outreach_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkin_due DATE NOT NULL,
  days_since_commissioning INTEGER NOT NULL,
  ai_message TEXT,
  message_generated_at TIMESTAMPTZ,
  whatsapp_sent_at TIMESTAMPTZ,
  customer_response TEXT,
  response_received_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'message_generated', 'sent', 'responded', 'no_response', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_outreach_status
  ON customer_outreach_queue (status, checkin_due)
  WHERE status IN ('pending', 'message_generated');
CREATE INDEX IF NOT EXISTS idx_customer_outreach_project
  ON customer_outreach_queue (project_id);

ALTER TABLE customer_outreach_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_outreach_read ON customer_outreach_queue
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('founder', 'om_technician', 'project_manager', 'sales_engineer')
    )
  );

CREATE POLICY customer_outreach_service ON customer_outreach_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE customer_outreach_queue IS
  'AI-generated quarterly customer check-in outreach. The weekly cron finds projects at 90/180/270 days post-commissioning, generates a personalized Claude message, and enqueues via n8n event bus for WhatsApp delivery.';

COMMIT;
