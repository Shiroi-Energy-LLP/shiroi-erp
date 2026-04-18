-- 074_rename_expenses_fks.sql
-- Renames legacy FK constraint names on the `expenses` table (renamed from
-- `project_site_expenses` in migration 066). Postgres preserves constraint
-- names through ALTER TABLE ... RENAME, so three FKs still carry the old
-- `project_site_expenses_*_fkey` names.
--
-- This matters because `listExpenses` and `getExpense` use PostgREST FK-name
-- hints to disambiguate the four FKs from `expenses` to `employees`
-- (submitted_by, verified_by, approved_by, rejected_by). The hints assume
-- the new names — when PostgREST can't resolve `expenses_submitted_by_fkey`
-- or `expenses_approved_by_fkey`, the embed fails and the query returns an
-- empty result set. End-user symptom: project Actuals tab shows
-- "No expenses logged for this project yet." even when the project has
-- vouchers linked to it.
--
-- Applied 2026-04-18 (dev).

ALTER TABLE expenses
  RENAME CONSTRAINT project_site_expenses_submitted_by_fkey
  TO expenses_submitted_by_fkey;

ALTER TABLE expenses
  RENAME CONSTRAINT project_site_expenses_approved_by_fkey
  TO expenses_approved_by_fkey;

ALTER TABLE expenses
  RENAME CONSTRAINT project_site_expenses_project_id_fkey
  TO expenses_project_id_fkey;
