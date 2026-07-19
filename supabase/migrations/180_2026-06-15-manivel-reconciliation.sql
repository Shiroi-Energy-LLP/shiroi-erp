-- =============================================================================
-- Migration 180 — Manivel sheet reconciliation foundation
-- Spec: docs/superpowers/specs/2026-06-15-manivel-dashboard-parity-design.md
--
-- recon_sheet_projects    : snapshot of the source-of-truth workbook (Projects +
--                           Budgets sheets). Kept for audit + dashboard backfill.
-- project_reconciliation  : per-ERP-project reconciliation state Manivel edits in
--                           the reconciliation UI. Core `projects` is NOT touched
--                           until a human-clicked "commit to project" action.
-- get_project_profitability(): per-project revenue/cost rollup from ERP txns.
--   cost_erp = committed POs (excl. cancelled/draft) + approved expenses.
--
-- Additive only — alters no existing table. Dev-first; prod deferred.
-- =============================================================================

CREATE TABLE recon_sheet_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_no      INT,
  name          TEXT NOT NULL,
  name_norm     TEXT NOT NULL,
  size_kwp      NUMERIC,
  status        TEXT,
  location      TEXT,
  sheet_year    INT,
  project_cost  NUMERIC,            -- revenue ("Project Cost")
  actual_cost   NUMERIC,            -- sheet "Actual Cost"
  profit_rs     NUMERIC,            -- project_cost - actual_cost
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_recon_sheet_name_norm ON recon_sheet_projects(name_norm);
CREATE INDEX idx_recon_sheet_year      ON recon_sheet_projects(sheet_year);

CREATE TABLE project_reconciliation (
  project_id         UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  matched_sheet_id   UUID REFERENCES recon_sheet_projects(id) ON DELETE SET NULL,
  match_score        NUMERIC,
  match_method       TEXT,          -- auto | likely | ambiguous | manual | erp_only | sheet_only
  status             TEXT NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed','confirmed','rejected')),
  resolved_year      INT,           -- dashboard year; anything < 2022 groups as "<=2021"
  resolved_status    TEXT,
  sheet_project_cost NUMERIC,
  sheet_actual_cost  NUMERIC,
  revenue_erp        NUMERIC,
  cost_erp           NUMERIC,
  preferred_source   TEXT NOT NULL DEFAULT 'erp'
                       CHECK (preferred_source IN ('erp','sheet')),
  reviewed_by        UUID REFERENCES employees(id),
  reviewed_at        TIMESTAMPTZ,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_project_recon_status ON project_reconciliation(status);
CREATE INDEX idx_project_recon_method ON project_reconciliation(match_method);
CREATE INDEX idx_project_recon_sheet  ON project_reconciliation(matched_sheet_id);
CREATE INDEX idx_project_recon_year   ON project_reconciliation(resolved_year);

CREATE TRIGGER project_reconciliation_updated_at
  BEFORE UPDATE ON project_reconciliation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: all authenticated employees read; founder + project_manager write.
ALTER TABLE recon_sheet_projects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recon_sheet_read" ON recon_sheet_projects
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "recon_sheet_write" ON recon_sheet_projects
  FOR ALL TO authenticated
  USING (get_my_role() IN ('founder','project_manager'))
  WITH CHECK (get_my_role() IN ('founder','project_manager'));

CREATE POLICY "project_recon_read" ON project_reconciliation
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_recon_insert" ON project_reconciliation
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('founder','project_manager'));
CREATE POLICY "project_recon_update" ON project_reconciliation
  FOR UPDATE TO authenticated
  USING (get_my_role() IN ('founder','project_manager'))
  WITH CHECK (get_my_role() IN ('founder','project_manager'));

-- Per-project profitability rollup from real ERP transactions (NEVER-DO #12: SQL, not JS).
-- revenue = contracted_value; cost = committed POs (excl cancelled/draft) + approved expenses.
CREATE OR REPLACE FUNCTION get_project_profitability(p_project_id UUID DEFAULT NULL)
RETURNS TABLE (
  project_id    UUID,
  revenue_erp   NUMERIC,
  cost_po       NUMERIC,
  cost_expenses NUMERIC,
  cost_erp      NUMERIC,
  margin_pct    NUMERIC
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH po AS (
    SELECT project_id, SUM(total_amount) AS amt
    FROM purchase_orders
    WHERE project_id IS NOT NULL AND status NOT IN ('cancelled','draft')
    GROUP BY project_id
  ),
  ex AS (
    SELECT project_id, SUM(amount) AS amt
    FROM expenses
    WHERE project_id IS NOT NULL AND status = 'approved'
    GROUP BY project_id
  )
  SELECT p.id,
         p.contracted_value,
         COALESCE(po.amt, 0),
         COALESCE(ex.amt, 0),
         COALESCE(po.amt, 0) + COALESCE(ex.amt, 0),
         CASE WHEN p.contracted_value > 0
              THEN ROUND((p.contracted_value - (COALESCE(po.amt,0) + COALESCE(ex.amt,0)))
                         / p.contracted_value * 100, 2)
              ELSE NULL END
  FROM projects p
  LEFT JOIN po ON po.project_id = p.id
  LEFT JOIN ex ON ex.project_id = p.id
  WHERE p.deleted_at IS NULL
    AND (p_project_id IS NULL OR p.id = p_project_id);
$$;

REVOKE ALL ON FUNCTION get_project_profitability(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_project_profitability(UUID) TO authenticated;
