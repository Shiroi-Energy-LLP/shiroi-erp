-- ============================================================
-- Migration 146 — RLS helper discipline sweep on migs 138 + 139
-- Date: 2026-05-30
-- Why:
--   Migs 138 (Wave 1 RAG + supporting tables) and 139 (Wave 2-4 foundation)
--   introduced ~11 RLS policies that used the raw recursive pattern
--     `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (...))`
--   instead of the canonical `get_my_role()` helper from mig 008a (see master
--   ref §5.6 — calling profiles RLS inside a profiles SELECT can infinite-recurse).
--
--   This sweep rewrites all 11 to the canonical helper. Behaviour is identical;
--   the rewrite removes the recursion risk and gives the planner a STABLE helper
--   it can cache per row.
--
-- Reconstructed from dev DB state (the Batch-A workflow agent applied via
-- execute_sql but didn't persist the local file). The DROP-then-CREATE pattern
-- below is idempotent — re-running on a DB that already has the new policies
-- is a no-op.
-- ============================================================

-- rag_query_log (mig 138)
DROP POLICY IF EXISTS rag_query_log_own_read ON public.rag_query_log;
CREATE POLICY rag_query_log_own_read ON public.rag_query_log
  FOR SELECT
  USING (caller_id = auth.uid() OR get_my_role() = 'founder'::app_role);

-- task_suggestion_queue (mig 138)
DROP POLICY IF EXISTS task_sugg_queue_read ON public.task_suggestion_queue;
CREATE POLICY task_sugg_queue_read ON public.task_suggestion_queue
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'marketing_manager'::app_role, 'project_manager'::app_role, 'om_technician'::app_role]));

-- executive_briefing_log (mig 138)
DROP POLICY IF EXISTS exec_briefing_read ON public.executive_briefing_log;
CREATE POLICY exec_briefing_read ON public.executive_briefing_log
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'marketing_manager'::app_role, 'project_manager'::app_role]));

-- voice_report_log (mig 138) — also uses get_my_employee_id() to scope by sender
DROP POLICY IF EXISTS voice_report_read ON public.voice_report_log;
CREATE POLICY voice_report_read ON public.voice_report_log
  FOR SELECT
  USING (get_my_role() = 'founder'::app_role OR sender_employee_id = get_my_employee_id());

-- monthly_performance_reports (mig 139)
DROP POLICY IF EXISTS monthly_perf_read ON public.monthly_performance_reports;
CREATE POLICY monthly_perf_read ON public.monthly_performance_reports
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'om_technician'::app_role, 'project_manager'::app_role]));

-- rag_ingest_state (mig 139)
DROP POLICY IF EXISTS rag_ingest_state_read ON public.rag_ingest_state;
CREATE POLICY rag_ingest_state_read ON public.rag_ingest_state
  FOR SELECT
  USING (get_my_role() = 'founder'::app_role);

-- sales_territories (mig 139)
DROP POLICY IF EXISTS territories_founder_write ON public.sales_territories;
CREATE POLICY territories_founder_write ON public.sales_territories
  FOR ALL
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'marketing_manager'::app_role]))
  WITH CHECK (get_my_role() = ANY (ARRAY['founder'::app_role, 'marketing_manager'::app_role]));

-- lead_win_loss_patterns (mig 139)
DROP POLICY IF EXISTS winloss_read ON public.lead_win_loss_patterns;
CREATE POLICY winloss_read ON public.lead_win_loss_patterns
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'marketing_manager'::app_role]));

-- plant_anomaly_log (mig 139)
DROP POLICY IF EXISTS anomaly_read ON public.plant_anomaly_log;
CREATE POLICY anomaly_read ON public.plant_anomaly_log
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'om_technician'::app_role, 'project_manager'::app_role]));

-- qc_photo_findings (mig 139) — has both read + update policies
DROP POLICY IF EXISTS qc_findings_read ON public.qc_photo_findings;
CREATE POLICY qc_findings_read ON public.qc_photo_findings
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]));

DROP POLICY IF EXISTS qc_findings_review_update ON public.qc_photo_findings;
CREATE POLICY qc_findings_review_update ON public.qc_photo_findings
  FOR UPDATE
  USING (get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role]))
  WITH CHECK (get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role]));
