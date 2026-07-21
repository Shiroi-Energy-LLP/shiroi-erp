# Purchase Flow — BOI Manager Replication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate Manivel's "Bill of Items Manager" purchase flow (price book → project BOI → multi-select → instant PO + PDF) inside the ERP, on top of the existing `project_boq_items` / `purchase_orders` / `price_book` tables.

**Architecture:** New route group `/purchase` (BOI workspace, PO log, project rollup, site-engineer intake) backed by new `purchase-flow-queries.ts`/`-actions.ts`. All money math and multi-row mutations happen in SQL RPCs (mig 210). The heavyweight v2 RFQ flow at `/procurement` is untouched — both flows share the same tables, so data stays consistent.

**Tech Stack:** Next.js 14 App Router, Supabase (dev project `actqtzoxjilqnldnacqz` ONLY — prod is frozen), @react-pdf/renderer, decimal.js, shadcn/ui, `ListPageShell` + `containedScroll` sticky-header pattern.

**Source spec (MUST READ for every UI task):** `docs/superpowers/specs/2026-07-20-purchase-flow-boi-manager-spec.md` — referenced below as "spec §N". The muscle-memory parts that must survive exactly (spec §14.6): five status views, always-visible status-wise money KPI row, bulk action bar, vendor-mismatch warn-but-allow.

---

## Locked design decisions (do not re-litigate)

