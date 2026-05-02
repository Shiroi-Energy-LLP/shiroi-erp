-- ============================================================================
-- Migration 106 — Reseed all doc-number sequences after bulk imports
-- Date: 2026-05-02
--
-- BUG REPORTED BY VIVEK (2026-05-02 post-mig-105)
-- -----------------------------------------------
--   "Quick quote proposal is not working, because you are not numbering it."
--
-- ROOT CAUSE
-- ----------
-- generate_doc_number(doc_type) (mig 005-ish) calls nextval on a global
-- per-type sequence (proposal_number_seq, project_number_seq, etc.) and
-- formats the result as `SHIROI/<TYPE>/<FY>/NNNN`. Bulk imports
-- (HubSpot/Zoho/Drive — multiple over the past months) INSERT rows with
-- hardcoded numbers like SHIROI/PROP/2025-26/0277 but DO NOT advance the
-- sequence.
--
-- After all those imports, the actual data goes up to suffix 277 for
-- proposals (388 canonical out of 798) and 264 for projects (362 out of
-- 362), but the sequences are stuck at:
--   proposal_number_seq = 6
--   project_number_seq  = 7
--   po_number_seq       = 37
--   invoice_number_seq  = NULL (never called)
--   credit_note_number_seq, receipt_number_seq, proforma_number_seq = NULL
--
-- So the next genuine generate_doc_number('PROP') returns 0007 — which
-- already exists. The Quick Quote action's INSERT fails with:
--   duplicate key value violates unique constraint "proposals_proposal_number_key"
-- The only error path Vivek saw said "Failed to create proposal: duplicate key…"
-- which read to him as "you are not numbering it" — close enough; the
-- numbering was producing collisions, not blanks.
--
-- Same latent bug for every other doc type: the next time someone tries
-- to raise an invoice, credit note, payment receipt, proforma, or PO,
-- they'll hit the same wall.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Audits each `*_number_seq` sequence against the MAX canonical numeric
--    suffix in its source table (where canonical = matches the
--    `^SHIROI/<TYPE>/<FY>/<digits>$` pattern; non-canonical legacy values
--    like "137.2", "SE/PV/034/22" are ignored — they pre-date the sequence
--    and don't collide with it).
-- 2. Calls setval to advance the sequence to GREATEST(current, max_suffix).
--    Never goes backwards — safe to re-run.
-- 3. Wraps each in `to_regclass IS NOT NULL` so the migration is robust
--    against future schema changes that drop or rename tables.
--
-- DEFENSE-IN-DEPTH (FUTURE WORK, NOT IN THIS MIGRATION)
-- -----------------------------------------------------
-- A post-insert trigger on each numbered table that does
--   PERFORM setval('<seq>', GREATEST(currval(...), inserted_suffix))
-- on every canonical insert would prevent this from happening again
-- without scripts having to remember. Out of scope here — focused on
-- unblocking Vivek's testing today.
-- ============================================================================

BEGIN;

-- Helper to bump one sequence to GREATEST(current, max canonical suffix)
-- in the named table+column. No-ops if the table doesn't exist.
CREATE OR REPLACE FUNCTION public._reseed_doc_seq(
  p_seq        TEXT,
  p_table      TEXT,
  p_column     TEXT,
  p_doc_type   TEXT
) RETURNS TABLE (
  seq_name      TEXT,
  table_name    TEXT,
  before_value  BIGINT,
  max_suffix    INT,
  after_value   BIGINT
)
LANGUAGE plpgsql
AS $func$
DECLARE
  v_pattern   TEXT;
  v_before    BIGINT;
  v_max       INT;
  v_after     BIGINT;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RAISE NOTICE 'reseed: table %s does not exist; skipping seq %s', p_table, p_seq;
    RETURN;
  END IF;

  v_pattern := '^SHIROI/' || p_doc_type || '/[0-9]{4}-[0-9]{2}/[0-9]+$';

  EXECUTE format(
    $q$
      SELECT MAX(
        CASE WHEN %I ~ %L
        THEN substring(%I from '/([0-9]+)$')::int END
      ) FROM %I
    $q$, p_column, v_pattern, p_column, p_table
  ) INTO v_max;

  EXECUTE format('SELECT last_value FROM %I', p_seq) INTO v_before;

  IF v_max IS NULL THEN
    RAISE NOTICE 'reseed: no canonical %s rows in %s.%s; leaving %s at %s',
      p_doc_type, p_table, p_column, p_seq, v_before;
    RETURN QUERY SELECT p_seq, p_table, v_before, NULL::INT, v_before;
    RETURN;
  END IF;

  -- setval(N, true) → next nextval returns N+1
  EXECUTE format('SELECT setval(%L, GREATEST(%s, %s), true)', p_seq, v_before, v_max);
  EXECUTE format('SELECT last_value FROM %I', p_seq) INTO v_after;

  RAISE NOTICE 'reseed: %s before=% after=% (max canonical suffix in %s.%s = %)',
    p_seq, v_before, v_after, p_table, p_column, v_max;

  RETURN QUERY SELECT p_seq, p_table, v_before, v_max, v_after;
END;
$func$;

-- Reseed every doc-number sequence used by generate_doc_number()
SELECT * FROM public._reseed_doc_seq('proposal_number_seq',    'proposals',           'proposal_number',    'PROP');
SELECT * FROM public._reseed_doc_seq('project_number_seq',     'projects',            'project_number',     'PROJ');
SELECT * FROM public._reseed_doc_seq('invoice_number_seq',     'invoices',            'invoice_number',     'INV');
SELECT * FROM public._reseed_doc_seq('credit_note_number_seq', 'invoice_credit_notes','credit_note_number', 'CN');
SELECT * FROM public._reseed_doc_seq('receipt_number_seq',     'customer_payments',   'receipt_number',     'REC');
SELECT * FROM public._reseed_doc_seq('po_number_seq',          'purchase_orders',     'po_number',          'PO');
SELECT * FROM public._reseed_doc_seq('proforma_number_seq',    'proforma_invoices',   'proforma_number',    'PI');

-- Drop the temporary helper. Keeping it would let anyone with privileges
-- re-trigger reseeds at runtime; leaving migrations idempotent + auditable
-- is cleaner. If we later need it as an ops tool, re-add it explicitly.
DROP FUNCTION public._reseed_doc_seq(TEXT, TEXT, TEXT, TEXT);

COMMIT;
