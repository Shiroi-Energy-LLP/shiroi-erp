-- Migration 169 — Won-without-proposal auto-creates a project (+ one-time backfill)
-- Root cause: project creation only fires from an accepted proposal. With the
-- proposal gate off, leads can be Won with no proposal -> no project ever
-- (58 stranded on dev). Fix: stub an accepted budgetary proposal when none
-- exists -> existing cascade builds the project and mig-104 assigns Manivel.
-- Stub sets financials_invalidated=TRUE so it bypasses proposal_total_sanity.
BEGIN;

-- 1. Trigger function: add the no-proposal stub branch
CREATE OR REPLACE FUNCTION public.fn_mark_proposal_accepted_on_lead_won()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_proposal_id UUID;
  v_prepared_by UUID;
  v_lead RECORD;
BEGIN
  IF NEW.status != 'won' OR OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_proposal_id
  FROM proposals
  WHERE lead_id = NEW.id
    AND status = ANY (ARRAY['draft','sent','viewed','negotiating']::proposal_status[])
  ORDER BY is_budgetary ASC NULLS LAST, created_at DESC
  LIMIT 1;

  IF v_proposal_id IS NOT NULL THEN
    UPDATE proposals
    SET status='accepted', accepted_at=NOW(),
        accepted_by_name=COALESCE(accepted_by_name,'Auto-accepted on lead won'),
        acceptance_method=COALESCE(acceptance_method,'physical_signature')
    WHERE id = v_proposal_id;
    RETURN NEW;
  END IF;

  -- A proposal exists but isn't in-play (already accepted/rejected): cascade/idempotency handles it.
  IF EXISTS (SELECT 1 FROM proposals WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- No proposal at all -> stub an accepted one so a project is created + assigned to Manivel.
  SELECT customer_name, estimated_size_kwp, base_quote_price, assigned_to
    INTO v_lead FROM leads WHERE id = NEW.id;

  v_prepared_by := COALESCE(
    v_lead.assigned_to,
    (SELECT e.id FROM employees e JOIN profiles p ON p.id=e.profile_id
       WHERE e.is_active AND p.role IN ('marketing_manager','founder')
       ORDER BY e.created_at DESC LIMIT 1),
    (SELECT id FROM employees WHERE is_active ORDER BY created_at LIMIT 1)
  );

  INSERT INTO proposals (
    lead_id, proposal_number, prepared_by, system_size_kwp, system_type,
    total_after_discount, valid_until, is_budgetary, status,
    financials_invalidated, accepted_at, accepted_by_name, acceptance_method
  ) VALUES (
    NEW.id, generate_doc_number('PROP'), v_prepared_by,
    COALESCE(v_lead.estimated_size_kwp, 0), 'on_grid', COALESCE(v_lead.base_quote_price, 0),
    CURRENT_DATE, TRUE, 'accepted',
    TRUE, NOW(), 'Auto-stub on lead won (no proposal)', 'physical_signature'
  );

  RETURN NEW;
END;
$function$;

-- 2. Dev-specific DRA dedup (no-op on other envs -- prod dedup handled at prod-apply review).
--    Keeps "DRA Infinique" (more data); soft-deletes "DRA - Infinique".
UPDATE leads SET deleted_at = NOW()
WHERE id = 'f5fd49cb-e222-438f-bc9e-3467d27e52b7' AND deleted_at IS NULL;

-- 3. Backfill: stub + project for every stranded won lead. Recent (created >= 2026-01-01)
--    stays order_received; old becomes completed. Criteria-based -> re-runs on prod.
ALTER TABLE projects DISABLE TRIGGER projects_sync_enqueue;   -- don't spam Zoho with historical projects
ALTER TABLE projects DISABLE TRIGGER trg_payment_followup;    -- don't create payment tasks on completed ones

DO $backfill$
DECLARE r RECORD; v_prepared_by UUID;
BEGIN
  FOR r IN
    SELECT l.id, l.estimated_size_kwp, l.base_quote_price, l.assigned_to,
           (l.created_at >= DATE '2026-01-01') AS is_recent
    FROM leads l
    WHERE l.status='won' AND l.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.lead_id=l.id)
      AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.lead_id=l.id AND pr.deleted_at IS NULL)
  LOOP
    v_prepared_by := COALESCE(r.assigned_to,
      (SELECT e.id FROM employees e JOIN profiles p ON p.id=e.profile_id
         WHERE e.is_active AND p.role IN ('marketing_manager','founder')
         ORDER BY e.created_at DESC LIMIT 1));
    INSERT INTO proposals (lead_id, proposal_number, prepared_by, system_size_kwp, system_type,
                           total_after_discount, valid_until, is_budgetary, status,
                           financials_invalidated, accepted_at, accepted_by_name, acceptance_method)
    VALUES (r.id, generate_doc_number('PROP'), v_prepared_by, COALESCE(r.estimated_size_kwp,0),
            'on_grid', COALESCE(r.base_quote_price,0), CURRENT_DATE, TRUE, 'accepted',
            TRUE, NOW(), 'Backfill: won without proposal', 'physical_signature');
    IF NOT r.is_recent THEN
      UPDATE projects SET status='completed' WHERE lead_id = r.id AND deleted_at IS NULL;
    END IF;
  END LOOP;
END $backfill$;

ALTER TABLE projects ENABLE TRIGGER projects_sync_enqueue;
ALTER TABLE projects ENABLE TRIGGER trg_payment_followup;

COMMIT;
