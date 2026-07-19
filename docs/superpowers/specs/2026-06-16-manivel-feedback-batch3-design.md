# Manivel Feedback Batch 3 — Design

> Status: **Approved** (Vivek, 2026-06-16). Dev-only (no prod until green-lit).
> Spec date: 2026-06-16. Migrations: **182–185**.
> Sibling work landed just before this: `/reconciliation` + `/command-center` (migs 180–181,
> spec `2026-06-15-manivel-dashboard-parity-design.md`). That is a **year-wise financial rollup**
> page; this batch is **operational** (status counts + ops columns on the project *list*, plus
> activities/ticket/price-book fixes). They are complementary and do not share code.

## Goal

Vivek's third feedback list for **Manivel** (Sr Project Manager, role = `project_manager`).
Operational polish across Projects, Activities, Service Tickets, Price Book, and BOQ.

## Decisions (locked with Vivek)

1. **Year column → editable FY.** The cell becomes an FY dropdown (2014-15 … current). Saving writes
   `projects.order_date = '<FYstart>-04-01'`, so the column, the existing FY filter, and the new
   header strip all read the same field.
2. **New project name (Activities + Tickets) → free-text label.** The project link becomes optional;
   the typed name is stored as `project_name_custom`. These rows are labels for Service/AMC/misc work
   and never become real projects.
3. **Activities column → project's own tab.** Clicking opens `/projects/[id]?tab=execution` (the
   Execution → Activities sub-tab).

## Already built — do not rebuild

