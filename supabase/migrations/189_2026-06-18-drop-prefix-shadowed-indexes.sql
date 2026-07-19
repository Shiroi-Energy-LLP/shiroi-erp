-- ============================================================================
-- Migration 189 — drop prefix-shadowed & reversed-order redundant indexes
-- Date: 2026-06-18
-- Context: docs/reviews/2026-06-18-erp-redundancy-sweep.md §1b/§1c
--          (follow-on to mig 188; the items it flagged but held back)
--
-- 16 PREFIX-shadowed plain indexes: each index's column is the left-prefix of a
-- composite UNIQUE index on the same table, which already serves the lookup. The
-- survivor is a WIDER composite (so a marginally larger scan) — held out of mig
-- 188's "byte-identical survivor" set, but all 16 are cold (0–8 scans in dev) so
-- there is no hot path to regress. Plus 1 reversed-column-order index that is dead
-- (idx_activity_associations_entity = (entity_id, entity_type), 0 scans; the live
-- access uses idx_activity_assoc_entity = (entity_type, entity_id), 470 scans).
--
-- The 4 HOT prefix-shadowed indexes (idx_ec_contact, idx_rfq_invitations_rfq,
-- idx_rfq_items_rfq, idx_rfq_quotes_invitation) are deliberately KEPT — the lean
-- single-column index earns its place on those hot paths.
--
-- Applied to DEV 2026-06-18. Prod: deferred (project: dev-only, no prod).
-- Safe to re-run (IF EXISTS). Index drops do not change generated types.
-- ============================================================================

-- Prefix-shadowed by a composite UNIQUE on the same table (all cold in dev):
DROP INDEX IF EXISTS public.idx_activity_assoc_activity;       -- prefix of activity_associations_activity_id_entity_type_entity_id_key
DROP INDEX IF EXISTS public.idx_bom_actual_project_cat;        -- prefix of bom_actual_vs_budgetary_project_id_category_recorded_at_key
DROP INDEX IF EXISTS public.idx_cp_leads_partner;              -- prefix of idx_cp_leads_unique (channel_partner_id, lead_id)
DROP INDEX IF EXISTS public.idx_dc_certs_project;              -- prefix of dc_certificates_project_id_certificate_type_key
DROP INDEX IF EXISTS public.idx_skills_employee;               -- prefix of idx_skills_employee_skill (employee_id, skill_name)
DROP INDEX IF EXISTS public.idx_exec_briefing_date;            -- prefix of executive_briefing_log_briefing_date_recipient_role_key
DROP INDEX IF EXISTS public.idx_lsa_month;                     -- prefix of idx_lsa_month_source (month_year, source, segment)
DROP INDEX IF EXISTS public.idx_leave_balances_employee;       -- prefix of idx_leave_balances_employee_type (employee_id, leave_type)
DROP INDEX IF EXISTS public.idx_onboarding_progress_employee;  -- prefix of onboarding_progress_employee_id_onboarding_track_key
DROP INDEX IF EXISTS public.idx_track_assignments_employee;    -- prefix of idx_track_assignments_unique (employee_id, track_id)
DROP INDEX IF EXISTS public.idx_project_bois_project;          -- prefix of project_bois_project_id_boi_number_key
DROP INDEX IF EXISTS public.idx_completion_project;            -- prefix of project_completion_items_project_id_component_key
DROP INDEX IF EXISTS public.idx_proposal_analytics_month;      -- prefix of idx_proposal_analytics_month_eng (month_year, sales_engineer_id)
DROP INDEX IF EXISTS public.idx_rag_source_path;               -- prefix of rag_chunks_source_path_chunk_index_key
DROP INDEX IF EXISTS public.idx_vendor_bills_vendor;           -- prefix of vendor_bills_vendor_id_bill_number_key
DROP INDEX IF EXISTS public.idx_zoho_monthly_summary_period;   -- prefix of zoho_monthly_summary_year_month_account_id_key

-- Reversed-column-order duplicate (dead — 0 scans):
DROP INDEX IF EXISTS public.idx_activity_associations_entity;  -- (entity_id, entity_type) dead; idx_activity_assoc_entity = (entity_type, entity_id) is the live one
