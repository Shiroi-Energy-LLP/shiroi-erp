-- Migration 140 — 2026-05-30 performance review (safe additive)
-- ============================================================
-- Two missing indexes flagged by `docs/reviews/sections/2026-05-30-performance.md`
-- (findings #18 and #19). Both are safe additive index creations — no data
-- changes, no behaviour changes, no app-side coordination required.

-- Finding #18 — inverter_poll_failures lacks an `inverter_id` index.
-- The existing `idx_inverter_poll_failures_recent` indexes only `attempted_at DESC`
-- (used by the "recent failures across all inverters" footer query). The per-inverter
-- "show failures for this specific inverter" query (used by /om/inverters/[id]) does
-- a full scan today. As Phase 8 polling ramps up to 5-minute cadence across all
-- connected inverters, this table will grow ~10K rows/day; the per-inverter query
-- needs its own index.
CREATE INDEX IF NOT EXISTS idx_inverter_poll_failures_inverter_id
  ON public.inverter_poll_failures(inverter_id);

-- Finding #19 — tasks(category) lacks an index.
-- The `task-suggestion-scanner` daily cron filters tasks by (entity_type, entity_id,
-- category) when checking whether an AI-suggested task already exists. Composite
-- index on (entity_type, entity_id) likely exists for the main listing, but the
-- category filter falls through to a full scan of matched rows. Adding a standalone
-- category index lets the planner short-circuit when category is the most selective
-- filter (which it usually is — `[AI suggested]` task category is rare).
CREATE INDEX IF NOT EXISTS idx_tasks_category
  ON public.tasks(category)
  WHERE deleted_at IS NULL;
