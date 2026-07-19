# Universal Table Typography + Wrap Standard — Design

**Date:** 2026-06-19
**Status:** Approved (design); spec under review
**Module:** design-system / all modules (cross-cutting)

---

## Problem

Table body text is inconsistent across the ERP. The **projects/leads/proposals/contacts** lists run through the shared `DataTable` (`apps/erp/src/components/data-table/data-table.tsx`) and read well at **14px** (`text-sm`). But many other screens hand-roll raw `<table>/<td>` markup that hardcodes **`text-[10px]`/`text-[11px]`** — tasks, the project **Execution** tasks table, service tickets, etc. — so the same content is noticeably smaller and harder to read. Several tables also **truncate** long values (with a hover `title`) instead of wrapping, hiding content.

Root cause of the drift: the hand-rolled tables **bypass the shared `@repo/ui` table primitive** (`packages/ui/src/components/table.tsx`), so there is no single place that enforces a body-text size or wrap behaviour. Each new table re-decides, and they trend small.

## Goals

1. **One body-text size for every display table: 14px**, matching the projects list.
2. **Wrap long text** (names, titles, notes, descriptions) so nothing is clipped; keep **numbers, dates, status badges, and action buttons on one line**.
3. Make this **universal in the shared UI** so future tables inherit it and the mistake can't silently recur.
4. Sweep the existing hand-rolled **display** tables onto the standard.

## Non-goals

- **No change** to: status/priority badges (the 10px uppercase pills are intentional), KPI/stat cards, form inputs, dialogs, comboboxes, toggles, charts, PDF tables.
- **Headers** keep the existing small-uppercase label style (matches today's projects headers). "14px everywhere" applies to **body** cells, not header labels.
- No data, query, or schema changes. Pure presentational.

## The standard

### 1. Shared primitive — `packages/ui/src/components/table.tsx`

This is the enforcement point. Every table built on the primitive inherits it.

- `Table`: base font `text-[13px]` → **`text-sm`** (14px).
- `TableCell`: `align-middle` → **`align-top`**; add **`whitespace-normal break-words`** and **`py-2`** (so wrapped multi-line cells read cleanly and never clip). Keep `h-11 px-3.5` (height becomes an effective min-height once content wraps).
- `TableHead`: keep `text-[10px]` uppercase label style; add **`whitespace-nowrap`** (header labels stay single-line).

### 2. Wrap policy (which columns opt out of wrapping)

Default = wrap. Columns that should stay single-line add `whitespace-nowrap`:

- Numeric / currency / quantity (already `text-right tabular-nums`)
- Dates
- Status / priority / stage badges
- Action button groups (edit/delete/toggle)

Everything else (names, titles, descriptions, notes, addresses) wraps.

### 3. `DataTable` alignment

`DataTable` already renders body cells at `text-sm`, so the visible projects look is unchanged. Apply the policy explicitly: `align-top` on body cells, `whitespace-nowrap` on the numeric/date/badge/phone cells (the renderer already special-cases these). This makes the policy identical between `DataTable` and primitive-based tables.

### 4. Guardrail (so it doesn't regress)

- Document the standard in `docs/design/design-system.md` (a "Tables" subsection: 14px body, wrap policy, "build on `@repo/ui` Table, never raw `<td>` for display tables").
- Add a `scripts/ci/check-forbidden-patterns.sh` rule (best-effort) that flags same-line `<td …text-[10px]/[11px]…>` and `TableCell className="…text-[10px]/[11px]…"`, grandfathering existing residue via the established baseline-count mechanism so the gate stays green while catching *new* offences. This is heuristic — a class split across lines or hidden in a `cn()` helper won't be caught — so the real guard is the primitive default + the design-system doc; the lint rule is a backstop, not the primary defence. Badges/cards/forms are unaffected (they're not `<td>`/`TableCell`).

## Sweep scope

Convert the hand-rolled **display** tables onto the `@repo/ui` primitives and remove their `text-[10px]/[11px]` + `truncate`/`title` hacks. Candidate display tables, grouped for batched delivery (exact per-file list finalised in the implementation plan after a quick in/out classification of each `<table>` site):

- **Tasks:** `(erp)/tasks/page.tsx` (table shell + header) + `components/tasks/tasks-table.tsx`; `(erp)/sales/tasks/page.tsx`; `(erp)/leads/[id]/tasks/page.tsx`; `components/my-tasks.tsx`; project Execution tasks + milestone tables in `components/projects/stepper-steps/step-execution.tsx` (+ `forms/execution-task-row.tsx`).
- **O&M:** `(erp)/om/tickets/page.tsx`; `components/om/amc-visit-tracker.tsx` + `(erp)/om/amc/page.tsx`; `(erp)/om/plant-monitoring/page.tsx`; `(erp)/om/inverters/_components/inverter-table.tsx`; `(erp)/om/profitability/_components/om-profitability-table.tsx`.
- **Projects steps:** BOM/BOQ/delivery/QC/commissioning/actuals/liaison display tables under `components/projects/stepper-steps/*`; `components/projects/activities/activities-client.tsx`; `components/projects/completion/milestone-progress-panel.tsx`; `components/projects/cut-length/cut-length-tab.tsx`.
- **Finance / procurement:** `components/expenses/expense-table.tsx`; `components/payments/payments-tracker-table.tsx` + `payment-followups-table.tsx`; `(erp)/price-book/page.tsx` + `components/price-book/catalog-admin.tsx`; procurement display tables under `(erp)/procurement/**` (RFQ/PO/dispatch/comparison/orders — display only, not the input/editor controls).
- **Misc:** `components/documents/document-list.tsx`, `components/expenses/documents-list.tsx`, `components/proposals/bom-table.tsx`, `components/whatsapp-import/bulk-action-table.tsx`, `(erp)/data-review/**` audit tables, `(erp)/liaison/page.tsx`, `(erp)/hr/attendance/page.tsx`.

Each site is reviewed individually: if it's a display table → migrate + apply standard; if it's a form/layout/editor table → leave (or apply only the 14px body where it clearly reads as data).

## Execution

Batched by module — **not** one giant commit — because this touches ~25–40 files across every area and carries real visual-regression risk:

1. **Foundation:** primitive (`table.tsx`) + `DataTable` alignment + `design-system.md` doc + forbidden-pattern rule. (Affects all primitive-based tables at once.)
2. **Tasks** domain.
3. **O&M** domain.
4. **Projects** steps.
5. **Finance / procurement.**
6. **Misc.**

Per batch: implement → run all four CI gates (`check-types`, `lint`, `check-forbidden-patterns.sh`, `build`) → Vivek reviews the diff → commit. Foundation batch ships first so its effect is visible before the sweep.

## Verification

- CI gates green per batch (read actual stdout, not just exit codes).
- Visual spot-check on a representative page per batch after it deploys — confirm against the **running Vercel build**, not just the repo (a committed+green change isn't "live" until the deploy is `READY` and the page serves it). See `feedback_verify_deployed_build`.
- Foundation batch: confirm the projects list is visually unchanged (it was already 14px) and a primitive-based table that was 13px is now 14px.

## Risks

- **Wide blast radius:** the primitive change re-renders every table in the app. Mitigated by batching + per-batch review + the projects-unchanged check.
- **Row height growth:** wrapping makes some rows taller. Acceptable per the explicit "wrap text" decision; numeric/badge/date/action columns stay single-line to limit it.
- **Mis-classifying a form/editor table as a display table.** Mitigated by per-site review during the sweep, not a blanket find-replace.
