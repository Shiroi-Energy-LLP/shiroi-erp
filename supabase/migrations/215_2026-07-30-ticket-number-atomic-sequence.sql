-- ============================================================================
-- 215 — Service ticket numbering: one atomic, sequence-backed generator
-- Date: 2026-07-30
--
-- BUG: "duplicate key value violates unique constraint
--       om_service_tickets_ticket_number_key" when creating a service ticket.
--
-- ROOT CAUSE — four independent ticket_number generators, three of them broken,
-- poisoning each other:
--
--   1. create_ir_test_ticket() / create_ir_test_ticket_om() (mig 006c) built the
--      number as 'TKT-' || project_number || '-IR-' || YYYYMMDD. That produced the
--      real row 'TKT-SHIROI/PROJ/2025-26/0036-IR-20260411'. It also carries no
--      serial, so two sub-0.5 MOhm IR results for one project on one day collide —
--      and because these are triggers, the collision aborts the parent
--      commissioning-report / visit-report save.
--
--   2. createServiceTicket() (TS) derived the next number with
--      ticket_number.split('-').pop() + 1. On the row above that yields
--      20260411 + 1 = 'TKT-20260412'. Every ticket since counted up a date-shaped
--      integer (TKT-20260412 .. TKT-20260426) instead of TKT-0002, TKT-0003, ...
--      It also seeded from ORDER BY created_at DESC LIMIT 1, which is wrong twice
--      over: back-dated tickets (mig-era feature, stamped at a fixed 06:30:00Z)
--      mean newest-by-created_at is not highest-by-number, and two tickets
--      back-dated to the same day share an identical created_at — a tie under
--      LIMIT 1 is non-deterministic, so the generator re-emits an existing number.
--      That tie is the immediate cause of the reported error.
--
--   3. create_service_tickets_from_inverter_alerts() (mig 050) used
--      CAST(SPLIT_PART(ticket_number, '-', 2) AS INT) over WHERE ticket_number
--      LIKE 'TKT-%'. On the legacy row SPLIT_PART returns 'SHIROI/PROJ/2025', so
--      the cast raises invalid_text_representation: inverter auto-ticketing has
--      been throwing on every run.
--
-- FIX: a single sequence-backed next_ticket_number(), installed as the column
-- DEFAULT so no caller can get numbering wrong — every path simply omits
-- ticket_number. Atomic (nextval), so concurrent creates cannot collide, and
-- back-dating no longer participates in numbering at all.
--
-- Existing tickets are renumbered chronologically to TKT-0001..TKT-0015
-- (Vivek's call, 2026-07-30). Numbers already sent out via WhatsApp/n8n and
-- indexed in the RAG store will not resolve to the same ticket afterwards;
-- re-run scripts/rag/ingest-service-tickets.ts to refresh the index.
--
-- Applied: dev only. Prod is deferred until Vivek green-lights a prod window.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Sequence + generator (pattern: next_boi_po_number(), mig 210)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS om_ticket_number_seq;

CREATE OR REPLACE FUNCTION public.next_ticket_number() RETURNS TEXT
LANGUAGE sql
SET search_path = public
AS $$
  SELECT 'TKT-' || lpad(nextval('om_ticket_number_seq')::TEXT, 4, '0');
$$;

REVOKE ALL ON FUNCTION public.next_ticket_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_ticket_number() TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE om_ticket_number_seq TO authenticated, service_role;

COMMENT ON FUNCTION public.next_ticket_number() IS
  'Atomic service-ticket number (TKT-0001 style). Installed as the DEFAULT on om_service_tickets.ticket_number — callers must omit the column, never compute it. Numbers are never reused (a deleted ticket leaves a gap, deliberate).';

-- ---------------------------------------------------------------------------
-- B. Renumber existing tickets chronologically -> TKT-0001, TKT-0002, ...
--    Two passes: the unique index is non-deferrable, so park the old values
--    out of the way first rather than relying on per-row update ordering.
--    updated_at is preserved — a renumber is not a user edit.
-- ---------------------------------------------------------------------------
ALTER TABLE om_service_tickets DISABLE TRIGGER om_service_tickets_updated_at;

UPDATE om_service_tickets SET ticket_number = 'TMP-' || id::TEXT;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
  FROM om_service_tickets
)
UPDATE om_service_tickets t
SET ticket_number = 'TKT-' || lpad(numbered.n::TEXT, 4, '0')
FROM numbered
WHERE numbered.id = t.id;

ALTER TABLE om_service_tickets ENABLE TRIGGER om_service_tickets_updated_at;

-- ---------------------------------------------------------------------------
-- C. Seed the sequence above the highest existing conforming number
-- ---------------------------------------------------------------------------
SELECT setval(
  'om_ticket_number_seq',
  COALESCE(
    (SELECT MAX((regexp_match(ticket_number, '^TKT-(\d+)$'))[1]::INT)
     FROM om_service_tickets
     WHERE ticket_number ~ '^TKT-\d+$'),
    0
  ) + 1,
  false
);

-- ---------------------------------------------------------------------------
-- D. Make correct numbering the default — the whole point of the fix
-- ---------------------------------------------------------------------------
ALTER TABLE om_service_tickets
  ALTER COLUMN ticket_number SET DEFAULT next_ticket_number();

