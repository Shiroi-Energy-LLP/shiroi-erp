# BOM + Voucher Import — Design Spec

> **Date:** 2026-06-21
> **Status:** Approved (Vivek), ready for implementation
> **Scope:** Dev-only until a prod window is green-lit.
> **Related:** Mirrors the historical-plants importer (`pending_project_imports`, migs 159/160/191, `/om/import-review`). Targets the procurement side (`project_boq_items`), not the customer BOM (`proposal_bom_lines`).

---

## 1. Problem & context

Shiroi has detailed, hand-maintained per-project Bills of Materials in
`scripts/data/se-master-file-2026-06-05.xlsx` — one sheet per project (~48
projects), each with a **contracted** price track *and* an **actual** spend
track, plus voucher/bill-collection tracking in a consolidated "rough sheet".

Today:

- `proposal_bom_lines` (~24,699 rows) already holds the **contracted/quote** BOM,
  extracted from proposal storage files by `scripts/extract-bom-*.ts`. So a
  contracted-only import would mostly duplicate existing data.
- `project_boq_items` (the procurement/BOI side, tied to **projects**) is
  essentially **empty** for history: only **62 of 480** projects have any BOQ
  rows (799 total). The **actuals + vouchers** in se-master-file are captured
  **nowhere**.
- Project-name matching is unreliable: in a 20-name sample ~60% matched, several
  ambiguously (Navins Starwood → 3 candidates, Hindu School → 5, Muralidharan →
  2), and ~40% had no project at all (Ceebros, Chettinad, GK Shetty, …). So
  matching **must be human-reviewed** — never blind-written (consistent with the
  "never auto-apply reconciliation" rule).

**Goal:** an upload → parse → auto-match → human-review → confirm pipeline that
writes each sheet's BOM (contracted + actual + voucher) into the matched
project's `project_boq_items`, and lets Manivel self-serve future uploads from
the BOM page. Seed the existing ~48 as the first batch to prove it end-to-end.

### Decisions locked with Vivek

1. **Depth:** Full — contracted + actual + voucher.
2. **Home:** A staged review screen reached from the BOM page (`/bom-review`).
3. **Format:** A tolerant parser for the existing se-master-file sheets (no
   reformatting); the preview step catches misreads.

## 2. Goals / non-goals

**Goals**
- Parse the se-master-file per-project sheet layout tolerantly.
- Stage parsed sheets with an auto-matched project + alternative candidates.
- A review screen: fix the project match, edit any parsed line (incl. voucher),
  confirm or skip — founder/PM only.
- On confirm, write a per-project BOI container + its `project_boq_items`
  (contracted + actual + voucher).
- A seed script to load the ~48 sheets into the review queue.

**Non-goals (explicit phase-2, noted so nothing is silently dropped)**
- **Creating the missing ~40% of project records.** The BOM importer *attaches
  to existing projects only*. Minting the missing projects stays the job of the
  existing `/om/import-review` flow (593 staged, 0 imported). The two compose:
  create the project there → attach its BOM here.
- **Bulk import of the "rough sheet" voucher consolidation** (fuzzy MT/VN →
  line mapping). The `voucher_no` + `bill_status` columns exist from day one and
  the review UI allows manual per-line voucher entry; the automated rough-sheet
  backfill is a follow-on.
- **Mobile / customer-facing surfaces.** Internal ERP only.

## 3. Data model (migration 198, dev-first; regenerate `database.ts` same commit)

### 3.1 Extend `project_boq_items`

It already holds the contracted side (`quantity`, `unit_price`, `total_price`,
`gst_rate`). Add:

| Column | Type | Note |
|--------|------|------|
| `actual_quantity` | `NUMERIC` | "Act Qty" |
| `actual_unit_price` | `NUMERIC(14,2)` | "Act Rate" |
| `actual_total_price` | `NUMERIC(14,2)` | "Act Total (w/ GST)" |
| `voucher_no` | `TEXT` | MT/VN reference |
| `bill_status` | `TEXT` | `CHECK (bill_status IN ('need_bill','submitted','na')) DEFAULT 'na'` |

All nullable (legacy rows keep working). No new indexes — these columns are
displayed, not filtered/sorted/joined.

### 3.2 New staging table `pending_bom_imports`

One row per **project sheet** in an upload. Parsed lines live as JSONB (same
pattern as `material_requisitions.items`) because they are reviewed then
cascaded, not queried directly.