| Sheet concept | ERP mapping |
|---|---|
| BOI line | `project_boq_items` row (existing). Status ladder `yet_to_finalize → yet_to_place → order_placed → received → delivered` already exists in its CHECK (024). `ready_to_dispatch` rows (from v2 dispatch) display/count under the **Received** bucket; the status dropdown offers only the 5 canonical statuses. |
| Project (name string) | `projects` row — real FK `project_boq_items.project_id`. NO free-text "type a new project" — BOI lines attach to real projects via combobox (deliberate delta; creating projects stays in the projects module). |
| Price Book | existing `price_book` table + existing `/price-book` page (reused, not rebuilt). Categories come from the DB `item_categories` master, NOT the sheet's 15-item list. |
| Expenses tab | existing `/expenses` module (reused, not rebuilt). Rollup RPC reads the `expenses` table. |
| PO | `purchase_orders` + `purchase_order_items` rows with new `source='boi_quick'`, `vendor_name` free text (vendor_id becomes nullable, best-effort matched), `payment_terms` text, `transport`, `delivery_place`. Line items frozen at creation (spec §6.3). |
| PO number | New sequence-backed `next_boi_po_number()` → `PO-0001` format, seeded above current max `PO-\d+`. v2 keeps `generate_doc_number('PO')`. |
| PDF | New minimal template per spec §6.2 (NOT the existing letterhead PO PDF). Generated at creation, uploaded to Storage (`pdf_storage_path`), downloadable via `/api/purchase/[poId]/pdf`. |
| Roles | Price-visible = `founder`, `project_manager`, `purchase_officer`, `finance`. Site engineers = `site_supervisor` → intake UI only, prices stripped server-side (never selected). Admin-ish actions (none beyond price-visible here). |
| KPIs / money totals | SQL RPCs only (NEVER-DO #12). BOI table rows load fully (batched `.range` loop — scale ~1–5k rows) and filter client-side per spec §12; KPI money comes from `get_boi_status_totals` RPC with the same filters. |

**Concurrency rules for this repo:** parallel Claude sessions share this tree. `git add` ONLY your own files by pathspec, never `-A`. Commit locally per task; push once at the end after full gates.

---

## File map

```
supabase/migrations/210_2026-07-20-purchase-flow-boi.sql        (new)
apps/erp/src/lib/purchase-flow-constants.ts                     (new — client-safe, no server imports)
apps/erp/src/lib/purchase-flow-queries.ts                       (new)
apps/erp/src/lib/purchase-flow-actions.ts                       (new, 'use server')
apps/erp/src/lib/pdf/boi-po-pdf.tsx                             (new)
apps/erp/src/app/api/purchase/[poId]/pdf/route.ts               (new)
apps/erp/src/app/(erp)/purchase/page.tsx                        (new — BOI workspace)
apps/erp/src/app/(erp)/purchase/orders/page.tsx                 (new — PO log)
apps/erp/src/app/(erp)/purchase/projects/page.tsx               (new — rollup)
apps/erp/src/app/(erp)/purchase/intake/page.tsx                 (new — site engineer)
apps/erp/src/components/purchase-flow/boi-workspace.tsx         (new — client root: filters+KPIs+table+selection)
apps/erp/src/components/purchase-flow/boi-table.tsx             (new — table + inline edit + badge selects)
apps/erp/src/components/purchase-flow/boi-add-item-modal.tsx    (new — single add/edit w/ PB autocomplete)
apps/erp/src/components/purchase-flow/boi-bulk-add-modal.tsx    (new — Add Multiple from Price Book)
apps/erp/src/components/purchase-flow/boi-bulk-bar.tsx          (new — N selected · status · Create PO · delete)
apps/erp/src/components/purchase-flow/create-po-modal.tsx       (new)
apps/erp/src/components/purchase-flow/po-log-client.tsx         (new — edit/delete modals)
apps/erp/src/components/purchase-flow/intake-client.tsx         (new)
apps/erp/src/components/purchase-flow/project-combobox.tsx      (new — spec §2 combobox, real projects)
apps/erp/src/lib/roles.ts                                       (modify — nav entries)
```

Every file follows the repo standards: `const op = '[fn]'` error handling, `ActionResult<T>`, reads in queries / mutations in actions, `import type` only from queries files in client components, no `any`.

---

### Task 1: Migration 210 + types regen

**Files:** Create `supabase/migrations/210_2026-07-20-purchase-flow-boi.sql`; regenerate `packages/types/database.ts`.

- [ ] **Step 1 — Verify column names before writing SQL** (schema-blind SQL is this repo's #1 failure mode). Confirm in `packages/types/database.ts` / migrations:
  - `projects`: exact names for project name, system size (kWp), and the contracted/order value used by `apps/erp/src/components/projects/detail/financial-box.tsx` ("contracted value") — that column is the rollup's "Project Budget".
  - `expenses`: `project_id`, `amount`, `status` value spellings (`submitted/verified/approved/rejected`).
  - `purchase_orders.status` + `approval_status` CHECK values (migs 004b/041/060/103) — pick the value pair representing "placed/approved" for instant-PO inserts.
  - `project_boq_items` RLS policies (mig 024 + later) — what role check pattern existing INSERT policies use, and whether `site_supervisor` can INSERT.
  - Whether `pg_trgm` is already enabled (it is, per mig 206-209 perf batch — verify).
- [ ] **Step 2 — Write the migration.** Contents (adjust names per Step 1):

```sql
-- 210: BOI-Manager-style quick purchase flow
-- Spec: docs/superpowers/specs/2026-07-20-purchase-flow-boi-manager-spec.md

-- A. Quick-PO metadata (sheet parity)
ALTER TABLE purchase_orders ALTER COLUMN vendor_id DROP NOT NULL;
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_name    TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms  TEXT,
  ADD COLUMN IF NOT EXISTS transport      TEXT,
  ADD COLUMN IF NOT EXISTS delivery_place TEXT,
  ADD COLUMN IF NOT EXISTS source         TEXT NOT NULL DEFAULT 'v2'
    CHECK (source IN ('v2','boi_quick'));
CREATE INDEX IF NOT EXISTS idx_po_source_created
  ON purchase_orders(source, created_at DESC);

-- B. PO-0001 numbering (seeded above any existing PO-N)
CREATE SEQUENCE IF NOT EXISTS boi_po_number_seq;
SELECT setval('boi_po_number_seq',
  COALESCE((SELECT MAX((regexp_match(po_number, '^PO-(\d+)$'))[1]::INT)
            FROM purchase_orders WHERE po_number ~ '^PO-\d+$'), 0) + 1,
  false);
CREATE OR REPLACE FUNCTION next_boi_po_number() RETURNS TEXT
LANGUAGE sql AS $$
  SELECT 'PO-' || lpad(nextval('boi_po_number_seq')::TEXT, 4, '0');
$$;

-- C. Atomic PO creation from selected BOI lines (spec §6.2 — server re-reads by ID,
--    computes totals in SQL, flips lines to order_placed)
CREATE OR REPLACE FUNCTION create_boi_po(
  p_item_ids       UUID[],
  p_project_id     UUID,
  p_vendor_name    TEXT,
  p_delivery_date  DATE,
  p_payment_terms  TEXT,
  p_transport      TEXT,
  p_delivery_place TEXT,
  p_prepared_by    UUID          -- employees.id (NOT profile id — FK footgun)
) RETURNS TABLE(out_po_id UUID, out_po_number TEXT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_po_id UUID := gen_random_uuid();
  v_po_number TEXT;
  v_subtotal NUMERIC(14,2);
  v_gst NUMERIC(14,2);
  v_vendor_id UUID;
  v_found INT;
BEGIN
  PERFORM 1 FROM project_boq_items WHERE id = ANY(p_item_ids) FOR UPDATE;
  SELECT COUNT(*) INTO v_found FROM project_boq_items WHERE id = ANY(p_item_ids);
  IF v_found <> COALESCE(array_length(p_item_ids,1),0) OR v_found = 0 THEN
    RAISE EXCEPTION 'Some selected items no longer exist (found %, expected %)',
      v_found, COALESCE(array_length(p_item_ids,1),0);
  END IF;

  SELECT ROUND(SUM(quantity * unit_price), 2),
         ROUND(SUM(quantity * unit_price * COALESCE(gst_rate,0) / 100), 2)
    INTO v_subtotal, v_gst
    FROM project_boq_items WHERE id = ANY(p_item_ids);

  SELECT id INTO v_vendor_id FROM vendors
   WHERE lower(company_name) = lower(trim(p_vendor_name)) LIMIT 1;

  v_po_number := next_boi_po_number();

  INSERT INTO purchase_orders (id, project_id, vendor_id, vendor_name, prepared_by,
    po_number, status, po_date, expected_delivery_date, payment_terms, transport,
    delivery_place, subtotal, gst_amount, total_amount, amount_paid,
    amount_outstanding, source)
  VALUES (v_po_id, p_project_id, v_vendor_id, trim(p_vendor_name), p_prepared_by,
    v_po_number, 'approved', CURRENT_DATE, p_delivery_date, p_payment_terms,
    p_transport, p_delivery_place, v_subtotal, v_gst, v_subtotal + v_gst, 0,
    v_subtotal + v_gst, 'boi_quick');
  -- NOTE Step 1: if approval_status exists and gates cascades, also set it 'approved' here.

  INSERT INTO purchase_order_items (purchase_order_id, boq_item_id, line_number,
    item_category, item_description, brand, unit, quantity_ordered, unit_price,
    total_price, gst_rate, gst_amount)
  SELECT v_po_id, b.id, row_number() OVER (ORDER BY b.created_at),
    b.item_category, b.item_description, b.brand, b.unit, b.quantity, b.unit_price,
    ROUND(b.quantity * b.unit_price, 2), b.gst_rate,
    ROUND(b.quantity * b.unit_price * COALESCE(b.gst_rate,0) / 100, 2)
  FROM project_boq_items b WHERE b.id = ANY(p_item_ids);
  -- NOTE Step 1: match purchase_order_items NOT NULL columns exactly (e.g. quantity_pending).

  UPDATE project_boq_items
     SET purchase_order_id = v_po_id, procurement_status = 'order_placed',
         vendor_name = COALESCE(NULLIF(trim(p_vendor_name),''), vendor_name),
         updated_at = NOW()
   WHERE id = ANY(p_item_ids);

  RETURN QUERY SELECT v_po_id, v_po_number;
END $$;

-- D. PO delete with optional revert (spec §7)
CREATE OR REPLACE FUNCTION delete_boi_po(p_po_id UUID, p_revert BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF p_revert THEN
    UPDATE project_boq_items
       SET procurement_status = 'yet_to_place', purchase_order_id = NULL, updated_at = NOW()
     WHERE purchase_order_id = p_po_id;
  ELSE
    UPDATE project_boq_items SET purchase_order_id = NULL, updated_at = NOW()
     WHERE purchase_order_id = p_po_id;
  END IF;
  DELETE FROM purchase_order_items WHERE purchase_order_id = p_po_id;
  DELETE FROM purchase_orders WHERE id = p_po_id;
END $$;

-- E. Status-wise money KPIs (spec §5.2 — every filter EXCEPT status applied)
CREATE OR REPLACE FUNCTION get_boi_status_totals(
  p_project_id UUID DEFAULT NULL, p_category TEXT DEFAULT NULL,
  p_vendor TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL
) RETURNS TABLE(status TEXT, line_count BIGINT, total_amount NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN b.procurement_status = 'ready_to_dispatch' THEN 'received'
              ELSE b.procurement_status END AS status,
         COUNT(*),
         ROUND(SUM(b.quantity * b.unit_price * (1 + COALESCE(b.gst_rate,0)/100)), 2)
    FROM project_boq_items b
   WHERE (p_project_id IS NULL OR b.project_id = p_project_id)
     AND (p_category  IS NULL OR b.item_category = p_category)
     AND (p_vendor    IS NULL OR b.vendor_name = p_vendor)
     AND (p_search    IS NULL OR
          (COALESCE(b.item_description,'') || ' ' || COALESCE(b.brand,'') || ' ' ||
           COALESCE(b.item_category,'') || ' ' || COALESCE(b.vendor_name,''))
          ILIKE '%' || p_search || '%')
   GROUP BY 1
$$;
CREATE INDEX IF NOT EXISTS idx_boq_items_search_trgm ON project_boq_items
  USING gin ((COALESCE(item_description,'') || ' ' || COALESCE(brand,'') || ' ' ||
              COALESCE(item_category,'') || ' ' || COALESCE(vendor_name,'')) gin_trgm_ops);

-- F. Project rollup (spec §3 computed columns; budget = contracted value per Step 1)
CREATE OR REPLACE FUNCTION get_purchase_project_rollup()
RETURNS TABLE(project_id UUID, project_name TEXT, system_size NUMERIC,
              project_budget NUMERIC, boi_total NUMERIC, expenses_total NUMERIC,
              profit_pct NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH boi AS (
    SELECT b.project_id AS pid,
           ROUND(SUM(b.quantity * b.unit_price * (1 + COALESCE(b.gst_rate,0)/100)),2) AS t
    FROM project_boq_items b GROUP BY 1),
  exp AS (
    SELECT e.project_id AS pid, ROUND(SUM(e.amount),2) AS t
    FROM expenses e GROUP BY 1)   -- Step 1: confirm col names; include all statuses (sheet parity)
  SELECT p.id, p.project_name, p.system_size_kwp,       -- Step 1: confirm both names
         p.total_project_cost,                          -- Step 1: replace with real budget col
         COALESCE(boi.t,0), COALESCE(exp.t,0),
         CASE WHEN COALESCE(p.total_project_cost,0) = 0 THEN 0
              ELSE ROUND((p.total_project_cost - (COALESCE(boi.t,0)+COALESCE(exp.t,0)))
                         / p.total_project_cost * 100, 2) END
    FROM projects p
    LEFT JOIN boi ON boi.pid = p.id
    LEFT JOIN exp ON exp.pid = p.id
   WHERE boi.pid IS NOT NULL OR exp.pid IS NOT NULL
$$;

-- G. Site-engineer intake: allow site_supervisor INSERT of yet_to_finalize lines
--    (mirror the exact policy helper pattern found in Step 1; sketch:)
CREATE POLICY boq_items_site_intake ON project_boq_items FOR INSERT
  TO authenticated
  WITH CHECK (procurement_status = 'yet_to_finalize'
              AND get_my_role() = 'site_supervisor');  -- Step 1: use the repo's real helper
```

- [ ] **Step 3 — Apply to DEV** via Supabase MCP `apply_migration` (project `actqtzoxjilqnldnacqz`). NEVER prod. Verify: `SELECT next_boi_po_number();` returns `PO-000N`, then `SELECT * FROM get_boi_status_totals();` returns rows.
- [ ] **Step 4 — Regenerate types** exactly per CLAUDE.md "Regenerating database.ts" (PAT one-liner → `node scripts/strip-view-fk-entries.mjs` → `pnpm check-types` must pass).
- [ ] **Step 5 — Commit** (pathspec only): `git add supabase/migrations/210_2026-07-20-purchase-flow-boi.sql packages/types/database.ts && git commit -m "feat(purchase): mig 210 — BOI quick-PO columns, PO-0001 seq, create/delete/kpi/rollup RPCs"`

---

### Task 2: Constants + queries + actions layer

**Files:** Create `apps/erp/src/lib/purchase-flow-constants.ts`, `purchase-flow-queries.ts`, `purchase-flow-actions.ts`.

- [ ] **Step 1 — constants** (client-safe, zero server imports — NEVER-DO #21):

```ts
export const BOI_STATUSES = ['yet_to_finalize','yet_to_place','order_placed','received','delivered'] as const;
export type BoiStatus = (typeof BOI_STATUSES)[number];
export const BOI_STATUS_LABELS: Record<BoiStatus, string> = {
  yet_to_finalize: 'Yet to Finalize', yet_to_place: 'Yet to Place',
  order_placed: 'Order Placed', received: 'Received', delivered: 'Delivered' };
export const BOI_STATUS_COLORS: Record<BoiStatus, string> = { /* spec §2 badge colors:
  orange / amber / blue / violet / green — use tailwind classes matching design system */ };
export const GST_OPTIONS = [0, 5, 12, 18, 28] as const;
export const PO_DEFAULTS = { paymentTerms: 'Credit', transport: 'At Actual' } as const;
export const PRICE_VISIBLE_ROLES = ['founder','project_manager','purchase_officer','finance'] as const;
```

- [ ] **Step 2 — queries** (server-only; every function `const op = '[name]'`; handle `error` and null `data` separately):
  - `getBoiLines(filters?)` — full fetch via batched `.range(i, i+999)` loop until short page (spec: no pagination, client filters). Select ALL display fields incl. `purchase_order_id` + embedded `purchase_orders(po_number)`. **CRITICAL:** embeds on `project_boq_items` are fine, but any embed on the `tasks` table elsewhere needs FK hints — not applicable here; embed PO via `purchase_orders!project_boq_items_purchase_order_id_fkey` if PostgREST is ambiguous.
  - `getBoiStatusTotals(filters)` — thin `.rpc('get_boi_status_totals', …)` wrapper.
  - `getBoiPos(search?)` — PO log: `source='boi_quick'` (plus all POs toggle later — YAGNI, quick only), newest-first, `count:'estimated'` + `.range()` pagination (NEVER-DO #25); KPI totals via a one-line `.rpc` or aggregate select, not JS reduce.
  - `getPurchaseProjectRollup()` — `.rpc` wrapper.
  - `searchPriceBookItems(term, { includePrices })` — for autocomplete + bulk-add + intake. When `includePrices=false` the select list EXCLUDES `base_price`/`gst_rate` (server-side stripping, spec §1).
  - `getProjectOptions()` — id + name, for combobox.
- [ ] **Step 3 — actions** (`'use server'`, all return `ActionResult<T>`, never throw; resolve employee id via `getCurrentEmployeeId()` — NEVER write profile ids into `*_by` columns; every mutation re-checks role server-side against `PRICE_VISIBLE_ROLES` except `submitIntakeItems` which requires `site_supervisor` or price-visible):
  - `addBoiLine(input)` / `updateBoiLine(id, input)` — full-row upsert from the add/edit modal. Compute nothing client-side; `total_price = qty*rate*(1+gst/100)` computed here with decimal.js before insert (single-row, not aggregation).
  - `updateBoiLineField(id, field, value)` — single-cell commit (spec §12); whitelist fields `quantity|unit_price|gst_rate|vendor_name|procurement_status`; recompute `total_price`; return the fresh row.
  - `addBoiLinesFromPriceBook(projectId, status, items: {priceBookId, qty, rate, gst}[])` — bulk insert; re-reads PB rows server-side for category/item/make/unit/vendor.
  - `bulkUpdateBoiStatus(ids, status)` / `deleteBoiLines(ids)`.
  - `createBoiPo(input)` — calls `create_boi_po` RPC → then renders PDF (Task 4 helper) → uploads to Storage → saves `pdf_storage_path` → returns `{poId, poNumber}`. PDF failure must NOT fail the PO (spec §6.2.5): wrap, log, return success with `pdfWarning`.
  - `updateBoiPoMeta(poId, meta)` — metadata only (spec §7 edit banner semantics).
  - `deleteBoiPoAction(poId, revertItems: boolean)` — calls `delete_boi_po` RPC.
  - `submitIntakeItems(projectId, items: {priceBookId, qty}[])` — spec §11: resolves everything from PB server-side, inserts `yet_to_finalize` lines; client never sends or receives prices.
- [ ] **Step 4 — Verify:** `pnpm check-types` green. **Step 5 — Commit** the three files: `git commit -m "feat(purchase): BOI flow constants + queries + actions"`.

---

### Task 3: BOI workspace UI (`/purchase`)

**Files:** Create `purchase/page.tsx`, `components/purchase-flow/{boi-workspace,boi-table,project-combobox,boi-bulk-bar}.tsx`. Read spec §2, §5 (all), §12 first.

- [ ] **Step 1 — page.tsx** (server): role-gate (redirect `site_supervisor` → `/purchase/intake`), fetch `getBoiLines()` + `getBoiStatusTotals()` + `getProjectOptions()` + viewer role, pass to client root. Status views = same page with `?status=yet_to_place` etc. (5 sidebar sub-links render via nav — Task 7); when `status` param present the status filter dropdown is hidden and the filter locked (spec §5.2).
- [ ] **Step 2 — boi-workspace.tsx** (client root): filter state (project, status, category, vendor, search) with client-side row filtering over the full dataset; KPI row = "Total (filtered)" card + 5 status cards fed by the RPC results re-fetched (via server action or route refresh) when non-status filters change — status cards ignore the status filter (spec §5.2, muscle-memory). Filters persist across tab switches within the session (lift to a module-level store or URL params). Table footer: `TOTAL (filtered view)` — display-only sum of already-loaded rows is unavoidable client-side; keep it display-only (KPI money of record comes from the RPC).
- [ ] **Step 3 — boi-table.tsx**: columns per spec §5 incl. leading checkbox; `ListPageShell`/`containedScroll` sticky header (see `docs` memory: overflow boxes trap `position: sticky` — copy an existing list page's structure, e.g. the price-book or expenses list). Inline edit per spec §2: Qty/Rate/Vendor swap-in inputs (Enter/blur commit via `updateBoiLineField`, Escape cancels, patch returned row into state); Status + GST always-visible badge-styled `<select>`s committing immediately; price columns render `formatINR`. Row actions: ✏️ opens edit modal, 🗑 `confirm()` delete.
- [ ] **Step 4 — selection + boi-bulk-bar.tsx** (spec §5.5): header checkbox = all *visible filtered* rows; filter changes prune hidden rows from selection; bar shows `N selected`, status dropdown + Change Status (confirm), 📄 Create PO (Task 4), 🗑 Delete Selected (strong confirm), Clear Selection.
- [ ] **Step 5 — project-combobox.tsx**: searchable dropdown of real projects (spec §2 keyboard behavior; no free-text creation — locked decision).
- [ ] **Step 6 — Verify** `pnpm check-types && pnpm lint` green; **commit** the new files.

---

### Task 4: Create-PO flow + PDF

**Files:** Create `create-po-modal.tsx`, `lib/pdf/boi-po-pdf.tsx`, `app/api/purchase/[poId]/pdf/route.ts`; wire `createBoiPo` in Task 2's action. Read spec §6 fully first.

- [ ] **Step 1 — create-po-modal.tsx** (spec §6.1): multi-vendor red warning (warn-only), summary line, fields with prefills (Vendor = first distinct vendor; Project = first distinct project — selection may span projects, PO stores one; Payment Terms `Credit`; Transport `At Actual`). On save → `createBoiPo` → on success: trigger PDF download (`window.open('/api/purchase/'+poId+'/pdf')`), patch updated rows (now `order_placed`), clear selection, toast `PO-00NN created ✓`.
- [ ] **Step 2 — boi-po-pdf.tsx** (spec §6.2.4 EXACTLY — deliberately minimal): A4 portrait, "PURCHASE ORDER" + PO number, info grid (Project|Payment Terms // Vendor|Transport // Delivery Date|Delivery Place, "-" when blank), "MATERIAL SPECIFICATION & COST BREAKDOWN" table (S.No · `Item — Make` · `qty unit` · Unit Price · Total, ₹ whole-rupee en-IN), totals box Subtotal / GST(x% when uniform, else "GST") / **Net Amount**. Company-purple accents from `pdf-styles.ts`. NO letterhead/GSTIN/signature.
- [ ] **Step 3 — pdf route**: model on `app/api/procurement/[poId]/pdf/route.ts` (auth → fetch PO + items → `renderToBuffer` → `application/pdf`). Regenerates from frozen `purchase_order_items` (immutable, spec §6.3). In `createBoiPo`, also upload the buffer to the same Storage bucket existing `pdf_storage_path` writers use (grep for the bucket name; if none writes it yet, use the documents bucket used by proposal PDFs) and save the path.
- [ ] **Step 4 — Verify** gates + manual: create a PO in dev against seeded BOI lines; confirm lines flip to Order Placed and the PDF downloads. **Commit.**

---

### Task 5: PO log (`/purchase/orders`)

**Files:** Create `purchase/orders/page.tsx`, `po-log-client.tsx`. Read spec §7.

- [ ] Newest-first paginated list (`count:'estimated'` + `.range`), columns PO Number · Project · Vendor · Delivery Date · Net Amount · Created By · PDF ("Download", or "—") · ✏️ 🗑. One search box (PO number/project/vendor/creator) + Clear + Refresh. KPIs: Total POs · Total PO Value (SQL, filtered). Edit modal = metadata only with spec §7's banner text. Delete modal with default-ON checkbox "Also revert this PO's item(s) status back to 'Yet to Place'" → `deleteBoiPoAction`. Verify gates; commit.

---

### Task 6: Project rollup (`/purchase/projects`)

**Files:** Create `purchase/projects/page.tsx` (+ small client table). Read spec §3.

- [ ] Table from `getPurchaseProjectRollup()`: Project · System Size · Project Budget · BOI Total · Expenses · Profit % (red when negative), search + KPI cards (count, Σ budget, Σ BOI, Σ expenses — computed in the RPC result set server-side, they're already aggregates). Row action 🧾 → `/purchase?project=<id>`, 💰 → `/expenses?project=<id>` (match the expenses page's actual filter param — verify). Budgets visible to price-visible roles only (page-level gate, same as `/purchase`). Verify; commit.

---

### Task 7: Site-engineer intake (`/purchase/intake`) + nav

**Files:** Create `purchase/intake/page.tsx`, `intake-client.tsx`; modify `lib/roles.ts`. Read spec §11 + §1.

- [ ] **Step 1 — intake page**: mobile-first single screen: greeting, project combobox, PB search (server round-trip via `searchPriceBookItems(term, {includePrices:false})` — NO price data in any payload), selected-items list with qty steppers + remove, Submit → `submitIntakeItems` → success message, reset selection, keep project. Accessible to `site_supervisor` AND price-visible roles (office can use it too).
- [ ] **Step 2 — roles.ts**: add nav section "Purchase" with entries: Bill of Items `/purchase`, Purchase Orders `/purchase/orders`, Projects `/purchase/projects` (price-visible roles); the 5 status views as sub-links of Bill of Items (`/purchase?status=…`); Site intake `/purchase/intake` for `site_supervisor` (their only purchase entry). Don't disturb existing `/procurement` nav.
- [ ] Verify gates (`pnpm build` catches roles/nav client-boundary issues); commit.

---

### Task 8: BOI exports (with/without price)

**Files:** Create `components/purchase-flow/boi-export.tsx` (+ optional `lib/pdf/boi-list-pdf.tsx`). Read spec §10.

- [ ] Chooser (💰 With Price — price-visible only / 📄 Without Price), exports exactly the filtered rows. PDF: A4 landscape via client-side `pdf().toBlob()` like `components/procurement/boq-download-button.tsx`; single-project header w/ stat boxes when project-filtered; GRAND TOTAL (with-price only). Excel: use the repo's existing `xlsx` dependency (bom-sheet-parser uses it — verify; if absent, ship CSV and note it). Filenames per spec. Verify; commit.

---

### Task 9: Final gates, docs, push

- [ ] **Step 1 — Full CI gates** (strict order, read real stdout): `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build` — build with `NODE_OPTIONS=--max-old-space-size=8192`; grep tails for `error TS|Failed:|ELIFECYCLE|Build failed`. Fix locally until green.
- [ ] **Step 2 — Docs**: one-line `docs/CHANGELOG.md` entry (≤400 chars, link the spec basename); update `docs/modules/purchase.md` (new "Quick purchase flow (BOI Manager parity)" section: routes, RPCs, source column, coexistence with v2); `docs/CURRENT_STATUS.md` in-flight note; `pnpm docs:index` (spec + plan are new files).
- [ ] **Step 3 — Push**: `git pull --rebase origin main` (parallel sessions!), then `git push origin main`. A local commit isn't done.

---

## Self-review notes (already applied)

- Spec coverage: §1→T2/T7 role stripping; §2 primitives→T3; §3→T6; §4 reused; §5→T3; §6→T1/T4; §7→T5; §8 reused; §9 maps to existing roles; §10→T8; §11→T7; §12 behaviors→T2/T3; §13 mapping table→locked decisions; §14 deltas→locked decisions.
- Deliberate deltas from the sheet (surface to Vivek in the final report): real project FKs (no type-a-new-project), categories from `item_categories` master, expenses/price-book screens reused not rebuilt, PO numbering sequence never reuses numbers, `ready_to_dispatch` folded into Received bucket.
- Type consistency: action names used in UI tasks match Task 2's exports; status literals come from `purchase-flow-constants.ts` everywhere.
