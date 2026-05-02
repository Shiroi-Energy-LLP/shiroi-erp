# Proposal financial corruption — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 130-proposal `total_after_discount` corruption (BOM extraction picked up wrong files from co-mingled lead folders) without re-introducing it on next BOM run.

**Architecture:** Two-phase rollout. Phase 1 lands the importer guardrails (`excel-parser.ts`, `extract-bom-all-unprocessed.ts`, `migrate-hubspot.ts`) with no DB changes — safe to merge alone. Phase 2 lands schema columns (`financials_invalidated`, `system_size_uncertain`), the Tier A reset migration, the AI re-extraction recovery for Tier B, the DB CHECK constraint, and the UI banner. Phase 3 (HubSpot re-import) is a separate plan once Vivek delivers the cleaned CSV.

**Tech Stack:** TypeScript, Next.js 14 App Router, Supabase Postgres + Edge, ExcelJS, Anthropic SDK (Claude Sonnet 4), shadcn/ui, Tailwind, decimal.js (already in repo).

**Companion design doc:** `docs/superpowers/plans/2026-04-26-proposal-financial-corruption-recovery.md`

---

## File map

### Phase 1 — Importer fixes (PR 1)
- Modify: `scripts/excel-parser.ts` — add per-kWp sanity check, reject obviously-not-a-line BOM rows
- Modify: `scripts/extract-bom-all-unprocessed.ts:198` — require filename token to match customer name in direct-folder strategy
- Modify: `scripts/migrate-hubspot.ts:1152` — sanity check `Total Project Value` against system size
- Create: `scripts/__tests__/excel-parser.test.ts` — Vitest tests for the new guardrails
- Modify: `package.json` (root or scripts/) — wire vitest if not already

### Phase 2 — Schema + data migration + UI banner (PR 2)
- Create: `supabase/migrations/087_proposal_data_quality_flags.sql`
- Create: `supabase/migrations/088_reset_corrupted_proposal_financials.sql`
- Create: `supabase/migrations/088b_apply_tier_b_reextractions.sql` (generated from script output, may be empty if zero recoverables)
- Create: `supabase/migrations/089_proposal_total_sanity_constraint.sql`
- Modify: `packages/types/database.ts` — regenerate via supabase CLI (mandatory per CLAUDE.md)
- Create: `apps/erp/src/components/proposal-data-quality-banner.tsx`
- Modify: `apps/erp/src/app/(erp)/proposals/[id]/page.tsx` — render banner
- Modify: `apps/erp/src/app/(erp)/sales/[id]/page.tsx` — render banner (verify exact path; check `apps/erp/src/app/(erp)/sales/[id]/` exists)
- Run: `scripts/ai-reextract-tier-b.ts` (worktree-local; the source is already complete and waiting)

### Phase 3 — HubSpot re-import (PR 3, separate plan)
- Stub only: not in this plan. See "Phase 3 stub" at the bottom.

---

# Phase 1 — Importer fixes (PR 1)

This phase ships standalone, no data changes. Merging it before Phase 2 prevents the next BOM extraction run from re-corrupting data Phase 2 cleans up.

## Task 1.1: Add per-kWp sanity check to `parseCostingSheet`

**Files:**
- Modify: `scripts/excel-parser.ts:357-422` (the body of `parseCostingSheet`)

**Why:** Today the parser blindly accepts whatever total it sees in summary cells or sums from BOM lines, including ₹980 billion outputs. A per-kWp ceiling stops that at the parser boundary.

- [ ] **Step 1: Read current `parseCostingSheet` and locate the return statement**

Run: `grep -n "return {" scripts/excel-parser.ts`
Expected: matches around line 415 — the final return.

- [ ] **Step 2: Add the sanity check before the return**

In `scripts/excel-parser.ts`, replace the block from the comment `// If no total from summary, calculate from BOM lines` down to but not including `// Determine parse quality`:

```ts
  // If no total from summary, calculate from BOM lines
  if (!summary.total_cost && bestLines.length > 0) {
    summary.total_cost = bestLines.reduce((sum, l) => sum + l.total_price, 0);
  }

  // SANITY CHECK — see docs/superpowers/plans/2026-04-30-proposal-corruption-implementation.md
  // Real Shiroi installs cap out around ₹2L/kWp (premium hybrid + battery).
  // ₹5L/kWp is already implausible. Reject anything beyond as a wrong-file extraction
  // (capex summary mistaken for BOM, multi-project pricing matrix, etc.).
  const MAX_PLAUSIBLE_PER_KWP = 500_000;
  if (systemSize && systemSize > 0 && summary.total_cost) {
    const perKwp = summary.total_cost / systemSize;
    if (perKwp > MAX_PLAUSIBLE_PER_KWP) {
      console.warn(
        `[excel-parser] Rejecting summary: ₹${summary.total_cost} for ${systemSize} kWp ` +
        `= ₹${Math.round(perKwp)}/kWp > ₹${MAX_PLAUSIBLE_PER_KWP}/kWp ceiling. Likely wrong file.`,
      );
      summary.supply_cost = null;
      summary.installation_cost = null;
      summary.gst_supply = null;
      summary.gst_installation = null;
      summary.total_cost = null;
      bestLines = []; // discard the contaminating lines too
      bestSheetName = '';
    }
  }
```

