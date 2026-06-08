-- Migration 168 — allow sales task types on tasks.category
-- Adds call / site_visit / document to the existing CHECK so manually-added
-- lead tasks carry a meaningful Type (was blank because no category was saved).
BEGIN;
ALTER TABLE tasks DROP CONSTRAINT tasks_category_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_category_check CHECK (
  category IS NULL OR category = ANY (ARRAY[
    'advance_payment','material_delivery','structure_installation','panel_installation',
    'electrical_work','testing_commissioning','civil_work','net_metering','handover',
    'general','payment_followup','payment_escalation','lead_followup',
    'call','site_visit','document'
  ])
);
COMMIT;
