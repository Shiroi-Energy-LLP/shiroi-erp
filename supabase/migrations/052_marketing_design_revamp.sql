-- ============================================================================
-- Migration 052 - Marketing + Design Workflow Revamp (Schema, Triggers, RLS)
-- ============================================================================
-- Apply AFTER migration 051 (enum additions). Migration 051 must commit first
-- so the new app_role and lead_status values can be referenced in the RLS
-- policies, constraint definitions, and trigger functions below.
--
-- Scope:
--   * Extend channel_partners.partner_type CHECK (consultants, referrals, etc.)
--   * Extend tasks.category CHECK with payment_followup + payment_escalation
--   * leads: new columns for consultant commission, base quote price, design metadata
--   * proposal_bom_lines + project_boq_items: price_book_id FK for Quote -> BOQ -> PO sync
--   * proposal_payment_schedule: per-milestone followup_sla_days + escalation_sla_days
--   * New tables: lead_closure_approvals, consultant_commission_payouts
--   * Triggers:
--       - Replace create_payment_followup_tasks() with per-milestone SLA version
--       - fn_create_consultant_payout_on_customer_payment (commission tranche on each receipt)
--       - fn_lock_consultant_commission_on_partner_assignment (lock amount on assign)
--       - fn_migrate_lead_files_to_project (copy proposal-files/leads/X/* to
--         project-files/projects/Y/* on project auto-create)
--   * New function: enqueue_payment_escalations (called by pg_cron hourly)
--   * RLS policy updates to include marketing_manager and extend designer
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2. CHECK constraint relaxations
-- ----------------------------------------------------------------------------

-- channel_partners.partner_type: extend with consultant subtypes
ALTER TABLE channel_partners
  DROP CONSTRAINT IF EXISTS channel_partners_partner_type_check;

ALTER TABLE channel_partners
  ADD CONSTRAINT channel_partners_partner_type_check
  CHECK (partner_type = ANY (ARRAY[
    'individual_broker',
    'aggregator',
    'ngo',
    'housing_society',
    'corporate',
    'consultant',
    'referral',
    'electrical_contractor',
    'architect',
    'mep_firm',
    'other'
  ]));

-- tasks.category: add payment_followup + payment_escalation
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_category_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_category_check
  CHECK (
    category IS NULL
    OR category = ANY (ARRAY[
      'advance_payment',
      'material_delivery',
      'structure_installation',
      'panel_installation',
      'electrical_work',
      'testing_commissioning',
      'civil_work',
      'net_metering',
      'handover',
      'general',
      'payment_followup',
      'payment_escalation'
    ])
  );

-- ----------------------------------------------------------------------------
-- 3. leads - new columns for consultant commission + design + base price
-- ----------------------------------------------------------------------------

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS channel_partner_id UUID REFERENCES channel_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consultant_commission_amount NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS consultant_commission_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consultant_commission_locked_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_quote_price NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS design_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS design_confirmed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS design_notes TEXT,
  ADD COLUMN IF NOT EXISTS draft_proposal_id UUID;

COMMENT ON COLUMN leads.channel_partner_id IS
  'If the lead came through a channel partner / consultant, this FK links to channel_partners.id. Commission is computed and locked at assignment time.';
COMMENT ON COLUMN leads.consultant_commission_amount IS
  'Locked consultant commission (INR). Set by fn_lock_consultant_commission_on_partner_assignment() when channel_partner_id is first set. Pass-through cost added on top of base quote price.';
COMMENT ON COLUMN leads.base_quote_price IS
  'Current Shiroi-side quote price excluding consultant commission. Gross margin for the discount band is computed against this value, not customer_price.';
COMMENT ON COLUMN leads.draft_proposal_id IS
  'When a lead enters site_survey_scheduled, a draft detailed proposal is pre-created so designers can build BOM directly into proposal_bom_lines. This FK points to that draft row.';

CREATE INDEX IF NOT EXISTS idx_leads_channel_partner_id
  ON leads(channel_partner_id)
  WHERE channel_partner_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. proposal_bom_lines + project_boq_items - price_book_id FK
-- ----------------------------------------------------------------------------
-- purchase_order_items already has price_book_id. Matching name for consistency.

ALTER TABLE proposal_bom_lines
  ADD COLUMN IF NOT EXISTS price_book_id UUID REFERENCES price_book(id) ON DELETE SET NULL;

ALTER TABLE project_boq_items
  ADD COLUMN IF NOT EXISTS price_book_id UUID REFERENCES price_book(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proposal_bom_lines_price_book_id
  ON proposal_bom_lines(price_book_id)
  WHERE price_book_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_boq_items_price_book_id
  ON project_boq_items(price_book_id)
  WHERE price_book_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. proposal_payment_schedule - per-milestone escalation SLA
-- ----------------------------------------------------------------------------

ALTER TABLE proposal_payment_schedule
  ADD COLUMN IF NOT EXISTS followup_sla_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS escalation_sla_days INTEGER NOT NULL DEFAULT 7;

COMMENT ON COLUMN proposal_payment_schedule.followup_sla_days IS
  'Days after the milestone trigger fires at which a payment_followup task is created for the marketing manager.';
COMMENT ON COLUMN proposal_payment_schedule.escalation_sla_days IS
  'Days after the follow-up task is created at which, if the task is still open, a payment_escalation task fires for the founder.';

-- ----------------------------------------------------------------------------
-- 6. lead_closure_approvals - captures amber-band Vivek approvals
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_closure_approvals (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  requested_by               UUID NOT NULL REFERENCES employees(id),
  requested_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by                UUID REFERENCES employees(id),
  approved_at                TIMESTAMPTZ,
  rejected_at                TIMESTAMPTZ,
  band_at_request            TEXT NOT NULL CHECK (band_at_request = ANY (ARRAY['green', 'amber', 'red'])),
  gross_margin_at_request    NUMERIC(6, 2) NOT NULL,
  final_base_price           NUMERIC(14, 2) NOT NULL,
  reason                     TEXT,
  status                     TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'withdrawn'])),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_closure_approvals_lead_id
  ON lead_closure_approvals(lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_closure_approvals_pending
  ON lead_closure_approvals(status, requested_at DESC)
  WHERE status = 'pending';

COMMENT ON TABLE lead_closure_approvals IS
  'Captures amber-band discount approvals at the Closure Soon stage. When gross margin falls below 10% (but above 8%), a pending row is created; the founder approves or rejects from the notifications inbox.';

-- ----------------------------------------------------------------------------
-- 7. consultant_commission_payouts - per-tranche commission disbursements
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS consultant_commission_payouts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel_partner_id     UUID NOT NULL REFERENCES channel_partners(id) ON DELETE RESTRICT,
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_payment_id    UUID NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  tranche_pct            NUMERIC(6, 2) NOT NULL,
  gross_amount           NUMERIC(14, 2) NOT NULL,
  tds_amount             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_amount             NUMERIC(14, 2) NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status = ANY (ARRAY['pending', 'paid', 'on_hold', 'cancelled'])),
  paid_at                TIMESTAMPTZ,
  paid_by                UUID REFERENCES employees(id),
  payment_reference      TEXT,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_consultant_payouts_customer_payment
  ON consultant_commission_payouts(customer_payment_id);

CREATE INDEX IF NOT EXISTS idx_consultant_payouts_partner_status
  ON consultant_commission_payouts(channel_partner_id, status);

CREATE INDEX IF NOT EXISTS idx_consultant_payouts_project
  ON consultant_commission_payouts(project_id);

COMMENT ON TABLE consultant_commission_payouts IS
  'One row per customer payment receipt - each tranche triggers a matching consultant disbursement.';

-- ----------------------------------------------------------------------------
-- 8. Stage bar covering index on leads
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_leads_status_archived
  ON leads(status, is_archived, deleted_at)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- TRIGGERS + FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 9a. Replace create_payment_followup_tasks with per-milestone SLA version
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_payment_followup_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_schedule            RECORD;
  v_task_exists         BOOLEAN;
  v_milestone_order     INT;
  v_followup_due_date   DATE;
  v_marketing_mgr_id    UUID;
BEGIN
  -- Only fire on status transitions
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Map project status transitions to payment milestones
  v_milestone_order := CASE NEW.status::text
    WHEN 'in_progress'          THEN 2
    WHEN 'waiting_net_metering' THEN 4
    WHEN 'completed'            THEN 4
    ELSE NULL
  END;

  IF v_milestone_order IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve the marketing manager who will own the follow-up.
  -- Prefer the first active marketing_manager employee; fall back to project_manager.
  SELECT e.id INTO v_marketing_mgr_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'marketing_manager'
    AND e.deleted_at IS NULL
  ORDER BY e.created_at ASC
  LIMIT 1;

  IF v_marketing_mgr_id IS NULL THEN
    v_marketing_mgr_id := NEW.project_manager_id;
  END IF;

  -- For each matching payment schedule milestone, create a follow-up task
  -- using the per-milestone followup_sla_days.
  FOR v_schedule IN
    SELECT pps.milestone_name,
           pps.amount,
           pps.percentage,
           pps.milestone_order,
           pps.followup_sla_days
    FROM proposals p
    JOIN proposal_payment_schedule pps ON pps.proposal_id = p.id
    WHERE p.lead_id = NEW.lead_id
      AND p.status = 'accepted'
      AND pps.milestone_order = v_milestone_order
    ORDER BY pps.milestone_order
    LIMIT 1
  LOOP
    v_followup_due_date := (CURRENT_DATE + (COALESCE(v_schedule.followup_sla_days, 7) || ' days')::interval)::date;

    SELECT EXISTS (
      SELECT 1 FROM tasks
      WHERE entity_type = 'project'
        AND entity_id = NEW.id
        AND category = 'payment_followup'
        AND title LIKE 'Payment follow-up: ' || v_schedule.milestone_name || '%'
        AND deleted_at IS NULL
    ) INTO v_task_exists;

    IF NOT v_task_exists THEN
      INSERT INTO tasks (
        id, title, description, category, entity_type, entity_id, project_id,
        assigned_to, created_by, due_date, priority
      ) VALUES (
        gen_random_uuid(),
        'Payment follow-up: ' || v_schedule.milestone_name
          || ' (' || v_schedule.percentage || '% = Rs.' || ROUND(v_schedule.amount) || ')',
        'Project ' || NEW.project_number || ' has reached "' || REPLACE(NEW.status::text, '_', ' ')
          || '" stage. Payment milestone "' || v_schedule.milestone_name
          || '" is now due. Please follow up with the customer.',
        'payment_followup',
        'project',
        NEW.id,
        NEW.id,
        v_marketing_mgr_id,
        COALESCE(v_marketing_mgr_id, NEW.project_manager_id),
        v_followup_due_date,
        'high'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$func$;

-- ----------------------------------------------------------------------------
-- 9b. enqueue_payment_escalations - scans open follow-ups past their SLA
-- ----------------------------------------------------------------------------
-- Called by pg_cron (hourly). Creates a founder escalation task for every
-- open payment_followup task that is older than its escalation_sla_days.

CREATE OR REPLACE FUNCTION public.enqueue_payment_escalations()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_row              RECORD;
  v_founder_id       UUID;
  v_escalation_count INT := 0;
  v_exists           BOOLEAN;
BEGIN
  -- Resolve the founder (there should be exactly one)
  SELECT e.id INTO v_founder_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'founder'
    AND e.deleted_at IS NULL
  ORDER BY e.created_at ASC
  LIMIT 1;

  IF v_founder_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT t.id             AS task_id,
           t.title          AS task_title,
           t.project_id,
           t.entity_id,
           t.created_at,
           pps.escalation_sla_days,
           p.project_number,
           p.id             AS project_id_full
    FROM tasks t
    JOIN projects p ON p.id = t.entity_id
    JOIN proposals pr ON pr.lead_id = p.lead_id AND pr.status = 'accepted'
    JOIN proposal_payment_schedule pps
      ON pps.proposal_id = pr.id
     AND (
       'Payment follow-up: ' || pps.milestone_name || ' (' || pps.percentage || '% = Rs.' || ROUND(pps.amount) || ')'
       = t.title
     )
    WHERE t.category = 'payment_followup'
      AND t.is_completed = FALSE
      AND t.deleted_at IS NULL
      AND t.created_at < (now() - (COALESCE(pps.escalation_sla_days, 7) || ' days')::interval)
  LOOP
    -- Skip if an escalation task already exists for this follow-up
    SELECT EXISTS (
      SELECT 1 FROM tasks
      WHERE entity_type = 'project'
        AND entity_id = v_row.project_id_full
        AND category = 'payment_escalation'
        AND description LIKE '%follow-up task ' || v_row.task_id::text || '%'
        AND deleted_at IS NULL
    ) INTO v_exists;

    IF NOT v_exists THEN
      INSERT INTO tasks (
        id, title, description, category, entity_type, entity_id, project_id,
        assigned_to, created_by, due_date, priority
      ) VALUES (
        gen_random_uuid(),
        'ESCALATION - ' || v_row.task_title,
        'Payment follow-up task ' || v_row.task_id::text || ' on project ' || v_row.project_number
          || ' has exceeded its escalation SLA (' || v_row.escalation_sla_days
          || ' days) without being closed. Founder escalation fired automatically.',
        'payment_escalation',
        'project',
        v_row.project_id_full,
        v_row.project_id_full,
        v_founder_id,
        v_founder_id,
        CURRENT_DATE,
        'critical'
      );

      v_escalation_count := v_escalation_count + 1;
    END IF;
  END LOOP;

  RETURN v_escalation_count;
END;
$func$;

-- ----------------------------------------------------------------------------
-- 9c. fn_lock_consultant_commission_on_partner_assignment
-- ----------------------------------------------------------------------------
-- When a lead gets a channel_partner_id assigned (or changed from NULL),
-- compute the commission amount using the partner's commission_type + rate
-- and the lead's base_quote_price / kWp, then lock it on the lead row.

CREATE OR REPLACE FUNCTION public.fn_lock_consultant_commission_on_partner_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_partner     RECORD;
  v_commission  NUMERIC(14, 2);
  v_base_price  NUMERIC(14, 2);
  v_kwp         NUMERIC(10, 2);
BEGIN
  -- Only act when channel_partner_id transitions to a non-null value,
  -- OR when commission hasn't been locked yet even though a partner is set.
  IF NEW.channel_partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF (OLD.channel_partner_id IS NOT NULL
      AND OLD.channel_partner_id = NEW.channel_partner_id
      AND NEW.consultant_commission_locked_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT id, commission_type, commission_rate
    INTO v_partner
  FROM channel_partners
  WHERE id = NEW.channel_partner_id
    AND deleted_at IS NULL
    AND is_active = TRUE;

  IF v_partner IS NULL THEN
    RAISE NOTICE 'fn_lock_consultant_commission: partner % not found or inactive', NEW.channel_partner_id;
    RETURN NEW;
  END IF;

  v_base_price := COALESCE(NEW.base_quote_price, 0);
  v_kwp        := COALESCE(NEW.estimated_size_kwp, 0);

  -- Compute commission based on the partner's commission_type
  v_commission := CASE v_partner.commission_type
    WHEN 'percentage_of_revenue' THEN ROUND(v_base_price * v_partner.commission_rate / 100, 2)
    WHEN 'per_kwp'               THEN ROUND(v_kwp * v_partner.commission_rate, 2)
    WHEN 'fixed_per_deal'        THEN ROUND(v_partner.commission_rate, 2)
    ELSE 0
  END;

  NEW.consultant_commission_amount     := v_commission;
  NEW.consultant_commission_locked_at  := now();
  -- consultant_commission_locked_by must be set by the calling code; we leave it alone here

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_lock_consultant_commission ON leads;

CREATE TRIGGER trg_lock_consultant_commission
  BEFORE INSERT OR UPDATE OF channel_partner_id, base_quote_price ON leads
  FOR EACH ROW
  EXECUTE FUNCTION fn_lock_consultant_commission_on_partner_assignment();

-- ----------------------------------------------------------------------------
-- 9d. fn_create_consultant_payout_on_customer_payment
-- ----------------------------------------------------------------------------
-- On every customer_payments insert, if the originating lead has a channel
-- partner, compute this tranche's share of the locked commission and insert
-- a pending consultant_commission_payouts row.

CREATE OR REPLACE FUNCTION public.fn_create_consultant_payout_on_customer_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_project           RECORD;
  v_lead              RECORD;
  v_partner           RECORD;
  v_contracted_value  NUMERIC(14, 2);
  v_tranche_pct       NUMERIC(6, 2);
  v_gross_amount      NUMERIC(14, 2);
  v_tds_amount        NUMERIC(14, 2) := 0;
  v_net_amount        NUMERIC(14, 2);
BEGIN
  -- Resolve the project + lead
  SELECT id, lead_id, contracted_value
    INTO v_project
  FROM projects
  WHERE id = NEW.project_id
    AND deleted_at IS NULL;

  IF v_project IS NULL OR v_project.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT channel_partner_id, consultant_commission_amount
    INTO v_lead
  FROM leads
  WHERE id = v_project.lead_id;

  IF v_lead.channel_partner_id IS NULL
     OR COALESCE(v_lead.consultant_commission_amount, 0) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT id, tds_applicable
    INTO v_partner
  FROM channel_partners
  WHERE id = v_lead.channel_partner_id;

  IF v_partner IS NULL THEN
    RETURN NEW;
  END IF;

  v_contracted_value := COALESCE(v_project.contracted_value, 0);
  IF v_contracted_value = 0 THEN
    RETURN NEW;
  END IF;

  -- This tranche's percentage of the total contract
  v_tranche_pct := ROUND(NEW.amount * 100.0 / v_contracted_value, 2);

  v_gross_amount := ROUND(v_lead.consultant_commission_amount * v_tranche_pct / 100, 2);

  IF v_partner.tds_applicable THEN
    v_tds_amount := ROUND(v_gross_amount * 0.05, 2);
  END IF;

  v_net_amount := v_gross_amount - v_tds_amount;

  INSERT INTO consultant_commission_payouts (
    lead_id,
    channel_partner_id,
    project_id,
    customer_payment_id,
    tranche_pct,
    gross_amount,
    tds_amount,
    net_amount,
    status
  ) VALUES (
    v_project.lead_id,
    v_lead.channel_partner_id,
    v_project.id,
    NEW.id,
    v_tranche_pct,
    v_gross_amount,
    v_tds_amount,
    v_net_amount,
    'pending'
  )
  ON CONFLICT (customer_payment_id) DO NOTHING;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_create_consultant_payout_on_customer_payment ON customer_payments;

CREATE TRIGGER trg_create_consultant_payout_on_customer_payment
  AFTER INSERT ON customer_payments
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_consultant_payout_on_customer_payment();

-- ----------------------------------------------------------------------------
-- 9e. fn_migrate_lead_files_to_project
-- ----------------------------------------------------------------------------
-- When a project is auto-spawned from a won lead, move file paths from
-- proposal-files/leads/{lead_id}/** to project-files/projects/{project_id}/**
-- via storage.objects rename. The RLS UPDATE policies on both buckets
-- (migrations 010 + 047 + this migration's extension) allow the move.

CREATE OR REPLACE FUNCTION public.fn_migrate_lead_files_to_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Rename the storage path prefix from leads/<lead_id>/ to projects/<project_id>/
  -- and move the bucket from proposal-files to project-files.
  UPDATE storage.objects
  SET bucket_id = 'project-files',
      name = regexp_replace(name, '^leads/' || NEW.lead_id::text || '/', 'projects/' || NEW.id::text || '/')
  WHERE bucket_id = 'proposal-files'
    AND name LIKE 'leads/' || NEW.lead_id::text || '/%';

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_migrate_lead_files_on_project_create ON projects;

CREATE TRIGGER trg_migrate_lead_files_on_project_create
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION fn_migrate_lead_files_to_project();

-- ============================================================================
-- RLS POLICY UPDATES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 10a. leads - marketing_manager gets full CRUD
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS leads_read ON leads;
CREATE POLICY leads_read ON leads FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'finance'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'designer'::app_role,
    'marketing_manager'::app_role
  ])
);

DROP POLICY IF EXISTS leads_insert ON leads;
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (
  (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid())
  = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role
  ])
);

DROP POLICY IF EXISTS leads_update ON leads;
CREATE POLICY leads_update ON leads FOR UPDATE USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'marketing_manager'::app_role
  ])
  OR assigned_to = get_my_employee_id()
);

-- ----------------------------------------------------------------------------
-- 10b. proposals - marketing_manager full, designer insert/update keep
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS proposals_read ON proposals;
CREATE POLICY proposals_read ON proposals FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'finance'::app_role,
    'project_manager'::app_role,
    'sales_engineer'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
  OR prepared_by = get_my_employee_id()
);

DROP POLICY IF EXISTS proposals_insert ON proposals;
CREATE POLICY proposals_insert ON proposals FOR INSERT WITH CHECK (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'designer'::app_role,
    'marketing_manager'::app_role
  ])
);

DROP POLICY IF EXISTS proposals_update ON proposals;
CREATE POLICY proposals_update ON proposals FOR UPDATE USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'marketing_manager'::app_role
  ])
  OR (
    get_my_role() = ANY (ARRAY['sales_engineer'::app_role, 'designer'::app_role])
    AND prepared_by = get_my_employee_id()
    AND status <> ALL (ARRAY['accepted'::proposal_status, 'rejected'::proposal_status])
  )
);

-- ----------------------------------------------------------------------------
-- 10c. proposal_bom_lines - add marketing_manager + designer
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS bom_lines_read ON proposal_bom_lines;
CREATE POLICY bom_lines_read ON proposal_bom_lines FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'finance'::app_role,
    'purchase_officer'::app_role,
    'designer'::app_role,
    'marketing_manager'::app_role
  ])
);

DROP POLICY IF EXISTS bom_lines_write ON proposal_bom_lines;
CREATE POLICY bom_lines_write ON proposal_bom_lines FOR ALL USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
) WITH CHECK (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
);

-- ----------------------------------------------------------------------------
-- 10d. proposal_payment_schedule - marketing_manager full access
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'proposal_payment_schedule'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS proposal_payment_schedule_read ON proposal_payment_schedule';
    EXECUTE 'DROP POLICY IF EXISTS proposal_payment_schedule_write ON proposal_payment_schedule';
  END IF;
END $$;

CREATE POLICY proposal_payment_schedule_read ON proposal_payment_schedule FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'finance'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role,
    'hr_manager'::app_role
  ])
);

CREATE POLICY proposal_payment_schedule_write ON proposal_payment_schedule FOR ALL USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
) WITH CHECK (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
);

-- ----------------------------------------------------------------------------
-- 10e. channel_partners - marketing_manager full CRUD
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS channel_partners_read ON channel_partners;
CREATE POLICY channel_partners_read ON channel_partners FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'finance'::app_role,
    'marketing_manager'::app_role
  ])
);

DROP POLICY IF EXISTS channel_partners_write ON channel_partners;
CREATE POLICY channel_partners_write ON channel_partners FOR ALL USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'finance'::app_role,
    'marketing_manager'::app_role
  ])
);

-- ----------------------------------------------------------------------------
-- 10f. net_metering_applications - marketing_manager takes over, PM read-only
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS net_metering_read ON net_metering_applications;
CREATE POLICY net_metering_read ON net_metering_applications FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'project_manager'::app_role,
    'finance'::app_role,
    'marketing_manager'::app_role
  ])
  OR EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = net_metering_applications.project_id
      AND p.customer_profile_id = auth.uid()
  )
);

DROP POLICY IF EXISTS net_metering_write ON net_metering_applications;
CREATE POLICY net_metering_write ON net_metering_applications FOR ALL USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'marketing_manager'::app_role
  ])
);

-- ----------------------------------------------------------------------------
-- 10g. price_book - add marketing_manager + designer write
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS price_book_write ON price_book;
CREATE POLICY price_book_write ON price_book FOR ALL USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'purchase_officer'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
);

-- ----------------------------------------------------------------------------
-- 10h. projects - marketing_manager + designer gain SELECT, no UPDATE/INSERT
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS projects_read ON projects;
CREATE POLICY projects_read ON projects FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'finance'::app_role,
    'hr_manager'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
  OR project_manager_id = get_my_employee_id()
  OR site_supervisor_id = get_my_employee_id()
  OR EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = projects.id
      AND pa.employee_id = get_my_employee_id()
      AND pa.unassigned_at IS NULL
  )
  OR (get_my_role() = 'customer'::app_role AND customer_profile_id = auth.uid())
);

-- UPDATE and INSERT on projects are intentionally NOT extended to marketing_manager/designer.
-- They stay with founder + project_manager only.

-- ----------------------------------------------------------------------------
-- 10i. tasks - marketing_manager full access to payment-related tasks
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS tasks_read ON tasks;
CREATE POLICY tasks_read ON tasks FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'project_manager'::app_role,
    'hr_manager'::app_role,
    'marketing_manager'::app_role
  ])
  OR assigned_to = get_my_employee_id()
  OR created_by = get_my_employee_id()
);

DROP POLICY IF EXISTS tasks_write ON tasks;
CREATE POLICY tasks_write ON tasks FOR ALL USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'project_manager'::app_role,
    'site_supervisor'::app_role,
    'sales_engineer'::app_role,
    'om_technician'::app_role,
    'hr_manager'::app_role,
    'marketing_manager'::app_role
  ])
);

-- ----------------------------------------------------------------------------
-- 10j. lead_closure_approvals + consultant_commission_payouts RLS
-- ----------------------------------------------------------------------------

ALTER TABLE lead_closure_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_commission_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_closure_approvals_read ON lead_closure_approvals FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'marketing_manager'::app_role,
    'finance'::app_role
  ])
);

CREATE POLICY lead_closure_approvals_write ON lead_closure_approvals FOR ALL USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'marketing_manager'::app_role
  ])
);

CREATE POLICY consultant_payouts_read ON consultant_commission_payouts FOR SELECT USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'marketing_manager'::app_role,
    'finance'::app_role
  ])
);

CREATE POLICY consultant_payouts_write ON consultant_commission_payouts FOR ALL USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'marketing_manager'::app_role,
    'finance'::app_role
  ])
);

-- ----------------------------------------------------------------------------
-- 10k. Storage bucket RLS additions for proposal-files under leads/*
-- ----------------------------------------------------------------------------
-- We need an UPDATE policy on storage.objects for proposal-files (so drag-drop
-- recategorisation works, same reason as migration 047 for project-files).
-- Also grant insert/update/delete to marketing_manager, designer,
-- sales_engineer.

DO $$
BEGIN
  -- Drop existing proposal-files policies to rebuild cleanly
  EXECUTE 'DROP POLICY IF EXISTS proposal_files_read ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS proposal_files_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS proposal_files_update ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS proposal_files_delete ON storage.objects';
END $$;

CREATE POLICY proposal_files_read ON storage.objects FOR SELECT USING (
  bucket_id = 'proposal-files'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY proposal_files_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'proposal-files'
  AND (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid())
      = ANY (ARRAY[
        'founder'::app_role,
        'sales_engineer'::app_role,
        'project_manager'::app_role,
        'site_supervisor'::app_role,
        'marketing_manager'::app_role,
        'designer'::app_role
      ])
);

CREATE POLICY proposal_files_update ON storage.objects FOR UPDATE USING (
  bucket_id = 'proposal-files'
  AND (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid())
      = ANY (ARRAY[
        'founder'::app_role,
        'sales_engineer'::app_role,
        'project_manager'::app_role,
        'site_supervisor'::app_role,
        'marketing_manager'::app_role,
        'designer'::app_role
      ])
);

CREATE POLICY proposal_files_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'proposal-files'
  AND (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid())
      = ANY (ARRAY[
        'founder'::app_role,
        'sales_engineer'::app_role,
        'project_manager'::app_role,
        'site_supervisor'::app_role,
        'marketing_manager'::app_role,
        'designer'::app_role
      ])
);

-- updated_at housekeeping
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_lead_closure_approvals_updated_at ON lead_closure_approvals;
CREATE TRIGGER trg_lead_closure_approvals_updated_at
  BEFORE UPDATE ON lead_closure_approvals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_consultant_payouts_updated_at ON consultant_commission_payouts;
CREATE TRIGGER trg_consultant_payouts_updated_at
  BEFORE UPDATE ON consultant_commission_payouts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- END OF MIGRATION 051
-- ============================================================================