- [ ] **Step 3: Run dry-imports against a known good BOM and a known bad BOM**

Run: `npx tsx scripts/excel-parser.ts --self-test 2>&1 | head -20` — but this script has no self-test. Skip; rely on the unit tests in Task 1.4.

## Task 1.2: Reject not-a-line-item BOM rows

**Files:**
- Modify: `scripts/excel-parser.ts` — `parseBOMSheet`, the loop body

**Why:** The corruption traces to rows like `"Cost /KW in Rs"` with `qty=197,211` and `unit_price=₹66,832` being accepted as line items. Add structural rejections.

- [ ] **Step 1: Locate the line-acceptance check**

Run: `grep -n "effectiveAmount" scripts/excel-parser.ts`
Expected: matches around line 269 (`const effectiveAmount = totalVal || amount || (qty * rate);`) and line 270 (`if (effectiveAmount <= 0) continue;`).

- [ ] **Step 2: Add reject conditions immediately after the existing `effectiveAmount` check**

In `scripts/excel-parser.ts`, in `parseBOMSheet`, replace:

```ts
    // Must have some numeric value to be a BOM line
    const effectiveAmount = totalVal || amount || (qty * rate);
    if (effectiveAmount <= 0) continue;

    // Skip if description is just a number (like "Cost Per Watt" followed by value)
    if (/^cost\s*per\s*watt$/i.test(desc)) continue;
```

with:

```ts
    // Must have some numeric value to be a BOM line
    const effectiveAmount = totalVal || amount || (qty * rate);
    if (effectiveAmount <= 0) continue;

    // Skip if description is just a number (like "Cost Per Watt" followed by value)
    if (/^cost\s*per\s*watt$/i.test(desc)) continue;

    // Reject capex-summary or pricing-matrix rows masquerading as line items.
    // Symptoms (from corruption analysis 2026-04-30):
    //   - "Cost /KW in Rs", "Cost per kW", "Total Project Value" etc. appearing
    //     in the description column with huge qty/unit_price.
    //   - "Unnamed item" (description is empty/whitespace) but with ₹crore-scale total.
    if (/^cost\s*\/?\s*kw|^cost\s*per\s*kw|^total\s*project|^grand\s*total|^project\s*cost/i.test(desc)) continue;
    if ((!desc || desc.trim().length === 0) && effectiveAmount > 5_000_000) continue; // empty desc + > ₹50L = sus
    // No real residential line item is > ₹50L; commercial rarely > ₹2Cr per line.
    if (effectiveAmount > 50_000_000) {
      console.warn(`[excel-parser] Skipping line with implausible total ₹${effectiveAmount}: "${desc.slice(0, 80)}"`);
      continue;
    }
```

- [ ] **Step 3: Commit**

```bash
git add scripts/excel-parser.ts
git commit -m "feat(scripts): reject implausible BOM lines and parser totals

The Excel BOM parser was accepting capex-summary rows and pricing-matrix
totals as if they were per-line items, contributing to the corruption
documented in docs/superpowers/plans/2026-04-30-proposal-corruption-implementation.md.

Add three guardrails:
- Reject parsed total when per-kWp > ₹5L (the ceiling is generous; anything
  beyond is a wrong-file extraction).
- Reject BOM rows whose description matches capex-summary patterns
  (Cost /KW, Cost per kW, Total Project Value, etc.).
- Reject empty-description rows with > ₹50L total, and any row with > ₹5Cr total."
```

## Task 1.3: Stricter file matching in `extract-bom-all-unprocessed.ts`

**Files:**
- Modify: `scripts/extract-bom-all-unprocessed.ts:196-220` (direct-folder strategy)

**Why:** The lead folder for "Agro Hyto-Sundar" contains `costing_200_kW.xlsx` (a 200 kW BOOT project). Today the script accepts that file because it's in the right folder UUID. Require the filename to mention the customer.

- [ ] **Step 1: Read the direct-folder strategy block**

Run: `grep -n "Strategy 1: Direct lead_id match" scripts/extract-bom-all-unprocessed.ts`
Expected: matches around line 197.

- [ ] **Step 2: Add a customer-name token requirement**

In `scripts/extract-bom-all-unprocessed.ts`, replace the body of the direct-match strategy block (from the comment `// Strategy 1: Direct lead_id match` to its closing brace). Show the exact lines first:

Run: `sed -n '195,225p' scripts/extract-bom-all-unprocessed.ts`

Then replace with:

```ts
      // Strategy 1: Direct lead_id match (folder = project's lead)
      if (file.folder_id === target.lead_id) {
        // Tightened 2026-04-30: a costing/BOM file in this folder is only trusted
        // if its filename contains a customer-name token of length ≥ 4. Lead folders
        // commonly contain unrelated files from co-mingled Google Drive imports.
        const customerTokens = target.name_tokens.filter(t => t.length >= 4);
        const fileTokens = tokenize(file.filename);
        const filenameMatchesCustomer =
          customerTokens.length === 0
            ? true // no customer name available → fall back to old behaviour rather than reject
            : customerTokens.some(t => fileTokens.some(ft => ft.includes(t) || t.includes(ft)));
        if (!filenameMatchesCustomer) continue; // skip — wrong customer's file in this folder

        // Prefer costing/BOM files
        const isCostingFile = /costing|bom|cost/i.test(file.filename);
```

