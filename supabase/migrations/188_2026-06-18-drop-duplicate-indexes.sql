-- ============================================================================
-- Migration 188 — drop exact-duplicate & exact-key-shadowed indexes (ERP-wide)
-- Date: 2026-06-18
-- Context: docs/reviews/2026-06-18-erp-redundancy-sweep.md
--          (follow-on to mig 187, which cleaned the same pattern on leads/projects)
--
-- An ERP-wide sweep of the LIVE dev catalog (pg_index) found 25 indexes whose key
-- (table + columns + opclass + predicate) is byte-identical to another index on the
-- same table — pure redundancy with ZERO loss of coverage:
--   * 5  are exact duplicates of another PLAIN index on the same column(s)
--   * 20 are shadowed by the UNIQUE/PK index on the identical key
-- Each drop's surviving index has the identical key, so query plans are unchanged.
-- (5 differ only in declared sort direction; the survivor serves the reverse order
--  via an equally-cheap backward index scan.) The hottest dropped index,
--  idx_employees_profile [364k scans], is covered identically by employees_profile_id_key.
--
-- NOT dropped here (flagged for review in the report): 20 PREFIX-shadowed plain
-- indexes whose survivor is a WIDER composite — a real, if tiny, trade-off on 4 hot
-- tables (entity_contacts, rfq_invitations, rfq_items, rfq_quotes).
--
-- Applied to DEV 2026-06-18. Prod: deferred (project: dev-only, no prod).
-- Safe to re-run (IF EXISTS). Index drops do not change generated types.
-- ============================================================================

-- (a) Exact duplicates of another PLAIN index on the same key.
--     Kept the *_id / current-table-name index (consistent with mig 187's choice).
DROP INDEX IF EXISTS public.idx_customer_payments_project;      -- dup of idx_customer_payments_project_id  (project_id)
DROP INDEX IF EXISTS public.idx_customer_payments_invoice;      -- dup of idx_customer_payments_invoice_id  (invoice_id)
DROP INDEX IF EXISTS public.idx_invoices_project;               -- dup of idx_invoices_project_id           (project_id)
DROP INDEX IF EXISTS public.idx_project_site_expenses_project;  -- dup of idx_expenses_project              (legacy table name)
DROP INDEX IF EXISTS public.idx_bom_lines_proposal;             -- dup of idx_bom_lines_proposal_order      (proposal_id, line_number)

-- (b) Plain indexes covered by the UNIQUE/PK index on the IDENTICAL key.
DROP INDEX IF EXISTS public.idx_attendance_employee_date;       -- covered by attendance_employee_id_date_key
DROP INDEX IF EXISTS public.idx_blacklisted_phones_phone;       -- covered by blacklisted_phones_phone_key
DROP INDEX IF EXISTS public.idx_commissioning_project;          -- covered by commissioning_reports_project_id_key
DROP INDEX IF EXISTS public.idx_cashflow_snapshots_date;        -- covered by company_cashflow_snapshots_snapshot_date_key
DROP INDEX IF EXISTS public.idx_daily_reports_project_date;     -- covered by idx_dsr_project_date (UNIQUE)
DROP INDEX IF EXISTS public.idx_exit_checklist_employee;        -- covered by employee_exit_checklists_employee_id_key
DROP INDEX IF EXISTS public.idx_employees_profile;              -- covered by employees_profile_id_key  (hottest: 364k scans)
DROP INDEX IF EXISTS public.idx_employees_code;                 -- covered by employees_employee_code_key
DROP INDEX IF EXISTS public.idx_monthly_perf_project;           -- covered by monthly_performance_reports_project_id_report_year_report_m_key
DROP INDEX IF EXISTS public.idx_net_metering_project;           -- covered by net_metering_applications_project_id_key
DROP INDEX IF EXISTS public.idx_payroll_exports_month;          -- covered by payroll_export_files_month_year_key
DROP INDEX IF EXISTS public.idx_plant_daily_plant;              -- covered by idx_plant_daily_unique (UNIQUE)
DROP INDEX IF EXISTS public.idx_plants_project;                 -- covered by plants_project_id_key
DROP INDEX IF EXISTS public.idx_handovers_project;              -- covered by project_handovers_project_id_key
DROP INDEX IF EXISTS public.idx_profitability_project;          -- covered by project_profitability_project_id_key
DROP INDEX IF EXISTS public.idx_digital_acceptance_proposal;    -- covered by proposal_digital_acceptance_proposal_id_key
DROP INDEX IF EXISTS public.idx_digital_acceptance_token;       -- covered by proposal_digital_acceptance_access_token_key
DROP INDEX IF EXISTS public.idx_scope_split_proposal;           -- covered by proposal_scope_split_proposal_id_key
DROP INDEX IF EXISTS public.idx_share_tokens_token;             -- covered by proposal_share_tokens_token_key
DROP INDEX IF EXISTS public.idx_proposals_number;               -- covered by proposals_proposal_number_key
