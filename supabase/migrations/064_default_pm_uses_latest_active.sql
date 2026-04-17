-- ============================================================
-- Migration 064 — Default PM lookup uses LATEST active PM
-- File: supabase/migrations/064_default_pm_uses_latest_active.sql
-- Date: 2026-04-17
--
-- POLICY CHANGE
-- -------------
-- Migration 063 introduced default-PM assignment in
-- create_project_from_accepted_proposal() using the EARLIEST-created
-- active project_manager (ORDER BY created_at ASC). That was a
-- "senior PM is the default" heuristic.
--
-- Per Vivek (2026-04-17): the newest active PM should catch new
-- projects arriving from sales. Rationale: round-robin load toward
-- the most-recently-hired PM so senior PMs stay free for escalations
-- and complex work, and the new hire ramps up on real projects.
--
-- Switch the ORDER BY to DESC so the LAST-created active PM wins.
-- Ties broken arbitrarily by LIMIT 1. Today this still resolves to
-- Manivel Sellamuthu (the only active PM). The behaviour only
-- diverges from migration 063 when a second active PM exists, at
-- which point the newest joiner automatically takes new intake.
--
-- All other logic in create_project_from_accepted_proposal() is
-- unchanged. Migration 062's founder fallback in the payment-followup
-- trigger remains the safety net for any case where no active PM
-- exists at all.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_project_from_accepted_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_project_number  TEXT;
  v_lead            RECORD;
  v_existing_id     UUID;
  v_default_pm_id   UUID;
BEGIN
  -- Only fire on transition TO 'accepted'
  IF NEW.status != 'accepted' OR OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if any project already exists for this lead
  SELECT id INTO v_existing_id
    FROM projects
    WHERE lead_id = NEW.lead_id
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch customer + site details from the lead
  SELECT
    customer_name,
    phone,
    email,
    COALESCE(address_line1, city) AS address_line1,
    city,
    state,
    pincode
  INTO v_lead
  FROM leads
  WHERE id = NEW.lead_id;

  IF v_lead IS NULL THEN
    RAISE NOTICE 'Cannot auto-create project: lead % not found', NEW.lead_id;
    RETURN NEW;
  END IF;

  -- Resolve default PM: LATEST-created active project_manager.
  -- The newest PM catches new project intake from sales. Today this
  -- is Manivel Sellamuthu (the only active PM). When additional PMs
  -- are hired, the most recent addition automatically becomes the
  -- default for new projects.
  -- If no PM exists, leave project_manager_id NULL — migration 062's
  -- founder fallback in the payment-followup trigger will handle it.
  SELECT e.id INTO v_default_pm_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'project_manager'
    AND e.is_active = TRUE
  ORDER BY e.created_at DESC
  LIMIT 1;

  -- Generate a new project number
  v_project_number := generate_doc_number('PROJ');

  -- Insert the project. Any field missing from the proposal falls back
  -- to safe zeros/nulls — the PM can fill in details via the stepper.
  INSERT INTO projects (
    proposal_id,
    lead_id,
    project_number,
    project_manager_id,
    customer_name,
    customer_phone,
    customer_email,
    site_address_line1,
    site_city,
    site_state,
    site_pincode,
    system_type,
    system_size_kwp,
    panel_brand,
    panel_model,
    panel_wattage,
    panel_count,
    inverter_brand,
    inverter_model,
    inverter_capacity_kw,
    battery_brand,
    battery_model,
    battery_capacity_kwh,
    contracted_value,
    advance_amount,
    advance_received_at,
    status
  ) VALUES (
    NEW.id,
    NEW.lead_id,
    v_project_number,
    v_default_pm_id,
    v_lead.customer_name,
    v_lead.phone,
    v_lead.email,
    v_lead.address_line1,
    v_lead.city,
    v_lead.state,
    v_lead.pincode,
    NEW.system_type,
    NEW.system_size_kwp,
    NEW.panel_brand,
    NEW.panel_model,
    NEW.panel_wattage,
    COALESCE(NEW.panel_count, 0),
    NEW.inverter_brand,
    NEW.inverter_model,
    NEW.inverter_capacity_kw,
    NEW.battery_brand,
    NEW.battery_model,
    NEW.battery_capacity_kwh,
    COALESCE(NEW.total_after_discount, 0),
    0,
    CURRENT_DATE,
    'order_received'
  );

  RETURN NEW;
END;
$func$;

COMMIT;
