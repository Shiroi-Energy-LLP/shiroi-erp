-- Migration 141 — 2026-05-30 SECURITY DEFINER search_path sweep
-- ============================================================
-- Defense-in-depth hardening: pin search_path on every SECURITY DEFINER function
-- in the public schema that does not already have one.
--
-- Why this matters:
--   A SECURITY DEFINER function executes with the owner's privileges (postgres,
--   here). Without an explicit search_path, the function resolves unqualified
--   identifiers against whatever search_path the *caller* has set. A malicious
--   or compromised caller can prepend a schema (e.g. via `SET search_path = evil,
--   public`) containing shadow copies of `pg_catalog` functions, tables, or
--   types and trick the definer function into executing attacker-controlled
--   code as the owner.
--
--   Pinning `search_path = public, pg_temp` neutralises that vector:
--     - public:   the only application schema we resolve unqualified names from
--     - pg_temp:  temporary objects (Postgres always implicitly trusts these,
--                 listing explicitly avoids a planner warning)
--   `pg_catalog` is always searched first by Postgres regardless of the GUC,
--   so we do not list it.
--
-- Why a sweep instead of editing each function:
--   `ALTER FUNCTION ... SET search_path` is metadata-only — it does not rewrite
--   the function body or change behaviour. The newer migrations (134, 137, plus
--   everything from 138 onward) already include the SET clause inline at CREATE
--   time. This migration brings the legacy functions (migs 1-130, plus the
--   handful in 131-133 that pre-date the convention) up to the same standard.
--
-- Reference: Supabase advisor lint 0011 (Function Search Path Mutable) and
-- the documented Postgres pattern in
-- https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY
--
-- 36 functions sweep — all owned by `postgres`, all idempotent ALTERs.

ALTER FUNCTION public.ack_sync_batch(p_results jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.claim_next_sync_batch(p_entity_type text, p_batch_size integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.consume_inverter_oauth_state(p_state_token text, p_brand text) SET search_path = public, pg_temp;
ALTER FUNCTION public.create_inverter_partition_for_month(target_month date) SET search_path = public, pg_temp;
ALTER FUNCTION public.create_ir_test_ticket() SET search_path = public, pg_temp;
ALTER FUNCTION public.create_ir_test_ticket_om() SET search_path = public, pg_temp;
ALTER FUNCTION public.create_payment_followup_tasks() SET search_path = public, pg_temp;
ALTER FUNCTION public.create_project_from_accepted_proposal() SET search_path = public, pg_temp;
ALTER FUNCTION public.create_service_tickets_from_inverter_alerts() SET search_path = public, pg_temp;
ALTER FUNCTION public.drop_expired_inverter_oauth_states() SET search_path = public, pg_temp;
ALTER FUNCTION public.drop_old_inverter_partitions() SET search_path = public, pg_temp;
ALTER FUNCTION public.enqueue_payment_escalations() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_boq_auto_update_on_grn_complete() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_create_consultant_payout_on_customer_payment() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_lock_consultant_commission_on_partner_assignment() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_mark_proposal_accepted_on_lead_won() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_migrate_lead_files_to_project() SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_cashflow_snapshot() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_data_flag_summary() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_flag_count(p_entity_type text, p_entity_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_inverters_due_for_poll(batch_limit integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_om_profitability(p_start_date date, p_end_date date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_salary_benchmark_report() SET search_path = public, pg_temp;
ALTER FUNCTION public.lock_stale_reports() SET search_path = public, pg_temp;
ALTER FUNCTION public.log_lead_status_change() SET search_path = public, pg_temp;
ALTER FUNCTION public.log_project_status_change() SET search_path = public, pg_temp;
ALTER FUNCTION public.log_proposal_status_change() SET search_path = public, pg_temp;
ALTER FUNCTION public.refresh_leave_balance() SET search_path = public, pg_temp;
ALTER FUNCTION public.refresh_project_cash_position() SET search_path = public, pg_temp;
ALTER FUNCTION public.rollup_inverter_readings_daily() SET search_path = public, pg_temp;
ALTER FUNCTION public.rollup_inverter_readings_hourly() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_correction_override_rate() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_po_amount_paid() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_price_book_accuracy() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_proposal_totals() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_storage_mime_type(p_bucket text, p_path text, p_mime text) SET search_path = public, pg_temp;
