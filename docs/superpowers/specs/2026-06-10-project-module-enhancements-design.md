# Project Module Enhancements — Design

**Date:** 2026-06-10
**Status:** Approved by Vivek (chat, 2026-06-10)
**Scope:** Five requirement areas in/around the Projects module: Project Value gating, BOI item editing, BOQ edit + auto-deliver, Execution (completion % + Activities sub-module + global Activities nav), Expenses project auto-search.
**Migrations:** 173–176, **dev only** (standing rule: no prod until Vivek green-lights a prod window).

---

## Requirements (as given)

1. **Project Details** — *Project Value* editable only by the Project Manager.
2. **BOI** — Edit option per item; PM can update item details at any time.
3. **BOQ** — Edit option per item; status auto-changes *Ready to Dispatch → Delivered* when the item is dispatched in the Delivery module.
4. **Execution** — Overall completion % auto-calculated from milestone completion; all project tasks visible in Execution; new *Activities* sub-module (daily activity log with SE/OS/Contractor manpower counts, filters, PM add/edit/delete, header summaries); *Activities* also as a global nav item consolidating all projects.
5. **Expenses** — Add Expense with auto-search project selection; entry point from the Project module.

## Decisions locked in with Vivek

| Question | Decision |
|---|---|
| BOI editing vs the draft→submitted→approved→locked immutability workflow | **Edit anytime + audit log.** PM/founder can edit items in any state including `locked`; every change is recorded in a history table (who/when/old→new). |
| Overall completion %: milestone-derived vs the manual 10-component weighted checklist (Progress tab) | **Milestones become the single source of truth.** Weighted per milestone; manual `project_completion_items` checklist is deprecated (UI removed, table left in place, no data destruction). |
| Activity "Stage" field | **The 10 execution milestones** (`execution_milestones_master`), not a new list, not free text. |
| Activities authorship + relationship to Daily Site Reports | **New standalone module; PM (+founder) write, all employees read.** `daily_site_reports` stays as-is (narrative/voice-note pipeline untouched). |
| Project Value editors | **PM + founder** (founder as standing override). |
| `done_by` on activities | **Free text** (contractor crews don't map to `employees`; upgradeable to a picker later). |

---

## 1. Project Value — PM-only editing

**Field:** `projects.contracted_value` (NUMERIC(14,2), set from the accepted proposal).

**Today:** `updateProjectField` (apps/erp/src/lib/project-detail-actions.ts) gates all `FINANCIAL_FIELDS` to founder/PM/finance/sales_engineer; `financial-box.tsx` renders the edit affordance for founder/finance only — client and server gates disagree.

**Change (no migration):**
- Server: carve `contracted_value` out of the shared `FINANCIAL_FIELDS` set into a dedicated gate inside `updateProjectField`: allowed roles `['project_manager', 'founder']` only. Other financial fields keep their existing gate.
- Client: `financial-box.tsx` renders Project Value as an `EditableField` only when role is PM/founder; read-only with lock icon otherwise. This also resolves the existing client≠server mismatch for this field.
- Error message on rejection: "Only the Project Manager can edit the Project Value."

## 2. BOI — per-item edit, any state, audited

**Today:** BOI items (`project_boq_items` rows FK'd to a `project_bois` version) support inline **add** and **delete** only while the BOI version is `draft`. No per-item edit exists; locked versions are immutable.

**Change:**
- **New action `updateBoiItem`** in `apps/erp/src/lib/project-bom-actions.ts` (`'use server'`, returns `ActionResult`):
  1. Role gate: `project_manager` or `founder` (via the existing caller-role helper; employee id via `getCurrentEmployeeId()` — never `auth.uid()` into an employees FK).
  2. Load the current row; diff against the submitted fields.
  3. Insert one history row into `project_boq_item_history` with the full diff.
  4. Update the item (recompute `total_price` = qty × unit_price with `decimal.js` semantics server-side — same recompute path the BOQ editor uses).
  - Editable fields: `item_description`, `brand`, `model`, `quantity`, `unit`, `unit_price`, `gst_rate` (and recomputed `total_price`).
  - Works regardless of BOI version status — `draft`, `submitted`, `approved`, `locked` alike. The audit row is the guardrail replacing immutability.
- **UI (`step-bom.tsx`):** pencil/Edit affordance per item row → inline edit row or small dialog (match the existing BOQ inline-edit idiom). Visible to PM/founder only. An expandable per-item "history" affordance lists audit entries (changed_by, changed_at, field old→new).
- Existing add/delete behavior for draft versions is unchanged. The BOQ step's `updateBoqItem` is untouched.

**Migration 173 — `project_boq_item_history`:**

```
project_boq_item_history (
  id            UUID PK DEFAULT gen_random_uuid(),
  boq_item_id   UUID NOT NULL REFERENCES project_boq_items(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id),
  boi_id        UUID REFERENCES project_bois(id),
  changed_by    UUID NOT NULL REFERENCES employees(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  changes       JSONB NOT NULL   -- { field: { old, new }, ... }
)
```
- Indexes: `boq_item_id`, `project_id`, `changed_at DESC`.
- RLS: INSERT for PM/founder (via the standard role helper); SELECT for all authenticated employees; no UPDATE/DELETE policies (append-only).

## 3. BOQ — visible edit affordance + auto-deliver on dispatch

**3a. Edit affordance (no behavior change):** the BOQ step already supports double-click inline editing of qty/unit_price/GST via `updateBoqItem`. Add a visible pencil/Edit icon per row triggering the same editor, so the capability is discoverable. PM/founder only (matching current edit gating).

**3b. Auto status Ready to Dispatch → Delivered:**

**Today:** `submitDeliveryChallan` (apps/erp/src/lib/project-dc-actions.ts) flips a DC `draft → dispatched` and stamps `dispatched_at`. Linked BOQ items (`delivery_challan_items.boq_item_id`) get `dispatched_qty` incremented at DC **creation**, but `procurement_status` never moves automatically — the PM flips it by hand.

**Change:**
- **Migration 174 — RPC `mark_dc_boq_items_delivered(p_dc_id UUID)`:** for every `delivery_challan_items` row of that DC, update the linked `project_boq_items.procurement_status` from `'ready_to_dispatch'` to `'delivered'` — **guarded**: only rows currently `'ready_to_dispatch'` advance; items in any other status are left untouched. Returns the count updated. `SECURITY DEFINER` with `SET search_path = public`, EXECUTE granted to `authenticated` only (not `anon`).
- **Action change:** `submitDeliveryChallan` calls the RPC immediately after the status flip succeeds, in the same action. RPC failure is logged with the `op` prefix but does not roll back the dispatch (status advance is best-effort sugar; the PM can still set status by hand). Revalidate the project path so the BOQ tab reflects it.
- **Semantics note (flagged at design review):** items are marked delivered on dispatch regardless of partial quantities — if a BOQ line is split across DCs, the first dispatch of that line delivers it. Refinement to "only when cumulative `dispatched_qty ≥ quantity`" is a small RPC change if Vivek wants it later.
- Naming note: requirement says "marked as Dispatched … status changes to Delivered" — i.e. the DC `dispatched` event drives the BOQ item to `delivered`. The DC's own `delivered` status (signature/receiver capture, currently unused) is out of scope.

## 4. Execution Module

### 4a. Completion % — milestone-weighted, single source of truth

**Today:** two unrelated numbers exist. The Execution step computes per-milestone % = done/total task ratio and shows a plain average. The Progress tab's `get_project_completion_pct` RPC sums weights of **manually ticked** `project_completion_items` (10 components, weights 5–25, handover 0). `projects.completion_pct` exists but is stale/legacy.

**Change (Migration 175):**
1. **`execution_milestones_master.weight INT NOT NULL DEFAULT 10`** — seeded so the 10 milestones sum to 100:

   | Milestone | Weight |
   |---|---|
   | Material Delivery | 10 |
   | Structure Installation | 15 |
   | Panel Installation | 20 |
   | Electrical Work | 15 |
   | Earthing Work | 5 |
   | Civil Work | 10 |
   | Testing & Commissioning | 10 |
   | Net Metering | 5 |
   | Handover | 5 |
   | Follow-ups | 5 |

2. **Rewrite `get_project_completion_pct(p_project_id)`** (same name/signature — every existing caller keeps working): per-milestone % = `completed_tasks / total_tasks` for non-deleted tasks with that `milestone_id`; a milestone with **zero tasks falls back to its stored `project_milestones.completion_pct`** (mirrors today's Execution-step behavior, so manually-tracked milestones aren't zeroed). Overall = `Σ(weight_i × pct_i) / Σ(weight_i over the project's milestones)`. Join: `project_milestones.milestone_name = execution_milestones_master.milestone_name` (LEFT JOIN); legacy milestone names absent from the master (e.g. old `advance_payment` rows) take `COALESCE(weight, 10)` so old projects still compute conservatively. Weights normalize over the milestones the project actually has, so a project without e.g. Civil Work still reaches 100%.
3. **Cache on `projects.completion_pct`:** trigger function `fn_refresh_project_completion_pct()` recomputes via the RPC and writes the column; triggers AFTER INSERT/UPDATE/DELETE on `tasks` (firing when `project_id IS NOT NULL OR milestone_id IS NOT NULL`, so universal-entity tasks tied to a milestone also refresh) and on `project_milestones`. One-time backfill UPDATE for all projects in the migration. List views read the cached column (no N+1); detail/Progress call the RPC live.
4. **Deprecate the manual checklist:** `project_completion_items` table stays (no data destruction) but the RPC no longer reads it and the `CompletionChecklist` UI is removed.

**UI:**
- **Progress tab** (`?tab=completion`) is rebuilt as a read-only weighted-milestone breakdown: per-milestone weight, task ratio, %, and the overall number; each row links into the Execution tab where tasks are edited. `CompletionChecklist` and its actions/queries are deleted (constants file pruned).
- **Execution step** replaces its plain-average header % with the same weighted RPC result, so Execution, Progress, and the project list all show one number.

### 4b. All project tasks visible

Largely already true (milestone groups + "Other Tasks (No Milestone)" group). Harden `project-stepper-queries.ts` so the task fetch matches `project_id = :id` **OR** (`entity_type = 'project'` AND `entity_id = :id`), deduped — tasks created through the universal-tasks path can't be invisible.

### 4c. Activities sub-module (new)

A **Tasks | Activities** toggle inside the Execution tab (`step-execution.tsx`); Activities renders the daily activity log for that project.

**Migration 176 — `project_activities` + summary RPC:**

```
project_activities (
  id                UUID PK DEFAULT gen_random_uuid(),   -- client-generated allowed
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  stage_id          UUID REFERENCES execution_milestones_master(id),
  done_by           TEXT,                                 -- free text (crew/person)
  description       TEXT NOT NULL,
  se_count          INT NOT NULL DEFAULT 0 CHECK (se_count >= 0),          -- Shiroi manpower
  os_count          INT NOT NULL DEFAULT 0 CHECK (os_count >= 0),          -- Outsourced manpower
  contractor_count  INT NOT NULL DEFAULT 0 CHECK (contractor_count >= 0),  -- Contractor manpower
  notes             TEXT,
  created_by        UUID NOT NULL REFERENCES employees(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ                            -- soft delete
)
```
- Indexes (every filterable column, same migration): `project_id`, `activity_date DESC`, `stage_id`, partial on `deleted_at IS NULL`.
- RLS: SELECT all authenticated employees; INSERT/UPDATE/DELETE `project_manager` + `founder` (standard role-helper pattern). Deletes are soft (`deleted_at` set via UPDATE); no hard-DELETE policy.
- **RPC `get_project_activities_summary(p_project_id UUID DEFAULT NULL, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL, p_stage_id UUID DEFAULT NULL)`** → `(total_activities, total_se, total_os, total_contractor, distinct_projects)` honoring the filters, `deleted_at IS NULL`. NULL `p_project_id` = all projects (powers the global page). Counts are summed in SQL, not JS.

**Files:**
- `apps/erp/src/lib/project-activities-queries.ts` — list (filters: date range, stage, manpower type `se|os|contractor` meaning count > 0; project filter for global) + summary wrapper.
- `apps/erp/src/lib/project-activities-actions.ts` (`'use server'`) — `addProjectActivity` / `updateProjectActivity` / `deleteProjectActivity` (soft), each: PM/founder gate, `getCurrentEmployeeId()` for `created_by`, `ActionResult`, revalidate.
- Shared label/order constants in `project-activities-constants.ts` (no server imports — NEVER-DO #21).
- `apps/erp/src/components/projects/activities/` — `activities-table.tsx` (columns exactly: # · Date · Stage · Done By · Description · SE · OS · Contractor · Notes · Actions), `activity-form-dialog.tsx` (add/edit; stage dropdown from the 10 milestones; date defaults today), header summary chips (SE/OS/Contractor totals from the RPC), filter bar (date range, stage, manpower type).

### 5. Global Activities page + nav

- **Route `apps/erp/src/app/(erp)/activities/page.tsx`** — consolidated activities across all projects: same table plus a **Project** column (project_number + customer/company name, linking to the project), filters Project (reuse the existing `ProjectCombobox`) · Date Range · Stage, header with org-wide manpower totals + activity stats (count, distinct projects) from the same summary RPC with `p_project_id = NULL`.
- **Nav (`apps/erp/src/lib/roles.ts`):** new `ITEMS.activities = { label: 'Activities', href: '/activities', icon: 'Activity' }`; added as a top-level item for `founder`, `project_manager`, `site_supervisor` (read-only for supervisors — write stays PM/founder). Sidebar renders automatically; `Activity` icon added to `ICON_MAP` if absent.
- URL-state filters (searchParams) consistent with existing list pages; pagination consistent with `listExpenses`-style patterns.

### 6. Expenses — auto-search project selection

- **Swap the picker:** `add-expense-dialog.tsx` replaces its plain `<Select>` with the existing **`ProjectCombobox`** (`apps/erp/src/components/forms/project-combobox.tsx` — client-side search over project_number/customer_name, keyboard nav). A pinned "General expense (no project)" choice maps to the existing `__general__` sentinel so nothing downstream changes. Projects prop already supplied by `expenses/page.tsx`.
- **Project-module entry point:** an "+ Add Expense" button on the project detail Actuals area (`SiteExpensesReadonly` header) opening the same dialog with the project **pre-selected and shown read-only** (combobox locked to that project). Dialog gains an optional `defaultProjectId` / `lockProject` prop pair; submit path (`submitExpense`) unchanged.

---

## Cross-cutting compliance

- All money math via `decimal.js` / NUMERIC(14,2); aggregation in SQL RPCs only (NEVER-DO #5/#12).
- Every new filterable/sortable column indexed in the same migration (#17).
- Reads in `*-queries.ts`, mutations in `*-actions.ts` returning `ActionResult` (#19); no inline Supabase in pages/components (#15).
- Shared constants live in `-constants.ts` files with no server imports (#21) — verified by `pnpm build`, not just check-types.
- `*_by` columns reference `employees(id)` resolved via `getCurrentEmployeeId()`, never `auth.uid()` (projects gotcha #10).
- Schema regenerated into `packages/types/database.ts` in the same commit as each migration (#20), via the Management-API PAT flow + `strip-view-fk-entries.mjs`.
- Migrations applied to **dev only**; numbered 173–176, append-only.

## Execution plan (Sonnet sub-agents)

| Workstream | Contents | Dependencies |
|---|---|---|
| A | Project Value gate (server + FinancialBox) | none |
| B | Expenses: ProjectCombobox swap + project-detail Add Expense entry | none |
| C | Mig 175 + completion-% rewrite (RPC, trigger, Progress tab rebuild, Execution header %, checklist removal, task-query hardening) | none |
| D | Mig 176 + Activities table/RPC + queries/actions/constants + Execution sub-tab UI | none |
| E | Global `/activities` page + nav | after D |
| F | Mig 173 + BOI per-item edit + audit UI | sequential with G |
| G | Mig 174 + BOQ edit affordance + auto-deliver wiring | sequential with F (shared files: BOI/BOQ steps, `project_boq_items`) |

A, B, C, D, F+G can start in parallel; E follows D. Each workstream lands with its migration applied to dev + types regenerated + all four CI gates green before docs/commit per the end-of-task sequence.

## Out of scope

- DC `delivered` status flow (receiver signature capture) — noted gap, untouched.
- Quantity-aware delivered semantics (cumulative `dispatched_qty ≥ quantity`) — flagged as optional refinement.
- Backfill/migration of historical `project_completion_items` ticks into milestone tasks — the old data stays readable in the table; no conversion.
- Mobile/offline (WatermelonDB) surfaces.
- Voice-note entry for activities (daily_site_reports pipeline remains separate).
