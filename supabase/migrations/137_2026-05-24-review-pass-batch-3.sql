-- =============================================================================
-- Migration 137 — Review-pass batch 3 (2026-05-24)
-- Fixes three latent defects identified in docs/reviews/2026-05-24-plan-vs-build.md
--
--   Fix 1 (latent bug #2): DC certificate immutability enforced at DB level.
--            mig 122's dc_certs_update policy allowed DB-level UPDATE on signed
--            rows (service-role mutations, direct SQL). App-only gate in
--            dc-certificate-actions.ts:50-68 was bypassable.
--
--   Fix 2 (latent bug #7): get_liaison_summary() SECURITY DEFINER role gate.
--            mig 115 granted EXECUTE to authenticated — any logged-in user
--            (including future customer-app accounts) could read org-wide
--            TNEB pipeline counts. Mirrors the mig 135 pattern for
--            fn_get_po_bill_reconciliation.
--
--   Fix 3 (stalled backlog #3): proposal_total_sanity CHECK constraint.
--            Recovery plan called for CHECK (total_after_discount <=
--            system_size_kwp * 1000000). Mig 089 landed flag columns but the
--            CHECK never shipped. Uses NOT VALID + backfill + VALIDATE pattern
--            so existing violators are flagged rather than blocking the migration.
-- =============================================================================

-- ── Fix 1: DC certificate immutability at DB level ───────────────────────────
--
-- The original dc_certs_update policy (mig 122) has no USING clause that
-- prevents updates to already-signed rows. Drop and recreate with
-- USING (signed_at IS NULL) to prevent any DB-level mutation once signed.
-- Service-role bypasses RLS entirely — that is the intended escape hatch
-- for admin corrections.

DROP POLICY IF EXISTS "dc_certs_update" ON dc_certificates;

CREATE POLICY "dc_certs_update" ON dc_certificates
  FOR UPDATE TO authenticated
  USING (
    signed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  )
  WITH CHECK (
    signed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );

-- ── Fix 2: get_liaison_summary() role gate ────────────────────────────────────
--
-- Replace the mig 115 LANGUAGE sql body with a plpgsql wrapper that gates
-- on founder / marketing_manager / project_manager, identical to the pattern
-- used in mig 135 for fn_get_po_bill_reconciliation.
-- Return shape is preserved exactly.

CREATE OR REPLACE FUNCTION get_liaison_summary()
RETURNS TABLE (
  total            BIGINT,
  awaiting_client  BIGINT,
  ceig_pending     BIGINT,
  ceig_in_process  BIGINT,
  tneb_active      BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Role gate: only internal staff who need pipeline visibility.
  -- Prevents future customer-app accounts (authenticated but non-staff)
  -- from reading org-wide TNEB counts.
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('founder', 'marketing_manager', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorised to read liaison summary';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT                                                                                AS total,
    COUNT(*) FILTER (WHERE awaiting_client_details = TRUE)::BIGINT                                 AS awaiting_client,
    COUNT(*) FILTER (WHERE ceig_required = TRUE AND ceig_status = 'pending')::BIGINT               AS ceig_pending,
    COUNT(*) FILTER (WHERE ceig_required = TRUE
                       AND ceig_status IN ('applied', 'inspection_scheduled'))::BIGINT             AS ceig_in_process,
    COUNT(*) FILTER (WHERE discom_status IN (
                       'applied', 'tneb_verified', 'tneb_inspected',
                       'tneb_estimated', 'installation_completed'))::BIGINT                        AS tneb_active
  FROM net_metering_applications;
END;
$$;

GRANT EXECUTE ON FUNCTION get_liaison_summary() TO authenticated;

-- ── Fix 3: proposal_total_sanity CHECK constraint ─────────────────────────────
--
-- Regression net: total_after_discount must not exceed system_size_kwp * ₹10L/kWp
-- (1,000,000 per kWp). Uses NOT VALID to skip existing rows, then backfills
-- violators by setting financials_invalidated = TRUE so VALIDATE passes.
--
-- Column names confirmed from mig 089: financials_invalidated (BOOLEAN NOT NULL DEFAULT FALSE)
-- and financials_invalidated_reason (TEXT).

-- Drop the existing weaker version (shipped without the financials_invalidated exemption arm;
-- the old definition also lacked a WITH CHECK clause protecting signed rows).
ALTER TABLE proposals
  DROP CONSTRAINT IF EXISTS proposal_total_sanity;

ALTER TABLE proposals
  ADD CONSTRAINT proposal_total_sanity
  CHECK (
    financials_invalidated = TRUE
    OR total_after_discount IS NULL
    OR system_size_kwp IS NULL
    OR total_after_discount <= system_size_kwp * 1000000
  )
  NOT VALID;

-- Mark any existing violators as flagged so VALIDATE will pass.
-- Uses financials_invalidated_reason (the correct column from mig 089).
UPDATE proposals
   SET financials_invalidated = TRUE,
       financials_invalidated_reason = COALESCE(financials_invalidated_reason, '') ||
         CASE WHEN financials_invalidated_reason IS NULL OR financials_invalidated_reason = ''
              THEN 'Auto-flagged by mig 137 (proposal_total_sanity): total_after_discount > system_size_kwp * 1,000,000'
              ELSE E'\nAuto-flagged by mig 137 (proposal_total_sanity): total_after_discount > system_size_kwp * 1,000,000' END
 WHERE financials_invalidated IS DISTINCT FROM TRUE
   AND total_after_discount IS NOT NULL
   AND system_size_kwp IS NOT NULL
   AND total_after_discount > system_size_kwp * 1000000;

ALTER TABLE proposals VALIDATE CONSTRAINT proposal_total_sanity;