(The closing brace remains as in the original — only the body is augmented with the `filenameMatchesCustomer` gate.)

- [ ] **Step 3: Commit**

```bash
git add scripts/extract-bom-all-unprocessed.ts
git commit -m "feat(scripts): require filename to match customer name for BOM extraction

Lead folders commonly contain files from unrelated customers (artifact of
the Google Drive import). Without a filename match, an arbitrary
'costing_200_kW.xlsx' in a 4 kWp residential lead's folder gets parsed
as that lead's BOM. Require at least one customer-name token (≥4 chars)
to appear in the filename before trusting a costing/BOM file in the
direct-folder strategy."
```

## Task 1.4: Validate `Total Project Value` in HubSpot importer

**Files:**
- Modify: `scripts/migrate-hubspot.ts:1147-1175` (the won-deal proposal insert)

**Why:** 63 of 144 HubSpot-migrated proposals carry implausible totals from the source CSV. Block the bad ones at import time so re-runs don't reintroduce them.

- [ ] **Step 1: Locate the proposal insert block**

Run: `grep -n "totalProjectValue = parseAmount" scripts/migrate-hubspot.ts`
Expected: matches around line 1152.

- [ ] **Step 2: Add the sanity check**

In `scripts/migrate-hubspot.ts`, find:

```ts
        const totalProjectValue = parseAmount(deal['Total Project Value']) ?? 0;
        const systemSizeKwp = sizeKwp ?? 5; // Default 5 kWp if unknown
```

Replace with:

```ts
        let totalProjectValue = parseAmount(deal['Total Project Value']) ?? 0;
        const systemSizeKwp = sizeKwp ?? 5; // Default 5 kWp if unknown

        // Sanity check: HubSpot's Total Project Value is unreliable for some deals.
        // Anything > ₹5L/kWp is implausible. Drop the value and note it; the row
        // will surface in the UI banner as "needs re-quote".
        const MAX_PLAUSIBLE_PER_KWP = 500_000;
        let droppedTpvNote: string | null = null;
        if (totalProjectValue > systemSizeKwp * MAX_PLAUSIBLE_PER_KWP) {
          droppedTpvNote = `Original HubSpot TPV ₹${totalProjectValue} dropped — implausible for ${systemSizeKwp} kWp.`;
          console.warn(`${op} ${droppedTpvNote} Deal: "${dealName}" (${dealId})`);
          totalProjectValue = 0;
        }
```

- [ ] **Step 3: Append the note to the proposal `notes` field**

Find the existing `notes:` line in `proposalInsert` (around line 1170):

```ts
          notes: `[HubSpot Migration] Won deal imported. PV: ${pvInfo ? `PV${pvInfo.pvNumber}/${pvInfo.fy}` : 'N/A'}`,
```

Replace with:

```ts
          notes: [
            `[HubSpot Migration] Won deal imported. PV: ${pvInfo ? `PV${pvInfo.pvNumber}/${pvInfo.fy}` : 'N/A'}`,
            droppedTpvNote ? `[Sanity check] ${droppedTpvNote}` : null,
          ].filter(Boolean).join(' | '),
```

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-hubspot.ts
git commit -m "feat(scripts): drop implausible HubSpot Total Project Value at import time

