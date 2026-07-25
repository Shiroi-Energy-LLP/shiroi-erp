-- 214_2026-07-25-payment-dashboard-supersede.sql
--
-- Aligns ERP receivables to Prem's "Payment Dashboard.xlsx" (Google Drive,
-- owner prem@shiroienergy.com, modified 2026-07-25).
--
-- SCOPE: the 26 sheet rows that map 1:1 to an active project by customer_name.
-- The other 9 sheet rows are ambiguous or unmatched and are deliberately left
-- alone pending Vivek's ruling (see docs/reviews/2026-07-25-payment-dashboard-supersede.md).
-- The 466 projects the sheet says nothing about are untouched — the Zoho Books
-- ledger (1,078 zoho_import payments back to 2023) stays intact.
--
-- TIER-3 SAFETY: customer_payments is immutable (finance.md). This migration
-- issues NO UPDATE and NO DELETE against it. Where the sheet disagrees with the
-- ERP total, the difference is posted as a single dated counter-entry so the
-- audit trail is preserved and reversible.
--
-- Verified before writing: no CHECK constraint on customer_payments.amount, so
-- negative counter-entries are legal; and none of these 26 projects has a
-- channel-partner lead, so trg_create_consultant_payout_on_customer_payment
-- is a no-op for every row inserted here.

BEGIN;

CREATE TEMP TABLE pd_sheet (
  sheet    TEXT PRIMARY KEY,
  erp_name TEXT NOT NULL,
  po       NUMERIC(14,2) NOT NULL,
  rcv      NUMERIC(14,2) NOT NULL
) ON COMMIT DROP;

INSERT INTO pd_sheet (sheet, erp_name, po, rcv) VALUES
  ('LOUIS',                 'Louis',                          343000,  100000),
  ('ANANTHA PADBANABAN',    'Anantha Padmanaban',             320000,  150000),
  ('SRI SUPRAPATHAM',       'Sri Suprabatham',                992000,  410000),
  ('KANDAN',                'Kandan Kolathur',                625000,  400000),
  ('4BRICKS - SRI MEENAKSHI','4 Bricks Sri Meenakshi',        300000,  100000),
  ('ANBAZHAGAN',            'Anbazhagan',                     206000,  100000),
  ('JAYANTHI',              'Jayanthi',                       588140,  588140),
  ('NAVINS SADHPRABHA',     'Navins Sadhprabha',              196000,   68000),
  ('JOTHIRAM',              'Jothiram',                       340000,  200000),
  ('SWAMINATHAN',           'Swaminathan - Mahalingapuram',   434000,  360000),
  ('SUNIL',                 'Sunil',                          210000,       0),
  ('DRA TRINITY',           'DRA - Trinity',                 1370979,  258000),
  ('DRA SKYLANTIS',         'DRA - Skylanties',               787865,  350000),
  ('DRA DOWNTOWN',          'DRA - Downtown',                2665214,  436000),
  ('NEWRY ADORA',           'Newry Adora',                    800788,  674493),
  ('RAMANIYAM SRIDEVI',     'Ramaniyam Sridevi',              282742,       0),
  ('LANCOR BAGYA',          'Lancor Bagya',                   238959,  107827),
  ('4BRICKS - RBI COLONY',  '4Bricks - RBI colony',           145882,  135882),
  ('SATHISH',               'Mr Sathish',                     205000,  100000),
  ('GOPI GUDUVANCHERY',     'Gopi Guduvanchery',              400000,  100000),
  ('KRISHNA - ZIRVE',       'Zirve Project [ krishna Group ]',1129744,  256652),
  ('LANCOR - SUMMIT',       'Lancor Holding',                 410849,       0),
  ('PP SUNDARRAJAN',        'PP Sundarrajan',                 340000,  200000),
  ('BANSIDHAR',             'Bansidhar',                      576000,       0),
  ('S&P - COURTYARD',       'S&P Courtyard',                 1200000,       0),
  ('PRESTIGE ESTATES',      'Prestige Hill Crest',           8967223, 7428225);

-- Resolve to project ids and snapshot the pre-change ERP received total.
CREATE TEMP TABLE pd_map ON COMMIT DROP AS
SELECT s.sheet,
       s.po,
       s.rcv,
       p.id AS project_id,
       COALESCE((SELECT SUM(cp.amount)
                   FROM customer_payments cp
                  WHERE cp.project_id = p.id), 0)::NUMERIC(14,2) AS erp_rcv
  FROM pd_sheet s
  JOIN projects p
    ON BTRIM(p.customer_name) = s.erp_name
   AND p.deleted_at IS NULL;

-- Abort rather than half-apply if the name mapping drifted since it was verified.
DO $$
DECLARE
  v_rows INT;
  v_dupes INT;
BEGIN
  SELECT COUNT(*) INTO v_rows FROM pd_map;
  IF v_rows <> 26 THEN
    RAISE EXCEPTION 'pd_map resolved % projects, expected 26 — name mapping drifted, aborting', v_rows;
  END IF;

  SELECT COUNT(*) INTO v_dupes
    FROM (SELECT sheet FROM pd_map GROUP BY sheet HAVING COUNT(*) > 1) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION '% sheet rows matched more than one project, aborting', v_dupes;
  END IF;
END $$;

-- 1. PO value: the sheet is authoritative.
UPDATE projects p
   SET contracted_value = m.po
  FROM pd_map m
 WHERE p.id = m.project_id
   AND p.contracted_value IS DISTINCT FROM m.po;

-- 2. Received total: post the difference as a Tier-3 counter-entry.
INSERT INTO customer_payments (
  id, project_id, amount, payment_date, payment_method, receipt_number,
  recorded_by, source, erp_recorded, is_advance, attribution_status, notes
)
SELECT gen_random_uuid(),
       m.project_id,
       (m.rcv - m.erp_rcv),
       DATE '2026-07-25',
       'bank_transfer',
       'PD-ADJ-20260725-' || UPPER(REGEXP_REPLACE(m.sheet, '[^A-Za-z0-9]+', '-', 'g')),
       '575b0a7c-03bf-49a4-8d97-98746045cedc',  -- Vivek Sridhar
       'erp',
       TRUE,
       FALSE,
       'assigned',
       'Payment Dashboard reconciliation 2026-07-25 (source: Prem''s Payment Dashboard.xlsx). '
         || 'Counter-entry aligning ERP received total to the sheet. Prior ERP total '
         || m.erp_rcv::TEXT || ', sheet total ' || m.rcv::TEXT || '.'
  FROM pd_map m
 WHERE m.rcv <> m.erp_rcv;

COMMIT;
