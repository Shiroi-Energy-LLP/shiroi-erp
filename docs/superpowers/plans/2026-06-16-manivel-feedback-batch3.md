# Manivel Feedback Batch 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship Vivek's third Manivel feedback list — projects-list dashboard + ops columns, free-text projects on activities/tickets, price-book RLS+edit fix, service-ticket polish, BOQ PDF download.

**Architecture:** Four dev-only migrations (182 price-book RLS, 183 tickets schema+RPC, 184 activities schema, 185 projects status RPC) + Next.js server/client changes. SQL aggregation only (NEVER-DO #12). Each numbered area is one green commit.

**Tech Stack:** Next.js 14 App Router, Supabase Postgres + RLS (`get_my_role()`), `@react-pdf/renderer`, vitest, decimal/`NUMERIC(14,2)`.

**Verification per commit:** `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && (set NODE_OPTIONS=--max-old-space-size=8192) pnpm build`. Apply each migration to **dev** (project `actqtzoxjilqnldnacqz`) before regen + commit. Read actual stdout (notifications can lie — master ref §4.15).

---

## Commit 1 — Price Book RLS + gst_type (unblocks Manivel)

**Files:**
- Create: `supabase/migrations/182_2026-06-16-price-book-write-rls.sql`
- Modify: `apps/erp/src/lib/price-book-actions.ts` (default gst_type)
- Modify: `apps/erp/src/components/price-book/add-price-book-item-dialog.tsx` (GST Type select)
- Modify: `apps/erp/src/components/price-book/edit-price-book-item-dialog.tsx` (GST Type select)
- Modify: `packages/types/database.ts` (regen — RLS change is type-neutral but regen confirms drift-free)

- [ ] **Step 1: Write migration 182**

```sql
-- =============================================================================
-- Migration 182 — Price Book write RLS includes project_manager
-- Spec: docs/superpowers/specs/2026-06-16-manivel-feedback-batch3-design.md
-- price_book_write (mig 052) allowed founder/sales_engineer/purchase_officer/
-- marketing_manager/designer — project_manager was MISSING, so Manivel's insert/
-- update hit "new row violates row-level security policy for table price_book"
-- (42501). Align RLS to the server action's editor set + add explicit WITH CHECK
-- (mig 052 had USING only). Dev-first; prod deferred.
-- =============================================================================

DROP POLICY IF EXISTS price_book_write ON price_book;
CREATE POLICY price_book_write ON price_book
  FOR ALL TO authenticated
  USING      (get_my_role() IN ('founder','project_manager','purchase_officer','finance'))
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer','finance'));
```

- [ ] **Step 2: Apply migration 182 to dev** via Supabase MCP `apply_migration` (project `actqtzoxjilqnldnacqz`, name `price_book_write_rls`) or `execute_sql`. Expected: success, no rows.

- [ ] **Step 3: Verify the policy** — `execute_sql`: `SELECT polname, pg_get_expr(polqual, polrelid) AS using, pg_get_expr(polwithcheck, polrelid) AS check FROM pg_policy WHERE polname='price_book_write';` Expected: both expressions list `project_manager`.

- [ ] **Step 4: Default gst_type in the action.** In `createPriceBookItem` (`price-book-actions.ts:112`), change the insert so a missing `gst_type` cannot violate NOT NULL:

```ts
  const { error } = await supabase.from('price_book').insert({
    ...input,
    gst_type: input.gst_type ?? 'supply',
    is_active: true,
    effective_from: today,
  } as any);
```

- [ ] **Step 5: Add GST Type select to the Add dialog.** In `add-price-book-item-dialog.tsx`, add a controlled-or-named select next to GST % (the `grid-cols-3` block ~line 222). It must submit `name="gst_type"`:

```tsx
<div>
  <Label htmlFor="add-gst_type" className="text-xs">GST Type</Label>
  <Select id="add-gst_type" name="gst_type" defaultValue="supply" className="h-9 text-xs">
    <option value="supply">Supply (goods)</option>
    <option value="works_contract">Works Contract (service)</option>
  </Select>
</div>
```
(Restructure the GST/HSN row to fit 4 fields, or place GST Type on its own line — keep ≤500 LOC, NEVER-DO #14.) The existing `gst_type: (form.get('gst_type') as string) || undefined` (line 120) now resolves to a real value.

- [ ] **Step 6: Add GST Type select to the Edit dialog** (`edit-price-book-item-dialog.tsx`), `defaultValue={item.gst_type ?? 'supply'}`, and add `gst_type: (form.get('gst_type') as string) || item.gst_type || 'supply'` to the `updatePriceBookItem` `data` object (~line 132) so "edit all fields" includes it.

- [ ] **Step 7: Regenerate types** (per Regen recipe in CLAUDE.md) then run the 4 gates. Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/182_2026-06-16-price-book-write-rls.sql apps/erp/src/lib/price-book-actions.ts apps/erp/src/components/price-book/ packages/types/database.ts
git commit -m "fix(price-book): PM can add/edit items (mig 182 RLS) + GST Type field"
```

---

## Commit 2 — Service tickets (mig 183: schema + RPC, header, strike-through, free-text project)

**Files:**
- Create: `supabase/migrations/183_2026-06-16-service-ticket-custom-project.sql`
- Modify: `apps/erp/src/components/forms/project-combobox.tsx` (add `allowCustom` — shared, also used by Commit 3)
- Modify: `apps/erp/src/lib/service-ticket-actions.ts` (`createServiceTicket` accepts custom name; new `getServiceTicketAmountTotal` query)
- Modify: `apps/erp/src/components/om/create-ticket-dialog.tsx` (custom project state)
- Modify: `apps/erp/src/app/(erp)/om/tickets/page.tsx` (remove strike-through, add Total Service Amount header, show custom project)
- Modify: `packages/types/database.ts` (regen)

- [ ] **Step 1: Write migration 183**

```sql
-- =============================================================================
-- Migration 183 — Service tickets: optional project (free-text label) + total RPC
-- Spec: docs/superpowers/specs/2026-06-16-manivel-feedback-batch3-design.md
-- Allow tickets for Service/AMC/misc work not tied to an ERP project: project_id
-- becomes nullable with a free-text project_name_custom fallback (CHECK: one of the
-- two). Ticket numbers are TKT-NNNN (project-independent), so nulls are safe.
-- get_service_ticket_amount_total(): SQL SUM for the list header (NEVER-DO #12).
-- Dev-first; prod deferred.
-- =============================================================================

ALTER TABLE om_service_tickets ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE om_service_tickets ADD COLUMN IF NOT EXISTS project_name_custom TEXT;
ALTER TABLE om_service_tickets DROP CONSTRAINT IF EXISTS om_service_tickets_project_or_custom;
ALTER TABLE om_service_tickets ADD CONSTRAINT om_service_tickets_project_or_custom
  CHECK (project_id IS NOT NULL OR project_name_custom IS NOT NULL);

CREATE OR REPLACE FUNCTION get_service_ticket_amount_total()
RETURNS NUMERIC
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(service_amount), 0) FROM om_service_tickets;
$$;
REVOKE ALL ON FUNCTION get_service_ticket_amount_total() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_service_ticket_amount_total() TO authenticated;
```

- [ ] **Step 2: Apply migration 183 to dev** and verify the column + constraint + function exist.

- [ ] **Step 3: Add `allowCustom` to `ProjectCombobox`** (shared component). Add props:

```ts
  allowCustom?: boolean;          // show "Use '<typed>'" when no match
  customValue?: string;           // current free-text value (when no project selected)
  onCustomChange?: (name: string) => void;
```
When `allowCustom` and the typed `query` is non-empty, render an always-available footer option in the dropdown:

```tsx
{allowCustom && query.trim() && (
  <button
    type="button"
    onClick={() => { onCustomChange?.(query.trim()); onChange(''); setOpen(false); }}
    className="w-full text-left px-3 py-2 text-xs text-shiroi-green hover:bg-n-50 border-t border-n-100"
  >
    Use “{query.trim()}” as project name
  </button>
)}
```
When `customValue` is set and `value` is empty, show the custom value as the trigger label (so the chosen label persists). Default behaviour (no `allowCustom`) is unchanged — AMC/expenses keep select-only.

- [ ] **Step 4: `createServiceTicket` accepts a custom name.** In `service-ticket-actions.ts`, widen the input to `{ projectId?: string; projectNameCustom?: string; ... }`, require at least one, and set both columns on insert (`project_id: input.projectId ?? null`, `project_name_custom: input.projectNameCustom ?? null`). Keep ticket-number minting unchanged. Add a query:

```ts
export async function getServiceTicketAmountTotal(): Promise<number> {
  const op = '[getServiceTicketAmountTotal]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_service_ticket_amount_total');
  if (error) { console.error(`${op} Failed:`, { code: error.code, message: error.message }); return 0; }
  return Number(data ?? 0);
}
```

- [ ] **Step 5: Wire custom project into `create-ticket-dialog.tsx`** — add `customProject` state, pass `allowCustom customValue={customProject} onCustomChange={setCustomProject}` to the combobox, and send `projectNameCustom: customProject || undefined` (and `projectId` only when chosen) to `createServiceTicket`. Validate one is present before submit.

- [ ] **Step 6: tickets page — remove strike-through + show custom project.** In `om/tickets/page.tsx` (~214–233): delete the `opacity-50` row class and the `line-through text-n-400` on the title (keep `text-n-900`). Where the project name renders, fall back to `ticket.project_name_custom` when `project_id`/joined project is null (label it plainly, no link). Confirm `getAllTickets` selects `project_name_custom`.

- [ ] **Step 7: tickets page — Total Service Amount header.** In the page server component, `const totalServiceAmount = await getServiceTicketAmountTotal();` and render near the title (~line 125–134): `Total Service Amount: {formatINR(totalServiceAmount)}` using the existing `formatINR` import.

- [ ] **Step 8: Regen types, run 4 gates, commit**

```bash
git add supabase/migrations/183_2026-06-16-service-ticket-custom-project.sql apps/erp/src/components/forms/project-combobox.tsx apps/erp/src/lib/service-ticket-actions.ts apps/erp/src/components/om/create-ticket-dialog.tsx "apps/erp/src/app/(erp)/om/tickets/page.tsx" packages/types/database.ts
git commit -m "feat(om): service tickets — Closed badge (no strike-through), Total Service Amount header, free-text project (mig 183)"
```

---

## Commit 3 — Activities free-text project (mig 184)

**Files:**
- Create: `supabase/migrations/184_2026-06-16-activity-custom-project.sql`
- Modify: `apps/erp/src/lib/project-activities-actions.ts` (`addProjectActivity` accepts custom name)
- Modify: `apps/erp/src/lib/project-activities-queries.ts` (select + return `project_name_custom`)
- Modify: `apps/erp/src/components/projects/activities/activity-form-dialog.tsx` (custom project state via `allowCustom`)
- Modify: `apps/erp/src/components/projects/activities/activities-client.tsx` (render custom label when no project_id)
- Modify: `packages/types/database.ts` (regen)

- [ ] **Step 1: Write migration 184**

```sql
-- =============================================================================
-- Migration 184 — Activities: optional project (free-text label)
-- Spec: docs/superpowers/specs/2026-06-16-manivel-feedback-batch3-design.md
-- Capture activities for Service/AMC/misc work not tied to an ERP project:
-- project_id nullable + free-text project_name_custom fallback (CHECK: one of two).
-- Dev-first; prod deferred.
-- =============================================================================

ALTER TABLE project_activities ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE project_activities ADD COLUMN IF NOT EXISTS project_name_custom TEXT;
ALTER TABLE project_activities DROP CONSTRAINT IF EXISTS project_activities_project_or_custom;
ALTER TABLE project_activities ADD CONSTRAINT project_activities_project_or_custom
  CHECK (project_id IS NOT NULL OR project_name_custom IS NOT NULL);
```

- [ ] **Step 2: Apply migration 184 to dev** and verify column + constraint.

- [ ] **Step 3: `addProjectActivity` accepts custom name.** Widen input to allow `projectNameCustom`; require `projectId` OR `projectNameCustom`; insert `project_id: input.projectId ?? null`, `project_name_custom: input.projectNameCustom ?? null`. Keep the founder/PM + `created_by` guard.

- [ ] **Step 4: queries return the custom label.** In `listProjectActivities`, add `project_name_custom` to the select; in the row mapper expose it; keep the projects join as LEFT join. The global page's project filter still works for real projects.

- [ ] **Step 5: dialog uses `allowCustom`** — in `activity-form-dialog.tsx` (global add path, ~line 106–116) add `customProject` state and pass `allowCustom customValue customProject onCustomChange` to `ProjectCombobox`; submit `projectNameCustom` when set.

- [ ] **Step 6: client renders custom label.** In `activities-client.tsx` Project column (~line 111–129), when `project_id` is null render `project_name_custom` as plain text (no link); else keep the existing link.

- [ ] **Step 7: Regen types, run 4 gates, commit**

```bash
git add supabase/migrations/184_2026-06-16-activity-custom-project.sql apps/erp/src/lib/project-activities-actions.ts apps/erp/src/lib/project-activities-queries.ts apps/erp/src/components/projects/activities/ packages/types/database.ts
git commit -m "feat(activities): log activities against a free-text project name (mig 184)"
```

---

## Commit 4 — Projects list: header strip + columns + FY Year (mig 185)

**Files:**
- Create: `supabase/migrations/185_2026-06-16-project-status-summary.sql`
- Create: `apps/erp/src/lib/helpers/fiscal-year.ts` + test
- Create: `apps/erp/src/components/projects/projects-summary-header.tsx`
- Modify: `apps/erp/src/lib/projects-queries.ts` (`getProjectStatusSummary`)
- Modify: `apps/erp/src/app/(erp)/projects/page.tsx` (render header; use fyOptions)
- Modify: `apps/erp/src/components/data-table/column-config.ts` (notes default + wrap; activities col; year editable=fy)
- Modify: `apps/erp/src/components/data-table/data-table.tsx` (wrap rendering; activities link cell; FY inline editor)
- Modify: `apps/erp/src/lib/inline-edit-actions.ts` (`year` → order_date via fyToOrderDate)
- Modify: `packages/types/database.ts` (regen)

- [ ] **Step 1: Write migration 185** (per-status counts + total kWp, FY-filtered, with SQL grand-total row)

```sql
-- =============================================================================
-- Migration 185 — get_project_status_summary(p_fy): list header dashboard
-- Spec: docs/superpowers/specs/2026-06-16-manivel-feedback-batch3-design.md
-- One row per status (count + summed kWp) over non-deleted projects, FY-filtered with
-- the same order_date-with-created_at-fallback logic the list uses (projects-queries.ts).
-- A 'TOTAL' grand-total row (GROUPING SETS) keeps the total system size fully in SQL
-- (NEVER-DO #12). Dev-first; prod deferred.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_project_status_summary(p_fy TEXT DEFAULT NULL)
RETURNS TABLE (status TEXT, project_count BIGINT, total_kwp NUMERIC)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT p.status::text AS status, p.system_size_kwp AS kwp
    FROM projects p
    WHERE p.deleted_at IS NULL
      AND (
        p_fy IS NULL OR p_fy !~ '^\d{4}-\d{2}$'
        OR (p.order_date >= (substring(p_fy from 1 for 4) || '-04-01')::date
            AND p.order_date < (((substring(p_fy from 1 for 4))::int + 1)::text || '-04-01')::date)
        OR (p.order_date IS NULL
            AND p.created_at >= (substring(p_fy from 1 for 4) || '-04-01')::timestamptz
            AND p.created_at < (((substring(p_fy from 1 for 4))::int + 1)::text || '-04-01')::timestamptz)
      )
  )
  SELECT CASE WHEN GROUPING(status) = 1 THEN 'TOTAL' ELSE status END,
         COUNT(*), COALESCE(SUM(kwp), 0)
  FROM base
  GROUP BY GROUPING SETS ((status), ());
$$;
REVOKE ALL ON FUNCTION get_project_status_summary(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_project_status_summary(TEXT) TO authenticated;
```

- [ ] **Step 2: Apply migration 185 to dev**; smoke `SELECT * FROM get_project_status_summary(NULL);` and `('2025-26')` — expect status rows + one TOTAL row.

- [ ] **Step 3: Write FY helper + failing test**

`apps/erp/src/lib/helpers/fiscal-year.ts`:
```ts
/** FY string like '2025-26' → order_date to store (1-Apr of FY start), or null if malformed. */
export function fyToOrderDate(fy: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  return m ? `${m[1]}-04-01` : null;
}

/** A date → FY string like '2025-26' (FY starts 1-Apr), or null. */
export function dateToFy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const start = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** FY options newest-first from 2014-15 up to the current FY. */
export function fyOptions(currentYearUtc: number, currentMonthUtc: number): string[] {
  const start = currentMonthUtc >= 3 ? currentYearUtc : currentYearUtc - 1;
  const out: string[] = [];
  for (let y = start; y >= 2014; y--) out.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  return out;
}
```
`apps/erp/src/lib/helpers/fiscal-year.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fyToOrderDate, dateToFy, fyOptions } from './fiscal-year';

describe('fyToOrderDate', () => {
  it('maps FY to 1-Apr of start year', () => expect(fyToOrderDate('2025-26')).toBe('2025-04-01'));
  it('null on malformed', () => { expect(fyToOrderDate('2025')).toBeNull(); expect(fyToOrderDate('x')).toBeNull(); });
});
describe('dateToFy', () => {
  it('March → prior FY', () => expect(dateToFy('2026-03-31T00:00:00Z')).toBe('2025-26'));
  it('April → new FY', () => expect(dateToFy('2025-04-01T00:00:00Z')).toBe('2025-26'));
  it('null/invalid → null', () => { expect(dateToFy(null)).toBeNull(); expect(dateToFy('nope')).toBeNull(); });
});
describe('fyOptions', () => {
  it('newest-first down to 2014-15', () => {
    const o = fyOptions(2026, 5); expect(o[0]).toBe('2026-27'); expect(o.at(-1)).toBe('2014-15');
  });
});
```

- [ ] **Step 4: Run the test — verify pass.** `pnpm --filter @repo/erp test fiscal-year` (or repo's vitest invocation). Expected: PASS. Then refactor `page.tsx`'s inline FY loop (lines 39–41) to call `fyOptions(...)`.

- [ ] **Step 5: `getProjectStatusSummary` query.** In `projects-queries.ts`:
```ts
export interface ProjectStatusSummaryRow { status: string; project_count: number; total_kwp: number; }
export async function getProjectStatusSummary(fy?: string): Promise<ProjectStatusSummaryRow[]> {
  const op = '[getProjectStatusSummary]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_project_status_summary', { p_fy: fy ?? null });
  if (error) { console.error(`${op} Failed:`, { code: error.code, message: error.message }); return []; }
  return (data ?? []) as ProjectStatusSummaryRow[];
}
```

- [ ] **Step 6: `ProjectsSummaryHeader` component** — server-friendly (data passed in). Split the rows into the `TOTAL` row (total count + total kWp) and per-status chips using the existing status label + colour map (reuse `STATUS_LABELS`/colour map already in `page.tsx`/`projects-table-wrapper.tsx`; extract to a shared constants file if needed to respect the client/server import boundary, NEVER-DO #21). Render: a "Total System Size — X kWp · N projects" stat + one chip per status `Label — count`.

- [ ] **Step 7: render header in `page.tsx`** — `const statusSummary = await getProjectStatusSummary(filters.fy)` and place `<ProjectsSummaryHeader rows={statusSummary} />` above the table. Re-fetches per FY because it reads the same `filters.fy`.

- [ ] **Step 8: column-config — Notes + Activities + Year.** In `column-config.ts` projects columns: set `notes` (label "Notes") `defaultVisible: true`, `editable: true`, add a `wrap: true` flag; collapse the duplicate `remarks` entry. Add `{ key: 'activities', label: 'Activities', defaultVisible: true, sortable: false, editable: false, fieldType: 'activities_link' }`. Change `year` to `editable: true, fieldType: 'fy'`. Update `getDefaultColumns('projects')` to `['project_number','customer_project','site_city','system_size_kwp','status','notes','activities','year']`.

- [ ] **Step 9: data-table rendering.** In `data-table.tsx`: (a) for a column with `wrap`, drop the truncate/nowrap classes and allow `whitespace-normal break-words` with a sensible max-width; (b) `activities_link` cell renders an icon/link to `/projects/${row.id}?tab=execution`; (c) `fy` field: display `dateToFy(row.order_date ?? row.created_at)`, and in edit mode render a `<select>` of `fyOptions(...)`; on change call `updateCellValue({ entityType:'projects', rowId:row.id, field:'year', value:selectedFy })`.

- [ ] **Step 10: inline-edit `year` → order_date.** In `inline-edit-actions.ts` add a `projects` transform: when `field === 'year'`, map to column `order_date` with `value = fyToOrderDate(value)` (reject if null). Ensure `order_date` isn't in the blocked set.

- [ ] **Step 11: Regen types, run 4 gates + vitest, commit**

```bash
git add supabase/migrations/185_2026-06-16-project-status-summary.sql apps/erp/src/lib/helpers/ apps/erp/src/components/projects/projects-summary-header.tsx apps/erp/src/lib/projects-queries.ts "apps/erp/src/app/(erp)/projects/page.tsx" apps/erp/src/components/data-table/ apps/erp/src/lib/inline-edit-actions.ts packages/types/database.ts
git commit -m "feat(projects): status+size dashboard header, Notes/Activities columns, editable FY year (mig 185)"
```

---

## Commit 5 — BOQ PDF download on the project BOQ tab

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-boq.tsx` (mount `BoqDownloadButton`)
- (Read first: `components/procurement/boq-download-button.tsx` props, `lib/pdf/boq-pdf.tsx` `BoqPdfProps`.)

