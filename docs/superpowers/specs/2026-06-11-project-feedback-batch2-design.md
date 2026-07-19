# Project Feedback Batch 2 — Design

**Date:** 2026-06-11
**Status:** Approved by Vivek (design presented in chat 2026-06-11; "Pls go ahead… execute all of this overnight"). Executed autonomously overnight per that instruction.
**Scope:** 12 feedback items across Projects, Execution/Tasks, Activities, Service Tickets, AMC, Price Book.
**Migration:** 177 only, **dev-only** (standing rule).

## Decisions locked with Vivek

| Question | Decision |
|---|---|
| Year filter basis | **Financial year (Apr–Mar) on `order_date`**, falling back to `created_at` when order_date is NULL |
| Delete Project UX | **Soft delete, no restore UI** — PM + founder only, type-project-number-to-confirm; restore via DB only |
| Activities "manually add a Stage" | **Free-text stage on the activity** (`stage_custom`); the 10-milestone master list untouched |
| Task Log removal scope | **Only the /tasks table** (Log column + expandable panel). Execution Activity-Log column and the task-detail Work Log card STAY |

## Findings from exploration that shaped the design

1. `projects.deleted_at` already exists (mig 004a) and `getProjects` already filters it — soft delete needs only an action + UI + `deleted_by` audit column. Hard delete is impossible regardless (RESTRICT FKs from invoices, customer_payments, purchase_orders, daily_site_reports, site_photos, commissioning_reports, qc_gate_inspections, om_contracts, plants, project_site_expenses, project_change_orders…).
2. The projects list search is `.or()` string interpolation over project_number+customer_name (`projects-queries.ts:48-52`) — one of the May-30 flagged injection patterns, and it misses `project_name`. Replacing it with an RPC fixes both.
3. Service tickets: `ticket_number` is auto-generated in `createServiceTicket` (TKT-NNNN; no form field) and `created_at` is `DEFAULT NOW()` — **item #8 is already satisfied**; item #7 means removing the *displayed* "Ticket #" column.
4. **Price-book add/edit dialogs are broken today**: their hardcoded 24-value legacy `CATEGORY_OPTIONS` (e.g. `solar_panel`, `mounting_structure`) violate the mig-057 CHECK constraint (Manivel-15: `solar_panels`, `mms`, …) — saving most categories fails with a DB error. The managed-lists work (#11/#12) inherently fixes this.
5. Tasks: BOTH creation paths (`createTask` from /tasks, `createQuickTask` from Execution) already set `project_id` + `entity_type='project'` + `entity_id`; `getAllTasks` has no entity filter; the Execution fetch was hardened 2026-06-11 for entity-only rows. Item #4's symptom is likely already resolved — the remaining real gap is that the /tasks create dialog has **no milestone picker**, so tasks created there can never appear under a milestone group. Verification against dev data is part of the work.

---

## Migration 177 — `177_2026-06-11-feedback-batch2.sql` (dev only)

1. **`projects.deleted_by UUID REFERENCES employees(id)`** (audit for soft delete; `deleted_at` already exists).
2. **RPC `search_projects_lite(p_query TEXT DEFAULT NULL, p_limit INT DEFAULT 12)`** → `(id, project_number, customer_name, project_name, status, order_date)`; matches `customer_name`/`project_name`/`project_number` via ILIKE; excludes `deleted_at IS NOT NULL`; newest-first; limit clamped 1..200; `SET search_path = public`; EXECUTE to authenticated only. (Cast `order_date` to text in the RETURNS if the column is TEXT — implementer verifies against database.ts.)
3. **`project_activities.stage_custom TEXT`** — free-text stage; display precedence `stage_label ?? stage_custom`.
4. **`item_categories`** (`id, value UNIQUE, label, is_active, sort_order, created_at`) seeded with the Manivel-15 (values+labels from `boi-constants.ts`, sort 10…150). **`item_units`** (`id, value UNIQUE, is_active, sort_order, created_at`) seeded with Vivek's list — Nos, No, KWp, Kg, Set, Meter, Packet, Wp, Lot, Box, Length — UNION'd with every distinct `unit` value currently present in `price_book` + `project_boq_items` (so the FK-free existing rows keep matching pickers). RLS: SELECT all authenticated; INSERT/UPDATE founder + project_manager + purchase_officer via `get_my_role()`; no DELETE policy (deactivate via `is_active`).
5. **price_book**: `DROP CONSTRAINT price_book_item_category_check`; add FK `price_book.item_category REFERENCES item_categories(value)` (existing rows are Manivel-15-clean per mig 057, so the FK backfills). `unit` stays free TEXT (UI-driven).

## 1. Projects — year filter (#1)

- `getProjects` accepts `fy?: string` ('2026-27'). When set: `from = <startYear>-04-01`, `to = <startYear+1>-04-01`, filter `.or(and(order_date.gte.<from>,order_date.lt.<to>),and(order_date.is.null,created_at.gte.<from>,created_at.lt.<to>))` — the interpolated values are internally generated dates, not user text (safe).
- Page: `FilterSelect paramName="year"` with FY options 2014-15 → current FY (static computed list; legacy imports reach back to 2014), label "FY 2026-27".

## 2. Projects — delete (#2)

- `deleteProject` action in `project-detail-actions.ts`: role gate `founder|project_manager` (via getUserProfile), `deleted_at = now()`, `deleted_by = getCurrentEmployeeId()`; revalidates `/projects`.
- UI: `DeleteProjectCard` (client) in the Details tab right column — red-outline "Delete Project", dialog requires typing the exact `project_number`, then deletes and `router.push('/projects')`. Rendered only for PM/founder (viewerRole already fetched on that page).
- `getProject` (detail fetch) gains `.is('deleted_at', null)` so deleted projects 404 everywhere.

## 3. Projects — auto search (#3)

- **`ProjectCombobox`**: `ProjectOpt` gains optional `project_name`; the filter matches it; display becomes `Customer – Project Name` (name only when set) with project_number right-aligned. All suppliers of `projects` props extend their selects to include `project_name`: expenses page, `getProjectOptionsForActivities`, OM (plant-monitoring filter + create dialog, add-inverter), tickets page, AMC queries.
- **Projects list typeahead**: new `searchProjectsLite` server action (wraps the RPC, mirroring `searchContactsLite`); new `ProjectsSearchBox` client component replacing the plain `SearchInput` on `/projects` — keeps the debounced `?search=` URL behavior AND shows a suggestions dropdown ("Customer – Project Name", number right-aligned); clicking a suggestion navigates to `/projects/[id]`.
- **List search fixed**: `getProjects`' `.or()` ILIKE is replaced by RPC-resolved ids: `search_projects_lite(search, 500)` → `.in('id', ids)` (empty → empty page). Kills the flagged injection pattern and makes `project_name` searchable.

## 4. Execution/Tasks — visibility (#4)

- Add an optional **Milestone** select to the /tasks create dialog: appears when a project is chosen, options loaded via a light server action `getProjectMilestonesLite(projectId)` → `(id, milestone_name)`; `createTask` input + insert gain `milestoneId`.
- Verify on dev data: count `tasks` with `entity_type='project' AND entity_id IS NOT NULL AND project_id IS NULL` (should be covered by the 2026-06-11 hardening) and spot-check a /tasks-created task appears on its project's Execution tab. Record results in the close-out.

## 6. Tasks — Log removal (#6, scope per decision)

- `/tasks` page table: remove the `Log` `<th>` (page.tsx:153) and in `tasks-table.tsx` the Log cell, expansion state/handlers, expanded row, and the now-orphaned `ActivityLogPanel` component.
- KEEP: Execution tables' Activity Log column (`ActivityLogCell`), task-detail Work Log card (`TaskWorkLog`), `task_work_logs` table + actions.

## 5. Activities (#5)

- **Project column (global page)**: show `project_name ?? customer_name` only; remove the small project_number line. (`listProjectActivities` already returns both; adjust `project_customer` mapping to prefer project_name and drop the number from display.)
- **Word wrap**: Description cells switch from `truncate` to `whitespace-normal break-words` (both per-project and global tables); same for Notes.
- **Add from global page**: `/activities` gets an "Add Activity" button (PM/founder) opening `ActivityFormDialog` extended with an optional project picker mode: new props `projects?: ProjectOpt[]` — when provided (and no fixed `projectId`), a required `ProjectCombobox` row appears at the top; submit uses the picked id.
- **Custom stage**: Stage select gains `Other (type below)…` (sentinel `__custom__`) revealing a text input bound to `stage_custom`. `ActivityInput` + actions carry `stageCustom: string | null` (mutually exclusive with `stageId` — choosing a master stage clears custom and vice versa). Tables display `stage_label ?? stage_custom ?? '—'`; list query maps `stage_custom` through. Summary/stage filters keep operating on master `stage_id` only.

## 7–9. Service Tickets

- **#7**: remove the "Ticket #" column from `/om/tickets` list (th + td); strip any other *displayed* `ticket_number` in OM UI (detail header shows it — replace with title; `DeleteTicketButton` confirm text switches to the ticket title). Generation + schema unchanged (numbers still mint internally; UNIQUE stays).
- **#8**: no change needed — `created_at DEFAULT NOW()` is automatic and already displayed in the list; verified.
- **#9**: `create-ticket-dialog.tsx` swaps the plain `<Select>` for `ProjectCombobox` (projects prop extended with project_name + number).

## 10. AMC

- `create-amc-dialog.tsx`: replace the `<Select>` with `ProjectCombobox`, preserving (a) the free-AMC (commissioned projects) vs paid-AMC (all projects) list switch, (b) the commissioned-date autofill on selection (onChange id → find row in the active list). `getCommissionedProjects` / `getAllProjectsForAmc` selects gain `project_number, project_name`.

## 11–12. Price Book — managed categories + units

- **Queries/actions**: `item-catalog-queries.ts` (`listItemCategories`, `listItemUnits`, each `activeOnly` default true) + `item-catalog-actions.ts` (`addItemCategory(label)` → slugified unique value, `addItemUnit(value)`, `toggleItemCategoryActive`, `toggleItemUnitActive`) gated founder + project_manager + purchase_officer; ActionResult shape.
- **Price-book dialogs**: delete the stale hardcoded `CATEGORY_OPTIONS`/`UNIT_OPTIONS`; both dialogs take `categories`/`units` props (page fetches server-side). Each dropdown gets a pinned **“+ Add new…”** choice that reveals an inline input and calls the add action, then selects the new value (router.refresh on close).
- **Settings surface**: `/price-book/settings` page (founder + purchase_officer + PM) — two cards (Categories: label+value+active toggle+add; Units: value+active toggle+add). Linked from a "Manage lists" button on `/price-book`. No new nav item.
- **BOI/BOQ consistency**: `step-bom.tsx` / `step-boq.tsx` fetch the two lists and pass them into `BoiInlineAddRow` / `BoiEditButton` / `BoqAddItemRow` / `BoqEditButton` / `BomInlineAddRow` as optional `categories?`/`units?` props (components fall back to the existing `BOI_CATEGORIES`/`UNITS` constants when absent, so nothing else breaks). `getCategoryLabel` prettifies unknown values (`replace(/_/g,' ')` + title case) so new categories render everywhere.

## Cross-cutting

- All standing rules apply (ActionResult, `op` logging, employees-id attribution, indexes-with-migration — the new tables' filter columns are tiny lookup lists, value UNIQUE indexes suffice; no `as any` on new-table queries; types regenerated in the same batch as mig 177; dev-only).
- Gates batched per Vivek's directive: one full gate run per code batch (+ vitest at the end), build with `NODE_OPTIONS=--max-old-space-size=8192`, forbidden-patterns via Git-Bash.

## Execution batches

| Batch | Contents |
|---|---|
| B1 | Mig 177 (+apply+regen) · year filter · delete project · search RPC/typeahead/list-search swap · ProjectCombobox upgrade + all caller selects · /tasks Log removal · /tasks milestone picker · #4 dev-data verification |
| B2 | Activities (project-name column, word wrap, global Add, custom stage) · tickets (#7 column strip, #9 combobox) · AMC combobox · price-book managed lists end-to-end + settings page + BOI/BOQ props |
| B3 | Docs (CHANGELOG, CURRENT_STATUS, modules projects/om/purchase[price-book]) + final verification |

## Out of scope

- Restore-deleted-projects UI (DB-only restore).
- Stage-master management UI; custom stages stay per-activity free text.
- Removing `ticket_number` from the schema (display-only removal).
- Work-log feature removal beyond the /tasks table (explicit decision).