```sql
CREATE TABLE pending_bom_imports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id  UUID NOT NULL,            -- groups one upload
  source_file_name TEXT NOT NULL,
  sheet_name       TEXT NOT NULL,
  project_name     TEXT NOT NULL,            -- from the sheet header
  normalized_name  TEXT NOT NULL,

  -- Match outcome (computed at seed time via match_project_by_name)
  matched_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  match_confidence   TEXT NOT NULL DEFAULT 'none'
                     CHECK (match_confidence IN ('exact','fuzzy','none')),
  match_score        NUMERIC(4,3) NOT NULL DEFAULT 0,
  match_candidates   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- top N {project_id, customer_name, project_number, score}

  -- Parsed payload
  header        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- type_of_shed, sys_size, location, prepared_by, dc_ac, dates
  parsed_lines  JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- work_order_value, est_cost, act_cost, con_profit, act_profit
  line_count    INT NOT NULL DEFAULT 0,

  -- Lifecycle
  status_review TEXT NOT NULL DEFAULT 'pending'
                CHECK (status_review IN ('pending','imported','rejected','error')),
  imported_boi_id     UUID REFERENCES project_bois(id) ON DELETE SET NULL,
  imported_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  imported_at   TIMESTAMPTZ,
  import_error  TEXT,
  rejection_reason TEXT,
  reviewed_by   UUID REFERENCES profiles(id),
  reviewed_at   TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_pending_bom_imports_status ON pending_bom_imports (status_review);
CREATE INDEX idx_pending_bom_imports_batch  ON pending_bom_imports (import_batch_id);
CREATE INDEX idx_pending_bom_imports_match  ON pending_bom_imports (match_confidence) WHERE status_review = 'pending';
```

Parsed-line element shape (TS `ParsedBomLine`, stored verbatim in `parsed_lines`):

```ts
{
  line_number: number;
  item_category: string;       // current category header
  item_description: string;
  make: string | null;         // "Make" column (G)
  vendor_name: string | null;  // vendor label sometimes in col A
  quantity: number | null;        unit: string | null;
  unit_price: number | null;      gst_rate: number | null;  total_price: number | null;   // contracted
  actual_quantity: number | null; actual_unit_price: number | null; actual_total_price: number | null; // actual
  voucher_no: string | null;   bill_status: 'need_bill' | 'submitted' | 'na';
  remarks: string | null;
}
```

### 3.3 RLS

```sql
ALTER TABLE pending_bom_imports ENABLE ROW LEVEL SECURITY;
-- founder + project_manager read/insert/update; service_role full (seed script)
CREATE POLICY pbi_select ON pending_bom_imports FOR SELECT TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder','project_manager']::app_role[]));
CREATE POLICY pbi_insert ON pending_bom_imports FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = ANY (ARRAY['founder','project_manager']::app_role[]));
CREATE POLICY pbi_update ON pending_bom_imports FOR UPDATE TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['founder','project_manager']::app_role[]));
CREATE POLICY pbi_service ON pending_bom_imports FOR ALL TO service_role USING (true) WITH CHECK (true);
```

`updated_at` trigger reuses the existing `fn_*_set_updated_at` pattern.

### 3.4 RPCs

**`match_project_by_name(p_name TEXT, p_limit INT DEFAULT 5)`** — STABLE,
SECURITY INVOKER. Uses `pg_trgm` `similarity()` (added mig 190) over
`projects.customer_name`. Returns `(project_id, customer_name, project_number,
score)` ordered by score desc. Drives both the seed-time auto-match and the
"alternative candidates" list. Authenticated.

**`approve_bom_import(p_id UUID, p_project_id UUID, p_lines JSONB)`** —
SECURITY DEFINER, founder/PM only (`get_my_role()` gate, `SET search_path`).
Accepts the **final** (possibly edited) lines + chosen project from the review
UI, so no per-cell staging writes are needed. Transaction:
1. Lock the staging row; require `status_review='pending'`; require the project
   exists.
2. `INSERT INTO project_bois (project_id, boi_number=next, status='locked',
   prepared_by=<caller employee>, notes='Imported from <file> / <sheet>')`.
