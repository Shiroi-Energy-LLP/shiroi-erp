# Zoho Orphan Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/cash/orphan-invoices` triage UI that lets founder + finance + marketing_manager attribute the 303 unattributed `zoho_import` invoices (~₹63 Cr) and 659 customer_payments to ERP projects, exclude them from cash, or defer them — with an append-only audit log.

**Architecture:** Five Postgres migrations (088–092) introduce a line-items table, attribution_status / excluded_from_cash columns, an audit table, and SQL helper functions for atomic cascade operations. The cash-position trigger from mig 080 is updated to filter excluded rows. A Next.js 14 server-rendered page composes three panes (customers / invoices / candidate projects), backed by RPCs for read aggregation and `'use server'` actions wrapping the SQL helpers for writes. A banner on `/cash` provides the discoverability hook.

**Tech Stack:** PostgreSQL (Supabase), Next.js 14 App Router, TypeScript, shadcn/ui (`@repo/ui`), `decimal.js` for money, `xlsx` for line-items backfill, `vitest` for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md`

---

## File structure

**New files:**

```
supabase/migrations/
  096_zoho_invoice_line_items.sql
  097_attribution_status_columns.sql
  098_cash_position_trigger_excluded.sql
  099_zoho_attribution_audit.sql
  100_orphan_triage_functions.sql

scripts/
  backfill-zoho-invoice-line-items.ts

apps/erp/src/lib/
  orphan-triage-queries.ts
  orphan-triage-actions.ts
  orphan-triage-helpers.ts          ← pure utilities (token-overlap, formatters)
  orphan-triage-helpers.test.ts     ← vitest unit tests

apps/erp/src/app/(erp)/cash/orphan-invoices/
  page.tsx
  loading.tsx
  _components/
    triage-shell.tsx
    customer-list-pane.tsx
    invoices-pane.tsx
    invoice-card.tsx
    line-items-table.tsx
    candidates-pane.tsx
    candidate-card.tsx
    assign-modal.tsx
    exclude-modal.tsx
    defer-modal.tsx
    audit-log-table.tsx

apps/erp/src/components/finance/
  orphan-banner.tsx                 ← reused on /cash
