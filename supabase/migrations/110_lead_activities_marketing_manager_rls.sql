-- Migration 110: lead_activities RLS realignment — add marketing_manager + project_manager
--
-- Which migration missed it:
--   mig 052 ("marketing + design revamp") swept many tables to add marketing_manager RLS
--   (proposals, proposal_bom_lines, proposal_payment_schedule, channel_partners,
--   net_metering_applications, lead_closure_approvals, consultant_commission_payouts,
--   leads_read/insert/update, tasks_read/write) but accidentally skipped lead_activities.
--
-- Why we're patching now:
--   Prem (marketing_manager) hit a hard RLS block on 2026-05-19 when logging a Site Visit
--   via the Activities tab on /sales/<id>. The action wrote a toast error:
--   "new row violates row-level security policy for table 'lead_activities'".
--   Two proposal rows were created via Quick Quote on the same day (verified in DB),
--   so the activity INSERT was the only remaining blocker.
--
-- Policy state BEFORE this migration (live on dev 2026-05-20):
--   lead_activities_read  → USING (role IN ('founder','hr_manager','finance')
--                                   OR performed_by = me
--                                   OR role = 'sales_engineer')
--   lead_activities_write → USING (role IN ('founder','sales_engineer','project_manager'))
--   marketing_manager and project_manager (read) were ABSENT from both policies.
--
-- Policy state AFTER this migration:
--   lead_activities_read  → open to founder, hr_manager, finance, sales_engineer,
--                           project_manager, marketing_manager, designer,
--                           OR own rows (performed_by = caller)
--   lead_activities_write → open to founder, sales_engineer, project_manager,
--                           marketing_manager for I/U/D (FOR ALL with explicit WITH CHECK)
--
-- Designer note:
--   designer is intentionally EXCLUDED from write. Designers read the lead funnel
--   for sizing context but do not log customer-facing activities.

BEGIN;

DROP POLICY IF EXISTS lead_activities_read ON lead_activities;
CREATE POLICY lead_activities_read ON lead_activities FOR SELECT
USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'finance'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
  OR performed_by = get_my_employee_id()
);

DROP POLICY IF EXISTS lead_activities_write ON lead_activities;
CREATE POLICY lead_activities_write ON lead_activities FOR ALL
USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role
  ])
)
WITH CHECK (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role
  ])
);

COMMIT;
