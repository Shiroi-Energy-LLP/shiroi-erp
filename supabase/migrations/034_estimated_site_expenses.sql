-- ---------------------------------------------------------------------------
-- 034: Estimated site expenses budget on projects
-- ---------------------------------------------------------------------------
-- Context: the BOI/BOM planning step should surface a PM-editable
-- budget for general site expenses (travel, food, lodging, consumables,
-- labour advances, miscellaneous) at the estimation stage. This number
-- is used in the BOQ budget analysis + Actuals step as the "budgeted"
-- baseline against which real vouchers are compared.
--
-- We intentionally store a single aggregate rather than a per-category
-- breakdown: the planning fidelity at BOI time is not high, and the
-- real record of what was spent lives in project_site_expenses.
-- ---------------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS estimated_site_expenses_budget NUMERIC(14, 2) DEFAULT 0 NOT NULL;

COMMENT ON COLUMN projects.estimated_site_expenses_budget IS
  'Planned budget for site expenses (travel, food, lodging, labour advances, etc.) entered by PM at BOI stage. Compared against actual approved vouchers in project_site_expenses.';
