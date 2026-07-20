# Projects List — Expected Dates, Next Follow-up, Multi-Status Filter, Completed-Last Sort

**Date:** 2026-07-20
**Status:** Approved (design sign-off by Vivek 2026-07-20)
**Module:** projects (`docs/modules/projects.md`)

## Problem

The `/projects` list can't answer three PM questions:

1. When is each project expected to start / finish? (`planned_start_date` / `planned_end_date` exist on `projects` since mig 004a and are editable in the Details-tab Timeline box, but are not list columns.)
2. When is the next follow-up due — especially for `holding_client` and `meter_client_scope` projects where the ball is in the customer's court? (No such field exists on `projects`; leads have `next_followup_date` + task sync via mig 108.)
3. Filtering is single-status only, and sorting by Status uses the Postgres enum declaration order, which lands `completed` in the middle of the list instead of last.

## Decisions (from design Q&A)

- **Reuse** `planned_start_date` / `planned_end_date` as the "Expected Start" / "Expected Completion" columns — one source of truth shared with the Timeline box. No new date columns for these.
- The three date columns are **hidden by default** (available via the column picker; saveable in views, mig 178).
- Setting Next Follow-up **auto-syncs a task**, mirroring the lead behaviour (mig 108) — DB trigger, not app-level.

## Schema — Migration 212 (`212_2026-07-20-projects-followup-and-status-rank.sql`; renumbered from 210 — the parallel purchase-flow session took 210/211)

1. `ALTER TABLE projects ADD COLUMN next_followup_date DATE;`
   + `CREATE INDEX idx_projects_next_followup ON projects(next_followup_date) WHERE deleted_at IS NULL;`
2. `ALTER TABLE projects ADD COLUMN status_rank SMALLINT GENERATED ALWAYS AS (CASE status ... END) STORED;` + index.
   Rank: `order_received`=1, `yet_to_start`=2, `in_progress`=3, `holding_shiroi`=4, `holding_client`=5, `waiting_net_metering`=6, `meter_client_scope`=7, `completed`=8 (**last**).
3. Indexes on `planned_start_date` and `planned_end_date` (`WHERE deleted_at IS NULL`) — they become sortable list columns (NEVER-DO #17).
4. Expand `tasks_category_check` with `'project_followup'`.
5. `sync_project_followup_task()` trigger function + `trg_sync_project_followup_task`
   `AFTER INSERT OR UPDATE OF next_followup_date, project_manager_id, deleted_at ON projects` — mirrors `sync_lead_followup_task` (mig 108):
   - Skip when `NEW.deleted_at IS NOT NULL` (soft-close the open follow-up task in that branch, same as date-cleared).
   - Assignee: `NEW.project_manager_id` → oldest active `project_manager` → oldest active `founder` (never NULL; `tasks.assigned_to` is NOT NULL since mig 108).
   - Find open task: `entity_type='project' AND entity_id=NEW.id AND category='project_followup' AND is_completed=FALSE AND deleted_at IS NULL`.
   - Date set: upsert (update due_date+assignee of the open task, else INSERT with `entity_type='project'`, `entity_id=NEW.id`, **and `project_id=NEW.id`** so the task appears on both the Execution tab and /tasks; title `'Follow up: ' || customer_name`; priority `medium`; `created_by = assignee`).
   - Date cleared: soft-close the open task (`is_completed=TRUE, completed_at=NOW()`).
6. No backfill needed (column is brand new, all NULL).

Regenerate `packages/types/database.ts` in the same commit (strip step + `pnpm check-types`). **Dev DB only** — prod untouched per the standing dev-only rule.

## Query — `getProjects` (`apps/erp/src/lib/projects-queries.ts`)

- `ProjectFilters.status` becomes `ProjectStatus[]` (page parses the comma-separated URL param); filter with `.in('status', arr)`. A 1-element array preserves today's behaviour (summary-header chips keep linking with a single status).
- When `sort === 'status'`, order by `status_rank` (same asc/desc direction) instead of the enum column.
- Add `next_followup_date` to the select (planned dates are already selected).

## UI

- **Filter bar** (`apps/erp/src/app/(erp)/projects/page.tsx`): replace the status `FilterSelect` with the existing `FilterMultiSelect` (`filter-multi-select.tsx`, comma-separated param). `STATUS_OPTIONS` unchanged.
- **Columns** (`PROJECT_COLUMNS` in `column-config.ts`), all `defaultVisible: false`, `sortable: true`, `editable: true`, `fieldType: 'date'`, `format: 'date'`:
  - `planned_start_date` — label **Expected Start**
  - `planned_end_date` — label **Expected Completion**
  - `next_followup_date` — label **Next Follow-up**
- Inline edits flow through the existing `updateCellValue` unchanged (keys match DB columns; task sync happens in the DB trigger). No new components.

## Error handling / edge cases

- Trigger never blocks the project write for task-sync reasons other than hard DB errors (single transaction, same as leads — accepted trade-off, consistent with mig 108).
- `status_rank` is generated — nothing writes it; inline status edits recompute it automatically.
- Multi-status param with junk values: PostgREST rejects invalid enum values with an error; the page filters the parsed list against `STATUS_OPTIONS` values before querying to avoid that.
- Saved views are untouched; users who want the new columns toggle them on and re-save.

## Testing

- CI gates: `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`.
- Manual on dev: set/clear/change `next_followup_date` on a project → task appears/moves/closes on Execution tab + /tasks; multi-select two statuses → list unions them; sort by Status asc → `completed` block is last; chip links from the summary header still filter.
- SQL sanity after applying 210: `SELECT status, status_rank FROM projects GROUP BY 1,2 ORDER BY 2;`
