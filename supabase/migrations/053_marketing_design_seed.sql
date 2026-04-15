-- ============================================================================
-- Migration 053 - Marketing + Design Revamp (Seed + Data Migration)
-- ============================================================================
-- Apply AFTER 051 (enums) and 052 (schema/triggers/RLS).
--
-- Scope:
--   * Remap existing leads from 'proposal_sent' to 'detailed_proposal_sent'
--     (the new Path B explicit stage). Path A leads use 'quick_quote_sent'
--     but there are none today - everything that existed was manually
--     designed, so Path B is correct for migration.
--   * Seed default followup_sla_days / escalation_sla_days on existing
--     proposal_payment_schedule rows using milestone trigger type.
--   * Best-effort backfill of price_book_id on proposal_bom_lines +
--     project_boq_items using fuzzy tokenized matching against price_book
--     in the same category.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Remap lead_status 'proposal_sent' -> 'detailed_proposal_sent'
-- ----------------------------------------------------------------------------
-- The old `proposal_sent` stage was generic - it sat between site_survey_done
-- and negotiation but didn't distinguish quick quote from full design flow.
-- Under the revamp, that state is Path B's explicit post-design "detailed
-- proposal sent" stage. Path A leads would have never entered `proposal_sent`
-- (they didn't exist yet), so this is a safe 1:1 remap.

UPDATE leads
SET status = 'detailed_proposal_sent',
    status_updated_at = now()
WHERE status = 'proposal_sent'
  AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Seed per-milestone followup/escalation SLAs on existing schedules
-- ----------------------------------------------------------------------------
-- Mapping per D8 of the plan:
--   on_acceptance         -> 3 followup / 4 escalation
--   on_material_delivery  -> 5 followup / 9 escalation
--   mid_installation      -> 7 followup / 7 escalation
--   on_commissioning      -> 7 followup / 7 escalation
--   after_net_metering    -> 14 followup / 14 escalation
--   retention_period_end  -> 30 followup / 30 escalation
--   custom                -> 7 followup / 7 escalation (default already set)

UPDATE proposal_payment_schedule
SET followup_sla_days = CASE due_trigger
    WHEN 'on_acceptance'        THEN 3
    WHEN 'on_material_delivery' THEN 5
    WHEN 'mid_installation'     THEN 7
    WHEN 'on_commissioning'     THEN 7
    WHEN 'after_net_metering'   THEN 14
    WHEN 'retention_period_end' THEN 30
    ELSE 7
  END,
  escalation_sla_days = CASE due_trigger
    WHEN 'on_acceptance'        THEN 4
    WHEN 'on_material_delivery' THEN 9
    WHEN 'mid_installation'     THEN 7
    WHEN 'on_commissioning'     THEN 7
    WHEN 'after_net_metering'   THEN 14
    WHEN 'retention_period_end' THEN 30
    ELSE 7
  END
WHERE TRUE;

-- ----------------------------------------------------------------------------
-- 3. Fuzzy-match price_book_id on existing proposal_bom_lines
-- ----------------------------------------------------------------------------
-- Strategy: within the same category, pick the price_book row whose
-- description has the highest token overlap (Jaccard-ish) with the BOM line.
-- Only applied to rows that don't already have a price_book_id.

WITH candidates AS (
  SELECT
    bom.id AS bom_id,
    pb.id  AS price_book_id,
    -- Token overlap score: count of common words divided by max word count
    (
      cardinality(
        (
          SELECT array_agg(w)
          FROM unnest(string_to_array(lower(regexp_replace(bom.item_description, '[^a-z0-9 ]', ' ', 'g')), ' ')) AS w
          WHERE w = ANY (string_to_array(lower(regexp_replace(pb.item_description, '[^a-z0-9 ]', ' ', 'g')), ' '))
            AND length(w) > 2
        )
      )::numeric
      /
      GREATEST(
        cardinality(string_to_array(lower(regexp_replace(bom.item_description, '[^a-z0-9 ]', ' ', 'g')), ' ')),
        cardinality(string_to_array(lower(regexp_replace(pb.item_description, '[^a-z0-9 ]', ' ', 'g')), ' ')),
        1
      )
    ) AS score
  FROM proposal_bom_lines bom
  JOIN price_book pb
    ON pb.item_category = bom.item_category
   AND pb.is_active = TRUE
   AND pb.deleted_at IS NULL
  WHERE bom.price_book_id IS NULL
),
best_candidates AS (
  SELECT DISTINCT ON (bom_id) bom_id, price_book_id, score
  FROM candidates
  WHERE score >= 0.25
  ORDER BY bom_id, score DESC
)
UPDATE proposal_bom_lines bom
SET price_book_id = bc.price_book_id
FROM best_candidates bc
WHERE bom.id = bc.bom_id
  AND bom.price_book_id IS NULL;

-- ----------------------------------------------------------------------------
-- 4. Fuzzy-match price_book_id on existing project_boq_items
-- ----------------------------------------------------------------------------
-- Same strategy. Where project_boq_items has a bom_line_id, we can just copy
-- the price_book_id from the parent proposal_bom_lines row - that's more
-- accurate than re-fuzzy-matching.

UPDATE project_boq_items boq
SET price_book_id = bom.price_book_id
FROM proposal_bom_lines bom
WHERE boq.bom_line_id = bom.id
  AND boq.price_book_id IS NULL
  AND bom.price_book_id IS NOT NULL;

-- For BOQ rows without a bom_line_id (orphans or pre-linked data), fuzzy match
WITH candidates AS (
  SELECT
    boq.id AS boq_id,
    pb.id  AS price_book_id,
    (
      cardinality(
        (
          SELECT array_agg(w)
          FROM unnest(string_to_array(lower(regexp_replace(boq.item_description, '[^a-z0-9 ]', ' ', 'g')), ' ')) AS w
          WHERE w = ANY (string_to_array(lower(regexp_replace(pb.item_description, '[^a-z0-9 ]', ' ', 'g')), ' '))
            AND length(w) > 2
        )
      )::numeric
      /
      GREATEST(
        cardinality(string_to_array(lower(regexp_replace(boq.item_description, '[^a-z0-9 ]', ' ', 'g')), ' ')),
        cardinality(string_to_array(lower(regexp_replace(pb.item_description, '[^a-z0-9 ]', ' ', 'g')), ' ')),
        1
      )
    ) AS score
  FROM project_boq_items boq
  JOIN price_book pb
    ON pb.item_category = boq.item_category
   AND pb.is_active = TRUE
   AND pb.deleted_at IS NULL
  WHERE boq.price_book_id IS NULL
),
best_candidates AS (
  SELECT DISTINCT ON (boq_id) boq_id, price_book_id, score
  FROM candidates
  WHERE score >= 0.25
  ORDER BY boq_id, score DESC
)
UPDATE project_boq_items boq
SET price_book_id = bc.price_book_id
FROM best_candidates bc
WHERE boq.id = bc.boq_id
  AND boq.price_book_id IS NULL;

-- ============================================================================
-- END OF MIGRATION 053
-- ============================================================================
