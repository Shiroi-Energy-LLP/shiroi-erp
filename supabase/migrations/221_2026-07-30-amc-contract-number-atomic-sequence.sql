-- ============================================================================
-- 221 — AMC contract numbering: two atomic, sequence-backed generators
-- Date: 2026-07-30
--
-- Same defect family as mig 215 (service tickets), caught before it fired.
-- createAmcSchedule() in apps/erp/src/lib/amc-actions.ts derived
-- contract_number in TypeScript:
--
--   .from('om_contracts').select('contract_number')
--   .order('created_at', { ascending: false }).limit(1).maybeSingle()
--   nextNum = parseInt(last.contract_number.split('-').pop()) + 1
--   contractNumber = (isFree ? 'AMC-FREE' : 'AMC-PAID') + '-' + pad(nextNum)
--
-- Three defects:
--
--   1. Read-then-insert is not atomic. Two concurrent creates read the same
--      newest row and compute the same serial. Same category -> duplicate key
--      on om_contracts_contract_number_key. DIFFERENT category -> no error at
--      all, and two contracts silently share a serial (AMC-FREE-0010 +
--      AMC-PAID-0010). The silent path is the worse one: it breaks the
--      one-counter invariant the generator assumes, permanently.
--
--   2. Seeding from "newest row by created_at" instead of MAX(serial) is wrong
--      twice over — a row created out of chronological order is not the highest
--      number, and two rows sharing a created_at make ORDER BY ... LIMIT 1
--      non-deterministic, so the generator re-emits a live number. (That tie is
--      exactly what produced the reported duplicate-key error on tickets.)
--      Deleting the highest-numbered contract also walks the counter backwards.
--
--   3. split('-').pop() assumes the number ends in digits. It does not have to:
--      005d documents the original format as 'AMC-PROJ-087-Y1', whose tail is
--      'Y1' -> parseInt -> NaN -> 'AMC-FREE-NaN'. Mig 215's ticket bug was this
--      exact poisoning, via a legacy 'TKT-<project>-IR-<date>' row.
--
-- STATE OF DEV BEFORE THIS MIGRATION (verified 2026-07-30, 9 rows):
--   AMC-FREE-0001..0004, AMC-PAID-0005, AMC-PAID-0006, AMC-PAID-0007,
--   AMC-FREE-0008, AMC-PAID-0009
-- i.e. clean and duplicate-free, but a SINGLE counter shared by both prefixes,
-- so each series is gapped (FREE = 1,2,3,4,8 / PAID = 5,6,7,9). No non-digit
-- tails, no created_at ties. Nothing was corrupt — this is prevention, not
-- recovery. Vivek's call (2026-07-30): give FREE and PAID independent counters
-- and renumber the existing 9 rows so each series runs contiguously from 1.
-- 5 of 9 numbers change (AMC-FREE-0008 and all four PAID rows). Safe to do:
-- every reference to a contract is by contract_id (UUID), contract_number is
-- stored as text nowhere else in the schema, and — unlike tickets — there is no
-- RAG ingest for contracts, so no index needs refreshing afterwards.
--
-- WHY A TRIGGER AND NOT A COLUMN DEFAULT (the one deviation from mig 215):
-- a Postgres DEFAULT expression cannot read other columns of the row being
-- inserted, so it cannot branch on amc_category. Per-category numbering
-- therefore has to be a BEFORE INSERT trigger. The trigger assigns
-- unconditionally, which is strictly MORE caller-proof than a DEFAULT: a
-- DEFAULT only applies when the caller omits the column, whereas this cannot
-- be bypassed by passing a value. The column keeps a DEFAULT of '' purely so
-- that contract_number generates as optional in packages/types/database.ts and
-- callers can omit it; the trigger overwrites that placeholder every time.
-- A future bulk import that genuinely needs to preserve external numbers must
-- opt out loudly: ALTER TABLE om_contracts DISABLE TRIGGER
-- om_contracts_set_contract_number.
--
-- Applied: dev only. Prod is deferred until Vivek green-lights a prod window.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A. One sequence per prefix + the generator
--    (pattern: next_ticket_number() mig 215, next_boi_po_number() mig 210)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS om_amc_free_contract_number_seq;
CREATE SEQUENCE IF NOT EXISTS om_amc_paid_contract_number_seq;