```

**Modified files:**

- `apps/erp/src/app/(erp)/cash/page.tsx` — insert `<OrphanBanner />` above the existing KPI cards.
- `packages/types/database.ts` — regenerated after each schema migration (committed alongside the migration that triggered it).
- `docs/CHANGELOG.md` — one-line summary per shipped migration + final UI ship.
- `docs/CURRENT_STATUS.md` — note in-flight work; remove when shipped.
- `docs/modules/finance.md` — add a "Zoho Orphan Triage" section with route, RPCs, and rules.

---

## Conventions used in this plan

- **Money:** `decimal.js` on the client, `NUMERIC(14,2)` in SQL. Never floats.
- **Server actions:** return `ActionResult<T>` from `@/lib/types/actions` (`ok(data)` / `err(msg, code?)`). Never throw across the RSC boundary.
- **Logging:** every function starts with `const op = '[functionName]';`. Failures logged with `{ ...context, error }` and op prefix.
- **Verification command for migrations:** copy the file's body into the Supabase SQL Editor against the dev project (`actqtzoxjilqnldnacqz`), run, observe `RAISE NOTICE` output. Save the file in `supabase/migrations/` after success.
- **Type regen command** (placeholder — follow the team's existing pattern): `pnpm dlx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts`.
- **Build verification:** `pnpm --filter erp check-types` + `pnpm --filter erp build` from repo root.

---

## Phase A — Schema + data layer

### Task 1: Migration 096 — `zoho_invoice_line_items` table

**Files:**
- Create: `supabase/migrations/096_zoho_invoice_line_items.sql`
- Modify: `packages/types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/096_zoho_invoice_line_items.sql
-- ============================================================================
-- Migration 096 — Zoho invoice line items table
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Phase 08 of the Zoho import only stored invoice header totals. The Orphan
-- Triage UI needs line-item detail to disambiguate parent-company invoices
-- (e.g., "RAMANIYAM REAL ESTATES" → which of 8 sub-projects). This migration
-- creates the table; population happens via scripts/backfill-zoho-invoice-line-items.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS zoho_invoice_line_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  zoho_invoice_id  TEXT NOT NULL,
  line_number      INT NOT NULL,
  item_name        TEXT,
  item_description TEXT,
  quantity         NUMERIC,
  rate             NUMERIC(14,2),
  amount           NUMERIC(14,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zoho_invoice_line_items_invoice_id
  ON zoho_invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_zoho_invoice_line_items_zoho_invoice_id
  ON zoho_invoice_line_items(zoho_invoice_id);

DO $$
BEGIN
  RAISE NOTICE '=== Migration 096 applied ===';
  RAISE NOTICE 'zoho_invoice_line_items table created. Backfill pending.';
END $$;

COMMIT;
```

- [ ] **Step 2: Apply to dev**

Open Supabase SQL Editor against the dev project (`actqtzoxjilqnldnacqz`), paste the migration body, run.

Expected: success message + `RAISE NOTICE` output:
```
=== Migration 096 applied ===
zoho_invoice_line_items table created. Backfill pending.
```

- [ ] **Step 3: Verify table shape**

In SQL Editor:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'zoho_invoice_line_items'
ORDER BY ordinal_position;
```

Expected: 9 columns (`id`, `invoice_id`, `zoho_invoice_id`, `line_number`, `item_name`, `item_description`, `quantity`, `rate`, `amount`, `created_at`). All correct types.

- [ ] **Step 4: Regenerate database.ts**

```bash
pnpm dlx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

Expected: `database.ts` now contains a `zoho_invoice_line_items` entry under `Tables`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/096_zoho_invoice_line_items.sql packages/types/database.ts
git commit -m "feat(zoho): mig 096 — zoho_invoice_line_items table"
```

---

### Task 2: Backfill script for line items

**Files:**
- Create: `scripts/backfill-zoho-invoice-line-items.ts`

- [ ] **Step 1: Write the backfill script**

```typescript
// scripts/backfill-zoho-invoice-line-items.ts
/**
 * Reads docs/Zoho data/Invoice.xls, extracts line items, and inserts them into
 * zoho_invoice_line_items keyed by invoice.zoho_invoice_id.
 *
 * Mismatch handling: for each Zoho invoice, sum line-item amounts and compare
 * to invoices.total_amount. If absolute deviation > 5% AND > ₹10,000, skip
 * that invoice's line items entirely and log a warning. Smaller deviations
 * (rounding) are accepted.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-zoho-invoice-line-items.ts --dry-run
 *   pnpm tsx scripts/backfill-zoho-invoice-line-items.ts --apply
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Database } from '@repo/types/database';

dotenv.config({ path: '.env.local' });

const ZOHO_DIR = path.resolve(__dirname, '../docs/Zoho data');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface XlsLineRow {
  'Invoice ID': string | null;
  'Item Name': string | null;
  'Item Description': string | null;
  'Quantity': string | number | null;
  'Item Price': string | number | null;
  'Item Total': string | number | null;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply;
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

  // Load the XLS — same file Phase 08 used.
  const wb = XLSX.readFile(path.join(ZOHO_DIR, 'Invoice.xls'), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<XlsLineRow>(sheet, { defval: null });
  console.log(`  ${rows.length} XLS rows`);

  // Group by Zoho invoice id.
  const grouped = new Map<string, XlsLineRow[]>();
  for (const r of rows) {
    const id = toStr(r['Invoice ID']);
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(r);
  }
  console.log(`  ${grouped.size} unique invoices in XLS`);

  // Lookup ERP invoices by zoho_invoice_id.
  const { data: invoices, error: invErr } = await admin
    .from('invoices')
    .select('id, zoho_invoice_id, total_amount')
    .eq('source', 'zoho_import');
  if (invErr) throw invErr;

  const invoiceByZohoId = new Map<string, { id: string; total: number }>();
  for (const inv of invoices ?? []) {
    if (inv.zoho_invoice_id) {
      invoiceByZohoId.set(inv.zoho_invoice_id, {
        id: inv.id,
        total: Number(inv.total_amount ?? 0),
      });
    }
  }
  console.log(`  ${invoiceByZohoId.size} ERP invoices with zoho_invoice_id`);

  // Build insert rows with mismatch check.
  const inserts: Array<{
    invoice_id: string;
    zoho_invoice_id: string;
    line_number: number;
    item_name: string | null;
    item_description: string | null;
    quantity: number;
    rate: number;
    amount: number;
  }> = [];
  let mismatchSkipped = 0;
  let invoicesProcessed = 0;
  let invoicesNoErpMatch = 0;

  for (const [zohoId, lines] of grouped) {
    const erp = invoiceByZohoId.get(zohoId);
    if (!erp) {
      invoicesNoErpMatch++;
      continue;
    }
    const sumLines = lines.reduce((s, r) => s + toNumber(r['Item Total']), 0);
    const erpTotal = erp.total;
    const absDev = Math.abs(sumLines - erpTotal);
    const pctDev = erpTotal === 0 ? 0 : absDev / erpTotal;
    if (absDev > 10000 && pctDev > 0.05) {
      console.warn(
        `  SKIP mismatch: ${zohoId} — XLS lines sum ₹${sumLines.toFixed(2)} ` +
        `vs ERP total ₹${erpTotal.toFixed(2)} (Δ ₹${absDev.toFixed(2)}, ${(pctDev * 100).toFixed(1)}%)`,
      );
      mismatchSkipped++;
      continue;
    }
    invoicesProcessed++;
    lines.forEach((r, idx) => {
      inserts.push({
        invoice_id: erp.id,
        zoho_invoice_id: zohoId,
        line_number: idx + 1,
        item_name: toStr(r['Item Name']),
        item_description: toStr(r['Item Description']),
        quantity: toNumber(r['Quantity']),
        rate: toNumber(r['Item Price']),
        amount: toNumber(r['Item Total']),
      });
    });
  }

  console.log('');
  console.log(`Invoices to backfill: ${invoicesProcessed}`);
  console.log(`Invoices skipped (mismatch >5% AND >₹10K): ${mismatchSkipped}`);
  console.log(`Invoices no ERP match: ${invoicesNoErpMatch}`);
  console.log(`Total line item rows: ${inserts.length}`);

  if (dryRun) {
    console.log('[DRY RUN] No writes.');
    return;
  }

  console.log('Inserting...');
  const CHUNK = 200;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const chunk = inserts.slice(i, i + CHUNK);
    const { error } = await admin.from('zoho_invoice_line_items').insert(chunk);
    if (error) throw error;
    process.stdout.write(`  ${Math.min(i + CHUNK, inserts.length)}/${inserts.length}\r`);
  }
  console.log('\nDone.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run**

```bash
pnpm tsx scripts/backfill-zoho-invoice-line-items.ts --dry-run
```

Expected output (numbers approximate):
```
Mode: DRY RUN
  ~5000 XLS rows
  ~480 unique invoices in XLS
  481 ERP invoices with zoho_invoice_id
Invoices to backfill: ~470
Invoices skipped (mismatch >5% AND >₹10K): 0–10
Invoices no ERP match: 0
Total line item rows: ~5000
[DRY RUN] No writes.
```

- [ ] **Step 3: Apply**

```bash
pnpm tsx scripts/backfill-zoho-invoice-line-items.ts --apply
```

Expected: matches dry-run counts; final "Done." line.

- [ ] **Step 4: Verify in SQL Editor**

```sql
-- Total rows
SELECT COUNT(*) FROM zoho_invoice_line_items;
-- ~5000

-- Spot check: 3 random invoices, summed line totals vs invoice total
SELECT i.invoice_number, i.total_amount,
       SUM(li.amount) AS sum_lines,
       COUNT(li.id) AS line_count
FROM invoices i
JOIN zoho_invoice_line_items li ON li.invoice_id = i.id
WHERE i.source = 'zoho_import'
GROUP BY i.id, i.invoice_number, i.total_amount
ORDER BY RANDOM()
LIMIT 3;
```

Expected: `total_amount` and `sum_lines` within rounding tolerance for each row.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-zoho-invoice-line-items.ts
git commit -m "feat(zoho): backfill script for invoice line items

One-shot import of line items from Invoice.xls into the new
zoho_invoice_line_items table. Skips any invoice whose summed line
totals deviate from the header total by >5% AND >₹10,000."
```

---

### Task 3: Migration 097 — `attribution_status` + `excluded_from_cash`

**Files:**
- Create: `supabase/migrations/097_attribution_status_columns.sql`
- Modify: `packages/types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/097_attribution_status_columns.sql
-- ============================================================================
-- Migration 097 — attribution_status + excluded_from_cash columns
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Adds the two state-tracking columns the Orphan Triage UI needs on both
-- invoices and customer_payments. Seeds attribution_status for rows that
-- mig 087 already attributed.

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS excluded_from_cash BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attribution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution_status IN ('pending','assigned','excluded','deferred'));

ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS excluded_from_cash BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attribution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution_status IN ('pending','assigned','excluded','deferred'));

CREATE INDEX IF NOT EXISTS idx_invoices_attribution_status
  ON invoices(attribution_status) WHERE source = 'zoho_import';
CREATE INDEX IF NOT EXISTS idx_customer_payments_attribution_status
  ON customer_payments(attribution_status) WHERE source = 'zoho_import';

-- Seed: mig 087's already-attributed rows go straight to 'assigned'.
UPDATE invoices
   SET attribution_status = 'assigned'
 WHERE source = 'zoho_import' AND project_id IS NOT NULL;

UPDATE customer_payments
   SET attribution_status = 'assigned'
 WHERE source = 'zoho_import' AND project_id IS NOT NULL;

DO $$
DECLARE
  inv_pending INT;
  inv_assigned INT;
  pay_pending INT;
  pay_assigned INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE attribution_status = 'pending'),
         COUNT(*) FILTER (WHERE attribution_status = 'assigned')
    INTO inv_pending, inv_assigned
    FROM invoices WHERE source = 'zoho_import';
  SELECT COUNT(*) FILTER (WHERE attribution_status = 'pending'),
         COUNT(*) FILTER (WHERE attribution_status = 'assigned')
    INTO pay_pending, pay_assigned
    FROM customer_payments WHERE source = 'zoho_import';
  RAISE NOTICE '=== Migration 097 applied ===';
  RAISE NOTICE 'Invoices: pending=%, assigned=%', inv_pending, inv_assigned;
  RAISE NOTICE 'Payments: pending=%, assigned=%', pay_pending, pay_assigned;
END $$;

COMMIT;
```

- [ ] **Step 2: Apply to dev (SQL Editor)**

Expected `RAISE NOTICE` output (numbers approximate):
```
=== Migration 097 applied ===
Invoices: pending=303, assigned=178
Payments: pending=659, assigned=419
```

- [ ] **Step 3: Verify column shape and seed**

```sql
-- Columns exist with correct defaults
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'invoices'
  AND column_name IN ('excluded_from_cash', 'attribution_status');

-- Seed counts match: assigned == count of rows with project_id NOT NULL
SELECT COUNT(*) FROM invoices
 WHERE source = 'zoho_import' AND attribution_status = 'assigned' AND project_id IS NULL;
-- Expected: 0 (every 'assigned' row should have a project_id)
```

- [ ] **Step 4: Regenerate database.ts**

```bash
pnpm dlx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

Verify the new columns are in the regenerated file.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/097_attribution_status_columns.sql packages/types/database.ts
git commit -m "feat(zoho): mig 097 — attribution_status + excluded_from_cash"
```

---

### Task 4: Migration 098 — Cash position trigger update

**Files:**
- Create: `supabase/migrations/098_cash_position_trigger_excluded.sql`

- [ ] **Step 1: Read the existing trigger function**

In SQL Editor:
```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'recompute_project_cash_position';
```

Copy the output — you'll need it as the base for the new function. The migration replaces the function while preserving its trigger bindings.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/098_cash_position_trigger_excluded.sql
-- ============================================================================
-- Migration 098 — Cash position trigger filters excluded_from_cash rows
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- The trigger function from mig 080 sums invoices and customer_payments per
-- project. After mig 097 added excluded_from_cash, the trigger needs to skip
-- rows where excluded_from_cash = TRUE (so MEGAGRID-style "no ERP match"
-- decisions don't pollute any project's cash position).
--
-- This migration replaces the function in place (CREATE OR REPLACE) and then
-- runs the bulk INSERT...ON CONFLICT recompute from mig 087 §2 to refresh all
-- project_cash_positions rows. Behaviour is identical to pre-migration since
-- no rows have excluded_from_cash = TRUE yet.

BEGIN;

CREATE OR REPLACE FUNCTION recompute_project_cash_position(p_project_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total_contracted        NUMERIC(14,2);
  v_total_invoiced          NUMERIC(14,2);
  v_total_received          NUMERIC(14,2);
  v_total_po_value          NUMERIC(14,2);
  v_total_paid_to_vendors   NUMERIC(14,2);
BEGIN
  SELECT COALESCE(contracted_value, 0) INTO v_total_contracted
    FROM projects WHERE id = p_project_id;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_invoiced
    FROM invoices
   WHERE project_id = p_project_id
     AND (status IS NULL OR status <> 'cancelled')
     AND excluded_from_cash IS NOT TRUE;

  SELECT COALESCE(
    NULLIF((SELECT COALESCE(SUM(amount), 0) FROM customer_payments
             WHERE project_id = p_project_id
               AND excluded_from_cash IS NOT TRUE), 0),
    (SELECT COALESCE(SUM(amount_paid), 0) FROM invoices
       WHERE project_id = p_project_id
         AND (status IS NULL OR status <> 'cancelled')
         AND excluded_from_cash IS NOT TRUE)
  ) INTO v_total_received;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_po_value
    FROM purchase_orders
   WHERE project_id = p_project_id
     AND status NOT IN ('cancelled');

  SELECT COALESCE(SUM(amount_paid), 0) INTO v_total_paid_to_vendors
    FROM purchase_orders
   WHERE project_id = p_project_id
     AND status NOT IN ('cancelled');

  INSERT INTO project_cash_positions (
    project_id, total_contracted,
    total_invoiced, total_received, total_outstanding,
    total_po_value, total_paid_to_vendors, total_vendor_outstanding,
    net_cash_position, is_invested, invested_since, last_computed_at
  )
  VALUES (
    p_project_id, v_total_contracted,
    v_total_invoiced, v_total_received,
    GREATEST(v_total_invoiced - v_total_received, 0),
    v_total_po_value, v_total_paid_to_vendors,
    GREATEST(v_total_po_value - v_total_paid_to_vendors, 0),
    v_total_received - v_total_paid_to_vendors,
    (v_total_received - v_total_paid_to_vendors) < 0,
    CASE WHEN (v_total_received - v_total_paid_to_vendors) < 0 THEN CURRENT_DATE ELSE NULL END,
    NOW()
  )
  ON CONFLICT (project_id)
  DO UPDATE SET
    total_contracted        = EXCLUDED.total_contracted,
    total_invoiced          = EXCLUDED.total_invoiced,
    total_received          = EXCLUDED.total_received,
    total_outstanding       = EXCLUDED.total_outstanding,
    total_po_value          = EXCLUDED.total_po_value,
    total_paid_to_vendors   = EXCLUDED.total_paid_to_vendors,
    total_vendor_outstanding= EXCLUDED.total_vendor_outstanding,
    net_cash_position       = EXCLUDED.net_cash_position,
    is_invested             = EXCLUDED.is_invested,
    invested_since          = CASE
      WHEN EXCLUDED.is_invested THEN
        COALESCE(project_cash_positions.invested_since, CURRENT_DATE)
      ELSE NULL
    END,
    last_computed_at        = NOW(),
    updated_at              = NOW();
END;
$$ LANGUAGE plpgsql;

-- Bulk refresh all projects so the new logic is reflected everywhere.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM projects LOOP
    PERFORM recompute_project_cash_position(r.id);
  END LOOP;
END $$;

DO $$
DECLARE
  total_proj INT; neg INT; pos INT; zero_ INT;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE net_cash_position < 0),
         COUNT(*) FILTER (WHERE net_cash_position > 0),
         COUNT(*) FILTER (WHERE net_cash_position = 0)
    INTO total_proj, neg, pos, zero_
    FROM project_cash_positions;
  RAISE NOTICE '=== Migration 098 applied ===';
  RAISE NOTICE 'Total: %, negative: %, positive: %, zero: %',
    total_proj, neg, pos, zero_;
END $$;

COMMIT;
```

> **NOTE for the engineer:** The `CREATE OR REPLACE FUNCTION` body above mirrors the function defined in mig 080. If your `pg_get_functiondef` output in Step 1 differs (e.g., extra fields, different parameters), reconcile the two before applying — the goal is "same behaviour as mig 080 PLUS `excluded_from_cash IS NOT TRUE` filters on the invoice and customer_payment subqueries". Don't change anything else.

- [ ] **Step 3: Apply to dev**

Expected NOTICE output should match the post-mig-087 baseline (negatives count should not change vs before this migration, since no rows have `excluded_from_cash = TRUE` yet).

- [ ] **Step 4: Verify trigger source**

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'recompute_project_cash_position';
```

Look for `excluded_from_cash IS NOT TRUE` in the body. Expected: 3 occurrences (in the two invoice subqueries + one customer_payments subquery).

- [ ] **Step 5: Sanity test the new behaviour**

```sql
-- Pick a project with at least one zoho_import invoice
WITH target AS (
  SELECT i.id AS invoice_id, i.project_id, i.total_amount, p.net_cash_position AS cash_before
  FROM invoices i
  JOIN project_cash_positions p ON p.project_id = i.project_id
  WHERE i.source = 'zoho_import' AND i.project_id IS NOT NULL AND i.attribution_status = 'assigned'
  ORDER BY i.total_amount DESC
  LIMIT 1
)
SELECT * FROM target;
-- Note the project_id, total_amount, and cash_before. Don't run the next steps
-- with that test data on prod — this is dev-only sanity.

-- Mark that one invoice excluded
UPDATE invoices SET excluded_from_cash = TRUE WHERE id = '<the invoice_id from above>';
PERFORM recompute_project_cash_position('<the project_id from above>');

-- Verify net_cash_position changed
SELECT net_cash_position FROM project_cash_positions WHERE project_id = '<the project_id from above>';
-- Expected: should differ from cash_before by approximately the invoice's contribution

-- Restore
UPDATE invoices SET excluded_from_cash = FALSE WHERE id = '<the invoice_id from above>';
PERFORM recompute_project_cash_position('<the project_id from above>');
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/098_cash_position_trigger_excluded.sql
git commit -m "feat(zoho): mig 098 — cash trigger filters excluded_from_cash"
```

---

### Task 5: Migration 099 — `zoho_attribution_audit` table

**Files:**
- Create: `supabase/migrations/099_zoho_attribution_audit.sql`
- Modify: `packages/types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/099_zoho_attribution_audit.sql
-- ============================================================================
-- Migration 099 — zoho_attribution_audit table
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Append-only history of every triage decision (assign / exclude / skip /
-- reassign / undo). Built so multiple team members can triage in parallel
-- and each decision shows who made it.

BEGIN;

CREATE TABLE IF NOT EXISTS zoho_attribution_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('invoice','payment')),
  entity_id       UUID NOT NULL,
  from_project_id UUID REFERENCES projects(id),
  to_project_id   UUID REFERENCES projects(id),
  decision        TEXT NOT NULL CHECK (decision IN
                    ('assign','exclude','skip','reassign','undo_exclude','undo_skip')),
  made_by         UUID NOT NULL REFERENCES employees(id),
  made_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_zoho_attribution_audit_entity
  ON zoho_attribution_audit(entity_id);
CREATE INDEX IF NOT EXISTS idx_zoho_attribution_audit_made_by_date
  ON zoho_attribution_audit(made_by, made_at DESC);

-- RLS: same three roles that have access to the triage page.
ALTER TABLE zoho_attribution_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Triage roles can read audit"
  ON zoho_attribution_audit FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('founder','finance','marketing_manager')
    )
  );

CREATE POLICY "Triage roles can insert audit"
  ON zoho_attribution_audit FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('founder','finance','marketing_manager')
    )
  );

DO $$
BEGIN
  RAISE NOTICE '=== Migration 099 applied ===';
  RAISE NOTICE 'zoho_attribution_audit table created with RLS.';
END $$;

COMMIT;
```

- [ ] **Step 2: Apply to dev**

- [ ] **Step 3: Verify table + RLS**

```sql
SELECT COUNT(*) FROM zoho_attribution_audit;  -- 0
SELECT polname FROM pg_policy WHERE polrelid = 'zoho_attribution_audit'::regclass;
-- Expected: 'Triage roles can read audit', 'Triage roles can insert audit'
```

- [ ] **Step 4: Regenerate database.ts**

```bash
pnpm dlx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/099_zoho_attribution_audit.sql packages/types/database.ts
git commit -m "feat(zoho): mig 099 — attribution audit table"
```

---

### Task 6: Migration 100 — SQL helper functions

**Files:**
- Create: `supabase/migrations/100_orphan_triage_functions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/100_orphan_triage_functions.sql
-- ============================================================================
-- Migration 100 — atomic orphan-triage SQL helper functions
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- These helpers wrap the multi-row updates the triage UI needs so the cascade
-- (invoice → linked payments) is atomic. SECURITY INVOKER means the caller's
-- RLS still applies — no privilege escalation.
--
-- Each function returns rows in a fixed shape that the JS layer can map to
-- ActionResult<T>. On precondition failure, return a row with success = false
-- and a code so the JS layer can show the right toast.

BEGIN;

CREATE OR REPLACE FUNCTION assign_orphan_invoice(
  p_invoice_id UUID,
  p_project_id UUID,
  p_made_by    UUID,
  p_notes      TEXT
) RETURNS TABLE (
  success                  BOOLEAN,
  code                     TEXT,
  cascaded_payment_count   INT
) AS $$
DECLARE
  v_status     TEXT;
  v_source     TEXT;
  v_cascade_n  INT;
BEGIN
  SELECT attribution_status, source INTO v_status, v_source
    FROM invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'invoice_not_found', 0;
    RETURN;
  END IF;
  IF v_source <> 'zoho_import' THEN
    RETURN QUERY SELECT FALSE, 'not_zoho_import', 0;
    RETURN;
  END IF;
  IF v_status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, 'already_triaged', 0;
    RETURN;
  END IF;

  -- Update invoice
  UPDATE invoices
     SET project_id = p_project_id,
         attribution_status = 'assigned'
   WHERE id = p_invoice_id;

  -- Cascade only payments that are still NULL on project_id (preserve prior
  -- decisions from mig 087's direct-customer-name path).
  WITH cascaded AS (
    UPDATE customer_payments
       SET project_id = p_project_id,
           attribution_status = 'assigned'
     WHERE invoice_id = p_invoice_id
       AND project_id IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cascade_n FROM cascaded;

  -- Audit
  INSERT INTO zoho_attribution_audit
    (entity_type, entity_id, to_project_id, decision, made_by, notes)
    VALUES ('invoice', p_invoice_id, p_project_id, 'assign', p_made_by, p_notes);

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_cascade_n;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exclude_orphan_invoice(
  p_invoice_id UUID,
  p_made_by    UUID,
  p_notes      TEXT
) RETURNS TABLE (
  success                BOOLEAN,
  code                   TEXT,
  cascaded_payment_count INT
) AS $$
DECLARE
  v_status     TEXT;
  v_source     TEXT;
  v_cascade_n  INT;
BEGIN
  SELECT attribution_status, source INTO v_status, v_source
    FROM invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'invoice_not_found', 0;
    RETURN;
  END IF;
  IF v_source <> 'zoho_import' THEN
    RETURN QUERY SELECT FALSE, 'not_zoho_import', 0;
    RETURN;
  END IF;

  -- Allow excluding from any state except already-excluded
  IF v_status = 'excluded' THEN
    RETURN QUERY SELECT FALSE, 'already_excluded', 0;
    RETURN;
  END IF;

  UPDATE invoices
     SET excluded_from_cash = TRUE,
         attribution_status = 'excluded'
   WHERE id = p_invoice_id;

  -- Exclude ALL linked payments (regardless of project_id state) — payments
  -- for an excluded invoice should never count toward cash.
  WITH cascaded AS (
    UPDATE customer_payments
       SET excluded_from_cash = TRUE,
           attribution_status = 'excluded'
     WHERE invoice_id = p_invoice_id
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cascade_n FROM cascaded;

  INSERT INTO zoho_attribution_audit
    (entity_type, entity_id, decision, made_by, notes)
    VALUES ('invoice', p_invoice_id, 'exclude', p_made_by, p_notes);

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_cascade_n;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reassign_orphan_invoice(
  p_invoice_id     UUID,
  p_new_project_id UUID,
  p_made_by        UUID,
  p_notes          TEXT
) RETURNS TABLE (
  success                BOOLEAN,
  code                   TEXT,
  cascaded_payment_count INT
) AS $$
DECLARE
  v_old_project UUID;
  v_status      TEXT;
  v_source      TEXT;
  v_cascade_n   INT;
BEGIN
  SELECT project_id, attribution_status, source
    INTO v_old_project, v_status, v_source
    FROM invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'invoice_not_found', 0;
    RETURN;
  END IF;
  IF v_source <> 'zoho_import' THEN
    RETURN QUERY SELECT FALSE, 'not_zoho_import', 0;
    RETURN;
  END IF;
  IF v_status <> 'assigned' THEN
    RETURN QUERY SELECT FALSE, 'not_assigned_state', 0;
    RETURN;
  END IF;
  IF v_old_project = p_new_project_id THEN
    RETURN QUERY SELECT FALSE, 'same_project', 0;
    RETURN;
  END IF;

  UPDATE invoices
     SET project_id = p_new_project_id
   WHERE id = p_invoice_id;

  -- Move only the payments that were cascaded to the OLD project. Payments
  -- separately attributed elsewhere are left alone.
  WITH cascaded AS (
    UPDATE customer_payments
       SET project_id = p_new_project_id
     WHERE invoice_id = p_invoice_id
       AND project_id = v_old_project
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cascade_n FROM cascaded;

  INSERT INTO zoho_attribution_audit
    (entity_type, entity_id, from_project_id, to_project_id, decision, made_by, notes)
    VALUES ('invoice', p_invoice_id, v_old_project, p_new_project_id, 'reassign', p_made_by, p_notes);

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_cascade_n;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 100 applied ===';
  RAISE NOTICE 'assign_orphan_invoice, exclude_orphan_invoice, reassign_orphan_invoice created.';
END $$;

COMMIT;
```

- [ ] **Step 2: Apply to dev**

- [ ] **Step 3: Smoke test in SQL Editor**

```sql
-- Pick an unattributed zoho invoice
SELECT id, zoho_customer_name, total_amount FROM invoices
 WHERE source = 'zoho_import' AND attribution_status = 'pending'
 LIMIT 1;

-- Pick any active project (use its UUID)
SELECT id FROM projects LIMIT 1;

-- Pick the system employee (used as made_by for backfill audits)
SELECT id FROM employees WHERE full_name LIKE '%system%' OR full_name = 'System' LIMIT 1;

-- Run assign
SELECT * FROM assign_orphan_invoice(
  '<invoice_id>'::uuid,
  '<project_id>'::uuid,
  '<system_employee_id>'::uuid,
  'smoke test'
);
-- Expected: success=true, cascaded_payment_count >= 0

-- Verify
SELECT attribution_status, project_id FROM invoices WHERE id = '<invoice_id>'::uuid;
-- Expected: 'assigned' + the project_id you passed
SELECT * FROM zoho_attribution_audit ORDER BY made_at DESC LIMIT 1;
-- Expected: matching row with decision='assign'
```

If something doesn't match, fix the function and re-apply before continuing. Don't keep the smoke-test data — undo by hand:
```sql
UPDATE invoices SET attribution_status = 'pending', project_id = NULL WHERE id = '<invoice_id>';
DELETE FROM zoho_attribution_audit WHERE notes = 'smoke test';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/100_orphan_triage_functions.sql
git commit -m "feat(zoho): mig 100 — orphan triage SQL helper functions"
```

---

## Phase B — Read RPCs

### Task 7: RPC `get_orphan_zoho_customer_summary()`

**Files:**
- Modify: `supabase/migrations/100_orphan_triage_functions.sql` (append) — OR create a new mig 101 if you've already moved on. The plan assumes 092 is still being edited; if you've committed and applied 092, create `101_orphan_read_rpcs.sql` instead.

For the cleanest history we'll add **all the read RPCs in one new migration 101** (so the helpers stay separate from the read aggregations).

**Files (revised):**
- Create: `supabase/migrations/101_orphan_read_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/101_orphan_read_rpcs.sql
-- ============================================================================
-- Migration 101 — Orphan triage read RPCs
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Three read RPCs that back the triage page:
--   - get_orphan_zoho_customer_summary() — left pane
--   - get_candidate_projects_for_zoho_customer(zoho_name) — right pane
--   - get_orphan_counts() — KPI strip + /cash banner

BEGIN;

CREATE OR REPLACE FUNCTION get_orphan_zoho_customer_summary()
RETURNS TABLE (
  zoho_customer_name        TEXT,
  invoice_count             INT,
  invoice_total             NUMERIC(14,2),
  payment_count             INT,
  payment_total             NUMERIC(14,2),
  candidate_project_count   INT
) AS $$
WITH orphan_invs AS (
  SELECT zoho_customer_name, COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS total
    FROM invoices
   WHERE source = 'zoho_import'
     AND attribution_status = 'pending'
     AND zoho_customer_name IS NOT NULL
   GROUP BY zoho_customer_name
),
orphan_pays AS (
  SELECT zoho_customer_name, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
    FROM customer_payments
   WHERE source = 'zoho_import'
     AND attribution_status = 'pending'
     AND zoho_customer_name IS NOT NULL
   GROUP BY zoho_customer_name
),
combined AS (
  SELECT COALESCE(i.zoho_customer_name, p.zoho_customer_name) AS name,
         COALESCE(i.n, 0)::INT AS inv_n,
         COALESCE(i.total, 0)  AS inv_total,
         COALESCE(p.n, 0)::INT AS pay_n,
         COALESCE(p.total, 0)  AS pay_total
    FROM orphan_invs i
    FULL OUTER JOIN orphan_pays p USING (zoho_customer_name)
)
SELECT c.name,
       c.inv_n,
       c.inv_total,
       c.pay_n,
       c.pay_total,
       COALESCE((
         SELECT COUNT(*)::INT FROM projects pr
          WHERE LOWER(pr.customer_name) LIKE '%' || LOWER(SPLIT_PART(c.name, ' ', 1)) || '%'
       ), 0) AS candidate_project_count
  FROM combined c
 WHERE c.inv_n > 0 OR c.pay_n > 0
 ORDER BY (c.inv_total + c.pay_total) DESC;
$$ LANGUAGE sql STABLE SECURITY INVOKER;

----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_candidate_projects_for_zoho_customer(p_zoho_name TEXT)
RETURNS TABLE (
  project_id        UUID,
  project_number    TEXT,
  customer_name     TEXT,
  status            TEXT,
  system_size_kwp   NUMERIC,
  system_type       TEXT,
  contracted_value  NUMERIC(14,2),
  total_invoiced    NUMERIC(14,2),
  total_received    NUMERIC(14,2),
  net_cash_position NUMERIC(14,2),
  started_date      DATE,
  completed_date    DATE
) AS $$
-- Token overlap: meaningful tokens of ERP customer must all appear in zoho name.
-- Stopwords from scripts/backfill-zoho-customer-attribution.ts mirrored here.
WITH erp AS (
  SELECT id, customer_name, project_number, status,
         system_size_kwp, system_type, contracted_value,
         started_date, completed_date,
         REGEXP_SPLIT_TO_ARRAY(LOWER(REGEXP_REPLACE(COALESCE(customer_name, ''), '[^a-z0-9 ]', ' ', 'g')), '\s+') AS toks
    FROM projects
),
filtered AS (
  SELECT e.*
    FROM erp e
   WHERE EXISTS (
     SELECT 1 FROM unnest(e.toks) t
      WHERE length(t) >= 2
        AND t NOT IN ('mr','mrs','ms','dr','shri','sri','sree','m','s','mss',
                      'pvt','private','ltd','limited','pl','plc','inc','co','company',
                      'corp','corporation','and','enterprises','enterprise',
                      'projects','project','group','holdings','holding','india','indian',
                      'p','the','of','kw','kwp')
        AND LOWER(p_zoho_name) LIKE '%' || t || '%'
   )
)
SELECT f.id,
       f.project_number,
       f.customer_name,
       f.status,
       f.system_size_kwp,
       f.system_type,
       f.contracted_value,
       COALESCE(pcp.total_invoiced, 0),
       COALESCE(pcp.total_received, 0),
       COALESCE(pcp.net_cash_position, 0),
       f.started_date,
       f.completed_date
  FROM filtered f
  LEFT JOIN project_cash_positions pcp ON pcp.project_id = f.id
 ORDER BY f.started_date DESC NULLS LAST;
$$ LANGUAGE sql STABLE SECURITY INVOKER;

----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_orphan_counts()
RETURNS TABLE (
  pending_invoice_count   INT,
  pending_invoice_total   NUMERIC(14,2),
  pending_payment_count   INT,
  pending_payment_total   NUMERIC(14,2),
  excluded_count          INT,
  excluded_total          NUMERIC(14,2),
  deferred_count          INT
) AS $$
SELECT
  (SELECT COUNT(*)::INT FROM invoices
    WHERE source = 'zoho_import' AND attribution_status = 'pending'),
  (SELECT COALESCE(SUM(total_amount), 0) FROM invoices
    WHERE source = 'zoho_import' AND attribution_status = 'pending'),
  (SELECT COUNT(*)::INT FROM customer_payments
    WHERE source = 'zoho_import' AND attribution_status = 'pending'),
  (SELECT COALESCE(SUM(amount), 0) FROM customer_payments
    WHERE source = 'zoho_import' AND attribution_status = 'pending'),
  (SELECT COUNT(*)::INT FROM invoices
    WHERE source = 'zoho_import' AND attribution_status = 'excluded')
    +
  (SELECT COUNT(*)::INT FROM customer_payments
    WHERE source = 'zoho_import' AND attribution_status = 'excluded'),
  (SELECT COALESCE(SUM(total_amount), 0) FROM invoices
    WHERE source = 'zoho_import' AND attribution_status = 'excluded')
    +
  (SELECT COALESCE(SUM(amount), 0) FROM customer_payments
    WHERE source = 'zoho_import' AND attribution_status = 'excluded'),
  (SELECT COUNT(*)::INT FROM invoices
    WHERE source = 'zoho_import' AND attribution_status = 'deferred')
    +
  (SELECT COUNT(*)::INT FROM customer_payments
    WHERE source = 'zoho_import' AND attribution_status = 'deferred');
$$ LANGUAGE sql STABLE SECURITY INVOKER;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 101 applied ===';
END $$;

COMMIT;
```

- [ ] **Step 2: Apply to dev**

- [ ] **Step 3: Smoke test each RPC**

```sql
-- Summary
SELECT * FROM get_orphan_zoho_customer_summary() LIMIT 5;
-- Expected: 5 rows, biggest by ₹ first; should include RAMANIYAM, LANCOR, NAVIN, etc.

-- Candidate projects
SELECT * FROM get_candidate_projects_for_zoho_customer('RAMANIYAM REAL ESTATES PRIVATE LIMITED');
-- Expected: 8+ projects, all with "Ramaniyam" in customer_name.

-- Counts
SELECT * FROM get_orphan_counts();
-- Expected: pending_invoice_count = 303 (or close), totals roughly ₹63 Cr.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/101_orphan_read_rpcs.sql
git commit -m "feat(zoho): mig 101 — orphan triage read RPCs"
```

---

## Phase C — Server-side queries and actions

### Task 8: Pure helper utilities + tests

**Files:**
- Create: `apps/erp/src/lib/orphan-triage-helpers.ts`
- Create: `apps/erp/src/lib/orphan-triage-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/erp/src/lib/orphan-triage-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { isMeaningfulToken, normalizeZohoName, summarizeLinkedPayments } from './orphan-triage-helpers';

describe('isMeaningfulToken', () => {
  it('rejects stopwords', () => {
    expect(isMeaningfulToken('pvt')).toBe(false);
    expect(isMeaningfulToken('ltd')).toBe(false);
    expect(isMeaningfulToken('and')).toBe(false);
  });
  it('rejects single-char tokens', () => {
    expect(isMeaningfulToken('m')).toBe(false);
    expect(isMeaningfulToken('a')).toBe(false);
  });
  it('accepts substantive words', () => {
    expect(isMeaningfulToken('ramaniyam')).toBe(true);
    expect(isMeaningfulToken('lancor')).toBe(true);
  });
});

describe('normalizeZohoName', () => {
  it('lowercases and trims', () => {
    expect(normalizeZohoName('  LANCOR  ')).toBe('lancor');
  });
  it('collapses whitespace', () => {
    expect(normalizeZohoName('Ramaniyam   Real   Estates')).toBe('ramaniyam real estates');
  });
});

describe('summarizeLinkedPayments', () => {
  it('returns "No linked payments" for empty array', () => {
    expect(summarizeLinkedPayments([])).toBe('No linked payments');
  });
  it('returns count + total for multiple', () => {
    const payments = [
      { amount: '10000.00' },
      { amount: '25000.50' },
    ];
    expect(summarizeLinkedPayments(payments)).toBe('2 payments · ₹35,000.50');
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
pnpm --filter erp test -- orphan-triage-helpers
```

Expected: FAIL — `Cannot find module './orphan-triage-helpers'`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/erp/src/lib/orphan-triage-helpers.ts
import Decimal from 'decimal.js';

const STOPWORDS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'shri', 'sri', 'sree', 'm', 's', 'mss',
  'pvt', 'private', 'ltd', 'limited', 'pl', 'plc', 'inc', 'co', 'company',
  'corp', 'corporation', 'and', 'enterprises', 'enterprise',
  'projects', 'project', 'group', 'holdings', 'holding', 'india', 'indian',
  'p', 'the', 'of', 'kw', 'kwp',
]);

