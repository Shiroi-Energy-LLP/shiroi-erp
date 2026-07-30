# Purchase / BOM / Service-Ticket / AMC fixes — design

**Date:** 2026-07-30
**Status:** approved (Vivek, 2026-07-30)
**Scope:** 4 modules, 11 requested items. One shared root cause spans two of the reported bugs.

---

## 1. Purchase — rename "Projects" tab to "Budgets"

Label-only change.

- `ITEMS.boiProjects.label` in `apps/erp/src/lib/roles.ts` → `'Budgets'`.
- Page H1 `Purchase Projects` → `Purchase Budgets` in `components/purchase-flow/purchase-projects-client.tsx` so nav and page agree.

**The route `/purchase/projects` does not change.** Renaming it would break existing bookmarks and `roles.test.ts` asserts on the href. The nav *label* is the user-visible thing being renamed.

---

## 2. BOM — wrap text + layout, all three surfaces

### 2a. `/bom-review` — full `ListPageShell` conversion

The 11-column inline-edit table currently sits in a bare `<div className="overflow-x-auto">`, so long `item_description` values force horizontal scrolling.

- Convert the page to `ListPageShell`, giving a sticky filter bar (category chips + import action) and a sticky `<thead>` — the pattern already used by `/om/tickets` and `/om/amc`. The shell owns the scroll container, so the table must NOT have its own overflow wrapper (an intermediate overflow box traps `position: sticky`).
- Drop `overflow-x-auto`. Columns get proportional widths, `align-top`, and `whitespace-normal break-words` so every column wraps. Item Description and Brand are the columns being clipped today.
- Typography up from `text-[10px]`/`text-xs` to `text-xs`/`text-sm`; roomier row padding; zebra rows.
- Double-click-to-edit behaviour is unchanged.

**Targeted pre-existing fix:** `bom-review/page.tsx` calls `createClient()` inline in the page body — a NEVER-DO #15 violation. Because the page shell is being rewritten anyway, the reads move to a new `apps/erp/src/lib/bom-review-queries.ts`.

### 2b. Proposal BOM table + project BOM tab

`components/proposals/bom-table.tsx` and `components/projects/stepper-steps/step-bom.tsx` get the wrap-text + column-width + spacing treatment only. They are embedded panels inside a larger page, not list pages, so no `ListPageShell`.

---

## 3. Shared root cause — `formatDate()` fed a timestamp

`formatDate()` (`packages/ui/src/formatters.ts:44`) appends `T00:00:00+05:30` to its input. That is correct for date-only `TEXT`/`DATE` values but produces `Invalid Date` for a full `TIMESTAMPTZ` ISO string. `formatDateFromTimestamp()` already exists for exactly this case.

Instances fixed:

| Reported symptom | Location | Column |
|---|---|---|
| Service Ticket **Created** column not displaying | `om/tickets/page.tsx` (Created cell) | `created_at` TIMESTAMPTZ |
| Service Ticket **Created** on detail page | `om/tickets/[id]/page.tsx` (MetaItem "Created") | `created_at` TIMESTAMPTZ |
| AMC **Completed Date** = "Invalid Date" | `om/amc/page.tsx` (Completed Date cell) | derived from `om_visit_schedules.completed_at` TIMESTAMPTZ |
| **SLA Due** — same bug, not reported | `om/tickets/[id]/page.tsx` (MetaItem "SLA Due") | `sla_deadline` TIMESTAMPTZ |

Plus a repo-wide sweep for other `formatDate(` calls receiving timestamp columns.

---

## 4. AMC module

### 4a. New detail page `/om/amc/[id]`

The Scheduled Visits `X / Y` cell becomes a `<Link>` to this page. The current inline expander (`AmcVisitTracker`) is retired from the list page — everything it did moves to the detail page with room to breathe.

Structure mirrors the service-ticket detail page (the established pattern in this module):

- **Header card:** contract number, project link, category badge, status toggle, start/end dates, visits included, next visit date, last completed date.
- **Service Amount:** `annual_value` shown when `amc_category = 'paid_amc'` (item 4.8). `om_contracts` has no separate payment-status column, so "marked as Paid" is read as the paid-AMC category.
- **Visit cards** — one card per `om_visit_schedules` row, replacing the cramped nested 7-column table. Each card contains:
  - date / engineer / status dropdown / done-by
  - the existing edit fields (work done, issues identified, resolution details, customer feedback, notes)
  - **Reports** — view/download via the existing `AttachmentLink` (short-lived signed URL; `project-files` is private), plus upload
  - **Work Activity** timeline (see 4b)
  - **Delete** button

### 4b. Work Activity — per-visit, migration 218

New table `om_visit_events`, mirroring `om_ticket_events` (migration 199):

