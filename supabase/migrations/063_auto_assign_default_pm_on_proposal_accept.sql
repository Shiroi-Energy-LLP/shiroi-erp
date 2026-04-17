-- ============================================================
-- Migration 063 — Auto-assign default PM when proposal → project
-- File: supabase/migrations/063_auto_assign_default_pm_on_proposal_accept.sql
-- Date: 2026-04-17
--
-- CONTEXT
-- -------
-- Migration 031 introduced create_project_from_accepted_proposal():
-- when a proposal transitions to 'accepted', a project row is
-- auto-created. That function did NOT set project_manager_id —
-- every auto-created project starts with PM = NULL.
--
-- Follow-on consequence (fixed by migration 062): if the PM stays
-- NULL, moving the project to 'in_progress' used to crash because
-- the trg_payment_followup trigger tried to INSERT a task with
-- created_by = NULL. Migration 062 added a founder tier-3 fallback
-- so that path no longer crashes.
--
-- This migration closes the gap at the source: when a project is
-- auto-created, assign the earliest-created active project_manager
-- as the default PM. Today that resolves to Manivel Sellamuthu —
-- the only active PM. If more PMs are added later, the earliest
-- one (by created_at) remains the default, which keeps Manivel
-- stable unless he's deactivated.
--
-- Fallback behaviour if NO active project_manager exists:
--   project_manager_id stays NULL.
-- Migration 062's tier-3 founder fallback in the payment-followup
-- trigger catches this case, so status changes still succeed.
--
-- Only the function body changes. Signature, trigger wiring, and
-- idempotency logic are untouched.
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

  -- Resolve default PM: earliest-created active project_manager.
  -- Today this is Manivel Sellamuthu (the only active PM).
  -- If no PM exists, leave project_manager_id NULL — migration 062's
  -- founder fallback in the payment-followup trigger will handle it.
  SELECT e.id INTO v_default_pm_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'project_manager'
    AND e.is_active = TRUE
  ORDER BY e.created_at ASC
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