About 63 of 144 HubSpot-migrated proposals carry implausibly high TPVs
(> ₹5L/kWp). Without a sanity check, re-running the importer would
reintroduce the same corruption Phase 2 cleans up. Drop the value and
record the rejection in the proposal's notes field."
```

## Task 1.5: Add Vitest tests for the parser guardrails

**Files:**
- Create: `scripts/__tests__/excel-parser.test.ts`
- Modify: `package.json` (or `scripts/package.json`) — verify Vitest is installed; if not, install it

**Why:** Without a test, the next refactor of `excel-parser.ts` could remove the guardrails silently.

- [ ] **Step 1: Verify Vitest is available**

Run: `pnpm -w list vitest 2>&1 | head -5` (or `pnpm list vitest --depth=0`)
Expected: shows a version. If not installed:

Run: `pnpm add -DW vitest`

- [ ] **Step 2: Create the test file**

Create `scripts/__tests__/excel-parser.test.ts`:

```ts
/**
 * Sanity-check tests for excel-parser.ts. We're not testing the full BOM-shape
 * extraction here — just the guardrails added in 2026-04-30 to stop the
 * proposal-financial-corruption regression from ever reappearing.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseCostingSheet } from '../excel-parser';

async function bookToBuffer(book: ExcelJS.Workbook): Promise<Buffer> {
  const arr = await book.xlsx.writeBuffer();
  return Buffer.from(arr);
}

describe('parseCostingSheet sanity checks', () => {
  it('rejects a parsed total > ₹5L/kWp', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Detailed BOM');
    sheet.addRow(['System Size', '4 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    // 1 row × ₹100 Cr — way above 4 kWp × ₹5L/kWp = ₹20L ceiling.
    sheet.addRow([1, 'Solar Panels', 1, 1_000_000_000, 1_000_000_000]);

    const summary = await bookToBuffer(book);
    const result = await parseCostingSheet(summary);

    expect(result.summary.total_cost).toBeNull();
    expect(result.bom_lines).toHaveLength(0);
  });

  it('keeps a reasonable total intact (₹2L/kWp ≈ premium hybrid)', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Detailed BOM');
    sheet.addRow(['System Size', '5 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    // Total ~₹10L for 5 kWp = ₹2L/kWp = OK
    sheet.addRow([1, 'Solar Panels 550 Wp', 10, 25_000, 250_000]);
    sheet.addRow([2, 'Inverter 5kW Hybrid', 1, 500_000, 500_000]);
    sheet.addRow([3, 'Battery 5 kWh', 1, 250_000, 250_000]);

    const buffer = await bookToBuffer(book);
    const result = await parseCostingSheet(buffer);

    expect(result.bom_lines.length).toBeGreaterThanOrEqual(3);
    expect(result.summary.total_cost).toBeGreaterThan(0);
    expect(result.summary.total_cost).toBeLessThan(2_000_000); // < ₹20L sanity
  });

  it('skips capex-summary rows masquerading as line items', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Detailed BOM');
    sheet.addRow(['System Size', '10 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    sheet.addRow([1, 'Solar Panels', 20, 12_000, 240_000]);
    // Capex summary rows that historically broke the parser:
    sheet.addRow([2, 'Cost /KW in Rs', 197_211, 66_832, 13_180_140_000_000]);
    sheet.addRow([3, '', 680_000, 761_600, 517_888_000_000]);

    const buffer = await bookToBuffer(book);
    const result = await parseCostingSheet(buffer);

    // Only the panel row should survive.
    expect(result.bom_lines).toHaveLength(1);
    expect(result.bom_lines[0].item_description.toLowerCase()).toContain('solar panels');
  });

  it('skips empty-description rows with > ₹50L total', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('BOM');
    sheet.addRow(['System Size', '5 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    sheet.addRow([1, 'Panels', 10, 25_000, 250_000]);
    sheet.addRow([2, '', 100_000, 1_000, 100_000_000]); // ₹10Cr empty-desc → reject

    const buffer = await bookToBuffer(book);
    const result = await parseCostingSheet(buffer);

    expect(result.bom_lines).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the tests; expect them to PASS (the guardrails from 1.1/1.2 should already make them pass)**

Run: `pnpm vitest run scripts/__tests__/excel-parser.test.ts`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/__tests__/excel-parser.test.ts package.json pnpm-lock.yaml
git commit -m "test(scripts): cover excel-parser corruption guardrails

Four tests cover the regression cases from the 2026-04-30 corruption
analysis: per-kWp ceiling, capex-summary row rejection, empty-description
row rejection, and the happy path for a real BOM."
```

## Task 1.6: Open PR 1

- [ ] **Step 1: Verify the branch state**

Run: `git status && git log --oneline -5`
Expected: clean working tree, the four commits from Tasks 1.1–1.5 on top.

- [ ] **Step 2: Push and open the PR**

Run:
```bash
git push -u origin HEAD
gh pr create --title "fix(scripts): add corruption guardrails to BOM/HubSpot importers" --body "$(cat <<'EOF'
## Summary
- `excel-parser.ts`: reject parsed totals > ₹5L/kWp and BOM rows that look like capex-summary cells
- `extract-bom-all-unprocessed.ts`: require filename to mention customer name in direct-folder strategy
- `migrate-hubspot.ts`: drop implausible HubSpot Total Project Value at import time
- Vitest coverage for the parser guardrails

## Why
Investigation in `docs/superpowers/plans/2026-04-26-proposal-financial-corruption-recovery.md` traced the proposal-total corruption (130 proposals, up to ₹98,509 Cr stored for a 4 kWp residential install) to (a) co-mingled lead folders + (b) over-eager BOM extraction. This PR ships the import-side fixes; PR 2 will land the data migration.

## Test plan
- [x] `pnpm vitest run scripts/__tests__/excel-parser.test.ts` — 4 tests pass
- [ ] (manual, post-merge) Re-run `npx tsx scripts/extract-bom-all-unprocessed.ts --dry-run` against dev — confirm the previously-corrupting files are now skipped with a console warning
EOF
)"
```

Expected: PR URL printed.

---

# Phase 2 — Schema, data migration, recovery, UI banner (PR 2)

PR 2 starts on a fresh branch off main, after PR 1 is merged.

## Task 2.1: Branch off and pull merged Phase 1

- [ ] **Step 1: Sync main and branch**

Run:
```bash
git checkout main
git pull
git checkout -b fix/proposal-corruption-data-migration
```

## Task 2.2: Migration 087 — schema columns

**Files:**
- Create: `supabase/migrations/087_proposal_data_quality_flags.sql`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/087_proposal_data_quality_flags.sql`:

```sql
-- ============================================================
-- Migration 087 — Proposal data quality flags
-- File: supabase/migrations/087_proposal_data_quality_flags.sql
-- Description: Adds two boolean flags + audit metadata for the
--              one-time financial-corruption cleanup, and for any
--              future regression detection.
-- Date: 2026-04-30
-- Rollback:
--   ALTER TABLE proposals
--     DROP COLUMN IF EXISTS financials_invalidated,
--     DROP COLUMN IF EXISTS financials_invalidated_at,
--     DROP COLUMN IF EXISTS financials_invalidated_reason,
--     DROP COLUMN IF EXISTS system_size_uncertain;
-- Dependencies: 003a_proposals_core.sql
-- ============================================================

BEGIN;

ALTER TABLE proposals
  ADD COLUMN financials_invalidated         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN financials_invalidated_at      TIMESTAMPTZ,
  ADD COLUMN financials_invalidated_reason  TEXT,
  ADD COLUMN system_size_uncertain          BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_proposals_financials_invalidated
  ON proposals(financials_invalidated)
  WHERE financials_invalidated = TRUE;

CREATE INDEX idx_proposals_system_size_uncertain
  ON proposals(system_size_uncertain)
  WHERE system_size_uncertain = TRUE;

COMMENT ON COLUMN proposals.financials_invalidated IS
  'Set to TRUE when migration 088 reset the financial fields after detecting corruption (per-kWp > ₹2L confident or > ₹5L doubtful). Cleared when a fresh quote/import populates valid numbers.';
COMMENT ON COLUMN proposals.system_size_uncertain IS
  'Set to TRUE when system_size_kwp could not be corroborated against lead.estimated_size_kwp or projects.system_size_kwp at the time of migration 088. The kWp itself needs verification, not just the price.';

COMMIT;
```

- [ ] **Step 2: Apply in dev via Supabase SQL editor**

Open `https://supabase.com/dashboard/project/actqtzoxjilqnldnacqz/sql/new` (per CLAUDE.md workflow), paste the migration content, run.

Expected: success; no rows affected (DDL only).

- [ ] **Step 3: Regenerate `database.ts` types (CLAUDE.md mandatory rule)**

Run:
```bash
pnpm supabase gen types typescript --project-id actqtzoxjilqnldnacqz > packages/types/database.ts
```

Expected: types file regenerated with the new columns.

- [ ] **Step 4: Commit migration + types together**

```bash
git add supabase/migrations/087_proposal_data_quality_flags.sql packages/types/database.ts
git commit -m "feat(db): add financials_invalidated + system_size_uncertain flags (migration 087)

Schema prep for migration 088 (Tier A reset). Two booleans + audit
metadata so the UI can render a 'needs review' banner and so future
regressions can be detected/queried by index."
```

## Task 2.3: Migration 088 — Tier A reset

**Files:**
- Create: `supabase/migrations/088_reset_corrupted_proposal_financials.sql`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/088_reset_corrupted_proposal_financials.sql`. The full SQL is in the design doc at `docs/superpowers/plans/2026-04-26-proposal-financial-corruption-recovery.md` under "Tier A — adaptive threshold". Copy it verbatim, with this header prepended:

```sql
-- ============================================================
-- Migration 088 — Reset corrupted proposal financials (Tier A)
-- File: supabase/migrations/088_reset_corrupted_proposal_financials.sql
-- Description: One-time cleanup. Resets total_after_discount,
--              total_before_discount, subtotals, GST, and revenue
--              for ~130 proposals where per-kWp price is implausibly
--              high. Sets financials_invalidated = TRUE on all,
--              system_size_uncertain = TRUE on the doubtful-kWp
--              subset (~24). Deletes the contaminating BOM lines.
--              HubSpot-migrated proposals are excluded — they go
--              through Tier D (re-import).
-- Date: 2026-04-30
-- Rollback: NOT SAFE TO ROLLBACK. Original values are not preserved
--           anywhere recoverable. The full original numbers are
--           captured in financials_invalidated_reason for forensic
--           reference. Re-running this migration is idempotent
--           (rows already at 0 stay at 0, but the flag/reason gets
--           refreshed to NOW()).
-- Dependencies: 087_proposal_data_quality_flags.sql
-- ============================================================
```

(Then the full BEGIN…COMMIT block from the design doc.)

- [ ] **Step 2: Dry-run the SELECT first in dev SQL editor**

Run only the `CREATE TEMP TABLE tier_a_targets AS WITH …` block followed by the `SELECT COUNT(*) …` query.
Expected: `total_targets` ≈ 130, `confident_targets` ≈ 106, `doubtful_targets` ≈ 24, `max_per_kwp` ≈ 24,627,275,000 (PV147), `min_per_kwp` between ₹2L and ₹5L.

- [ ] **Step 3: Confirm the count with Vivek before running the UPDATE**

(Pause here. Vivek must approve.)

- [ ] **Step 4: Run the full migration in dev**

Paste the entire migration into the SQL editor, run.
Expected:
- UPDATE: 130 rows affected
- DELETE on `proposal_bom_lines`: a few thousand rows (the contaminating ones)

- [ ] **Step 5: Spot-check 5 proposals**

Run in dev SQL editor:
```sql
SELECT proposal_number, system_size_kwp, total_after_discount,
       financials_invalidated, system_size_uncertain,
       LEFT(financials_invalidated_reason, 200) AS reason_preview
FROM proposals
WHERE proposal_number IN ('PV147/25-26', 'PV121/24', 'PV306/24-25', 'SE/PV/069/22-23', 'PV320/25');
```
Expected: all 5 show `total_after_discount = 0`, `financials_invalidated = true`, the reason text quoting the original total. Doubtful-kWp ones (e.g., PV147 if its lead size doesn't match) show `system_size_uncertain = true`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/088_reset_corrupted_proposal_financials.sql
git commit -m "feat(db): migration 088 — reset corrupted proposal financials (Tier A)

130 proposals reset to 0 with financials_invalidated = TRUE.
24 of those also flagged system_size_uncertain. Contaminating BOM
lines deleted. HubSpot-migrated proposals excluded (Tier D)."
```

## Task 2.4: Add `ANTHROPIC_API_KEY` and run AI re-extraction

> This task is interactive. Vivek must add the key to `.env.local` first.

**Files:**
- Run: `scripts/ai-reextract-tier-b.ts` (already in worktree — no edit needed)
- Output: `scripts/data/tier-b-reextraction-results.json`

- [ ] **Step 1: Verify the API key is set**

Run: `node -e "require('dotenv').config({path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local'}); console.log('len:', (process.env.ANTHROPIC_API_KEY||'').length);"`
Expected: `len: > 80` (real Anthropic keys are ~108 chars).

If `len: 0`: STOP. Ask Vivek to set it on line 12 of `.env.local`. Do not proceed to step 2.

- [ ] **Step 2: Run the re-extraction**

Run: `npx tsx scripts/ai-reextract-tier-b.ts 2>&1 | tee scripts/data/tier-b-reextraction.log`
Expected: ~17 candidates processed, mix of `recoverable` / `still-suspicious` / `no-signal`. Total cost printed at end (~$2 estimated).

- [ ] **Step 3: Review the results JSON**

Read `scripts/data/tier-b-reextraction-results.json`. Count by classification. Decide with Vivek: which `recoverable` rows actually look right (compare extracted vs. stored side by side).

## Task 2.5: Migration 088b — apply Tier B recoveries

**Files:**
- Create: `supabase/migrations/088b_apply_tier_b_reextractions.sql`

This migration is GENERATED from the JSON output of Task 2.4. Don't write it by hand.

- [ ] **Step 1: Generate the migration from the JSON**

Run: `npx tsx scripts/generate-088b-from-reextract.ts` (this script doesn't exist yet — create it):

Create `scripts/generate-088b-from-reextract.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

const results = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'data/tier-b-reextraction-results.json'),
    'utf-8',
  ),
);

const recoverable = results.filter((r: any) => r.classification === 'recoverable');

if (recoverable.length === 0) {
  console.log('No recoverable rows. Skip migration 088b.');
  process.exit(0);
}

const sql = `-- ============================================================
-- Migration 088b — Apply Tier B AI re-extraction recoveries
-- File: supabase/migrations/088b_apply_tier_b_reextractions.sql
-- Description: Restores total_after_discount for ${recoverable.length}
--              proposals whose Claude-Sonnet re-extraction returned a
--              plausible per-kWp total. Generated from
--              scripts/data/tier-b-reextraction-results.json.
-- Date: 2026-04-30
-- ============================================================

BEGIN;

${recoverable.map((r: any) => {
  const total = Math.round(Number(r.extracted_total));
  const reason = `AI-recovered ${r.extracted_size_kwp} kWp ₹${total} from ${r.file_picked} (was ₹${r.stored_total})`.replace(/'/g, "''");
  return `UPDATE proposals
SET total_after_discount = ${total},
    total_before_discount = ${total},
    financials_invalidated_reason = COALESCE(financials_invalidated_reason || E'\\n', '') || '${reason}',
    updated_at = NOW()
WHERE id = '${r.proposal_id}';`;
}).join('\n\n')}

COMMIT;
`;

const out = path.resolve(__dirname, '../supabase/migrations/088b_apply_tier_b_reextractions.sql');
fs.writeFileSync(out, sql);
console.log(`Wrote ${out} with ${recoverable.length} updates.`);
```

Then run:
```bash
npx tsx scripts/generate-088b-from-reextract.ts
```

Expected: either prints "No recoverable rows. Skip migration 088b." OR writes the migration with N UPDATEs.

- [ ] **Step 2: If migration was generated, apply in dev SQL editor**

Open the SQL editor, paste contents of `supabase/migrations/088b_apply_tier_b_reextractions.sql`, run.
Expected: N rows affected (matches `recoverable.length`).

- [ ] **Step 3: Commit (whether or not 088b exists)**

```bash
git add scripts/generate-088b-from-reextract.ts scripts/data/tier-b-reextraction-results.json
[ -f supabase/migrations/088b_apply_tier_b_reextractions.sql ] && git add supabase/migrations/088b_apply_tier_b_reextractions.sql
git commit -m "feat(db): migration 088b — Tier B AI re-extraction recoveries

Restores N proposals where Claude Sonnet successfully re-extracted a
plausible total from the original docx/pdf. The rest stay banner-flagged."
```

## Task 2.6: Migration 089 — DB CHECK constraint

**Files:**
- Create: `supabase/migrations/089_proposal_total_sanity_constraint.sql`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/089_proposal_total_sanity_constraint.sql`:

```sql
-- ============================================================
-- Migration 089 — Proposal total sanity CHECK constraint
-- File: supabase/migrations/089_proposal_total_sanity_constraint.sql
-- Description: Final regression net. Rejects any UPDATE/INSERT that
--              would set total_after_discount > ₹10L/kWp (twice the
--              importer's ₹5L threshold so importer warnings happen
--              first; this only catches code-path regressions).
-- Date: 2026-04-30
-- Rollback: ALTER TABLE proposals DROP CONSTRAINT proposal_total_sanity;
-- Dependencies: 088_reset_corrupted_proposal_financials.sql (must be
--               applied first; otherwise the constraint blocks the
--               existing corrupted rows from being reset to 0).
-- ============================================================

BEGIN;

ALTER TABLE proposals
  ADD CONSTRAINT proposal_total_sanity
  CHECK (
    total_after_discount IS NULL
    OR system_size_kwp IS NULL
    OR system_size_kwp = 0
    OR total_after_discount <= system_size_kwp * 1000000  -- ₹10L/kWp ceiling
  );

COMMENT ON CONSTRAINT proposal_total_sanity ON proposals IS
  'Final regression net (added 2026-04-30 after the BOM-corruption cleanup). Rejects total_after_discount > ₹10L/kWp.';

COMMIT;
```

- [ ] **Step 2: Apply in dev**

Run in SQL editor.
Expected: success. If it fails with "violates check constraint", migration 088 was incomplete — investigate before retrying.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/089_proposal_total_sanity_constraint.sql
git commit -m "feat(db): migration 089 — proposal_total_sanity CHECK constraint

Rejects any future write where total_after_discount > ₹10L/kWp.
Final regression net after the importer fixes (PR 1) and data
cleanup (088)."
```

## Task 2.7: UI banner component

**Files:**
- Create: `apps/erp/src/components/proposal-data-quality-banner.tsx`

- [ ] **Step 1: Find the existing banner/alert pattern**

Run: `grep -rn "bg-yellow\|bg-amber\|alert-warning" apps/erp/src/components/ | head -10`
Expected: examples of existing yellow/amber banner components. Match their styling.

- [ ] **Step 2: Create the banner**

Create `apps/erp/src/components/proposal-data-quality-banner.tsx`:

```tsx
import { AlertTriangle } from 'lucide-react';

type Props = {
  financialsInvalidated: boolean;
  systemSizeUncertain: boolean;
  reason: string | null;
  storedTotal: number | null;
  systemSizeKwp: number | null;
};

export function ProposalDataQualityBanner({
  financialsInvalidated,
  systemSizeUncertain,
  reason,
  storedTotal,
  systemSizeKwp,
}: Props) {
  // Compute the soft-trigger: even without flags, surface a banner if the stored
  // per-kWp is implausibly high (catches the 17 Tier B cases not covered by 088).
  const perKwp =
    storedTotal && systemSizeKwp && systemSizeKwp > 0
      ? Number(storedTotal) / Number(systemSizeKwp)
      : 0;
  const softTrigger = perKwp > 200_000 && !financialsInvalidated;

  if (!financialsInvalidated && !systemSizeUncertain && !softTrigger) return null;

  let title: string;
  let body: string;
  if (financialsInvalidated && systemSizeUncertain) {
    title = 'Financials and system size both need re-verification';
    body =
      'This proposal was reset by the 2026-04-30 data cleanup. Re-confirm both the kWp size and the price before sending.';
  } else if (financialsInvalidated) {
    title = 'Financials need re-quoting';
    body =
      'This proposal was reset by the 2026-04-30 data cleanup. Re-quote before sending.';
  } else if (systemSizeUncertain) {
    title = 'System size uncertain';
    body =
      'The kWp size on this proposal could not be corroborated against the lead or project. Verify before relying on it.';
  } else {
    title = 'Total looks unusually high';
    body = `Stored total works out to ₹${Math.round(perKwp / 1000)}K/kWp, which is unusually high. Verify before sending.`;
  }

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm">{body}</div>
        {reason && (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer">Audit details</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words">{reason}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/proposal-data-quality-banner.tsx
git commit -m "feat(ui): proposal data quality banner

Surfaces financials_invalidated, system_size_uncertain, and
soft-triggered (per-kWp > ₹2L) cases on proposal pages."
```

## Task 2.8: Wire the banner into proposal & sales pages

**Files:**
- Modify: `apps/erp/src/app/(erp)/proposals/[id]/page.tsx`
- Modify: `apps/erp/src/app/(erp)/sales/[id]/page.tsx` (verify path)

- [ ] **Step 1: Confirm the file paths**

Run: `ls apps/erp/src/app/\(erp\)/proposals/\[id\]/page.tsx apps/erp/src/app/\(erp\)/sales/\[id\]/page.tsx 2>&1`
Expected: both files exist. If the sales page is at a different path, run `find apps/erp/src/app -name "page.tsx" | grep -i sale` to locate.

- [ ] **Step 2: Find where the proposal data is loaded in `proposals/[id]/page.tsx`**

Run: `grep -n "from('proposals')\|getProposal\|proposal-queries\|.select(" apps/erp/src/app/\(erp\)/proposals/\[id\]/page.tsx | head -10`

- [ ] **Step 3: Update the proposal SELECT to include the new columns**

Wherever the proposal is fetched (likely via a queries function in `apps/erp/src/lib/proposals-queries.ts`), add `financials_invalidated, system_size_uncertain, financials_invalidated_reason` to the select list.

If the queries function uses a `*` select, no change needed for SELECT itself, but the Row type from `database.ts` will already include the new fields after Task 2.2 step 3.

- [ ] **Step 4: Render the banner near the top of `proposals/[id]/page.tsx`**

Import:
```tsx
import { ProposalDataQualityBanner } from '@/components/proposal-data-quality-banner';
```

Add (immediately inside the page's JSX root, before any other content):
```tsx
<ProposalDataQualityBanner
  financialsInvalidated={proposal.financials_invalidated}
  systemSizeUncertain={proposal.system_size_uncertain}
  reason={proposal.financials_invalidated_reason}
  storedTotal={proposal.total_after_discount ? Number(proposal.total_after_discount) : null}
  systemSizeKwp={proposal.system_size_kwp ? Number(proposal.system_size_kwp) : null}
/>
```

- [ ] **Step 5: Repeat for the sales page**

Same pattern. If the sales page wraps a list of proposals, render one banner per proposal item OR a single rolled-up banner if any proposal in scope is flagged.

- [ ] **Step 6: Verify by running the dev server**

Run: `pnpm --filter erp dev` (or the equivalent — check `package.json` scripts)
Expected: dev server starts on `localhost:3000`. Navigate to `/proposals/<id-of-PV147-25-26>` and confirm the banner renders. The id can be looked up via:
```sql
SELECT id FROM proposals WHERE proposal_number = 'PV147/25-26';
```

- [ ] **Step 7: Commit**

```bash
git add apps/erp/src/app/\(erp\)/proposals/\[id\]/page.tsx apps/erp/src/app/\(erp\)/sales/\[id\]/page.tsx apps/erp/src/lib/proposals-queries.ts
git commit -m "feat(ui): wire proposal data quality banner into proposal and sales pages

Banner shows on any proposal where financials_invalidated, system_size_uncertain,
or stored per-kWp > ₹2L."
```

## Task 2.9: Open PR 2

- [ ] **Step 1: Push and create PR**

Run:
```bash
git push -u origin HEAD
gh pr create --title "feat: reset corrupted proposal financials (data migration + banner)" --body "$(cat <<'EOF'
## Summary
- Migration 087: add `financials_invalidated` and `system_size_uncertain` flags
- Migration 088: reset 130 corrupted proposals (Tier A); flag 24 for kWp uncertainty
- Migration 088b: apply ~N AI-recovered totals (Tier B subset)
- Migration 089: ₹10L/kWp CHECK constraint (final regression net)
- UI banner on proposal and sales pages

## Why
Investigation: `docs/superpowers/plans/2026-04-26-proposal-financial-corruption-recovery.md`
Implementation plan: `docs/superpowers/plans/2026-04-30-proposal-corruption-implementation.md`
Depends on: PR 1 (importer fixes), already merged.

## Test plan
- [x] Migration 088 dry-run shows ~130 / ~106 / ~24 row counts in dev
- [x] Spot-check of PV147, PV121, PV306, SE/PV/069, PV320 in dev — all show banner
- [x] AI re-extraction script ran with N recoverables; 088b applied
- [ ] (manual) Vivek confirms before prod rollout
EOF
)"
```

- [ ] **Step 2: Schedule prod run with Vivek**

Pause for Vivek's approval. Apply 087 → 088 → (088b if generated) → 089 in prod via the SQL editor in that order. After each migration, run the same spot-check.

---

# Phase 3 stub — HubSpot re-import (PR 3)

Blocked on Vivek delivering the cleaned HubSpot CSV. Out of scope for this plan; will be its own plan once the CSV arrives.

Outline:
1. New script `scripts/reimport-hubspot-financials.ts`.
2. For each row in CSV, look up `proposals` by `hubspot_deal_id`.
3. If found and the new TPV passes the ₹5L/kWp check: UPDATE `total_*`, `shiroi_revenue`, set `financials_invalidated = FALSE`.
4. If not found: INSERT new lead + proposal + (if won) project, reusing the now-fixed `migrate-hubspot.ts` validation.
5. Log per-row outcome to `scripts/data/hubspot-reimport-<date>.json` for audit.

---

# Self-review checklist (run after writing the plan)

- [x] Spec coverage: every Vivek decision has a task. (#1 threshold → 088 SQL; #2 reset action → 087+088; #3 AI re-extract → 2.4–2.5; #4 HubSpot → Phase 3 stub; #5 CHECK constraint → 089; #6 PR ordering → Phase 1 vs 2.)
- [x] No placeholders: every step has exact paths, exact code, exact commands. (Note: Tier B recovery count (`N`) and exact 088b body are intentionally generated at runtime in 2.5 from the JSON output — that's the design, not a placeholder.)
- [x] Type consistency: `financials_invalidated`, `system_size_uncertain`, `financials_invalidated_reason` used identically across migration 087, migration 088, the banner component, and the page wiring.
- [x] Each phase produces working software on its own (Phase 1 = importer fixes pass tests; Phase 2 = data cleanup + UI banner shipped together).