- **Custom column config (req #7).** `/projects` already has a DataTable with **saved views**
  (`table_views`, mig 178), a column show/hide picker, and inline edit. Registering the two new
  columns is all that's needed.
- **Service-ticket created date.** Already `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` and already
  displayed in the list (`om/tickets/page.tsx`). Verify-only.
- **BOQ PDF rendering.** `apps/erp/src/lib/pdf/boq-pdf.tsx` + `components/procurement/boq-download-button.tsx`
  exist and work in the procurement view. We only surface the button on the project BOQ tab.

---

## 1. Project Module — list page (`apps/erp/src/app/(erp)/projects/`)

### 1a. Header summary strip (req #1, #2, #3)
- New RPC **`get_project_status_summary(p_fy TEXT DEFAULT NULL)`** → `(status TEXT, project_count BIGINT, total_kwp NUMERIC)`,
  one row per status over non-deleted projects, FY filtered with the **same** `order_date`-with-`created_at`-fallback
  logic the list uses (`projects-queries.ts:49-57`). Money/size aggregated in SQL (NEVER-DO #12).
- New server component `ProjectsSummaryHeader` rendered above the table in `page.tsx`:
  - one compact count chip per status (all 8 statuses, existing label + colour map),
  - **Total System Size: `X.XX kWp`** (sum of `total_kwp`) and total project count.
- Recompute on FY change is automatic: `page.tsx` is a server component, the FY filter is a URL param,
  so the header re-queries with the same `fy` on each navigation. No client state.

### 1b. Columns (req #4, #6)
Default visible set (in `data-table/column-config.ts` `getDefaultColumns('projects')`):
`project_number · customer_project · site_city · system_size_kwp · status · notes · activities · year`.
- **Notes** — reuse existing `notes` column (display alias `remarks`→`notes` already in
  `inline-edit-actions.ts`). Make default-visible, inline-editable, and **word-wrapping** (current cell
  renderer truncates; this column opts into wrap). Collapse the duplicate `remarks` column into `notes`.
- **Activities** — new non-editable column; cell is a link/icon → `/projects/[id]?tab=execution`.
- **Year** — change from read-only to inline **FY select**. `updateCellValue` gains a `year` field that
  maps to `order_date` and converts the FY string (`'2025-26'`) to `'2025-04-01'`.

### 1c. Custom config (req #7) — register only
Add `notes` + `activities` to the projects column registry so they appear in the column picker / saved views.

---

## 2. Activities Module (req: free-text project)

- Shared **`ProjectCombobox`** gains opt-in props `allowCustom?: boolean` + `onCustomChange?(name)`.
  When the query matches no project, show **“Use '<typed>'”** which sets a custom name instead of an id.
  (Mirrors `CompanyPicker` create-inline UX, but creates nothing.) Only Activities + Tickets enable it;
  AMC/expenses unchanged.
- `addProjectActivity` accepts `projectId` **or** `projectNameCustom` (≥1 required).
- `listProjectActivities` selects `project_name_custom`; the client shows it when `project_id` is null;
  the Project link is rendered only when a real `project_id` exists.

**Migration 184** — `project_activities`:
- `ALTER COLUMN project_id DROP NOT NULL`
- `ADD COLUMN project_name_custom TEXT`
- `ADD CONSTRAINT project_activities_project_or_custom CHECK (project_id IS NOT NULL OR project_name_custom IS NOT NULL)`

---

## 3. Service Ticket Module (`apps/erp/src/app/(erp)/om/tickets/`)

- **Free-text project** — New Ticket dialog uses the `allowCustom` combobox; `createServiceTicket` accepts
  `projectNameCustom`. Ticket numbers are `TKT-NNNN` (project-independent), so null `project_id` is safe.
- **“Closed” not strike-through (req)** — in `om/tickets/page.tsx` (~lines 214–233) remove the
  `line-through` + `opacity-50` styling for closed/resolved rows; the `TicketStatusToggle` badge already
  renders “Closed”. Keep rows visually normal.
- **Created date** — verify only (already automatic + displayed).
- **Total Service Amount header (req)** — new RPC **`get_service_ticket_amount_total()`** →
  `SUM(service_amount)` over non-deleted tickets (SQL, never JS). Display **“Total Service Amount: ₹XX,XXX”**
  in the list header; recomputed each load.

**Migration 183** — `om_service_tickets` + ticket-total RPC:
- `ALTER COLUMN project_id DROP NOT NULL`
- `ADD COLUMN project_name_custom TEXT`
- `ADD CONSTRAINT om_service_tickets_project_or_custom CHECK (project_id IS NOT NULL OR project_name_custom IS NOT NULL)`
- `get_service_ticket_amount_total()` RPC (used by the header in this same step).

---

## 4. Price Book — both bugs (req)

- **RLS error (root cause).** `price_book_write` (mig 052) allows
  `founder, sales_engineer, purchase_officer, marketing_manager, designer` — **`project_manager` is
  missing**, so Manivel's insert/update hit exactly the reported `42501`. The server action's intended
  editors are `founder, project_manager, purchase_officer, finance` (`price-book-actions.ts:9-14`).
- **Second add bug.** The Add dialog never sends the `NOT NULL` `gst_type` (reads a non-existent form
  field → `undefined` → would fail `23502` once RLS is fixed). `gst_type` enum = `'supply' | 'works_contract'`.

**Migration 182** — redefine `price_book_write`:
```sql
DROP POLICY IF EXISTS price_book_write ON price_book;
CREATE POLICY price_book_write ON price_book FOR ALL TO authenticated
  USING      (get_my_role() IN ('founder','project_manager','purchase_officer','finance'))
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer','finance'));
```
(Drops stale write access for sales_engineer/marketing_manager/designer — none can see the Price Book UI,
which is gated to founder/PM/purchase_officer; this aligns RLS to the server action and adds the missing
`WITH CHECK`.)

**Code** — add a **GST Type** select (`Supply` / `Works Contract`) to the Add **and** Edit dialogs
(so “edit all fields” holds), and default `gst_type` to `'supply'` in `createPriceBookItem` when absent
(defensive, so the insert can never fail on that column again).

---

## 5. Project Module — BOQ PDF (req)

Surface the existing `BoqDownloadButton` on the project BOQ tab
(`components/projects/stepper-steps/step-boq.tsx`), wired to that project's `project_boq_items`
(fields: `line_number, item_category, item_description, unit, quantity, unit_price, total_price, hsn_code`)
plus project number / customer / site address. Client-side instant download — no new route or storage.

---

## 6. Migration 185 — projects status RPC

`get_project_status_summary(p_fy TEXT DEFAULT NULL)` →
`(status TEXT, project_count BIGINT, total_kwp NUMERIC)`.
`LANGUAGE sql STABLE SET search_path = public`, `REVOKE … FROM PUBLIC, anon`,
`GRANT EXECUTE … TO authenticated` (matching the mig 180/181 RPC convention).
(The ticket-total RPC `get_service_ticket_amount_total()` lives in mig 183 with its feature.)

> Numbering = build order. Each migration is self-contained for its commit: **182** price-book RLS,
> **183** tickets (schema + ticket-total RPC), **184** activities schema, **185** projects status RPC.
> Applied to dev in order 182 → 183 → 184 → 185. Regenerate `packages/types/database.ts` after the
> schema-changing migrations, in the same commit (NEVER-DO #20).

---

## Build order (each its own green commit, CI gates per commit)

1. **Price Book** (mig 182 + gst_type in dialogs + action default) — unblocks Manivel first.
2. **Service tickets** (mig 183 + strike-through removal + total-amount RPC/header + free-text project).
3. **Activities free-text** (mig 184 + `ProjectCombobox.allowCustom` + action + display).
4. **Projects list** (mig 185 RPC + summary header + Notes/Activities columns + FY-editable Year + default headers).
5. **BOQ PDF** button wiring.

(The shared `ProjectCombobox.allowCustom` change lands in step 2 and is reused by step 3.)

## Out of scope / non-goals

- No prod migrations (dev-only standing rule).
- Free-text project rows do **not** roll into project reports or `/command-center` (label-only by design).
- No partial-quantity or pricing changes to BOQ; PDF is a render of existing items.
- No change to AMC/expenses project pickers (they keep select-only behaviour).

## Verification

- 4 CI gates locally per commit: `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`
  (build with `NODE_OPTIONS=--max-old-space-size=8192`).
- Manual (dev, as `project_manager` and `founder`): add/edit a Price Book item; add an Activity and a
  Service Ticket with a free-text project; confirm a closed ticket shows “Closed” (no strike-through);
  see Total Service Amount in the tickets header; on `/projects` see status chips + total kWp that change
  with the FY filter, edit a Notes cell (wraps) and a Year cell (FY), click Activities → Execution tab;
  download a BOQ PDF.