3. For each element of `p_lines`: `INSERT INTO project_boq_items` with
   `project_id`, `boi_id`, `line_number`, `item_category`, `item_description`,
   `brand=make`, `vendor_name`, `quantity`, `unit`, `unit_price`, `gst_rate`,
   `gst_type='supply'`, `total_price`, `actual_quantity`, `actual_unit_price`,
   `actual_total_price`, `voucher_no`, `bill_status`,
   `procurement_status='yet_to_finalize'`.
4. Mark the import `status_review='imported'`, set `imported_boi_id`,
   `imported_project_id`, `imported_at`, `reviewed_by`.
5. `EXCEPTION WHEN OTHERS` → mark `status_review='error'`, store `import_error`,
   re-raise (same shape as `approve_pending_import`).

**Reject / skip** is a plain RLS `UPDATE` (`status_review='rejected'` +
`rejection_reason`) wrapped in a thin action — no SECURITY DEFINER needed.

## 4. Parser — `apps/erp/src/lib/bom-sheet-parser.ts`

Pure, dependency-light (`exceljs`, already a dep). Runs in **both** the browser
(upload dialog) and Node (seed script). Tolerant by design — sheets drift
(89–194 rows, title variants, MSM has fewer columns).

```ts
export type ParsedBomLine = { /* §3.2 */ };
export interface ParsedBomSheet {
  ok: boolean;
  sheetName: string; projectName: string;
  header: Record<string, unknown>;
  lines: ParsedBomLine[];
  summary: Record<string, unknown>;
  warnings: string[];
}
export function parseBomWorkbook(buf: ArrayBuffer): { sheets: ParsedBomSheet[]; warnings: string[] };
export function parseBomSheet(ws: ExcelJS.Worksheet): ParsedBomSheet;
```

Algorithm per sheet:
1. **Skip non-BOM sheets.** Only parse sheets whose title row contains "Bill Of
   Materials" (any variant); ignore `Project Report`, `Project details`,
   `Daily Report`, `rough`, `rough sheet`, `Sheet30..32`.
2. **Header block** (rows ~1–7): read labelled pairs (`Project Name`,
   `Type of Shed`, `Sys Size`, `Location`, `Prepared by`, `DC/AC Capacity`,
   dates) by scanning for the label text, not fixed cells.
3. **Anchor the table**: find the header row containing `Items` + one of
   `Con Without Gst` / `Rate`. Map column indices dynamically from it
   (contracted block H–M, actual block N–S, `Make`, `Remarks`) — never hardcode
   offsets, because they shift between sheets.
4. **Classify rows** until a `Summary` row:
   - *Category header*: col A non-empty, description (col B) empty, subtotals in
     the Con/Act subtotal columns → set `currentCategory`.
   - *Item row*: description non-empty → emit a `ParsedBomLine`
     (`item_category=currentCategory`, contracted H–M, actual N–S, `make`=G,
     `vendor_name`=col A if it looks like a vendor label, `remarks`=T).
   - Skip fully-blank rows.
5. **Summary block**: capture work-order value, est/act cost, con/act profit.
6. **Warnings** (never throw): missing header anchor, zero lines, a row with a
   description but no contracted total, etc. — surfaced in the review UI.

**Tests** (`apps/erp/src/lib/__tests__/bom-sheet-parser.test.ts`, TDD): build
small in-memory `exceljs` worksheets that reproduce the real layouts
(Mr Muralidharan = standard, GK Shetty = "/Purchase Request" + extra cols, MSM =
narrow variant) and assert category grouping, contracted vs actual split,
vendor-label capture, and graceful warnings on a malformed sheet.

## 5. Matching

At seed/upload time, for each parsed sheet call `match_project_by_name`. Set
`matched_project_id` + `match_confidence`:
- `score >= 0.85` → `exact` (auto-selected default, still confirmable)
- `0.45 <= score < 0.85` → `fuzzy` (default-selected but flagged)
- `< 0.45` → `none` (reviewer must pick or skip)

Store the top 5 as `match_candidates`. The review UI shows the chosen match and
the alternatives; the project picker (reuse
`apps/erp/src/components/forms/project-combobox.tsx`) lets the reviewer override.

## 6. UI

### 6.1 Entry point — on `/bom-review`
An **"Import from Excel"** button (founder/PM only) linking to
`/bom-review/import`. (Keeps the existing 24.7k-line review grid untouched.)

### 6.2 `/bom-review/import` — staged review (mirrors `/om/import-review`)
- **Server page** reads `pending_bom_imports` (status filter, default `pending`)
  via `bom-import-queries.ts`, role-gated founder/PM.