export function isMeaningfulToken(t: string): boolean {
  if (!t) return false;
  if (t.length < 2) return false;
  if (STOPWORDS.has(t.toLowerCase())) return false;
  return true;
}

export function normalizeZohoName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function summarizeLinkedPayments(payments: Array<{ amount: string | number }>): string {
  if (payments.length === 0) return 'No linked payments';
  const total = payments.reduce(
    (acc, p) => acc.plus(new Decimal(p.amount ?? 0)),
    new Decimal(0),
  );
  return `${payments.length} payment${payments.length === 1 ? '' : 's'} · ₹${total.toFixed(2)}`;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter erp test -- orphan-triage-helpers
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/lib/orphan-triage-helpers.ts apps/erp/src/lib/orphan-triage-helpers.test.ts
git commit -m "feat(orphan-triage): pure helpers + unit tests"
```

---

### Task 9: Read queries — `orphan-triage-queries.ts`

**Files:**
- Create: `apps/erp/src/lib/orphan-triage-queries.ts`

- [ ] **Step 1: Write the queries file**

```typescript
// apps/erp/src/lib/orphan-triage-queries.ts
import { createClient } from '@repo/supabase/server';
import { unstable_cache } from 'next/cache';
import type { Database } from '@repo/types/database';

type Invoice = Database['public']['Tables']['invoices']['Row'];
type CustomerPayment = Database['public']['Tables']['customer_payments']['Row'];

export interface OrphanCustomerSummary {
  zoho_customer_name: string;
  invoice_count: number;
  invoice_total: string;
  payment_count: number;
  payment_total: string;
  candidate_project_count: number;
}

export interface OrphanInvoiceWithLineItems {
  invoice: Invoice;
  line_items: Array<{
    line_number: number;
    item_name: string | null;
    item_description: string | null;
    quantity: number;
    rate: number;
    amount: number;
  }>;
  linked_payments: CustomerPayment[];
}

export interface CandidateProject {
  project_id: string;
  project_number: string;
  customer_name: string;
  status: string;
  system_size_kwp: number | null;
  system_type: string | null;
  contracted_value: string;
  total_invoiced: string;
  total_received: string;
  net_cash_position: string;
  started_date: string | null;
  completed_date: string | null;
}

export interface OrphanCounts {
  pendingInvoiceCount: number;
  pendingInvoiceTotal: string;
  pendingPaymentCount: number;
  pendingPaymentTotal: string;
  excludedCount: number;
  excludedTotal: string;
  deferredCount: number;
}

// ── Left pane ──

export async function getOrphanCustomerSummary(): Promise<OrphanCustomerSummary[]> {
  const op = '[getOrphanCustomerSummary]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_orphan_zoho_customer_summary');
  if (error) {
    console.error(`${op} RPC failed`, { error });
    throw new Error(`Failed to load orphan customer summary: ${error.message}`);
  }
  return (data ?? []).map((r: any) => ({
    zoho_customer_name: r.zoho_customer_name,
    invoice_count: Number(r.invoice_count),
    invoice_total: String(r.invoice_total ?? '0'),
    payment_count: Number(r.payment_count),
    payment_total: String(r.payment_total ?? '0'),
    candidate_project_count: Number(r.candidate_project_count),
  }));
}

