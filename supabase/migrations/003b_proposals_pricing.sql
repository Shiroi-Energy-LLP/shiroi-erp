-- ============================================================
-- Migration 003b — Proposals Pricing, Scope Split,
--                  Correction Factors
-- File: supabase/migrations/003b_proposals_pricing.sql
-- Description: Price book, scope split matrix, BOM correction
--              factors, correction override log, proposal
--              comparison scenarios.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS proposal_scenarios CASCADE;
--   DROP TABLE IF EXISTS proposal_correction_log CASCADE;
--   DROP TABLE IF EXISTS bom_correction_factors CASCADE;
--   DROP TABLE IF EXISTS proposal_scope_split CASCADE;
--   DROP TABLE IF EXISTS price_book CASCADE;
-- Dependencies: 001_foundation.sql, 003a_proposals_core.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. price_book
-- Master reference prices for all materials and labour.
-- Sales engineers use this as starting point for BOM lines.
-- Updated when actual purchase prices diverge >5% on 3+
-- purchases — system sets update_recommended flag.
-- ------------------------------------------------------------
CREATE TABLE price_book (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  item_category         TEXT NOT NULL CHECK (item_category IN (
    'panel', 'inverter', 'battery', 'structure',
    'dc_cable', 'ac_cable', 'conduit', 'earthing',
    'acdb', 'dcdb', 'net_meter', 'civil_work',
    'installation_labour', 'transport', 'other'
  )),
  item_description      TEXT NOT NULL,
  brand                 TEXT,
  model                 TEXT,
  specification         TEXT,
  -- e.g. '550W Mono PERC', '5kW Single Phase', '100Ah 48V'

  unit                  TEXT NOT NULL,
  -- 'nos', 'kw', 'sqft', 'meter', 'lumpsum'

  -- Pricing
  base_price            NUMERIC(14,2) NOT NULL,
  -- Current reference price per unit excluding GST.
  last_purchase_price   NUMERIC(14,2),
  -- Most recent actual PO price. Updated after each PO.
  price_variance_pct    NUMERIC(5,2),
  -- ((last_purchase_price - base_price) / base_price) * 100
  -- Positive = actual higher than book. Negative = cheaper.

  -- Staleness detection
  purchases_above_threshold INT NOT NULL DEFAULT 0,
  -- Count of purchases where actual > book by >5%.
  -- When this hits 3: update_recommended = TRUE.
  update_recommended    BOOLEAN NOT NULL DEFAULT FALSE,
  last_reviewed_at      DATE,

  -- GST
  gst_type              gst_type NOT NULL,
  gst_rate              NUMERIC(5,2) NOT NULL,
  hsn_code              TEXT,

  -- Validity
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until       DATE,
  -- NULL = currently active.

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            UUID REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER price_book_updated_at
  BEFORE UPDATE ON price_book
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_price_book_category ON price_book(item_category);
CREATE INDEX idx_price_book_active   ON price_book(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_price_book_update   ON price_book(update_recommended)
  WHERE update_recommended = TRUE;


-- ------------------------------------------------------------
-- 2. proposal_scope_split
-- Every BOM line is tagged to a scope owner.
-- This table holds the summary split per proposal —
-- the line-level data lives in proposal_bom_lines.scope_owner.
-- Used for: customer-facing scope clarity, liability tracking,
-- Shiroi revenue calculation (excludes client/builder scope).
-- ------------------------------------------------------------
CREATE TABLE proposal_scope_split (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id             UUID NOT NULL UNIQUE REFERENCES proposals(id) ON DELETE CASCADE,

  -- Shiroi scope totals
  shiroi_supply_value     NUMERIC(14,2) NOT NULL DEFAULT 0,
  shiroi_works_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
  shiroi_total            NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Client scope (shown in proposal for their budgeting)
  client_scope_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
  client_scope_notes      TEXT,
  -- What the client needs to arrange: civil work, earthing pit etc.

  -- Builder scope (builder's responsibility)
  builder_scope_value     NUMERIC(14,2) NOT NULL DEFAULT 0,
  builder_scope_notes     TEXT,

  -- Excluded (explicitly out of scope — documented to avoid disputes)
  excluded_scope_notes    TEXT,

  -- Liability notes
  liability_notes         TEXT,
  -- e.g. "Shiroi not responsible for builder-supplied elevated structure"

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER proposal_scope_split_updated_at
  BEFORE UPDATE ON proposal_scope_split
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_scope_split_proposal ON proposal_scope_split(proposal_id);


-- ------------------------------------------------------------
-- 3. bom_correction_factors
-- Historical correction factors per item category.
-- Seeded by importing 100 completed projects with actuals.
-- Updated on every project close when actuals are entered.
-- Engineers see raw estimate AND corrected side-by-side.
-- ------------------------------------------------------------
CREATE TABLE bom_correction_factors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  item_category         TEXT NOT NULL CHECK (item_category IN (
    'panel', 'inverter', 'battery', 'structure',
    'dc_cable', 'ac_cable', 'conduit', 'earthing',
    'acdb', 'dcdb', 'net_meter', 'civil_work',
    'installation_labour', 'transport', 'other'
  )),
  system_type           system_type,
  -- NULL = applies to all system types.
  segment               customer_segment,
  -- NULL = applies to all segments.

  -- The factor
  correction_factor     NUMERIC(6,4) NOT NULL,
  -- e.g. 1.0850 = estimates typically run 8.5% low for this category.
  -- Applied as: corrected_cost = raw_estimated_cost * correction_factor.

  -- Confidence
  data_points_count     INT NOT NULL DEFAULT 0,
  -- How many completed projects fed into this factor.
  -- Factor shown as advisory only when < 10 data points.
  last_updated_from_project_id UUID,
  -- Most recent project that updated this factor.

  -- Override monitoring
  override_count        INT NOT NULL DEFAULT 0,
  override_rate_pct     NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- If override_rate_pct > 80: factor flagged for review.
  flagged_for_review    BOOLEAN NOT NULL DEFAULT FALSE,

  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER bom_correction_factors_updated_at
  BEFORE UPDATE ON bom_correction_factors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_bcf_category_type_segment
  ON bom_correction_factors(item_category, system_type, segment)
  WHERE is_active = TRUE;
-- Ensures one active factor per category+type+segment combination.

CREATE INDEX idx_bcf_flagged ON bom_correction_factors(flagged_for_review)
  WHERE flagged_for_review = TRUE;


-- ------------------------------------------------------------
-- 4. proposal_correction_log
-- Every time an engineer overrides a correction factor,
-- it is logged here with a mandatory reason.
-- Used to calculate override_rate_pct in bom_correction_factors.
-- Immutable — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE proposal_correction_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id           UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  bom_line_id           UUID NOT NULL REFERENCES proposal_bom_lines(id) ON DELETE CASCADE,
  overridden_by         UUID NOT NULL REFERENCES employees(id),

  item_category         TEXT NOT NULL,
  system_factor         NUMERIC(6,4) NOT NULL,
  -- The correction factor that was in place.
  override_factor       NUMERIC(6,4) NOT NULL,
  -- What the engineer changed it to.
  -- 1.0000 = no correction applied.

  raw_cost              NUMERIC(14,2) NOT NULL,
  system_corrected_cost NUMERIC(14,2) NOT NULL,
  override_corrected_cost NUMERIC(14,2) NOT NULL,
  -- Difference shows the financial impact of the override.

  reason                TEXT NOT NULL,
  -- Mandatory. Cannot be blank.

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_correction_log_proposal  ON proposal_correction_log(proposal_id);
CREATE INDEX idx_correction_log_category  ON proposal_correction_log(item_category);
CREATE INDEX idx_correction_log_overrider ON proposal_correction_log(overridden_by);


-- ------------------------------------------------------------
-- 5. proposal_scenarios
-- Side-by-side comparison of system configurations.
-- e.g. "3kWp on-grid vs 5kWp hybrid with battery".
-- Shown to customer during negotiation.
-- ------------------------------------------------------------
CREATE TABLE proposal_scenarios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id           UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,

  scenario_label        TEXT NOT NULL,
  -- e.g. 'Option A — 3kWp On-Grid', 'Option B — 5kWp Hybrid'

  system_size_kwp       NUMERIC(6,2) NOT NULL,
  system_type           system_type NOT NULL,
  total_price           NUMERIC(14,2) NOT NULL,
  annual_kwh            NUMERIC(10,2),
  annual_savings        NUMERIC(14,2),
  payback_years         NUMERIC(5,2),

  is_recommended        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Shiroi's recommended option for this customer.
  display_order         INT NOT NULL DEFAULT 1,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER proposal_scenarios_updated_at
  BEFORE UPDATE ON proposal_scenarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_scenarios_proposal ON proposal_scenarios(proposal_id, display_order);


-- ------------------------------------------------------------
-- RLS — proposals pricing tables
-- ------------------------------------------------------------

-- price_book: all internal non-customer roles can read.
-- Only founder and sales_engineer can write.
ALTER TABLE price_book ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_book_read"
  ON price_book FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "price_book_write"
  ON price_book FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

-- proposal_scope_split: same access as proposals
ALTER TABLE proposal_scope_split ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scope_split_read"
  ON proposal_scope_split FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager', 'finance')
  );

CREATE POLICY "scope_split_write"
  ON proposal_scope_split FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

-- bom_correction_factors: all internal roles can read.
-- Only founder can write (factors updated by system trigger, not UI).
ALTER TABLE bom_correction_factors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bcf_read"
  ON bom_correction_factors FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "bcf_write"
  ON bom_correction_factors FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  );

-- proposal_correction_log: read for founder and sales.
-- Insert only — no updates, no deletes (immutable).
ALTER TABLE proposal_correction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "correction_log_read"
  ON proposal_correction_log FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager')
  );

CREATE POLICY "correction_log_insert"
  ON proposal_correction_log FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

-- proposal_scenarios
ALTER TABLE proposal_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scenarios_read"
  ON proposal_scenarios FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'sales_engineer', 'project_manager', 'finance')
  );

CREATE POLICY "scenarios_write"
  ON proposal_scenarios FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'sales_engineer')
  );

COMMIT;