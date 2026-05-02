-- ============================================================================
-- Migration 089 — Task backfill + leads.map_link + expected orders/payments
-- Date: 2026-05-01
-- Why: (1) Existing payment-followup tasks were assigned to PMs (no
--      marketing_manager existed at trigger-fire time) — backfill to Prem.
--      (2) Add map_link to leads (parallel to projects.location_map_link).
--      (3) Two new RPCs power Expected Orders + Expected Payments dashboard
--      cards (per NEVER-DO #12, all date arithmetic stays in the DB).
--      (4) Update create_project_from_accepted_proposal trigger to copy
--      lead.map_link → project.location_map_link on proposal acceptance.
-- ============================================================================

-- ============================================================
-- (1) Backfill payment-follow-up tasks to marketing_manager
-- ============================================================

WITH prem AS (
  SELECT e.id AS employee_id
  FROM employees e
  JOIN profiles  p ON p.id = e.profile_id
  WHERE p.role = 'marketing_manager' AND e.is_active = TRUE
  ORDER BY e.created_at ASC
  LIMIT 1
)
UPDATE tasks
SET assigned_to = (SELECT employee_id FROM prem)
WHERE category IN ('payment_followup', 'payment_escalation')
  AND is_completed = FALSE
  AND deleted_at IS NULL
  AND assigned_to IS DISTINCT FROM (SELECT employee_id FROM prem)
  AND (SELECT employee_id FROM prem) IS NOT NULL;

-- ============================================================
-- (2) leads.map_link
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS map_link TEXT NULL;

COMMENT ON COLUMN leads.map_link IS
  'Optional Google Maps URL for the customer site. Used by sales, design, and project ops.';

-- ============================================================
-- (3a) RPC: get_expected_orders
-- ============================================================

CREATE OR REPLACE FUNCTION get_expected_orders(window_days INT)
RETURNS TABLE (
  lead_id             UUID,
  customer_name       TEXT,
  status              lead_status,
  estimated_size_kwp  NUMERIC(10,2),
  base_quote_price    NUMERIC(14,2),
  derived_value       NUMERIC(14,2),
  expected_close_date DATE,
  close_probability   INT,
  days_until          INT
)
LANGUAGE sql STABLE AS $$
  SELECT
    l.id,
    l.customer_name,
    l.status,
    l.estimated_size_kwp,
    l.base_quote_price,
    COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000)::NUMERIC(14,2) AS derived_value,
    l.expected_close_date,
    l.close_probability,
    GREATEST(0, l.expected_close_date - CURRENT_DATE)::int AS days_until
  FROM leads l
  WHERE l.status IN ('negotiation','closure_soon')
    AND l.deleted_at IS NULL
    AND l.expected_close_date IS NOT NULL
    AND l.expected_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + window_days
  ORDER BY l.expected_close_date ASC NULLS LAST,
           COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_expected_orders(INT) TO authenticated;

-- ============================================================
-- (3b) RPC: get_expected_payments
-- ============================================================

CREATE OR REPLACE FUNCTION get_expected_payments(window_days INT)
RETURNS TABLE (
  project_id            UUID,
  project_number        TEXT,
  customer_name         TEXT,
  milestone_name        TEXT,
  milestone_order       INT,
  amount                NUMERIC(14,2),
  expected_payment_date DATE,
  days_until            INT
)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      p.id            AS project_id,
      p.project_number,
      p.customer_name,
      pps.milestone_name,
      pps.milestone_order,
      pps.amount,
      CASE pps.due_trigger
        WHEN 'on_proposal_acceptance' THEN (p.order_date         + (pps.due_days_after_trigger || ' days')::interval)::date
        WHEN 'on_project_start'       THEN (p.actual_start_date  + (pps.due_days_after_trigger || ' days')::interval)::date
        WHEN 'on_project_completion'  THEN (p.commissioned_date  + (pps.due_days_after_trigger || ' days')::interval)::date
        ELSE NULL
      END AS expected_payment_date,
      pps.amount AS milestone_amount
    FROM projects p
    JOIN proposals pr                  ON pr.lead_id = p.lead_id AND pr.status = 'accepted'
    JOIN proposal_payment_schedule pps ON pps.proposal_id = pr.id
    WHERE p.contracted_value > 0
  ),
  with_received AS (
    SELECT b.*,
           COALESCE(
             (SELECT SUM(cp.amount) FROM customer_payments cp WHERE cp.project_id = b.project_id),
             0
           ) AS total_received,
           SUM(b.milestone_amount) OVER (
             PARTITION BY b.project_id ORDER BY b.milestone_order
           ) AS cumulative_through_milestone
    FROM base b
  )
  SELECT
    project_id,
    project_number,
    customer_name,
    milestone_name,
    milestone_order,
    amount,
    expected_payment_date,
    GREATEST(0, expected_payment_date - CURRENT_DATE)::int AS days_until
  FROM with_received
  WHERE expected_payment_date IS NOT NULL
    AND expected_payment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + window_days
    AND total_received < cumulative_through_milestone
  ORDER BY expected_payment_date ASC, amount DESC;
$$;

GRANT EXECUTE ON FUNCTION get_expected_payments(INT) TO authenticated;

-- ============================================================
-- (4) Update create_project_from_accepted_proposal trigger
--     to copy lead.map_link → project.location_map_link
--     Surgical change: add map_link to v_lead SELECT +
--     add location_map_link to INSERT column/value lists.
--     All other logic preserved verbatim.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_project_from_accepted_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    pincode,
    map_link
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
    location_map_link,
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
    v_lead.map_link,
    'order_received'
  );

  RETURN NEW;
END;
$function$;