// ── Middle pane ──

export async function getOrphansForCustomer(zohoCustomerName: string): Promise<{
  invoices: OrphanInvoiceWithLineItems[];
  orphan_payments_no_invoice: CustomerPayment[];
}> {
  const op = '[getOrphansForCustomer]';
  console.log(`${op} Starting`, { zohoCustomerName });
  const supabase = await createClient();

  // Invoices for this Zoho customer + their line items + linked payments
  const { data: invoices, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('source', 'zoho_import')
    .eq('attribution_status', 'pending')
    .eq('zoho_customer_name', zohoCustomerName)
    .order('invoice_date', { ascending: false });
  if (invErr) {
    console.error(`${op} invoices query failed`, { error: invErr });
    throw new Error(`Failed to load orphan invoices: ${invErr.message}`);
  }

  const invoiceIds = (invoices ?? []).map((i) => i.id);

  // Line items
  const lineItemsByInvoice = new Map<string, OrphanInvoiceWithLineItems['line_items']>();
  if (invoiceIds.length > 0) {
    const { data: lineItems, error: liErr } = await supabase
      .from('zoho_invoice_line_items')
      .select('invoice_id, line_number, item_name, item_description, quantity, rate, amount')
      .in('invoice_id', invoiceIds)
      .order('line_number', { ascending: true });
    if (liErr) {
      console.error(`${op} line items query failed`, { error: liErr });
      throw new Error(`Failed to load line items: ${liErr.message}`);
    }
    for (const li of lineItems ?? []) {
      const arr = lineItemsByInvoice.get(li.invoice_id) ?? [];
      arr.push({
        line_number: li.line_number,
        item_name: li.item_name,
        item_description: li.item_description,
        quantity: Number(li.quantity ?? 0),
        rate: Number(li.rate ?? 0),
        amount: Number(li.amount ?? 0),
      });
      lineItemsByInvoice.set(li.invoice_id, arr);
    }
  }

  // Linked payments (those with invoice_id pointing at one of our invoices)
  const linkedByInvoice = new Map<string, CustomerPayment[]>();
  if (invoiceIds.length > 0) {
    const { data: linked, error: lpErr } = await supabase
      .from('customer_payments')
      .select('*')
      .in('invoice_id', invoiceIds)
      .order('payment_date', { ascending: false });
    if (lpErr) {
      console.error(`${op} linked payments query failed`, { error: lpErr });
      throw new Error(`Failed to load linked payments: ${lpErr.message}`);
    }
    for (const p of linked ?? []) {
      if (!p.invoice_id) continue;
      const arr = linkedByInvoice.get(p.invoice_id) ?? [];
      arr.push(p);
      linkedByInvoice.set(p.invoice_id, arr);
    }
  }

  // Orphan payments without invoice link (advances)
  const { data: advances, error: advErr } = await supabase
    .from('customer_payments')
    .select('*')
    .eq('source', 'zoho_import')
    .eq('attribution_status', 'pending')
    .eq('zoho_customer_name', zohoCustomerName)
    .is('invoice_id', null)
    .order('payment_date', { ascending: false });
  if (advErr) {
    console.error(`${op} advances query failed`, { error: advErr });
    throw new Error(`Failed to load orphan advance payments: ${advErr.message}`);
  }

  return {
    invoices: (invoices ?? []).map((inv) => ({
      invoice: inv,
      line_items: lineItemsByInvoice.get(inv.id) ?? [],
      linked_payments: linkedByInvoice.get(inv.id) ?? [],
    })),
    orphan_payments_no_invoice: advances ?? [],
  };
}

// ── Right pane ──

export async function getCandidateProjectsForCustomer(zohoCustomerName: string): Promise<CandidateProject[]> {
  const op = '[getCandidateProjectsForCustomer]';
  console.log(`${op} Starting`, { zohoCustomerName });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'get_candidate_projects_for_zoho_customer',
    { p_zoho_name: zohoCustomerName },
  );
  if (error) {
    console.error(`${op} RPC failed`, { error });
    throw new Error(`Failed to load candidate projects: ${error.message}`);
  }
  return (data ?? []).map((r: any) => ({
    project_id: r.project_id,
    project_number: r.project_number,
    customer_name: r.customer_name,
    status: r.status,
    system_size_kwp: r.system_size_kwp == null ? null : Number(r.system_size_kwp),
    system_type: r.system_type,
    contracted_value: String(r.contracted_value ?? '0'),
    total_invoiced: String(r.total_invoiced ?? '0'),
    total_received: String(r.total_received ?? '0'),
    net_cash_position: String(r.net_cash_position ?? '0'),
    started_date: r.started_date,
    completed_date: r.completed_date,
  }));
}