```sql
CREATE TABLE om_visit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id        UUID NOT NULL REFERENCES om_visit_schedules(id) ON DELETE CASCADE,
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('note','system')),
  body            TEXT NOT NULL,
  attachment_path TEXT,
  attachment_name TEXT,
  created_by      UUID REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_om_visit_events_visit ON om_visit_events (visit_id, created_at DESC);
-- RLS mirrors om_ticket_events.
```

`created_by` is a FK to **`employees(id)`**, not `profiles(id)` — writes resolve it through `getCurrentEmployeeId()`, never `auth.uid()`.

Client component `AmcVisitTimeline` mirrors `TicketTimeline` (note + optional attachment, delete own entry, IST timestamps). Types regenerated in the same commit (NEVER-DO #20).

### 4c. Reports view/download

`om_visit_schedules.report_file_paths` stores paths only — no original filenames. The UI shows the path basename as the label. Uploading continues to write to `amc/{contractId}/{visitId}/{ts}.{ext}`.

### 4d. Delete — both levels

- **Per visit:** new `deleteAmcVisit()` server action. `om_visit_events` cascades; report files in Storage are left in place (consistent with how ticket deletion behaves today).
- **Per contract:** `AMC_DELETE_ROLES` widens from `['founder','om_technician']` to `['founder','om_technician','project_manager']`.

### 4e. Project field auto-search

The plain `<FilterSelect paramName="project">` on `/om/amc` becomes `AmcProjectFilter` — a direct adaptation of the working `TicketProjectFilter` (URL-aware `ProjectCombobox`, resets pagination). The create dialog already uses `ProjectCombobox`, so it is unchanged.

### 4f. Typography and spacing

The AMC list page runs on `text-[9px]`/`text-[10px]`. List and detail pages move to `text-xs`/`text-[11px]` with matching cell padding.

---

## Compliance notes

- **#12** no money aggregated in JS — `annual_value` is displayed, not summed.
- **#15** no inline Supabase in pages — new AMC detail page reads via `amc-actions.ts`; `/bom-review` reads move to `bom-review-queries.ts`.
- **#17** new `om_visit_events` filter column indexed in the same migration.
- **#19** all new actions return `ActionResult<T>`.
- **#20** `packages/types/database.ts` regenerated in the same commit as migration 218.
- **#21** client components import only from actions / client-safe constants.
- **#24** no writes during render.

## Addendum — 4g. om_technician write access (migration 220, approved 2026-07-30)

Raised as out-of-scope during implementation, then approved by Vivek in the same session.

`om_visit_schedules.om_schedules_write` and `om_contracts.om_contracts_write` were both `FOR ALL` limited to founder + project_manager (mig 005d). The O&M technician — the role that performs the visits — could open every AMC screen and change nothing, and because RLS rejects a write by affecting 0 rows rather than raising, the UI reported success. Affected: visit status, reschedule, assign engineer, work-done/issues/resolution/feedback/notes, report upload, contract Open/Closed toggle, Create AMC, close-out. Mig 218 compounded it by granting DELETE on a visit the same role could not edit.

Fix: realign both tables with this module's existing convention (`tickets_update` on `om_service_tickets` = founder + project_manager + om_technician), replacing each `FOR ALL` with explicit INSERT / UPDATE / DELETE policies. A `FOR ALL` policy carrying only `USING` supplies no `WITH CHECK`, which makes its INSERT path read as an accident rather than a decision. `om_contracts` gets no hard DELETE policy — `deleteAmc()` is a soft close (`status → 'cancelled'`), covered by UPDATE.

Two defects in mig 218 fixed at the same time:

1. Its three `om_visit_events` policies were copied from mig 199 and use a bare `auth.uid()` inside the subquery, re-introducing 3 of the `auth_rls_initplan` warnings that mig 206 had cleared repo-wide (185 → 0). Now `get_my_role()`; advisor back to **0**.
2. `om_visit_events.created_by` had no covering index despite being joined on every timeline read (`author:employees!om_visit_events_created_by_fkey`). Added (NEVER-DO #17).

**Verification** — the policy change was proved, not assumed. Dev has no `om_technician` profile, so a rolled-back transaction temporarily promoted a profile, set `request.jwt.claims`, switched to the `authenticated` role so RLS applied, and attempted the three writes: visit UPDATE **1 row**, contract UPDATE **1 row**, `om_visit_events` INSERT **1 row**. Rollback confirmed clean (0 leftover om_technician profiles, 0 probe rows).

**Generalisable lesson:** a read policy that includes a role while the write policy excludes it yields a screen that looks editable and silently discards edits. Worth auditing other modules for the same read/write asymmetry.

## Out of scope

- Renaming the `/purchase/projects` route.
- Storing original report filenames (would need a `report_file_names` column; basename is sufficient for now).
- Any prod migration — dev only, per the standing rule.
- Auditing other modules for the same read/write policy asymmetry (flagged above; not done here).