- [ ] **Step 1: confirm data shape.** `step-boq.tsx` already loads BOQ items; confirm each has `line_number, item_category, item_description, unit, quantity, unit_price, total_price, hsn_code` and the project has `project_number, customer_name` + site address parts. Map to `BoqPdfProps` (which the procurement view already builds).

- [ ] **Step 2: mount the button** in the BOQ step header actions, passing `project={{ project_number, customer_name, site_address }}`, `items={mappedItems}`, `generatedBy={viewerName}`. Guard render to founder/PM/purchase_officer (the step already knows the viewer role).

- [ ] **Step 3: run 4 gates, commit**

```bash
git add apps/erp/src/components/projects/stepper-steps/step-boq.tsx
git commit -m "feat(projects): download BOQ as PDF from the project BOQ tab"
```

---

## After all commits

- [ ] `git push origin main`.
- [ ] Update `docs/CHANGELOG.md` (one line), `docs/CURRENT_STATUS.md`, and module docs (`projects.md`, `om.md`, `purchase.md` for price book).
- [ ] Notify Vivek of the dev walkthrough list (spec Verification section).

## Self-review notes (spec coverage)

- Req #1/#2/#3 → Commit 4 (header strip, mig 185, FY-aware). #4 Notes/Activities → Commit 4. #5 editable Year → Commit 4. #6 default headers → Commit 4 Step 8. #7 custom config → already exists (mig 178); new cols registered in Step 8.
- Activities free-text → Commit 3. Tickets free-text → Commit 2. Closed badge → Commit 2 Step 6. Created date → verify-only (Commit 2 Step 6 confirms). Total Service Amount → Commit 2 Step 7. BOQ PDF → Commit 5. Price Book RLS+edit → Commit 1.