- **Upload control** (`_components/bom-upload-dialog.tsx`, `'use client'`):
  file input → `parseBomWorkbook` client-side → preview sheet count + per-sheet
  line counts + warnings → `seedBomImports` action stages them → refresh.
- **Review list** (`_components/bom-import-list.tsx` + `bom-import-row-card.tsx`):
  one card per staged sheet, ordered by match confidence. Card shows: project
  match picker (default = best candidate; candidate chips; combobox override),
  confidence badge, line count, contracted/actual totals. Expand → the parsed
  lines in an editable table (every cell, incl. `voucher_no` + `bill_status`);
  edits held in client state. Per-card **Confirm** (calls `approveBomImport(id,
  projectId, editedLines)`) and **Skip** (`rejectBomImport`).
- Reuse `ListPageShell` + the sticky-header table standard.

### 6.3 Actions / queries
- `apps/erp/src/lib/bom-import-actions.ts` (`'use server'`, `ActionResult<T>`):
  `seedBomImports(batch)`, `approveBomImport(id, projectId, lines)`,
  `rejectBomImport(id, reason)`. Thin wrappers over RPC / RLS writes, mirroring
  `import-review-actions.ts`.
- `apps/erp/src/lib/bom-import-queries.ts`: `getBomImports(filters)` (paginated,
  `count:'estimated'`), `getBomImportStats()`.
- Shared client-safe constants (status labels, `bill_status` options) in
  `bom-import-constants.ts` to respect the client/server import boundary
  (NEVER-DO #21).

## 7. Seeding the initial ~48 — `scripts/seed-bom-imports.ts`
Service-role script: load `se-master-file-2026-06-05.xlsx` → `parseBomWorkbook`
→ for each sheet call `match_project_by_name` (service role) → insert a
`pending_bom_imports` row (one `import_batch_id` for the run). Idempotent:
skip a `(source_file_name, sheet_name)` already present in `pending`/`imported`.
Run it on dev; Manivel reviews + confirms in the UI.

## 8. Role access
Founder + project_manager (Manivel is PM) for the whole flow — upload, review,
confirm, skip. Matches `pending_project_imports` precedent.

## 9. Testing & verification
- Parser unit tests (§4) — the core risk.
- `match_project_by_name` sanity check on dev (known names → expected projects).
- Manual: run the seed script on dev, open `/bom-review/import`, confirm one
  matched sheet, verify the BOI + `project_boq_items` appear on that project's
  procurement page with contracted **and** actual values + voucher fields.
- All four CI gates green locally before push
  (`check-types`, `lint`, `check-forbidden-patterns.sh`, `build`).

## 10. File manifest
```
supabase/migrations/198_2026-06-21-bom-voucher-import.sql      (new)
packages/types/database.ts                                     (regen)
apps/erp/src/lib/bom-sheet-parser.ts                           (new)
apps/erp/src/lib/__tests__/bom-sheet-parser.test.ts           (new)
apps/erp/src/lib/bom-import-actions.ts                         (new)
apps/erp/src/lib/bom-import-queries.ts                         (new)
apps/erp/src/lib/bom-import-constants.ts                       (new)
apps/erp/src/app/(erp)/bom-review/import/page.tsx             (new)
apps/erp/src/app/(erp)/bom-review/import/_components/bom-upload-dialog.tsx   (new)
apps/erp/src/app/(erp)/bom-review/import/_components/bom-import-list.tsx     (new)
apps/erp/src/app/(erp)/bom-review/import/_components/bom-import-row-card.tsx (new)
apps/erp/src/app/(erp)/bom-review/page.tsx                     (edit: add Import button)
scripts/seed-bom-imports.ts                                    (new)
docs/CHANGELOG.md, docs/CURRENT_STATUS.md, docs/modules/purchase.md (docs)
```

## 11. Risks
- **Parser fragility** on unseen sheet variants → mitigated by dynamic anchoring,
  warnings, and the mandatory preview/edit step (no blind writes).
- **Wrong project match** → never auto-applied; reviewer confirms each, picker +
  candidates make override one click.
- **Double import** → idempotent seed; confirmed rows leave the `pending` queue;
  a project can legitimately receive multiple BOIs (versions), so we don't hard-
  block re-import but the BOI note records provenance.
- **Migration numbering collision** with parallel sessions → verify 198 is free
  immediately before applying.
```
