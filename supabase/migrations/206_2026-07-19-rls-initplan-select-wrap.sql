-- 206: Wrap bare auth.uid()/auth.jwt()/auth.role()/auth.email() calls in RLS policies
-- in scalar sub-selects so Postgres evaluates them ONCE per query (InitPlan) instead of
-- per-row. Fixes the 185 `auth_rls_initplan` performance-advisor warnings (2026-07-19
-- ERP speed report, docs/reviews/2026-07-19-erp-speed-full-report.md).
-- Behavior-preserving: (SELECT auth.uid()) === auth.uid() semantically; both are STABLE
-- within a statement. Idempotent: re-running finds nothing bare to wrap.
-- Applied to dev 2026-07-19 (wrapped 105 quals + 85 with_checks across ~190 policies;
-- post-check: 0 bare calls remain in public schema).
DO $mig$
DECLARE
  p record;
  nq text;
  nc text;
  stmt text;
  cnt int := 0;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') ~ 'auth\.(uid|jwt|role|email)\(\)'
        OR coalesce(with_check, '') ~ 'auth\.(uid|jwt|role|email)\(\)')
  LOOP
    nq := p.qual;
    nc := p.with_check;

    -- 3-step rewrite so already-wrapped calls are not double-wrapped:
    -- (1) normalize existing "( SELECT auth.x() AS x)" forms to a placeholder,
    -- (2) wrap the remaining bare calls, (3) restore placeholders as wrapped calls.
    IF nq IS NOT NULL THEN
      nq := regexp_replace(nq, '\(\s*SELECT\s+auth\.(uid|jwt|role|email)\(\)\s+AS\s+\w+\s*\)', '@@W_\1@@', 'gi');
      nq := regexp_replace(nq, 'auth\.(uid|jwt|role|email)\(\)', '(SELECT auth.\1())', 'g');
      nq := regexp_replace(nq, '@@W_(uid|jwt|role|email)@@', '(SELECT auth.\1())', 'g');
    END IF;
    IF nc IS NOT NULL THEN
      nc := regexp_replace(nc, '\(\s*SELECT\s+auth\.(uid|jwt|role|email)\(\)\s+AS\s+\w+\s*\)', '@@W_\1@@', 'gi');
      nc := regexp_replace(nc, 'auth\.(uid|jwt|role|email)\(\)', '(SELECT auth.\1())', 'g');
      nc := regexp_replace(nc, '@@W_(uid|jwt|role|email)@@', '(SELECT auth.\1())', 'g');
    END IF;

    IF (nq IS DISTINCT FROM p.qual) OR (nc IS DISTINCT FROM p.with_check) THEN
      stmt := format('ALTER POLICY %I ON public.%I', p.policyname, p.tablename);
      IF nq IS NOT NULL AND nq IS DISTINCT FROM p.qual THEN
        stmt := stmt || format(' USING (%s)', nq);
      END IF;
      IF nc IS NOT NULL AND nc IS DISTINCT FROM p.with_check THEN
        stmt := stmt || format(' WITH CHECK (%s)', nc);
      END IF;
      EXECUTE stmt;
      cnt := cnt + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'initplan-wrapped % policies', cnt;
END
$mig$;