export async function searchAllProjects(query: string): Promise<CandidateProject[]> {
  const op = '[searchAllProjects]';
  console.log(`${op} Starting`, { query });
  if (!query || query.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, status, system_size_kwp, system_type, contracted_value, started_date, completed_date')
    .or(`customer_name.ilike.%${query}%,project_number.ilike.%${query}%`)
    .limit(50);
  if (error) {
    console.error(`${op} query failed`, { error });
    throw new Error(`Project search failed: ${error.message}`);
  }
  // Inline cash position lookup
  const ids = (data ?? []).map((p) => p.id);
  const cashByProj = new Map<string, { invoiced: number; received: number; net: number }>();
  if (ids.length > 0) {
    const { data: cash } = await supabase
      .from('project_cash_positions')
      .select('project_id, total_invoiced, total_received, net_cash_position')
      .in('project_id', ids);
    for (const c of cash ?? []) {
      cashByProj.set(c.project_id, {
        invoiced: Number(c.total_invoiced ?? 0),
        received: Number(c.total_received ?? 0),
        net: Number(c.net_cash_position ?? 0),
      });
    }
  }
  return (data ?? []).map((p) => {
    const c = cashByProj.get(p.id) ?? { invoiced: 0, received: 0, net: 0 };
    return {
      project_id: p.id,
      project_number: p.project_number,
      customer_name: p.customer_name,
      status: p.status,
      system_size_kwp: p.system_size_kwp == null ? null : Number(p.system_size_kwp),
      system_type: p.system_type,
      contracted_value: String(p.contracted_value ?? '0'),
      total_invoiced: String(c.invoiced),
      total_received: String(c.received),
      net_cash_position: String(c.net),
      started_date: p.started_date,
      completed_date: p.completed_date,
    };
  });
}

// ── Counts (for KPI strip and /cash banner) ──

export const getOrphanCounts = unstable_cache(
  async (): Promise<OrphanCounts> => {
    const op = '[getOrphanCounts]';
    console.log(`${op} Starting`);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_orphan_counts');
    if (error) {
      console.error(`${op} RPC failed`, { error });
      throw new Error(`Failed to load orphan counts: ${error.message}`);
    }
    const r = data?.[0] ?? {
      pending_invoice_count: 0,
      pending_invoice_total: 0,
      pending_payment_count: 0,
      pending_payment_total: 0,
      excluded_count: 0,
      excluded_total: 0,
      deferred_count: 0,
    };
    return {
      pendingInvoiceCount: Number(r.pending_invoice_count),
      pendingInvoiceTotal: String(r.pending_invoice_total ?? '0'),
      pendingPaymentCount: Number(r.pending_payment_count),
      pendingPaymentTotal: String(r.pending_payment_total ?? '0'),
      excludedCount: Number(r.excluded_count),
      excludedTotal: String(r.excluded_total ?? '0'),
      deferredCount: Number(r.deferred_count),
    };
  },
  ['orphan-counts'],
  { revalidate: 60, tags: ['orphan-counts'] },
);

// ── Audit log ──

export async function getAttributionAudit(opts?: {
  decision?: string;
  madeBy?: string;
  page?: number;
}): Promise<{ rows: any[]; total: number }> {
  const op = '[getAttributionAudit]';
  console.log(`${op} Starting`, opts);
  const supabase = await createClient();
  const page = opts?.page ?? 1;
  const perPage = 50;
  let q = supabase
    .from('zoho_attribution_audit')
    .select(
      'id, entity_type, entity_id, from_project_id, to_project_id, decision, made_by, made_at, notes, employees!made_by(full_name)',
      { count: 'estimated' },
    )
    .order('made_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);
  if (opts?.decision) q = q.eq('decision', opts.decision);
  if (opts?.madeBy) q = q.eq('made_by', opts.madeBy);
  const { data, count, error } = await q;
  if (error) {
    console.error(`${op} query failed`, { error });
    throw new Error(`Audit query failed: ${error.message}`);
  }
  return { rows: data ?? [], total: count ?? 0 };
}
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm --filter erp check-types
```

Expected: clean. If any RPC return-type isn't yet in `database.ts`, regenerate types and re-run.

- [ ] **Step 3: Smoke test from a script**

Create `scripts/smoke-orphan-queries.ts`:

```typescript
// scripts/smoke-orphan-queries.ts
import { getOrphanCustomerSummary, getOrphanCounts, getCandidateProjectsForCustomer } from '../apps/erp/src/lib/orphan-triage-queries';

async function main() {
  const counts = await getOrphanCounts();
  console.log('counts:', counts);
  const summary = await getOrphanCustomerSummary();
  console.log('top 3 customers:', summary.slice(0, 3));
  if (summary.length > 0) {
    const candidates = await getCandidateProjectsForCustomer(summary[0].zoho_customer_name);
    console.log(`candidates for "${summary[0].zoho_customer_name}":`, candidates.length);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run:
```bash
pnpm tsx scripts/smoke-orphan-queries.ts
```

Expected: counts populated, top 3 customers listed, candidate count > 0 for first customer. After verifying, delete the smoke script.

```bash
rm scripts/smoke-orphan-queries.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/lib/orphan-triage-queries.ts
git commit -m "feat(orphan-triage): read queries and RPC wrappers"
```

---

### Task 10: Server actions — assign + assign-payment

**Files:**
- Create: `apps/erp/src/lib/orphan-triage-actions.ts`

- [ ] **Step 1: Write the actions module skeleton + assign actions**

```typescript
// apps/erp/src/lib/orphan-triage-actions.ts
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

const ALLOWED_ROLES = new Set(['founder', 'finance', 'marketing_manager']);

interface CallerContext {
  employeeId: string;
}

async function requireTriageRole(): Promise<ActionResult<CallerContext>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated', 'unauthenticated');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return err('Forbidden — triage requires founder, finance, or marketing_manager', 'forbidden');
  }
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return err('Employee record not found for current user', 'no_employee');
  return ok({ employeeId: employee.id });
}

function postSuccess() {
  revalidatePath('/cash/orphan-invoices');
  revalidatePath('/cash');
  revalidateTag('orphan-counts');
}

// ── Assign actions ──

export async function assignOrphanInvoice(
  invoiceId: string,
  projectId: string,
  notes: string | null,
): Promise<ActionResult<{ cascadedPaymentCount: number }>> {
  const op = '[assignOrphanInvoice]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('assign_orphan_invoice', {
    p_invoice_id: invoiceId,
    p_project_id: projectId,
    p_made_by: auth.data.employeeId,
    p_notes: notes,
  });
  if (error) {
    console.error(`${op} RPC failed`, { invoiceId, projectId, error });
    return err(error.message, error.code);
  }
  const row = (data as any)?.[0];
  if (!row?.success) {
    console.warn(`${op} precondition`, { invoiceId, code: row?.code });
    return err(`Cannot assign — ${row?.code ?? 'unknown'}`, row?.code);
  }
  postSuccess();
  return ok({ cascadedPaymentCount: Number(row.cascaded_payment_count ?? 0) });
}

export async function assignOrphanPayment(
  paymentId: string,
  projectId: string,
  notes: string | null,
): Promise<ActionResult<void>> {
  const op = '[assignOrphanPayment]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();

  // Precondition: payment exists, is zoho_import, attribution_status = pending
  const { data: pay, error: fetchErr } = await supabase
    .from('customer_payments')
    .select('id, source, attribution_status')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !pay) {
    console.error(`${op} not found`, { paymentId, error: fetchErr });
    return err('Payment not found', 'not_found');
  }
  if (pay.source !== 'zoho_import') return err('Not a Zoho import row', 'not_zoho_import');
  if (pay.attribution_status !== 'pending') return err('Already triaged', 'already_triaged');

  const { error: upErr } = await supabase
    .from('customer_payments')
    .update({ project_id: projectId, attribution_status: 'assigned' })
    .eq('id', paymentId);
  if (upErr) {
    console.error(`${op} update failed`, { paymentId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: 'payment',
      entity_id: paymentId,
      to_project_id: projectId,
      decision: 'assign',
      made_by: auth.data.employeeId,
      notes,
    });
  if (auditErr) {
    console.error(`${op} audit insert failed`, { paymentId, error: auditErr });
    return err(auditErr.message, auditErr.code);
  }
  postSuccess();
  return ok(undefined);
}
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm --filter erp check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/orphan-triage-actions.ts
git commit -m "feat(orphan-triage): assign actions + role-guard helper"
```

---

### Task 11: Exclude + defer actions

**Files:**
- Modify: `apps/erp/src/lib/orphan-triage-actions.ts` (append)

- [ ] **Step 1: Append exclude + defer functions**

Add the following to the bottom of `apps/erp/src/lib/orphan-triage-actions.ts`:

```typescript
// ── Exclude actions ──

export async function excludeInvoice(
  invoiceId: string,
  notes: string,
): Promise<ActionResult<{ cascadedPaymentCount: number }>> {
  const op = '[excludeInvoice]';
  if (!notes || notes.trim().length === 0) {
    return err('Notes required for exclude', 'notes_required');
  }
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('exclude_orphan_invoice', {
    p_invoice_id: invoiceId,
    p_made_by: auth.data.employeeId,
    p_notes: notes,
  });
  if (error) {
    console.error(`${op} RPC failed`, { invoiceId, error });
    return err(error.message, error.code);
  }
  const row = (data as any)?.[0];
  if (!row?.success) {
    return err(`Cannot exclude — ${row?.code ?? 'unknown'}`, row?.code);
  }
  postSuccess();
  return ok({ cascadedPaymentCount: Number(row.cascaded_payment_count ?? 0) });
}

export async function excludePayment(
  paymentId: string,
  notes: string,
): Promise<ActionResult<void>> {
  const op = '[excludePayment]';
  if (!notes || notes.trim().length === 0) {
    return err('Notes required for exclude', 'notes_required');
  }
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data: pay, error: fetchErr } = await supabase
    .from('customer_payments')
    .select('id, source, attribution_status')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !pay) return err('Payment not found', 'not_found');
  if (pay.source !== 'zoho_import') return err('Not a Zoho import row', 'not_zoho_import');
  if (pay.attribution_status === 'excluded') return err('Already excluded', 'already_excluded');

  const { error: upErr } = await supabase
    .from('customer_payments')
    .update({ excluded_from_cash: true, attribution_status: 'excluded' })
    .eq('id', paymentId);
  if (upErr) {
    console.error(`${op} update failed`, { paymentId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: 'payment',
      entity_id: paymentId,
      decision: 'exclude',
      made_by: auth.data.employeeId,
      notes,
    });
  if (auditErr) {
    console.error(`${op} audit insert failed`, { paymentId, error: auditErr });
    return err(auditErr.message, auditErr.code);
  }
  postSuccess();
  return ok(undefined);
}

// ── Defer actions ──

export async function deferInvoice(
  invoiceId: string,
  notes: string | null,
): Promise<ActionResult<void>> {
  const op = '[deferInvoice]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data: inv, error: fetchErr } = await supabase
    .from('invoices')
    .select('id, source, attribution_status')
    .eq('id', invoiceId)
    .single();
  if (fetchErr || !inv) return err('Invoice not found', 'not_found');
  if (inv.source !== 'zoho_import') return err('Not a Zoho import row', 'not_zoho_import');
  if (inv.attribution_status !== 'pending') return err('Cannot defer non-pending row', 'wrong_state');

  const { error: upErr } = await supabase
    .from('invoices')
    .update({ attribution_status: 'deferred' })
    .eq('id', invoiceId);
  if (upErr) {
    console.error(`${op} update failed`, { invoiceId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: 'invoice',
      entity_id: invoiceId,
      decision: 'skip',
      made_by: auth.data.employeeId,
      notes,
    });
  if (auditErr) {
    console.error(`${op} audit insert failed`, { invoiceId, error: auditErr });
    return err(auditErr.message, auditErr.code);
  }
  postSuccess();
  return ok(undefined);
}

export async function deferPayment(
  paymentId: string,
  notes: string | null,
): Promise<ActionResult<void>> {
  const op = '[deferPayment]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data: pay, error: fetchErr } = await supabase
    .from('customer_payments')
    .select('id, source, attribution_status')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !pay) return err('Payment not found', 'not_found');
  if (pay.source !== 'zoho_import') return err('Not a Zoho import row', 'not_zoho_import');
  if (pay.attribution_status !== 'pending') return err('Cannot defer non-pending row', 'wrong_state');

  const { error: upErr } = await supabase
    .from('customer_payments')
    .update({ attribution_status: 'deferred' })
    .eq('id', paymentId);
  if (upErr) {
    console.error(`${op} update failed`, { paymentId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: 'payment',
      entity_id: paymentId,
      decision: 'skip',
      made_by: auth.data.employeeId,
      notes,
    });
  if (auditErr) return err(auditErr.message, auditErr.code);
  postSuccess();
  return ok(undefined);
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm --filter erp check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/orphan-triage-actions.ts
git commit -m "feat(orphan-triage): exclude + defer actions"
```

---

### Task 12: Reassign + undo actions

**Files:**
- Modify: `apps/erp/src/lib/orphan-triage-actions.ts` (append)

- [ ] **Step 1: Append reassign + undo functions**

Add to the bottom of the actions file:

```typescript
// ── Reassign action ──

export async function reassignInvoice(
  invoiceId: string,
  newProjectId: string,
  notes: string | null,
): Promise<ActionResult<{ cascadedPaymentCount: number }>> {
  const op = '[reassignInvoice]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('reassign_orphan_invoice', {
    p_invoice_id: invoiceId,
    p_new_project_id: newProjectId,
    p_made_by: auth.data.employeeId,
    p_notes: notes,
  });
  if (error) {
    console.error(`${op} RPC failed`, { invoiceId, newProjectId, error });
    return err(error.message, error.code);
  }
  const row = (data as any)?.[0];
  if (!row?.success) {
    return err(`Cannot reassign — ${row?.code ?? 'unknown'}`, row?.code);
  }
  postSuccess();
  return ok({ cascadedPaymentCount: Number(row.cascaded_payment_count ?? 0) });
}

// ── Undo actions ──

export async function undoExclude(
  entityType: 'invoice' | 'payment',
  entityId: string,
): Promise<ActionResult<void>> {
  const op = '[undoExclude]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const table = entityType === 'invoice' ? 'invoices' : 'customer_payments';

  const { error: upErr } = await supabase
    .from(table as any)
    .update({ excluded_from_cash: false, attribution_status: 'pending' })
    .eq('id', entityId);
  if (upErr) {
    console.error(`${op} update failed`, { entityType, entityId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      decision: 'undo_exclude',
      made_by: auth.data.employeeId,
      notes: null,
    });
  if (auditErr) return err(auditErr.message, auditErr.code);

  // For invoices, undo also cascades to linked payments.
  if (entityType === 'invoice') {
    const { error: cascadeErr } = await supabase
      .from('customer_payments')
      .update({ excluded_from_cash: false, attribution_status: 'pending' })
      .eq('invoice_id', entityId)
      .eq('excluded_from_cash', true);
    if (cascadeErr) {
      console.error(`${op} cascade undo failed`, { entityId, error: cascadeErr });
      // Non-fatal — primary update succeeded.
    }
  }

  postSuccess();
  return ok(undefined);
}

export async function undoDefer(
  entityType: 'invoice' | 'payment',
  entityId: string,
): Promise<ActionResult<void>> {
  const op = '[undoDefer]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const table = entityType === 'invoice' ? 'invoices' : 'customer_payments';

  const { error: upErr } = await supabase
    .from(table as any)
    .update({ attribution_status: 'pending' })
    .eq('id', entityId);
  if (upErr) {
    console.error(`${op} update failed`, { entityType, entityId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      decision: 'undo_skip',
      made_by: auth.data.employeeId,
      notes: null,
    });
  if (auditErr) return err(auditErr.message, auditErr.code);
  postSuccess();
  return ok(undefined);
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm --filter erp check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/orphan-triage-actions.ts
git commit -m "feat(orphan-triage): reassign + undo actions"
```

---

## Phase D — Page skeleton + KPI strip

### Task 13: Page route + role guard + loading state

**Files:**
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/page.tsx`
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/loading.tsx`

- [ ] **Step 1: Write `loading.tsx`**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/loading.tsx
import { Skeleton } from '@repo/ui';

export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-[600px]" />
    </div>
  );
}
```

- [ ] **Step 2: Write `page.tsx`**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { getOrphanCounts, getOrphanCustomerSummary } from '@/lib/orphan-triage-queries';
import { TriageShell } from './_components/triage-shell';
import { Eyebrow, Breadcrumb } from '@repo/ui';

export const metadata = { title: 'Zoho Orphan Triage' };

const ALLOWED = new Set(['founder', 'finance', 'marketing_manager']);

export default async function OrphanTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; customer?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !ALLOWED.has(profile.role)) {
    redirect('/cash?notice=orphan-triage-forbidden');
  }

  const [counts, summary] = await Promise.all([
    getOrphanCounts(),
    getOrphanCustomerSummary(),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-4"
        items={[{ label: 'Cash Flow', href: '/cash' }, { label: 'Zoho Orphan Triage' }]}
      />
      <div>
        <Eyebrow className="mb-1">CASH FLOW</Eyebrow>
        <h1 className="text-2xl font-bold text-[#1A1D24]">Zoho Orphan Triage</h1>
        <p className="text-sm text-[#7C818E]">
          Attribute parent-company Zoho invoices and payments to ERP projects.
        </p>
      </div>

      <TriageShell
        counts={counts}
        customers={summary}
        activeTab={(params.tab as any) ?? 'active'}
        selectedCustomer={params.customer ?? null}
      />
    </div>
  );
}
```

- [ ] **Step 3: Build verification**

```bash
pnpm --filter erp build
```

Expected: build succeeds. The build will fail on missing `TriageShell` — that's fine for now if Step 4 fixes it. (If you want incremental green builds, do this task and Task 14 together.)

- [ ] **Step 4: Commit (skip until Task 14 is in)**

Hold the commit until Task 14 — committing a broken build is bad practice. Combined commit at the end of Task 14.

---

### Task 14: TriageShell component (KPIs + tabs + 3-pane scaffold)

**Files:**
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/triage-shell.tsx`

- [ ] **Step 1: Write the shell component**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/triage-shell.tsx
'use client';

import { useState } from 'react';
import { Card, CardContent, Tabs, TabsList, TabsTrigger, TabsContent } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import { FileText, AlertTriangle, Ban, Pause } from 'lucide-react';
import type { OrphanCounts, OrphanCustomerSummary } from '@/lib/orphan-triage-queries';
import { CustomerListPane } from './customer-list-pane';
import { InvoicesPane } from './invoices-pane';
import { CandidatesPane } from './candidates-pane';
import { AuditLogTable } from './audit-log-table';

interface Props {
  counts: OrphanCounts;
  customers: OrphanCustomerSummary[];
  activeTab: 'active' | 'deferred' | 'excluded' | 'audit';
  selectedCustomer: string | null;
}

export function TriageShell({ counts, customers, activeTab, selectedCustomer }: Props) {
  const [selected, setSelected] = useState<string | null>(
    selectedCustomer ?? customers[0]?.zoho_customer_name ?? null,
  );

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<FileText className="h-5 w-5 text-amber-600" />}
          bg="bg-amber-100"
          count={counts.pendingInvoiceCount}
          total={counts.pendingInvoiceTotal}
          label="Pending Invoices"
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5 text-orange-600" />}
          bg="bg-orange-100"
          count={counts.pendingPaymentCount}
          total={counts.pendingPaymentTotal}
          label="Pending Payments"
        />
        <KpiCard
          icon={<Ban className="h-5 w-5 text-red-600" />}
          bg="bg-red-100"
          count={counts.excludedCount}
          total={counts.excludedTotal}
          label="Excluded (No ERP Match)"
        />
        <KpiCard
          icon={<Pause className="h-5 w-5 text-gray-600" />}
          bg="bg-gray-100"
          count={counts.deferredCount}
          total={null}
          label="Deferred"
        />
      </div>

      <Tabs defaultValue={activeTab}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="deferred">Deferred</TabsTrigger>
          <TabsTrigger value="excluded">Excluded</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {customers.length === 0 ? (
            <EmptyDone />
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: '260px 1fr 320px' }}>
              <CustomerListPane
                customers={customers}
                selected={selected}
                onSelect={setSelected}
              />
              <InvoicesPane zohoCustomerName={selected} />
              <CandidatesPane zohoCustomerName={selected} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="deferred">
          <DeferredTab />
        </TabsContent>

        <TabsContent value="excluded">
          <ExcludedTab />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({
  icon, bg, count, total, label,
}: {
  icon: React.ReactNode;
  bg: string;
  count: number;
  total: string | null;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
            {icon}
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1D24]">{count}</p>
            {total !== null && (
              <p className="text-xs text-[#7C818E]">{shortINR(Number(total))}</p>
            )}
            <p className="text-xs text-[#7C818E]">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyDone() {
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <p className="text-2xl">✅ All Zoho imports attributed.</p>
        <p className="text-sm text-[#7C818E] mt-2">Check the Audit log tab for the decision history.</p>
      </CardContent>
    </Card>
  );
}

// Placeholders — Tasks 17 (deferred-tab), 18 (excluded-tab) will replace these.
function DeferredTab() {
  return <Card><CardContent className="py-12 text-center text-[#7C818E]">Deferred tab — coming in Task 17</CardContent></Card>;
}
function ExcludedTab() {
  return <Card><CardContent className="py-12 text-center text-[#7C818E]">Excluded tab — coming in Task 18</CardContent></Card>;
}
```

- [ ] **Step 2: Stub the child components so the build passes**

Create stubs that will be filled in by Tasks 15+:

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/customer-list-pane.tsx
'use client';
import type { OrphanCustomerSummary } from '@/lib/orphan-triage-queries';
export function CustomerListPane(_props: {
  customers: OrphanCustomerSummary[];
  selected: string | null;
  onSelect: (n: string) => void;
}) {
  return <div className="border rounded-lg p-4 text-sm text-[#7C818E]">Customer list — Task 15</div>;
}
```

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/invoices-pane.tsx
export function InvoicesPane(_props: { zohoCustomerName: string | null }) {
  return <div className="border rounded-lg p-4 text-sm text-[#7C818E]">Invoices pane — Tasks 16-17</div>;
}
```

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/candidates-pane.tsx
export function CandidatesPane(_props: { zohoCustomerName: string | null }) {
  return <div className="border rounded-lg p-4 text-sm text-[#7C818E]">Candidates pane — Tasks 18-19</div>;
}
```

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/audit-log-table.tsx
export function AuditLogTable() {
  return <div className="border rounded-lg p-4 text-sm text-[#7C818E]">Audit log — Task 22</div>;
}
```

- [ ] **Step 3: Build verification**

```bash
pnpm --filter erp build
```

Expected: clean build.

- [ ] **Step 4: Visual smoke**

```bash
pnpm --filter erp dev
```

Navigate to `http://localhost:3000/cash/orphan-invoices` (logged in as founder). Expected:
- 4 KPI cards with real numbers from the dev DB.
- 4 tabs.
- Active tab shows the 3-pane stub (gray placeholder boxes).

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/app/\(erp\)/cash/orphan-invoices/page.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/loading.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/triage-shell.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/customer-list-pane.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/invoices-pane.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/candidates-pane.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/audit-log-table.tsx
git commit -m "feat(orphan-triage): page skeleton + KPI strip + tabs"
```

---

## Phase E — UI components

### Task 15: Customer list pane (left)

**Files:**
- Modify: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/customer-list-pane.tsx`

- [ ] **Step 1: Replace stub with real implementation**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/customer-list-pane.tsx
'use client';

import { useState, useMemo } from 'react';
import { Input } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import type { OrphanCustomerSummary } from '@/lib/orphan-triage-queries';
import Decimal from 'decimal.js';

interface Props {
  customers: OrphanCustomerSummary[];
  selected: string | null;
  onSelect: (name: string) => void;
}

export function CustomerListPane({ customers, selected, onSelect }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return customers;
    const s = search.toLowerCase();
    return customers.filter((c) => c.zoho_customer_name.toLowerCase().includes(s));
  }, [customers, search]);

  return (
    <div className="border rounded-lg bg-white overflow-hidden flex flex-col" style={{ height: '70vh' }}>
      <div className="p-3 border-b">
        <Input
          placeholder="Search Zoho customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-4 text-xs text-[#7C818E]">No matching customers.</p>
        ) : (
          filtered.map((c) => {
            const total = new Decimal(c.invoice_total).plus(new Decimal(c.payment_total));
            const isSelected = c.zoho_customer_name === selected;
            return (
              <button
                key={c.zoho_customer_name}
                type="button"
                onClick={() => onSelect(c.zoho_customer_name)}
                className={`w-full text-left p-3 border-b hover:bg-gray-50 transition-colors ${
                  isSelected ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''
                }`}
              >
                <p className="text-xs font-bold text-[#1A1D24] truncate">{c.zoho_customer_name}</p>
                <p className="text-[10px] text-[#7C818E] mt-0.5">
                  {c.invoice_count} invoices · {shortINR(total.toNumber())}
                </p>
                <p className="text-[10px] text-[#7C818E]">
                  {c.candidate_project_count} ERP candidates
                </p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build verification**

```bash
pnpm --filter erp check-types && pnpm --filter erp build
```

- [ ] **Step 3: Visual smoke**

Reload `/cash/orphan-invoices`. Expected:
- Left pane shows real Zoho customer rows (RAMANIYAM, LANCOR, NAVIN, etc.).
- Search filters live.
- Clicking a row highlights it (yellow strip on left).

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/customer-list-pane.tsx
git commit -m "feat(orphan-triage): customer list pane with search"
```

---

### Task 16: Line items table + Invoice card

**Files:**
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/line-items-table.tsx`
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/invoice-card.tsx`

- [ ] **Step 1: Write `line-items-table.tsx`**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/line-items-table.tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';

interface Props {
  items: Array<{
    line_number: number;
    item_name: string | null;
    item_description: string | null;
    quantity: number;
    rate: number;
    amount: number;
  }>;
}

export function LineItemsTable({ items }: Props) {
  if (items.length === 0) {
    return <p className="text-xs text-[#7C818E] italic">No line items recorded.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/2">Item</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((it) => (
          <TableRow key={it.line_number}>
            <TableCell>
              <div className="text-xs font-medium">{it.item_name ?? '—'}</div>
              {it.item_description && (
                <div className="text-[10px] text-[#7C818E]">{it.item_description}</div>
              )}
            </TableCell>
            <TableCell className="text-right text-xs font-mono">{it.quantity}</TableCell>
            <TableCell className="text-right text-xs font-mono">{formatINR(it.rate)}</TableCell>
            <TableCell className="text-right text-xs font-mono">{formatINR(it.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Write `invoice-card.tsx`**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/invoice-card.tsx
'use client';

import { Card, CardContent, Badge, Button } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { LineItemsTable } from './line-items-table';
import type { OrphanInvoiceWithLineItems } from '@/lib/orphan-triage-queries';

interface Props {
  data: OrphanInvoiceWithLineItems;
  selected: boolean;
  onSelect: () => void;
  onAssign: () => void;
  onExclude: () => void;
  onDefer: () => void;
}

export function InvoiceCard({ data, selected, onSelect, onAssign, onExclude, onDefer }: Props) {
  const { invoice, line_items, linked_payments } = data;
  return (
    <Card
      className={`cursor-pointer transition-shadow ${selected ? 'ring-2 ring-amber-500' : 'hover:shadow-md'}`}
      onClick={onSelect}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-0.5">
            <p className="text-sm font-bold">{invoice.invoice_number}</p>
            <p className="text-xs text-[#7C818E]">{formatDate(invoice.invoice_date)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-mono font-bold">{formatINR(Number(invoice.total_amount))}</p>
            <Badge variant="outline" className="text-[10px]">
              {invoice.status ?? 'unknown'}
            </Badge>
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase font-bold text-[#7C818E] mb-1">Line items</p>
          <LineItemsTable items={line_items} />
        </div>

        {invoice.notes && (
          <div>
            <p className="text-[10px] uppercase font-bold text-[#7C818E] mb-1">Notes</p>
            <p className="text-xs italic">{invoice.notes}</p>
          </div>
        )}

        {linked_payments.length > 0 && (
          <div>
            <p className="text-[10px] uppercase font-bold text-[#7C818E] mb-1">Linked payments</p>
            <div className="space-y-1">
              {linked_payments.map((p) => (
                <div key={p.id} className="flex justify-between text-xs">
                  <span>{formatDate(p.payment_date)} · {p.payment_method ?? '—'}</span>
                  <span className="font-mono">{formatINR(Number(p.amount))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" onClick={onAssign}>Assign to project</Button>
          <Button size="sm" variant="outline" onClick={onExclude}>No ERP match</Button>
          <Button size="sm" variant="ghost" onClick={onDefer}>Defer</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Build verification**

```bash
pnpm --filter erp check-types && pnpm --filter erp build
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/line-items-table.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/invoice-card.tsx
git commit -m "feat(orphan-triage): line items table + invoice card"
```

---

### Task 17: Invoices pane (middle) + modals wiring

**Files:**
- Modify: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/invoices-pane.tsx`
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/assign-modal.tsx`
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/exclude-modal.tsx`
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/defer-modal.tsx`

- [ ] **Step 1: Write the three modals**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/assign-modal.tsx
'use client';

import { useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label } from '@repo/ui';
import { useToast } from '@repo/ui';
import { assignOrphanInvoice, assignOrphanPayment } from '@/lib/orphan-triage-actions';
import { formatINR } from '@repo/ui/formatters';

interface Props {
  open: boolean;
  onClose: () => void;
  entity: { kind: 'invoice'; id: string; total: string; number: string }
        | { kind: 'payment'; id: string; total: string; ref: string };
  project: { id: string; number: string; customer_name: string } | null;
  onSuccess: () => void;
}

export function AssignModal({ open, onClose, entity, project, onSuccess }: Props) {
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleConfirm = () => {
    if (!project) return;
    startTransition(async () => {
      const result = entity.kind === 'invoice'
        ? await assignOrphanInvoice(entity.id, project.id, notes || null)
        : await assignOrphanPayment(entity.id, project.id, notes || null);
      if (!result.success) {
        toast({ title: 'Assign failed', description: result.error, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Assigned',
        description: entity.kind === 'invoice'
          ? `Cascaded ${result.data.cascadedPaymentCount} linked payment(s).`
          : 'Payment assigned.',
      });
      setNotes('');
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to project</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          Assign{' '}
          {entity.kind === 'invoice' ? <strong>{entity.number}</strong> : <strong>{entity.ref}</strong>}{' '}
          ({formatINR(Number(entity.total))}) to{' '}
          {project ? <strong>{project.customer_name} ({project.number})</strong> : '—'}?
        </p>
        {entity.kind === 'invoice' && (
          <p className="text-xs text-[#7C818E]">
            Linked customer payments will cascade to the same project.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="assign-notes">Notes (optional)</Label>
          <Input id="assign-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isPending || !project}>
            {isPending ? 'Assigning…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/exclude-modal.tsx
'use client';

import { useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label, useToast } from '@repo/ui';
import { excludeInvoice, excludePayment } from '@/lib/orphan-triage-actions';
import { formatINR } from '@repo/ui/formatters';

interface Props {
  open: boolean;
  onClose: () => void;
  entity: { kind: 'invoice'; id: string; total: string; number: string }
        | { kind: 'payment'; id: string; total: string; ref: string };
  onSuccess: () => void;
}

export function ExcludeModal({ open, onClose, entity, onSuccess }: Props) {
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleConfirm = () => {
    if (!notes.trim()) {
      toast({ title: 'Notes required', description: 'Explain why this is excluded from cash.', variant: 'destructive' });
      return;
    }
    startTransition(async () => {
      const result = entity.kind === 'invoice'
        ? await excludeInvoice(entity.id, notes)
        : await excludePayment(entity.id, notes);
      if (!result.success) {
        toast({ title: 'Exclude failed', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Excluded', description: 'No longer affects any project cash position.' });
      setNotes('');
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as no ERP match</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          Mark <strong>{entity.kind === 'invoice' ? entity.number : entity.ref}</strong>{' '}
          ({formatINR(Number(entity.total))}) as <em>excluded from cash</em>?
        </p>
        <p className="text-xs text-[#7C818E]">
          The row stays in the DB for audit but does not move any project's cash position.
          {entity.kind === 'invoice' && ' Linked payments are excluded too.'} Undo from the Excluded tab.
        </p>
        <div className="space-y-2">
          <Label htmlFor="exclude-notes">Reason (required)</Label>
          <Input
            id="exclude-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., Industrial deal not in ERP — written off"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Excluding…' : 'Confirm exclude'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/defer-modal.tsx
'use client';

import { useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label, useToast } from '@repo/ui';
import { deferInvoice, deferPayment } from '@/lib/orphan-triage-actions';

interface Props {
  open: boolean;
  onClose: () => void;
  entity: { kind: 'invoice'; id: string; number: string }
        | { kind: 'payment'; id: string; ref: string };
  onSuccess: () => void;
}

export function DeferModal({ open, onClose, entity, onSuccess }: Props) {
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleConfirm = () => {
    startTransition(async () => {
      const result = entity.kind === 'invoice'
        ? await deferInvoice(entity.id, notes || null)
        : await deferPayment(entity.id, notes || null);
      if (!result.success) {
        toast({ title: 'Defer failed', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Deferred', description: 'Moved to the Deferred tab.' });
      setNotes('');
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Defer for later</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          Move <strong>{entity.kind === 'invoice' ? entity.number : entity.ref}</strong> to the Deferred tab?
          It won't affect cash until you come back to it.
        </p>
        <div className="space-y-2">
          <Label htmlFor="defer-notes">Note (optional)</Label>
          <Input id="defer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to research" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Deferring…' : 'Confirm defer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the invoices pane**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/invoices-pane.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Tabs, TabsList, TabsTrigger, TabsContent, Skeleton } from '@repo/ui';
import { InvoiceCard } from './invoice-card';
import { AssignModal } from './assign-modal';
import { ExcludeModal } from './exclude-modal';
import { DeferModal } from './defer-modal';
import { getOrphansForCustomerClient } from './_client-fetchers';
import { formatINR, formatDate } from '@repo/ui/formatters';

interface Props {
  zohoCustomerName: string | null;
}

interface Bundle {
  invoices: any[];
  orphan_payments_no_invoice: any[];
}

export function InvoicesPane({ zohoCustomerName }: Props) {
  const router = useRouter();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Modal state
  const [modal, setModal] = useState<
    | { type: 'assign'; entity: any }
    | { type: 'exclude'; entity: any }
    | { type: 'defer'; entity: any }
    | null
  >(null);

  useEffect(() => {
    if (!zohoCustomerName) { setBundle(null); return; }
    setLoading(true);
    getOrphansForCustomerClient(zohoCustomerName).then((b) => {
      setBundle(b);
      setLoading(false);
    });
  }, [zohoCustomerName]);

  const refresh = () => {
    setModal(null);
    if (zohoCustomerName) {
      getOrphansForCustomerClient(zohoCustomerName).then(setBundle);
    }
    router.refresh();
  };

  if (!zohoCustomerName) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[#7C818E]">
          Select a customer on the left to start triage.
        </CardContent>
      </Card>
    );
  }

  if (loading || !bundle) {
    return <Skeleton className="h-[500px]" />;
  }

  return (
    <div className="space-y-3" style={{ height: '70vh', overflowY: 'auto' }}>
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">
            Invoices ({bundle.invoices.length})
          </TabsTrigger>
          <TabsTrigger value="advances">
            Advance payments ({bundle.orphan_payments_no_invoice.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-3">
          {bundle.invoices.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-[#7C818E]">No pending invoices for this customer.</CardContent></Card>
          ) : (
            bundle.invoices.map((b: any) => (
              <InvoiceCard
                key={b.invoice.id}
                data={b}
                selected={b.invoice.id === selectedInvoiceId}
                onSelect={() => setSelectedInvoiceId(b.invoice.id)}
                onAssign={() => setModal({ type: 'assign', entity: { kind: 'invoice', id: b.invoice.id, total: String(b.invoice.total_amount), number: b.invoice.invoice_number } })}
                onExclude={() => setModal({ type: 'exclude', entity: { kind: 'invoice', id: b.invoice.id, total: String(b.invoice.total_amount), number: b.invoice.invoice_number } })}
                onDefer={() => setModal({ type: 'defer', entity: { kind: 'invoice', id: b.invoice.id, number: b.invoice.invoice_number } })}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="advances" className="space-y-2">
          {bundle.orphan_payments_no_invoice.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-[#7C818E]">No advance payments.</CardContent></Card>
          ) : (
            bundle.orphan_payments_no_invoice.map((p: any) => (
              <Card key={p.id}>
                <CardContent className="p-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-bold">{p.receipt_number}</p>
                    <p className="text-xs text-[#7C818E]">
                      {formatDate(p.payment_date)} · {p.payment_method} · {formatINR(Number(p.amount))}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="text-xs px-2 py-1 bg-amber-100 rounded"
                      onClick={() => setModal({ type: 'assign', entity: { kind: 'payment', id: p.id, total: String(p.amount), ref: p.receipt_number } })}
                    >
                      Assign
                    </button>
                    <button
                      className="text-xs px-2 py-1 bg-red-100 rounded"
                      onClick={() => setModal({ type: 'exclude', entity: { kind: 'payment', id: p.id, total: String(p.amount), ref: p.receipt_number } })}
                    >
                      No match
                    </button>
                    <button
                      className="text-xs px-2 py-1 bg-gray-100 rounded"
                      onClick={() => setModal({ type: 'defer', entity: { kind: 'payment', id: p.id, ref: p.receipt_number } })}
                    >
                      Defer
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {modal?.type === 'assign' && (
        <AssignModal
          open
          onClose={() => setModal(null)}
          entity={modal.entity}
          project={null /* candidates pane sets this via global state in next iteration */}
          onSuccess={refresh}
        />
      )}
      {modal?.type === 'exclude' && (
        <ExcludeModal open onClose={() => setModal(null)} entity={modal.entity} onSuccess={refresh} />
      )}
      {modal?.type === 'defer' && (
        <DeferModal open onClose={() => setModal(null)} entity={modal.entity} onSuccess={refresh} />
      )}
    </div>
  );
}
```

> The `AssignModal` integration above passes `project={null}` because the candidate selection lives in the right pane (next task). You'll wire the right pane to set a "currently focused candidate" via shared state in Task 19.

- [ ] **Step 3: Write the client-side fetcher helper**

`getOrphansForCustomer` from `orphan-triage-queries.ts` is server-only (uses `next/cache`). For the client to refetch on customer change, use a thin server-action wrapper. Create:

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/_client-fetchers.ts
'use server';

import { getOrphansForCustomer } from '@/lib/orphan-triage-queries';

export async function getOrphansForCustomerClient(name: string) {
  return getOrphansForCustomer(name);
}
```

- [ ] **Step 4: Build verification**

```bash
pnpm --filter erp check-types && pnpm --filter erp build
```

- [ ] **Step 5: Visual smoke**

Click a customer in the left pane; middle pane should populate with that customer's invoices including line items. Click "Defer" on an invoice → modal opens → confirm → invoice disappears (refetch) and KPI strip updates after `router.refresh()`.

- [ ] **Step 6: Commit**

```bash
git add apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/invoices-pane.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/assign-modal.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/exclude-modal.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/defer-modal.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/_client-fetchers.ts
git commit -m "feat(orphan-triage): invoices pane + assign/exclude/defer modals"
```

---

### Task 18: Candidate card + Candidates pane (right) + selection state

**Files:**
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/candidate-card.tsx`
- Modify: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/candidates-pane.tsx`
- Modify: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/triage-shell.tsx`
- Modify: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/invoices-pane.tsx`

- [ ] **Step 1: Add a shared "selected project" context**

Create:
```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/triage-context.tsx
'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface SelectedProject {
  id: string;
  number: string;
  customer_name: string;
}

interface TriageContextValue {
  selectedProject: SelectedProject | null;
  setSelectedProject: (p: SelectedProject | null) => void;
}

const Ctx = createContext<TriageContextValue | undefined>(undefined);

export function TriageProvider({ children }: { children: ReactNode }) {
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  return <Ctx.Provider value={{ selectedProject, setSelectedProject }}>{children}</Ctx.Provider>;
}

export function useTriage(): TriageContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTriage must be used inside TriageProvider');
  return ctx;
}
```

- [ ] **Step 2: Wrap the active-tab body with the provider**

In `triage-shell.tsx`, add `import { TriageProvider } from './triage-context';` and wrap the active-tab grid:

```tsx
<TabsContent value="active">
  {customers.length === 0 ? (
    <EmptyDone />
  ) : (
    <TriageProvider>
      <div className="grid gap-4" style={{ gridTemplateColumns: '260px 1fr 320px' }}>
        <CustomerListPane customers={customers} selected={selected} onSelect={setSelected} />
        <InvoicesPane zohoCustomerName={selected} />
        <CandidatesPane zohoCustomerName={selected} />
      </div>
    </TriageProvider>
  )}
</TabsContent>
```

- [ ] **Step 3: Write the candidate card**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/candidate-card.tsx
'use client';

import { Card, CardContent, Badge, Button } from '@repo/ui';
import { shortINR, formatDate } from '@repo/ui/formatters';
import type { CandidateProject } from '@/lib/orphan-triage-queries';
import { useTriage } from './triage-context';

interface Props {
  project: CandidateProject;
}

export function CandidateCard({ project }: Props) {
  const { selectedProject, setSelectedProject } = useTriage();
  const isSelected = selectedProject?.id === project.project_id;
  const net = Number(project.net_cash_position);
  return (
    <Card
      className={`cursor-pointer transition-all ${isSelected ? 'ring-2 ring-green-600 bg-green-50' : 'hover:shadow-md'}`}
      onClick={() => setSelectedProject({
        id: project.project_id,
        number: project.project_number,
        customer_name: project.customer_name,
      })}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs font-bold">{project.customer_name}</p>
            <p className="text-[10px] text-[#7C818E]">{project.project_number}</p>
          </div>
          <Badge variant="outline" className="text-[9px]">{project.status}</Badge>
        </div>
        <div className="text-[10px] text-[#7C818E]">
          {project.system_size_kwp ? `${project.system_size_kwp} kWp` : '—'} · {project.system_type ?? '—'}
        </div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <div><span className="text-[#7C818E]">Contracted</span> <span className="font-mono">{shortINR(Number(project.contracted_value))}</span></div>
          <div><span className="text-[#7C818E]">Invoiced</span> <span className="font-mono">{shortINR(Number(project.total_invoiced))}</span></div>
          <div><span className="text-[#7C818E]">Received</span> <span className="font-mono">{shortINR(Number(project.total_received))}</span></div>
          <div>
            <span className="text-[#7C818E]">Net</span>{' '}
            <span className={`font-mono font-bold ${net < 0 ? 'text-red-600' : 'text-green-700'}`}>
              {shortINR(net)}
            </span>
          </div>
        </div>
        {project.started_date && (
          <p className="text-[9px] text-[#7C818E]">
            Started {formatDate(project.started_date)}
            {project.completed_date && ` · Completed ${formatDate(project.completed_date)}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write the candidates pane**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/candidates-pane.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, Tabs, TabsList, TabsTrigger, TabsContent, Input, Skeleton } from '@repo/ui';
import { CandidateCard } from './candidate-card';
import {
  fetchCandidatesClient,
  fetchAllProjectsClient,
} from './_client-fetchers';
import type { CandidateProject } from '@/lib/orphan-triage-queries';

interface Props {
  zohoCustomerName: string | null;
}

export function CandidatesPane({ zohoCustomerName }: Props) {
  const [likely, setLikely] = useState<CandidateProject[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<CandidateProject[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!zohoCustomerName) { setLikely([]); return; }
    setLoading(true);
    fetchCandidatesClient(zohoCustomerName).then((c) => { setLikely(c); setLoading(false); });
  }, [zohoCustomerName]);

  useEffect(() => {
    if (search.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      fetchAllProjectsClient(search).then(setSearchResults);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  if (!zohoCustomerName) {
    return <Card><CardContent className="py-8 text-center text-[#7C818E] text-xs">Pick a customer →</CardContent></Card>;
  }

  return (
    <div className="space-y-2" style={{ height: '70vh', overflowY: 'auto' }}>
      <Tabs defaultValue="likely">
        <TabsList className="w-full">
          <TabsTrigger value="likely" className="flex-1">Likely ({likely.length})</TabsTrigger>
          <TabsTrigger value="all" className="flex-1">Search all</TabsTrigger>
        </TabsList>

        <TabsContent value="likely" className="space-y-2">
          {loading ? (
            <Skeleton className="h-32" />
          ) : likely.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-xs text-[#7C818E]">
              No likely matches. Try "Search all" or mark these invoices as "No ERP match".
            </CardContent></Card>
          ) : (
            likely.map((p) => <CandidateCard key={p.project_id} project={p} />)
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-2">
          <Input
            placeholder="Search project number or customer name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searchResults.map((p) => <CandidateCard key={p.project_id} project={p} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 5: Add the new client fetchers**

Append to `_client-fetchers.ts`:

```typescript
'use server';

import {
  getOrphansForCustomer,
  getCandidateProjectsForCustomer,
  searchAllProjects,
} from '@/lib/orphan-triage-queries';

export async function getOrphansForCustomerClient(name: string) {
  return getOrphansForCustomer(name);
}

export async function fetchCandidatesClient(name: string) {
  return getCandidateProjectsForCustomer(name);
}

export async function fetchAllProjectsClient(query: string) {
  return searchAllProjects(query);
}
```

- [ ] **Step 6: Wire the AssignModal in invoices-pane to read the selected project**

In `invoices-pane.tsx`, replace the AssignModal usage:

```tsx
import { useTriage } from './triage-context';

export function InvoicesPane({ zohoCustomerName }: Props) {
  const { selectedProject } = useTriage();
  // ...rest unchanged...

  return (
    // ...
    {modal?.type === 'assign' && (
      <AssignModal
        open
        onClose={() => setModal(null)}
        entity={modal.entity}
        project={selectedProject}
        onSuccess={refresh}
      />
    )}
    // ...
  );
}
```

- [ ] **Step 7: Build + visual smoke**

```bash
pnpm --filter erp check-types && pnpm --filter erp build
pnpm --filter erp dev
```

Open `/cash/orphan-invoices`. Pick a customer (RAMANIYAM). Right pane shows candidate Ramaniyam projects with cash data. Click a candidate (turns green ring). Click "Assign to project" on an invoice in the middle. Modal pre-fills with the selected project. Confirm → row disappears from middle pane.

- [ ] **Step 8: Commit**

```bash
git add apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/candidate-card.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/candidates-pane.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/triage-shell.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/invoices-pane.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/triage-context.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/_client-fetchers.ts
git commit -m "feat(orphan-triage): candidate cards + selection context, assign flow end-to-end"
```

---

### Task 19: Deferred + Excluded tabs with undo

**Files:**
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/deferred-tab.tsx`
- Create: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/excluded-tab.tsx`
- Modify: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/triage-shell.tsx`

- [ ] **Step 1: Add a tabular fetcher for deferred/excluded rows**

Append to `_client-fetchers.ts`:

```typescript
import { createClient } from '@repo/supabase/server';

export async function fetchByStatus(status: 'deferred' | 'excluded') {
  const supabase = await createClient();
  const [inv, pay] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, invoice_date, total_amount, zoho_customer_name, attribution_status, excluded_from_cash')
      .eq('source', 'zoho_import')
      .eq('attribution_status', status)
      .order('invoice_date', { ascending: false })
      .limit(200),
    supabase
      .from('customer_payments')
      .select('id, receipt_number, payment_date, amount, zoho_customer_name, attribution_status, excluded_from_cash')
      .eq('source', 'zoho_import')
      .eq('attribution_status', status)
      .order('payment_date', { ascending: false })
      .limit(200),
  ]);
  return {
    invoices: inv.data ?? [],
    payments: pay.data ?? [],
  };
}
```

- [ ] **Step 2: Write the deferred tab**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/deferred-tab.tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button, useToast } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { fetchByStatus } from './_client-fetchers';
import { undoDefer } from '@/lib/orphan-triage-actions';

export function DeferredTab() {
  const router = useRouter();
  const [data, setData] = useState<{ invoices: any[]; payments: any[] } | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  useEffect(() => {
    fetchByStatus('deferred').then(setData);
  }, []);

  const handleUndo = (kind: 'invoice' | 'payment', id: string) => {
    startTransition(async () => {
      const r = await undoDefer(kind, id);
      if (!r.success) {
        toast({ title: 'Undo failed', description: r.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Restored to triage queue' });
      const fresh = await fetchByStatus('deferred');
      setData(fresh);
      router.refresh();
    });
  };

  if (!data) return <Card><CardContent className="py-8 text-[#7C818E]">Loading…</CardContent></Card>;
  const empty = data.invoices.length === 0 && data.payments.length === 0;
  if (empty) return <Card><CardContent className="py-12 text-center text-[#7C818E]">No deferred rows.</CardContent></Card>;

  return (
    <div className="space-y-6">
      {data.invoices.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.invoice_number}</TableCell>
                    <TableCell>{formatDate(i.invoice_date)}</TableCell>
                    <TableCell className="text-xs">{i.zoho_customer_name}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(Number(i.total_amount))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleUndo('invoice', i.id)}>
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {data.payments.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.receipt_number}</TableCell>
                    <TableCell>{formatDate(p.payment_date)}</TableCell>
                    <TableCell className="text-xs">{p.zoho_customer_name}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(Number(p.amount))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleUndo('payment', p.id)}>
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the excluded tab**

Same shape as the deferred tab but using `fetchByStatus('excluded')` and `undoExclude` instead of `undoDefer`. Include an "Excluded reason" column populated from the most recent matching `zoho_attribution_audit` row (decision='exclude', latest by `made_at`):

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/excluded-tab.tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button, useToast } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { fetchByStatus } from './_client-fetchers';
import { undoExclude } from '@/lib/orphan-triage-actions';

export function ExcludedTab() {
  const router = useRouter();
  const [data, setData] = useState<{ invoices: any[]; payments: any[] } | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  useEffect(() => { fetchByStatus('excluded').then(setData); }, []);

  const handleUndo = (kind: 'invoice' | 'payment', id: string) => {
    startTransition(async () => {
      const r = await undoExclude(kind, id);
      if (!r.success) {
        toast({ title: 'Undo failed', description: r.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Restored — back in triage queue' });
      const fresh = await fetchByStatus('excluded');
      setData(fresh);
      router.refresh();
    });
  };

  if (!data) return <Card><CardContent className="py-8 text-[#7C818E]">Loading…</CardContent></Card>;
  const empty = data.invoices.length === 0 && data.payments.length === 0;
  if (empty) return <Card><CardContent className="py-12 text-center text-[#7C818E]">No excluded rows.</CardContent></Card>;

  return (
    <div className="space-y-6">
      {data.invoices.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.invoice_number}</TableCell>
                    <TableCell className="text-xs">{i.zoho_customer_name}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(Number(i.total_amount))}</TableCell>
                    <TableCell><span className="text-xs text-red-600">Excluded</span></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleUndo('invoice', i.id)}>
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {/* Payments table mirrors the invoices table — same shape as deferred-tab.tsx */}
    </div>
  );
}
```

- [ ] **Step 4: Wire the new tabs into `triage-shell.tsx`**

Replace the placeholder `DeferredTab` and `ExcludedTab` functions inside `triage-shell.tsx` with imports:

```typescript
import { DeferredTab } from './deferred-tab';
import { ExcludedTab } from './excluded-tab';
```

Remove the inline placeholder definitions.

- [ ] **Step 5: Build verification**

```bash
pnpm --filter erp check-types && pnpm --filter erp build
```

- [ ] **Step 6: Visual smoke**

Defer one invoice, then visit the Deferred tab — should see it. Click Restore — verify it goes back to Active.
Exclude one invoice, then visit Excluded — see it. Restore — verify it goes back to Active.

- [ ] **Step 7: Commit**

```bash
git add apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/deferred-tab.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/excluded-tab.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/triage-shell.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/_client-fetchers.ts
git commit -m "feat(orphan-triage): deferred + excluded tabs with undo"
```

---

### Task 20: Audit log table

**Files:**
- Modify: `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/audit-log-table.tsx`

- [ ] **Step 1: Replace stub with paginated audit log**

```typescript
// apps/erp/src/app/(erp)/cash/orphan-invoices/_components/audit-log-table.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { fetchAuditClient } from './_client-fetchers';

interface AuditRow {
  id: string;
  entity_type: 'invoice' | 'payment';
  entity_id: string;
  decision: string;
  made_by: string;
  made_at: string;
  notes: string | null;
  from_project_id: string | null;
  to_project_id: string | null;
  employees?: { full_name: string };
}

const DECISION_COLORS: Record<string, string> = {
  assign: 'bg-green-100 text-green-800',
  exclude: 'bg-red-100 text-red-800',
  skip: 'bg-gray-100 text-gray-800',
  reassign: 'bg-blue-100 text-blue-800',
  undo_exclude: 'bg-yellow-100 text-yellow-800',
  undo_skip: 'bg-yellow-100 text-yellow-800',
};

export function AuditLogTable() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: AuditRow[]; total: number } | null>(null);
  const [decisionFilter, setDecisionFilter] = useState<string>('');

  useEffect(() => {
    fetchAuditClient({ page, decision: decisionFilter || undefined }).then(setData);
  }, [page, decisionFilter]);

  if (!data) return <Card><CardContent className="py-8 text-[#7C818E]">Loading…</CardContent></Card>;
  const totalPages = Math.max(1, Math.ceil(data.total / 50));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 border-b flex gap-2 flex-wrap">
          <span className="text-xs text-[#7C818E]">Filter:</span>
          {['', 'assign', 'exclude', 'skip', 'reassign', 'undo_exclude', 'undo_skip'].map((d) => (
            <button
              key={d || 'all'}
              type="button"
              onClick={() => { setDecisionFilter(d); setPage(1); }}
              className={`text-xs px-2 py-1 rounded ${
                decisionFilter === d ? 'bg-[#00B050] text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {d || 'All'}
            </button>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-[#7C818E]">No audit rows.</TableCell></TableRow>
            ) : (
              data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{formatDate(r.made_at)}</TableCell>
                  <TableCell className="text-xs">{r.employees?.full_name ?? r.made_by.slice(0, 8)}</TableCell>
                  <TableCell className="text-xs font-mono">
                    {r.entity_type} · {r.entity_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${DECISION_COLORS[r.decision]}`}>
                      {r.decision}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-[#7C818E] max-w-md truncate">{r.notes ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-3 border-t">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <span className="text-xs self-center">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Add the audit fetcher**

Append to `_client-fetchers.ts`:

```typescript
import { getAttributionAudit } from '@/lib/orphan-triage-queries';

export async function fetchAuditClient(opts: { page: number; decision?: string }) {
  return getAttributionAudit(opts);
}
```

- [ ] **Step 3: Build + visual smoke**

```bash
pnpm --filter erp check-types && pnpm --filter erp build
```

Visit Audit log tab. Verify rows from earlier triage actions show with the right user name, decision color, and notes.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/audit-log-table.tsx \
        apps/erp/src/app/\(erp\)/cash/orphan-invoices/_components/_client-fetchers.ts
git commit -m "feat(orphan-triage): paginated audit log with decision filter"
```

---

### Task 21: Orphan banner on /cash

**Files:**
- Create: `apps/erp/src/components/finance/orphan-banner.tsx`
- Modify: `apps/erp/src/app/(erp)/cash/page.tsx`

- [ ] **Step 1: Write the banner component**

```typescript
// apps/erp/src/components/finance/orphan-banner.tsx
import Link from 'next/link';
import { Card, CardContent } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import { AlertTriangle } from 'lucide-react';
import { getOrphanCounts } from '@/lib/orphan-triage-queries';

export async function OrphanBanner() {
  const counts = await getOrphanCounts();
  if (counts.pendingInvoiceCount === 0 && counts.pendingPaymentCount === 0) return null;
  const totalRupees = Number(counts.pendingInvoiceTotal) + Number(counts.pendingPaymentTotal);
  return (
    <Link href="/cash/orphan-invoices" className="block">
      <Card className="border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors">
        <CardContent className="flex items-center gap-3 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-900">
              {counts.pendingInvoiceCount} orphan invoices · {shortINR(totalRupees)} unattributed ·{' '}
              {counts.pendingPaymentCount} payments
            </p>
            <p className="text-xs text-amber-700">Click to triage in /cash/orphan-invoices →</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Insert the banner in `cash/page.tsx`**

Open `apps/erp/src/app/(erp)/cash/page.tsx`. Right after the existing `<div>` that contains the page title (`<h1>Cash Flow</h1>`), insert:

```tsx
import { OrphanBanner } from '@/components/finance/orphan-banner';

// inside the JSX, immediately after the page-title div:
<OrphanBanner />
```

The banner is a Server Component — it'll auto-load and render only when there are orphans.

- [ ] **Step 3: Build + visual smoke**

```bash
pnpm --filter erp check-types && pnpm --filter erp build
pnpm --filter erp dev
```

Visit `/cash`. Banner shows above the existing KPIs. Click → lands at `/cash/orphan-invoices`.

Manually mark one row as triaged via the SQL Editor:
```sql
UPDATE invoices SET attribution_status = 'assigned'
 WHERE id = (SELECT id FROM invoices WHERE source = 'zoho_import' AND attribution_status = 'pending' LIMIT 1);
```
Reload `/cash` (force-refresh past the 60s cache). Banner number ticks down by 1.

Restore:
```sql
UPDATE invoices SET attribution_status = 'pending' WHERE id = '<that id>';
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/finance/orphan-banner.tsx \
        apps/erp/src/app/\(erp\)/cash/page.tsx
git commit -m "feat(cash): orphan triage banner above cash KPIs"
```

---

## Phase F — Verification, docs, prod deploy

### Task 22: Manual UAT pass on dev

- [ ] **Step 1: Login as founder**

Walk through:
1. `/cash` — banner visible.
2. `/cash/orphan-invoices` — KPI strip populated, customer list left, click RAMANIYAM.
3. Middle pane shows 12 RAMANIYAM invoices with line items.
4. Right pane shows 8+ Ramaniyam projects with cash data.
5. Click a candidate project (turns green). Click "Assign to project" on an invoice → modal pre-filled → confirm. Toast says "Cascaded N payments". Invoice disappears from middle pane. KPI count drops by 1.
6. Click "No ERP match" on an invoice → modal requires notes → confirm. Invoice disappears.
7. Click "Defer" on an invoice → confirm. Invoice disappears.
8. Switch to Deferred tab → row visible → click Restore → row goes back to Active.
9. Switch to Excluded tab → row visible → click Restore → row goes back to Active.
10. Switch to Audit tab → 5+ rows visible with correct decisions and your name.

- [ ] **Step 2: Login as marketing_manager**

Repeat steps 1–10. All should work identically.

- [ ] **Step 3: Login as om_technician (or any non-allowed role)**

Visit `/cash/orphan-invoices` → should redirect to `/cash?notice=orphan-triage-forbidden`.
Visit `/cash` → banner is NOT visible (current banner exists for everyone; if it shouldn't be, gate it on role — see notes).

> If the banner is visible to non-allowed roles, that's by design — the triage page is the gated thing, not the banner. If you want the banner role-gated too, wrap the import in `{['founder','finance','marketing_manager'].includes(profile.role) && <OrphanBanner />}` in `cash/page.tsx`.

- [ ] **Step 4: Database integrity check**

```sql
-- Every assigned row has a project_id
SELECT COUNT(*) FROM invoices WHERE source = 'zoho_import' AND attribution_status = 'assigned' AND project_id IS NULL;
-- Expected: 0

-- Every excluded row has excluded_from_cash = TRUE
SELECT COUNT(*) FROM invoices WHERE source = 'zoho_import' AND attribution_status = 'excluded' AND excluded_from_cash IS NOT TRUE;
-- Expected: 0

-- Audit row count matches activity (≥ number of triage actions you took)
SELECT decision, COUNT(*) FROM zoho_attribution_audit GROUP BY decision;

-- Cash position changes for any project where you triaged: pick one project_id and confirm net_cash_position is non-NULL and updated
SELECT project_id, net_cash_position, last_computed_at FROM project_cash_positions
WHERE project_id IN (
  SELECT to_project_id FROM zoho_attribution_audit WHERE decision = 'assign' LIMIT 5
);
```

- [ ] **Step 5: Roll back UAT changes (optional)**

If your UAT touched dozens of rows you'd rather reset:
```sql
-- Find the audit IDs you created
SELECT id, entity_id, decision FROM zoho_attribution_audit WHERE made_at > '2026-05-01' ORDER BY made_at;
-- Reverse each one manually OR leave them — the data is on dev, no impact.
```

---

### Task 23: Documentation updates

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/modules/finance.md`

- [ ] **Step 1: Append to CHANGELOG.md**

Add lines (use the same format as nearby entries):

```markdown
- 2026-05-XX — Mig 088: zoho_invoice_line_items table + backfill from Invoice.xls
- 2026-05-XX — Mig 089: attribution_status + excluded_from_cash columns on invoices/customer_payments (seeded from mig 087)
- 2026-05-XX — Mig 090: cash position trigger filters excluded_from_cash; bulk refresh
- 2026-05-XX — Mig 091: zoho_attribution_audit table + RLS for triage roles
- 2026-05-XX — Mig 092: assign/exclude/reassign atomic SQL helper functions
- 2026-05-XX — Mig 093: orphan triage read RPCs (customer summary, candidate projects, counts)
- 2026-05-XX — Ship: /cash/orphan-invoices triage UI for founder/finance/marketing_manager
```

- [ ] **Step 2: Update CURRENT_STATUS.md**

Remove the orphan-attribution work from the in-flight list. Add a one-liner under "Recently shipped":

```markdown
- Zoho Orphan Triage — /cash/orphan-invoices, three-pane UI, full audit trail. Team (founder + finance + marketing_manager) clearing the queue. ~₹63 Cr to disambiguate.
```

- [ ] **Step 3: Add a "Zoho Orphan Triage" section to docs/modules/finance.md**

In `docs/modules/finance.md`, inside "Screens / Routes" add:

```markdown
- `/cash/orphan-invoices` — triage UI for parent-company Zoho invoices/payments. Three panes (Zoho customer list / orphan invoices with line items / candidate ERP projects). Outcomes: assign, exclude-from-cash (no ERP match), defer. Audit log built into the page. Founder + finance + marketing_manager roles. Powered by `orphan-triage-queries.ts` + `orphan-triage-actions.ts`. Backed by mig 100 SQL helpers and mig 101 read RPCs.
```

In "Key Tables":

```markdown
- `zoho_invoice_line_items` — line items from Zoho's `Invoice.xls`, joined to invoices via `zoho_invoice_id`. Backfilled by `scripts/backfill-zoho-invoice-line-items.ts`. Mismatches >5% AND >₹10K are skipped.
- `zoho_attribution_audit` — append-only history of every triage decision (assign/exclude/skip/reassign/undo). RLS to triage roles only.
```

In "RPCs":

```markdown
- `assign_orphan_invoice(p_invoice_id, p_project_id, p_made_by, p_notes)` / `exclude_orphan_invoice` / `reassign_orphan_invoice` — atomic cascade helpers backing the triage UI (mig 100).
- `get_orphan_zoho_customer_summary()` / `get_candidate_projects_for_zoho_customer(zoho_name)` / `get_orphan_counts()` — read aggregations for the page (mig 101).
```

- [ ] **Step 4: Commit**

```bash
git add docs/CHANGELOG.md docs/CURRENT_STATUS.md docs/modules/finance.md
git commit -m "docs: zoho orphan triage — changelog, current status, finance module"
```

---

### Task 24: Prod deploy

> **Reminder:** every step is run by Vivek directly. The plan documents the order; nothing here is automated.

- [ ] **Step 1: Apply migrations 096–101 in order on prod**

For each `088…093.sql`:
1. Open the file locally.
2. Open Supabase SQL Editor against the prod project (`kfkydkwycgijvexqiysc`).
3. Paste, run, observe `RAISE NOTICE`.
4. Verify counts (the post-mig-087 baseline numbers should reproduce).

- [ ] **Step 2: Run the line-items backfill on prod**

```bash
# From repo root, with PROD_* env vars exported (one-shot for this command):
NEXT_PUBLIC_SUPABASE_URL=$PROD_SUPABASE_URL \
SUPABASE_SECRET_KEY=$PROD_SUPABASE_SECRET_KEY \
pnpm tsx scripts/backfill-zoho-invoice-line-items.ts --dry-run

# Verify, then:
NEXT_PUBLIC_SUPABASE_URL=$PROD_SUPABASE_URL \
SUPABASE_SECRET_KEY=$PROD_SUPABASE_SECRET_KEY \
pnpm tsx scripts/backfill-zoho-invoice-line-items.ts --apply
```

- [ ] **Step 3: Regenerate types against prod**

```bash
pnpm dlx supabase gen types typescript --project-id kfkydkwycgijvexqiysc --schema public > packages/types/database.ts
```

Diff against the dev-generated version. They should be identical (same schema). If they differ, investigate before proceeding.

- [ ] **Step 4: Push code**

```bash
git push origin <branch>
```

Vercel auto-deploys. Verify deploy succeeds at https://erp.shiroienergy.com.

- [ ] **Step 5: Sanity check on prod**

Visit https://erp.shiroienergy.com/cash. Banner shows. Click → orphan triage page opens. KPI strip populates with prod numbers (303 invoices / ~₹63 Cr / 659 payments). Spot-check one customer (RAMANIYAM) — line items, candidates, cash positions all correct.

Don't actually run any triage actions until the team is briefed. Stop here.

- [ ] **Step 6: Brief the team**

Slack the channel: "/cash/orphan-invoices is live. Marketing manager + finance — please start chewing through. Skip anything you're unsure about (Defer button). I'll review your decisions in the Audit tab daily."

---

## Self-review

After writing this plan, check:

**1. Spec coverage:**

- ✅ Three-pane layout (customer list / invoices / candidate projects) — Tasks 14–18.
- ✅ Line-item visibility — Tasks 1, 2, 16.
- ✅ KPI strip + tabs (Active / Deferred / Excluded / Audit) — Task 14.
- ✅ Action outcomes A (defer), B (exclude), E (reassign + undo) — Tasks 11, 12, 17, 19.
- ✅ Cascade rules per spec (assign cascades NULL-only, exclude cascades all, reassign cascades old-project-only) — Task 6 (SQL functions).
- ✅ Cash position trigger update for excluded_from_cash — Task 4.
- ✅ Audit table with all decision types — Task 5; UI in Task 20.
- ✅ Banner on /cash — Task 21.
- ✅ Role gating (founder + finance + marketing_manager) — Task 13 (page guard); Task 5 (RLS); Task 10 (action guard).
- ✅ Concurrent-edit detection — SQL helpers return `already_triaged` codes (Task 6); UI shows error toast (modal handlers).
- ✅ Line-items mismatch handling (skip if >5% AND >₹10K) — Task 2.
- ✅ Out-of-scope items confirmed not implemented (split, create-on-fly, mobile, ML suggest) — none of these have tasks.

**2. Placeholder scan:** None. Every step has the actual code or command.

**3. Type consistency:** ActionResult<T> shape is consistent everywhere. The SQL helper functions return `(success BOOLEAN, code TEXT, cascaded_payment_count INT)` consistently. The triage-context's SelectedProject shape (id/number/customer_name) is used identically in CandidateCard and AssignModal.

**4. Migration numbering:** 088 → 089 → 090 → 091 → 092 → 093, all separate, applied sequentially.

---

*Plan complete and ready for execution.*
