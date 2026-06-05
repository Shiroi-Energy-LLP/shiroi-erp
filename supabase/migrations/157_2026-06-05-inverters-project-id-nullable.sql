-- Migration 157: Allow inverters.project_id to be NULL.
--
-- Why:
--   When seeding inverters from a vendor monitoring portal (Sungrow,
--   Growatt, etc.) we sometimes encounter plants whose customer name
--   cannot be confidently matched to an existing Shiroi project — e.g.
--   informal single-word labels ("Atish", "Dhruv Solar") or unfamiliar
--   abbreviations ("MSM Unit II"). Forcing project_id to be NOT NULL
--   either blocks the seed entirely or forces us to fabricate
--   placeholder projects that pollute the projects table with rows
--   that lack a real proposal, lead, contract value, etc.
--
--   The pragmatic alternative is to let an inverter exist in
--   "monitoring-only" state until an O&M technician maps it to a real
--   project via the UI. Telemetry collection does not depend on
--   project linkage; the Edge Function poller only touches project_id
--   when looking up per-customer Growatt credentials, and that path
--   already guards against the column being null.
--
-- Effect:
--   - Drop NOT NULL on inverters.project_id.
--   - Keep the FK + ON DELETE RESTRICT (still safe: a project cannot
--     be deleted while inverters reference it; the inverter must
--     be re-pointed or its project_id cleared first).
--   - idx_inverters_project continues to work — Postgres still indexes
--     non-NULL values; rows with project_id IS NULL simply do not
--     appear in lookups by project.

BEGIN;

ALTER TABLE inverters
  ALTER COLUMN project_id DROP NOT NULL;

COMMENT ON COLUMN inverters.project_id IS
  'FK → projects.id. Nullable because vendor monitoring portals may surface plants before a Shiroi project record exists for them. O&M re-assigns project_id once the customer mapping is confirmed.';

COMMIT;