CREATE OR REPLACE FUNCTION public.next_amc_contract_number(p_category TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  -- No fallback branch on purpose. Silently numbering an unknown or NULL
  -- category into the FREE series is how defect 3 above got started; failing
  -- the INSERT loudly is the correct outcome.
  CASE p_category
    WHEN 'free_amc' THEN
      RETURN 'AMC-FREE-' || lpad(nextval('om_amc_free_contract_number_seq')::TEXT, 4, '0');
    WHEN 'paid_amc' THEN
      RETURN 'AMC-PAID-' || lpad(nextval('om_amc_paid_contract_number_seq')::TEXT, 4, '0');
    ELSE
      RAISE EXCEPTION
        'next_amc_contract_number: amc_category must be free_amc or paid_amc, got %',
        COALESCE(p_category, 'NULL');
  END CASE;
END;
$function$;

REVOKE ALL ON FUNCTION public.next_amc_contract_number(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_amc_contract_number(TEXT) TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE om_amc_free_contract_number_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE om_amc_paid_contract_number_seq TO authenticated, service_role;

COMMENT ON FUNCTION public.next_amc_contract_number(TEXT) IS
  'Atomic AMC contract number, one independent counter per category (AMC-FREE-0001 / AMC-PAID-0001). Applied by the om_contracts_set_contract_number BEFORE INSERT trigger — never call this from application code. Numbers are never reused (a deleted contract leaves a gap, deliberate).';

-- ---------------------------------------------------------------------------
-- B. Renumber existing contracts per category, chronologically.
--    Two passes: om_contracts_contract_number_key is non-deferrable, so park
--    the old values out of the way rather than relying on per-row UPDATE
--    ordering. updated_at is preserved — a renumber is not a user edit.
-- ---------------------------------------------------------------------------

-- amc_category is nullable (mig 044 added it without NOT NULL, and a CHECK
-- constraint passes on NULL). Numbering now depends on it, so refuse to guess.
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
  FROM om_contracts
  WHERE amc_category IS NULL OR amc_category NOT IN ('free_amc', 'paid_amc');

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'Refusing to renumber: % om_contracts row(s) have a NULL/unknown amc_category. Fix those rows first.',
      v_bad;
  END IF;
END $$;

ALTER TABLE om_contracts DISABLE TRIGGER om_contracts_updated_at;

UPDATE om_contracts SET contract_number = 'TMP-' || id::TEXT;

WITH numbered AS (
  SELECT
    id,
    amc_category,
    row_number() OVER (PARTITION BY amc_category ORDER BY created_at, id) AS n
  FROM om_contracts
)
UPDATE om_contracts c
SET contract_number =
      CASE numbered.amc_category
        WHEN 'free_amc' THEN 'AMC-FREE-'
        ELSE 'AMC-PAID-'
      END
      || lpad(numbered.n::TEXT, 4, '0')
FROM numbered
WHERE numbered.id = c.id;

ALTER TABLE om_contracts ENABLE TRIGGER om_contracts_updated_at;

-- ---------------------------------------------------------------------------
-- C. Seed each sequence above its own highest existing conforming number
-- ---------------------------------------------------------------------------
SELECT setval(
  'om_amc_free_contract_number_seq',
  COALESCE(
    (SELECT MAX((regexp_match(contract_number, '^AMC-FREE-(\d+)$'))[1]::INT)
     FROM om_contracts
     WHERE contract_number ~ '^AMC-FREE-\d+$'),
    0
  ) + 1,
  false
);

SELECT setval(
  'om_amc_paid_contract_number_seq',
  COALESCE(
    (SELECT MAX((regexp_match(contract_number, '^AMC-PAID-(\d+)$'))[1]::INT)
     FROM om_contracts
     WHERE contract_number ~ '^AMC-PAID-\d+$'),
    0
  ) + 1,
  false
);

-- ---------------------------------------------------------------------------
-- D. Make correct numbering unbypassable — the whole point of the fix
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.om_contracts_set_contract_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  -- Unconditional: whatever the caller passed is discarded. See the header note
  -- on why this is a trigger rather than mig 215's column DEFAULT.
  NEW.contract_number := next_amc_contract_number(NEW.amc_category);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS om_contracts_set_contract_number ON om_contracts;
CREATE TRIGGER om_contracts_set_contract_number
  BEFORE INSERT ON om_contracts
  FOR EACH ROW
  EXECUTE FUNCTION om_contracts_set_contract_number();

-- Placeholder default so the column is omittable in generated TS types; the
-- trigger above replaces it on every insert. Never relied on for a real value.
ALTER TABLE om_contracts
  ALTER COLUMN contract_number SET DEFAULT '';

COMMENT ON COLUMN om_contracts.contract_number IS
  'AMC-FREE-0001 / AMC-PAID-0001 style serial, one independent counter per amc_category. Assigned by the om_contracts_set_contract_number BEFORE INSERT trigger, which overwrites anything the caller passes. Never set this from application code — mig 221 removed the TS generator that computed it non-atomically. The DEFAULT of '''' is a placeholder that only makes the column omittable in packages/types/database.ts.';

COMMENT ON FUNCTION public.om_contracts_set_contract_number() IS
  'BEFORE INSERT on om_contracts: stamps contract_number from next_amc_contract_number(amc_category). A DEFAULT could not do this — DEFAULT expressions cannot read amc_category. Disable this trigger explicitly if a bulk import must preserve external numbers.';

COMMIT;

-- ============================================================================
-- Verification (run after applying)
-- ============================================================================
--   -- Expect AMC-FREE-0001..0005 and AMC-PAID-0001..0004, chronological:
--   SELECT contract_number, amc_category, created_at
--     FROM om_contracts ORDER BY created_at;
--
--   -- Expect 0 rows (no duplicate serial within a category, no bad format):
--   SELECT contract_number FROM om_contracts
--    WHERE contract_number !~ '^AMC-(FREE|PAID)-\d{4}$';
--
--   -- Next values without consuming them (expect free=6, paid=5):
--   SELECT last_value, is_called FROM om_amc_free_contract_number_seq;
--   SELECT last_value, is_called FROM om_amc_paid_contract_number_seq;
--
--   -- Unknown category must raise, not silently number into FREE:
--   SELECT next_amc_contract_number('nonsense');   -- expect ERROR
--
--   -- If a sequence was consumed only for testing, re-seed:
--   SELECT setval('om_amc_free_contract_number_seq',
--     COALESCE((SELECT MAX((regexp_match(contract_number,'^AMC-FREE-(\d+)$'))[1]::INT)
--               FROM om_contracts WHERE contract_number ~ '^AMC-FREE-\d+$'), 0) + 1, false);
-- ============================================================================