COMMENT ON COLUMN om_service_tickets.ticket_number IS
  'TKT-0001 style serial. Generated by the column DEFAULT (next_ticket_number()). Never pass this from application code — mig 215 removed four hand-rolled generators that collided with each other.';

-- ---------------------------------------------------------------------------
-- E. Rewrite the three SQL generators to let the DEFAULT do the work
-- ---------------------------------------------------------------------------

-- E1. IR test below 0.5 MOhm on a commissioning report (was mig 006c)
CREATE OR REPLACE FUNCTION public.create_ir_test_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only trigger when IR test result is below threshold
  IF NEW.insulation_resistance_mohm IS NOT NULL
    AND NEW.insulation_resistance_mohm < 0.5
    AND (OLD IS NULL OR OLD.insulation_resistance_mohm IS NULL
         OR OLD.insulation_resistance_mohm >= 0.5)
  THEN
    -- ticket_number omitted: supplied by the column DEFAULT (mig 215). The old
    -- 'TKT-<project>-IR-<date>' scheme carried no serial, so a second failing
    -- reading on the same day aborted this INSERT and with it the parent save.
    INSERT INTO om_service_tickets (
      project_id,
      issue_type,
      severity,
      title,
      description,
      status,
      sla_hours,
      sla_deadline,
      auto_created_ir_test
    ) VALUES (
      NEW.project_id,
      'wiring_issue',
      'critical',
      'IR Test Below Minimum — Immediate Inspection Required',
      'Insulation resistance test result of ' ||
        NEW.insulation_resistance_mohm || ' MΩ is below the 0.5 MΩ minimum. '
        'Immediate electrical inspection required before system can operate.',
      'open',
      4,
      -- Critical: 4-hour SLA
      NOW() + INTERVAL '4 hours',
      TRUE
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- E2. Same check on an O&M visit report (was mig 006c)
CREATE OR REPLACE FUNCTION public.create_ir_test_ticket_om()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.ir_test_result_mohm IS NOT NULL
    AND NEW.ir_test_result_mohm < 0.5
    AND (OLD IS NULL OR OLD.ir_test_result_mohm IS NULL
         OR OLD.ir_test_result_mohm >= 0.5)
  THEN
    -- ticket_number omitted: supplied by the column DEFAULT (mig 215).
    INSERT INTO om_service_tickets (
      project_id,
      contract_id,
      visit_report_id,
      issue_type,
      severity,
      title,
      description,
      status,
      sla_hours,
      sla_deadline,
      auto_created_ir_test
    ) VALUES (
      NEW.project_id,
      NEW.contract_id,
      NEW.id,
      'wiring_issue',
      'critical',
      'IR Test Below Minimum During O&M Visit',
      'Insulation resistance test result of ' ||
        NEW.ir_test_result_mohm || ' MΩ is below the 0.5 MΩ minimum. '
        'Immediate electrical inspection required.',
      'open',
      4,
      NOW() + INTERVAL '4 hours',
      TRUE
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- E3. Daily inverter-alert sweep (was mig 050) — the CAST(...AS INT) here was
--     raising invalid_text_representation on the legacy number, so this whole
--     function failed every run.
CREATE OR REPLACE FUNCTION public.create_service_tickets_from_inverter_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  tickets_created INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      i.id AS inverter_id,
      i.serial_number,
      i.brand,
      i.project_id,
      d.performance_ratio,
      d.offline_minutes,
      d.fault_minutes
    FROM inverter_readings_daily d
    JOIN inverters i ON i.id = d.inverter_id
    WHERE d.day = (NOW() - interval '1 day')::date
      AND i.current_status NOT IN ('decommissioned')
      AND (
        (d.performance_ratio IS NOT NULL AND d.performance_ratio < 0.70)
        OR d.offline_minutes > 60
        OR d.fault_minutes > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM om_service_tickets t
        WHERE t.project_id = i.project_id
          AND t.created_at > NOW() - interval '7 days'
          AND t.status NOT IN ('closed', 'resolved')
          AND t.title LIKE '%' || i.serial_number || '%'
      )
  LOOP
    -- ticket_number omitted: supplied by the column DEFAULT (mig 215).
    INSERT INTO om_service_tickets (
      project_id,
      title,
      description,
      issue_type,
      severity,
      status,
      sla_hours
    ) VALUES (
      r.project_id,
      'Inverter alert: ' || r.serial_number,
      format(
        'Auto-detected from daily rollup. Performance ratio: %s. Offline minutes: %s. Fault minutes: %s. Brand: %s.',
        COALESCE(r.performance_ratio::text, 'n/a'),
        r.offline_minutes,
        r.fault_minutes,
        r.brand
      ),
      CASE
        WHEN r.fault_minutes > 0 THEN 'inverter_fault'
        WHEN r.offline_minutes > 60 THEN 'inverter_offline'
        ELSE 'inverter_underperformance'
      END,
      CASE
        WHEN r.fault_minutes > 0 THEN 'high'
        WHEN r.offline_minutes > 240 THEN 'high'
        ELSE 'medium'
      END,
      'open',
      CASE
        WHEN r.fault_minutes > 0 THEN 24
        WHEN r.offline_minutes > 240 THEN 24
        ELSE 48
      END
    );

    tickets_created := tickets_created + 1;
  END LOOP;

  RETURN tickets_created;
END;
$function$;
