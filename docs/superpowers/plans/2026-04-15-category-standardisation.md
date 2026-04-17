# Category Standardisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify BOI/BOQ/Actuals/Purchase/Price Book on Manivel's 15-category vocabulary, add a smart autocomplete combobox for item entry backed by Price Book + recent BOQ items, re-import Price Book rates from Manivel's Google Sheet, and grant `project_manager` access to the Price Book.

**Architecture:** Migration 057 collapses legacy category values on `project_boq_items` + `price_book` + `delivery_challan_items` to Manivel's 15, and expands the CHECK constraint on `proposal_bom_lines` + `purchase_order_items` to accept the union of legacy 26 + Manivel 15 (strategy C — no mass rewrite of 33,450 historical BOM lines). A new `<ItemCombobox>` client component backed by a `getItemSuggestions()` server query (~950 deduped items from `price_book` + `project_boq_items`) replaces the plain description `<input>` in all three inline add rows (BOI, BOQ, proposal BOM). The proposal-side `BomInlineAddRow` also drops its local 21-value `BOM_CATEGORIES` dropdown and imports the shared `BOI_CATEGORIES`, killing the dual-vocab bug that made `applyPriceBookRates` find zero matches. Price Book re-imports via upsert on a new unique index `(item_description, item_category) WHERE deleted_at IS NULL`.

**Tech Stack:** Next.js 14 App Router, React 19 client components, Supabase PostgreSQL (migrations via SQL Editor), `@repo/ui` design system, `@repo/types` generated database types, `vitest` for unit tests, `tsx` for the import script, `googleapis` Sheets API for the Price Book source.

**Spec:** `docs/superpowers/specs/2026-04-15-category-standardisation-design.md`

---

## File Structure Overview

| # | Path | Kind | Purpose |
|---|---|---|---|
| 1 | `supabase/migrations/057_category_standardisation.sql` | CREATE | Collapse legacy values + expand CHECK constraints + add upsert index |
| 2 | `packages/types/database.ts` | REGEN | Type regen after migration 057 |
| 3 | `apps/erp/src/lib/boi-constants.ts` | EDIT | Add Battery, fix I&C label, export `ItemCategory` + `mapLegacyToManivel` |
| 4 | `apps/erp/src/__tests__/boi-constants.test.ts` | CREATE | Unit tests for `mapLegacyToManivel` + `getCategoryLabel` |
| 5 | `apps/erp/src/lib/item-suggestions-queries.ts` | CREATE | Server query that returns ~950 deduped item suggestions |
| 6 | `apps/erp/src/components/forms/item-combobox.tsx` | CREATE | Shared combobox with keyboard nav + create-new row |
| 7 | `apps/erp/src/__tests__/item-combobox-filter.test.ts` | CREATE | Unit tests for `filterAndRank` |
| 8 | `apps/erp/src/components/projects/forms/bom-line-form.tsx` | EDIT | Wire combobox into `BoiInlineAddRow` + `BomInlineAddRow`, delete local `BOM_CATEGORIES` |
| 9 | `apps/erp/src/components/projects/stepper-steps/step-bom.tsx` | EDIT | Load suggestions once, pass to `BoiInlineAddRow` |
| 10 | `apps/erp/src/components/projects/forms/boq-variance-form.tsx` | EDIT | Wire combobox into `BoqAddItemRow` |
| 11 | `apps/erp/src/components/projects/stepper-steps/step-boq.tsx` | EDIT | Load suggestions once, pass to `BoqAddItemRow` |
| 12 | `<proposal wizard step file>` | EDIT | Pass suggestions prop to `BomInlineAddRow` (callers located via Grep) |
| 13 | `apps/erp/src/lib/price-book-actions.ts` | EDIT | Add `assertCanEditPriceBook` role guard to 3 mutations |
| 14 | `apps/erp/src/lib/roles.ts` | EDIT | Add `ITEMS.priceBook` to `project_manager` under new "Reference" section |
| 15 | `scripts/import-price-book-from-gdrive.ts` | EDIT | Rewrite `CATEGORY_MAP` to Manivel 15, change insert → upsert |

---

## Dependencies & Ordering

1. **Task 1 (write migration)** → **Task 2 (apply + regen types)** — schema must exist before code uses it
2. **Task 2** → **Task 3 (boi-constants.ts)** — type regen unblocks the `ItemCategory` export
3. **Task 3** → **Tasks 4–13** — `ItemCategory` is imported by queries/components/tests
4. **Task 1 (migration)** → **Task 8 (bom-line-form.tsx fix)** — `proposal_bom_lines` CHECK must accept Manivel values before the form writes them
5. **Tasks 3 + 5** → **Task 6 (combobox)** — combobox imports both
6. **Task 6** → **Tasks 8–12** — callers import combobox
7. **Tasks 1–14 land** → **Tasks 15–17 (re-import + verification)** — don't re-import until schema is migrated
8. **Everything** → **Task 18 (CI gates)** — final green-light

No task depends on task 14 (roles.ts) for compilation; it can ship in any order after task 3.

---

## Task 1: Write migration 057 SQL

**Files:**
- Create: `supabase/migrations/057_category_standardisation.sql`

- [ ] **Step 1: Create the migration file with header comment**

Create `supabase/migrations/057_category_standardisation.sql` with this content:

```sql
-- Migration 057 — Category standardisation
-- Collapses legacy category values across 3 tables to Manivel's 15 vocabulary,
-- expands CHECK constraints on 2 legacy tables to accept the union (strategy C),
-- and adds a unique index for Price Book upsert on item_description + item_category.
--
-- Spec: docs/superpowers/specs/2026-04-15-category-standardisation-design.md
-- Ordering: must run BEFORE apps/erp/src/components/projects/forms/bom-line-form.tsx
-- starts writing Manivel values to proposal_bom_lines.
--
-- Applied via Supabase SQL Editor (dev first, prod after testing week).

BEGIN;
```

- [ ] **Step 2: Add UPDATE block for `project_boq_items`**

Append to the migration:

```sql
-- ============================================================================
-- 1. project_boq_items — migrate legacy → Manivel 15
-- ============================================================================

UPDATE project_boq_items SET item_category = CASE item_category
  WHEN 'panel' THEN 'solar_panels'
  WHEN 'solar_panel' THEN 'solar_panels'
  WHEN 'structure' THEN 'mms'
  WHEN 'mounting_structure' THEN 'mms'
  WHEN 'dc_cable' THEN 'dc_accessories'
  WHEN 'dc_access' THEN 'dc_accessories'
  WHEN 'dcdb' THEN 'dc_accessories'
  WHEN 'connector' THEN 'dc_accessories'
  WHEN 'junction_box' THEN 'dc_accessories'
  WHEN 'ac_cable' THEN 'ac_accessories'
  WHEN 'acdb' THEN 'ac_accessories'
  WHEN 'lt_panel' THEN 'ac_accessories'
  WHEN 'ht_cable' THEN 'ac_accessories'
  WHEN 'ht_panel' THEN 'ac_accessories'
  WHEN 'transformer' THEN 'ac_accessories'
  WHEN 'bus_duct' THEN 'ac_accessories'
  WHEN 'conduit' THEN 'conduits'
  WHEN 'gi_cable_tray' THEN 'conduits'
  WHEN 'earthing' THEN 'earthing_accessories'
  WHEN 'earth_access' THEN 'earthing_accessories'
  WHEN 'lightning_arrestor' THEN 'earthing_accessories'
  WHEN 'safety_equipment' THEN 'safety_accessories'
  WHEN 'walkway' THEN 'safety_accessories'
  WHEN 'handrail' THEN 'safety_accessories'
  WHEN 'net_meter' THEN 'generation_meter'
  WHEN 'monitoring' THEN 'generation_meter'
  WHEN 'installation_labour' THEN 'ic'
  WHEN 'liaison' THEN 'statutory_approvals'
  WHEN 'transport' THEN 'transport_civil'
  WHEN 'civil_work' THEN 'transport_civil'
  WHEN 'other' THEN 'others'
  ELSE item_category
END;

ALTER TABLE project_boq_items DROP CONSTRAINT IF EXISTS project_boq_items_item_category_check;
ALTER TABLE project_boq_items ADD CONSTRAINT project_boq_items_item_category_check
  CHECK (item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));
```

- [ ] **Step 3: Add UPDATE block + dedup + unique index for `price_book`**

Append to the migration:

```sql
-- ============================================================================
-- 2. price_book — migrate legacy → Manivel 15 + dedup + upsert unique index
-- ============================================================================

UPDATE price_book SET item_category = CASE item_category
  WHEN 'panel' THEN 'solar_panels'
  WHEN 'solar_panel' THEN 'solar_panels'
  WHEN 'structure' THEN 'mms'
  WHEN 'mounting_structure' THEN 'mms'
  WHEN 'dc_cable' THEN 'dc_accessories'
  WHEN 'dc_access' THEN 'dc_accessories'
  WHEN 'dcdb' THEN 'dc_accessories'
  WHEN 'connector' THEN 'dc_accessories'
  WHEN 'junction_box' THEN 'dc_accessories'
  WHEN 'ac_cable' THEN 'ac_accessories'
  WHEN 'acdb' THEN 'ac_accessories'
  WHEN 'lt_panel' THEN 'ac_accessories'
  WHEN 'ht_cable' THEN 'ac_accessories'
  WHEN 'ht_panel' THEN 'ac_accessories'
  WHEN 'transformer' THEN 'ac_accessories'
  WHEN 'bus_duct' THEN 'ac_accessories'
  WHEN 'conduit' THEN 'conduits'
  WHEN 'gi_cable_tray' THEN 'conduits'
  WHEN 'earthing' THEN 'earthing_accessories'
  WHEN 'earth_access' THEN 'earthing_accessories'
  WHEN 'lightning_arrestor' THEN 'earthing_accessories'
  WHEN 'safety_equipment' THEN 'safety_accessories'
  WHEN 'walkway' THEN 'safety_accessories'
  WHEN 'handrail' THEN 'safety_accessories'
  WHEN 'net_meter' THEN 'generation_meter'
  WHEN 'monitoring' THEN 'generation_meter'
  WHEN 'installation_labour' THEN 'ic'
  WHEN 'liaison' THEN 'statutory_approvals'
  WHEN 'transport' THEN 'transport_civil'
  WHEN 'civil_work' THEN 'transport_civil'
  WHEN 'other' THEN 'others'
  ELSE item_category
END;

-- Dedup before creating the unique index.
-- If multiple rows have the same (item_description, item_category), keep the
-- most recent (by created_at) and soft-delete the rest.
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT item_description, item_category, COUNT(*) AS c
    FROM price_book
    WHERE deleted_at IS NULL
    GROUP BY item_description, item_category
    HAVING COUNT(*) > 1
  ) x;
  IF dup_count > 0 THEN
    RAISE NOTICE 'price_book has % duplicate (description, category) groups — auto-deduplicating (keep most recent)', dup_count;
  END IF;
END $$;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY item_description, item_category
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM price_book
  WHERE deleted_at IS NULL
)
UPDATE price_book
SET deleted_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE price_book DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE price_book ADD CONSTRAINT price_book_item_category_check
  CHECK (item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));

-- Unique index for the import script's upsert conflict target.
-- Case-sensitive (Manivel's sheet is the single source of truth — consistent casing).
CREATE UNIQUE INDEX IF NOT EXISTS price_book_desc_cat_unique
  ON price_book (item_description, item_category)
  WHERE deleted_at IS NULL;
```

- [ ] **Step 4: Add UPDATE + CHECK block for `delivery_challan_items`**

Append to the migration:

```sql
-- ============================================================================
-- 3. delivery_challan_items — migrate legacy → Manivel 15
-- ============================================================================

UPDATE delivery_challan_items SET item_category = CASE item_category
  WHEN 'panel' THEN 'solar_panels'
  WHEN 'solar_panel' THEN 'solar_panels'
  WHEN 'structure' THEN 'mms'
  WHEN 'mounting_structure' THEN 'mms'
  WHEN 'dc_cable' THEN 'dc_accessories'
  WHEN 'dc_access' THEN 'dc_accessories'
  WHEN 'dcdb' THEN 'dc_accessories'
  WHEN 'connector' THEN 'dc_accessories'
  WHEN 'junction_box' THEN 'dc_accessories'
  WHEN 'ac_cable' THEN 'ac_accessories'
  WHEN 'acdb' THEN 'ac_accessories'
  WHEN 'lt_panel' THEN 'ac_accessories'
  WHEN 'ht_cable' THEN 'ac_accessories'
  WHEN 'ht_panel' THEN 'ac_accessories'
  WHEN 'transformer' THEN 'ac_accessories'
  WHEN 'bus_duct' THEN 'ac_accessories'
  WHEN 'conduit' THEN 'conduits'
  WHEN 'gi_cable_tray' THEN 'conduits'
  WHEN 'earthing' THEN 'earthing_accessories'
  WHEN 'earth_access' THEN 'earthing_accessories'
  WHEN 'lightning_arrestor' THEN 'earthing_accessories'
  WHEN 'safety_equipment' THEN 'safety_accessories'
  WHEN 'walkway' THEN 'safety_accessories'
  WHEN 'handrail' THEN 'safety_accessories'
  WHEN 'net_meter' THEN 'generation_meter'
  WHEN 'monitoring' THEN 'generation_meter'
  WHEN 'installation_labour' THEN 'ic'
  WHEN 'liaison' THEN 'statutory_approvals'
  WHEN 'transport' THEN 'transport_civil'
  WHEN 'civil_work' THEN 'transport_civil'
  WHEN 'other' THEN 'others'
  ELSE item_category
END
WHERE item_category IS NOT NULL;

ALTER TABLE delivery_challan_items DROP CONSTRAINT IF EXISTS delivery_challan_items_item_category_check;
ALTER TABLE delivery_challan_items ADD CONSTRAINT delivery_challan_items_item_category_check
  CHECK (item_category IS NULL OR item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));
```

- [ ] **Step 5: Expand CHECK on `proposal_bom_lines` + `purchase_order_items` (strategy C)**

Append to the migration:

```sql
-- ============================================================================
-- 4. proposal_bom_lines — expand CHECK to union (legacy 26 + Manivel 15).
-- No data migration (strategy C: 33,450 historical rows stay on legacy vocab).
-- New inserts from bom-line-form.tsx will use Manivel values.
-- ============================================================================

ALTER TABLE proposal_bom_lines DROP CONSTRAINT IF EXISTS proposal_bom_lines_item_category_check;
ALTER TABLE proposal_bom_lines ADD CONSTRAINT proposal_bom_lines_item_category_check
  CHECK (item_category IN (
    -- Manivel 15 (for new inserts)
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others',
    -- Legacy 26 (for existing rows — preserved per strategy C)
    'panel','solar_panel','mounting_structure','structure','dc_cable','dc_access',
    'ac_cable','dcdb','acdb','lt_panel','ht_cable','ht_panel','transformer',
    'bus_duct','conduit','gi_cable_tray','earthing','earth_access','lightning_arrestor',
    'safety_equipment','walkway','handrail','net_meter','monitoring',
    'installation_labour','liaison','transport','civil_work','other',
    'connector','junction_box'
  ));

-- ============================================================================
-- 5. purchase_order_items — same expansion
-- ============================================================================

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_item_category_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_item_category_check
  CHECK (item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others',
    'panel','solar_panel','mounting_structure','structure','dc_cable','dc_access',
    'ac_cable','dcdb','acdb','lt_panel','ht_cable','ht_panel','transformer',
    'bus_duct','conduit','gi_cable_tray','earthing','earth_access','lightning_arrestor',
    'safety_equipment','walkway','handrail','net_meter','monitoring',
    'installation_labour','liaison','transport','civil_work','other',
    'connector','junction_box'
  ));
```

- [ ] **Step 6: Add sanity-check block that raises exception on any mapping gap**

Append to the migration:

```sql
-- ============================================================================
-- 6. Post-UPDATE sanity checks — abort migration if any row is outside Manivel 15
-- ============================================================================

DO $$
DECLARE
  bad_boq INT;
  bad_price_book INT;
  bad_dc INT;
BEGIN
  SELECT COUNT(*) INTO bad_boq FROM project_boq_items
  WHERE item_category NOT IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  );

  SELECT COUNT(*) INTO bad_price_book FROM price_book
  WHERE deleted_at IS NULL
    AND item_category NOT IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  );

  SELECT COUNT(*) INTO bad_dc FROM delivery_challan_items
  WHERE item_category IS NOT NULL
    AND item_category NOT IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  );

  IF bad_boq > 0 THEN
    RAISE EXCEPTION 'project_boq_items has % rows with unmapped legacy category — aborting migration', bad_boq;
  END IF;
  IF bad_price_book > 0 THEN
    RAISE EXCEPTION 'price_book has % active rows with unmapped legacy category — aborting migration', bad_price_book;
  END IF;
  IF bad_dc > 0 THEN
    RAISE EXCEPTION 'delivery_challan_items has % rows with unmapped legacy category — aborting migration', bad_dc;
  END IF;

  RAISE NOTICE 'Migration 057 sanity checks passed: 0 unmapped rows in 3 target tables';
END $$;

COMMIT;
```

- [ ] **Step 7: Commit migration file**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
git add supabase/migrations/057_category_standardisation.sql
git commit -m "feat(db): migration 057 - category standardisation (Manivel's 15)"
```

---

## Task 2: Apply migration 057 to dev + regenerate types

**Files:**
- Modify: `packages/types/database.ts`

- [ ] **Step 1: Open dev Supabase SQL Editor**

Open: https://supabase.com/dashboard/project/actqtzoxjilqnldnacqz/sql/new

- [ ] **Step 2: Paste + run migration 057**

Copy the full contents of `supabase/migrations/057_category_standardisation.sql` into the SQL editor. Click "Run".

Expected: `Success. No rows returned.` plus the `NOTICE: Migration 057 sanity checks passed: 0 unmapped rows in 3 target tables` notice in the output panel.

If the migration aborts with a RAISE EXCEPTION, investigate the specific table/value that failed. The exception message names the table. Query the legacy value it missed and add a WHEN clause to that table's UPDATE block.

- [ ] **Step 3: Verify `project_boq_items` category distribution**

In the same SQL editor, run:

```sql
SELECT item_category, COUNT(*)
FROM project_boq_items
GROUP BY item_category
ORDER BY item_category;
```

Expected: every value in the first column is one of the 15 Manivel values. No legacy values remain.

- [ ] **Step 4: Verify `price_book` distribution**

```sql
SELECT item_category, COUNT(*)
FROM price_book
WHERE deleted_at IS NULL
GROUP BY item_category
ORDER BY item_category;
```

Expected: 15-or-fewer rows returned, all Manivel values.

- [ ] **Step 5: Verify the new unique index exists**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'price_book' AND indexname = 'price_book_desc_cat_unique';
```

Expected: one row showing `CREATE UNIQUE INDEX price_book_desc_cat_unique ON public.price_book USING btree (item_description, item_category) WHERE (deleted_at IS NULL)`.

- [ ] **Step 6: Regenerate TypeScript database types**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

Expected: command exits 0, `packages/types/database.ts` file size changes (diff should show updated CHECK constraint comments — no new tables/columns in this migration).

- [ ] **Step 7: Run `tsc --noEmit` to confirm no type regressions**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: "0 errors" across all 4 packages.

- [ ] **Step 8: Commit the type regen**

```bash
git add packages/types/database.ts
git commit -m "chore(types): regenerate after migration 057"
```

---

## Task 3: Update `boi-constants.ts` with 15 categories + `ItemCategory` + `mapLegacyToManivel`

**Files:**
- Modify: `apps/erp/src/lib/boi-constants.ts`

- [ ] **Step 1: Replace the entire file with the new content**

Open `apps/erp/src/lib/boi-constants.ts` (currently 24 lines). Replace its contents with:

```typescript
// Manivel's 15 item categories — shared between server and client components.
// DO NOT add 'use client' here; this file must be importable by server components.
//
// This is the single source of truth for item categories across:
// - BOI (project_boq_items)
// - BOQ (project_boq_items)
// - Proposal BOM (proposal_bom_lines — accepts union per migration 057)
// - Price Book (price_book)
// - Delivery Challan (delivery_challan_items)

export const BOI_CATEGORIES = [
  { value: 'solar_panels',         label: 'Solar Panels' },
  { value: 'inverter',             label: 'Inverter' },
  { value: 'battery',              label: 'Battery' },
  { value: 'mms',                  label: 'MMS (Module Mounting Structure)' },
  { value: 'dc_accessories',       label: 'DC & Accessories' },
  { value: 'ac_accessories',       label: 'AC & Accessories' },
  { value: 'conduits',             label: 'Conduits' },
  { value: 'earthing_accessories', label: 'Earthing & Accessories' },
  { value: 'safety_accessories',   label: 'Safety & Accessories' },
  { value: 'generation_meter',     label: 'Generation Meter & Accessories' },
  { value: 'ic',                   label: 'I&C (Installation & Commissioning)' },
  { value: 'statutory_approvals',  label: 'Statutory Approvals' },
  { value: 'transport_civil',      label: 'Transport & Civil' },
  { value: 'miscellaneous',        label: 'Miscellaneous' },
  { value: 'others',               label: 'Others' },
] as const;

export type ItemCategory = typeof BOI_CATEGORIES[number]['value'];

export const ITEM_CATEGORY_VALUES: ReadonlyArray<ItemCategory> =
  BOI_CATEGORIES.map((c) => c.value);

export function getCategoryLabel(value: string): string {
  return BOI_CATEGORIES.find((c) => c.value === value)?.label ?? value.replace(/_/g, ' ');
}

/**
 * Maps a legacy category value to Manivel 15.
 *
 * Used by:
 * - scripts/import-price-book-from-gdrive.ts (row-by-row mapping)
 * - UI code that renders historical rows from proposal_bom_lines / purchase_order_items
 *   (those tables still hold legacy values per strategy C of migration 057)
 *
 * Returns the original value if already on Manivel 15 or not recognized.
 */
export function mapLegacyToManivel(legacy: string): ItemCategory | string {
  const map: Record<string, ItemCategory> = {
    panel: 'solar_panels',
    solar_panel: 'solar_panels',
    structure: 'mms',
    mounting_structure: 'mms',
    dc_cable: 'dc_accessories',
    dc_access: 'dc_accessories',
    dcdb: 'dc_accessories',
    connector: 'dc_accessories',
    junction_box: 'dc_accessories',
    ac_cable: 'ac_accessories',
    acdb: 'ac_accessories',
    lt_panel: 'ac_accessories',
    ht_cable: 'ac_accessories',
    ht_panel: 'ac_accessories',
    transformer: 'ac_accessories',
    bus_duct: 'ac_accessories',
    conduit: 'conduits',
    gi_cable_tray: 'conduits',
    earthing: 'earthing_accessories',
    earth_access: 'earthing_accessories',
    lightning_arrestor: 'earthing_accessories',
    safety_equipment: 'safety_accessories',
    walkway: 'safety_accessories',
    handrail: 'safety_accessories',
    net_meter: 'generation_meter',
    monitoring: 'generation_meter',
    installation_labour: 'ic',
    liaison: 'statutory_approvals',
    transport: 'transport_civil',
    civil_work: 'transport_civil',
    other: 'others',
  };
  return map[legacy] ?? legacy;
}
```

- [ ] **Step 2: Run `tsc --noEmit` to verify no breakage**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: 0 errors. If the `as const` assertion breaks any consumer, fix those sites (likely any code doing `BOI_CATEGORIES.push(...)` or mutating the array — there shouldn't be any).

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/boi-constants.ts
git commit -m "feat(vocab): add Battery, fix I&C label, export ItemCategory + mapLegacyToManivel"
```

---

## Task 4: Unit tests for `boi-constants.ts`

**Files:**
- Create: `apps/erp/src/__tests__/boi-constants.test.ts`

- [ ] **Step 1: Create the `__tests__` directory + test file**

Create `apps/erp/src/__tests__/boi-constants.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import {
  BOI_CATEGORIES,
  ITEM_CATEGORY_VALUES,
  getCategoryLabel,
  mapLegacyToManivel,
  type ItemCategory,
} from '../lib/boi-constants';

describe('BOI_CATEGORIES', () => {
  it('has exactly 15 entries', () => {
    expect(BOI_CATEGORIES).toHaveLength(15);
  });

  it('includes Battery (the new #15)', () => {
    const values = BOI_CATEGORIES.map((c) => c.value);
    expect(values).toContain('battery');
  });

  it('labels I&C as Installation & Commissioning (not Instrumentation & Control)', () => {
    const ic = BOI_CATEGORIES.find((c) => c.value === 'ic');
    expect(ic?.label).toBe('I&C (Installation & Commissioning)');
  });

  it('has no duplicate values', () => {
    const values = BOI_CATEGORIES.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('ITEM_CATEGORY_VALUES', () => {
  it('contains the same values as BOI_CATEGORIES', () => {
    expect(ITEM_CATEGORY_VALUES).toEqual(BOI_CATEGORIES.map((c) => c.value));
  });
});

describe('getCategoryLabel', () => {
  it('returns the correct label for a known value', () => {
    expect(getCategoryLabel('solar_panels')).toBe('Solar Panels');
    expect(getCategoryLabel('mms')).toBe('MMS (Module Mounting Structure)');
    expect(getCategoryLabel('ic')).toBe('I&C (Installation & Commissioning)');
  });

  it('falls back to a human-readable form for an unknown value', () => {
    expect(getCategoryLabel('foo_bar')).toBe('foo bar');
  });
});

describe('mapLegacyToManivel', () => {
  it('maps legacy solar panel variants to solar_panels', () => {
    expect(mapLegacyToManivel('panel')).toBe('solar_panels');
    expect(mapLegacyToManivel('solar_panel')).toBe('solar_panels');
  });

  it('maps structure variants to mms', () => {
    expect(mapLegacyToManivel('structure')).toBe('mms');
    expect(mapLegacyToManivel('mounting_structure')).toBe('mms');
  });

  it('collapses all DC-side BOS to dc_accessories', () => {
    expect(mapLegacyToManivel('dc_cable')).toBe('dc_accessories');
    expect(mapLegacyToManivel('dc_access')).toBe('dc_accessories');
    expect(mapLegacyToManivel('dcdb')).toBe('dc_accessories');
    expect(mapLegacyToManivel('connector')).toBe('dc_accessories');
    expect(mapLegacyToManivel('junction_box')).toBe('dc_accessories');
  });

  it('collapses all AC-side BOS to ac_accessories', () => {
    expect(mapLegacyToManivel('ac_cable')).toBe('ac_accessories');
    expect(mapLegacyToManivel('acdb')).toBe('ac_accessories');
    expect(mapLegacyToManivel('lt_panel')).toBe('ac_accessories');
    expect(mapLegacyToManivel('ht_cable')).toBe('ac_accessories');
    expect(mapLegacyToManivel('transformer')).toBe('ac_accessories');
  });

  it('maps gi_cable_tray to conduits (Vivek correction)', () => {
    expect(mapLegacyToManivel('gi_cable_tray')).toBe('conduits');
    expect(mapLegacyToManivel('conduit')).toBe('conduits');
  });

  it('maps lightning_arrestor to earthing_accessories (Vivek correction)', () => {
    expect(mapLegacyToManivel('lightning_arrestor')).toBe('earthing_accessories');
    expect(mapLegacyToManivel('earthing')).toBe('earthing_accessories');
    expect(mapLegacyToManivel('earth_access')).toBe('earthing_accessories');
  });

  it('maps installation_labour to ic (Installation & Commissioning)', () => {
    expect(mapLegacyToManivel('installation_labour')).toBe('ic');
  });

  it('maps liaison to statutory_approvals', () => {
    expect(mapLegacyToManivel('liaison')).toBe('statutory_approvals');
  });

  it('collapses transport and civil_work to transport_civil', () => {
    expect(mapLegacyToManivel('transport')).toBe('transport_civil');
    expect(mapLegacyToManivel('civil_work')).toBe('transport_civil');
  });

  it('maps singular "other" to plural "others"', () => {
    expect(mapLegacyToManivel('other')).toBe('others');
  });

  it('passes Manivel values through unchanged', () => {
    const manivelValues: ItemCategory[] = [
      'solar_panels', 'inverter', 'battery', 'mms', 'dc_accessories',
      'ac_accessories', 'conduits', 'earthing_accessories', 'safety_accessories',
      'generation_meter', 'ic', 'statutory_approvals', 'transport_civil',
      'miscellaneous', 'others',
    ];
    for (const v of manivelValues) {
      expect(mapLegacyToManivel(v)).toBe(v);
    }
  });

  it('passes unknown values through unchanged', () => {
    expect(mapLegacyToManivel('something_made_up')).toBe('something_made_up');
  });
});
```

- [ ] **Step 2: Run the tests — they should all pass**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp/apps/erp"
pnpm test -- boi-constants
```

Expected: all tests pass. If any fail, the error message points at a specific expect() — fix the constants file (Task 3) to match.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
git add apps/erp/src/__tests__/boi-constants.test.ts
git commit -m "test(vocab): unit tests for BOI_CATEGORIES + mapLegacyToManivel"
```

---

## Task 5: Create `item-suggestions-queries.ts`

**Files:**
- Create: `apps/erp/src/lib/item-suggestions-queries.ts`

- [ ] **Step 1: Create the query file**

Create `apps/erp/src/lib/item-suggestions-queries.ts` with:

```typescript
// Server-side query file — imports @repo/supabase/server, so can only be called
// from server components / server actions. No 'use server' or 'server-only'
// directive needed (Next.js 14 enforces the boundary via the import).

import { cache } from 'react';
import { createClient } from '@repo/supabase/server';
import type { ItemCategory } from './boi-constants';

export interface ItemSuggestionRow {
  description: string;
  category: ItemCategory;
  unit: string;
  base_price: number;
  source: 'price_book' | 'boq';
}

/**
 * Fetches ~950 deduped item suggestions for the ItemCombobox.
 *
 * Source:
 * - `price_book` (curated by Manivel, ~252 active rows)
 * - `project_boq_items` (recent user entries, ~701 rows)
 *
 * Dedup rule: `(LOWER(description), category)` — Price Book rows win on conflict.
 * Wrapped with React's `cache()` so multiple server components on the same
 * request share the result.
 */
export const getItemSuggestions = cache(async (): Promise<ItemSuggestionRow[]> => {
  const op = '[getItemSuggestions]';
  const supabase = await createClient();

  const [priceBookRes, boqRes] = await Promise.all([
    supabase
      .from('price_book')
      .select('item_description, item_category, unit, base_price')
      .is('deleted_at', null)
      .eq('is_active', true)
      .limit(500),
    supabase
      .from('project_boq_items')
      .select('item_description, item_category, unit, unit_price')
      .limit(2000),
  ]);

  if (priceBookRes.error) {
    console.error(`${op} price_book query failed:`, {
      code: priceBookRes.error.code,
      message: priceBookRes.error.message,
    });
  }
  if (boqRes.error) {
    console.error(`${op} project_boq_items query failed:`, {
      code: boqRes.error.code,
      message: boqRes.error.message,
    });
  }

  const priceBook = priceBookRes.data ?? [];
  const boq = boqRes.data ?? [];

  // Dedupe by (LOWER(description), category). Price Book wins.
  const seen = new Set<string>();
  const out: ItemSuggestionRow[] = [];

  const keyOf = (desc: string | null, cat: string | null): string =>
    `${(desc ?? '').toLowerCase().trim()}::${cat ?? ''}`;

  for (const r of priceBook) {
    if (!r.item_description || !r.item_category) continue;
    const key = keyOf(r.item_description, r.item_category);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      description: r.item_description,
      category: r.item_category as ItemCategory,
      unit: r.unit ?? 'Nos',
      base_price: Number(r.base_price ?? 0),
      source: 'price_book',
    });
  }

  for (const r of boq) {
    if (!r.item_description || !r.item_category) continue;
    const key = keyOf(r.item_description, r.item_category);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      description: r.item_description,
      category: r.item_category as ItemCategory,
      unit: r.unit ?? 'Nos',
      base_price: Number(r.unit_price ?? 0),
      source: 'boq',
    });
  }

  return out;
});
```

- [ ] **Step 2: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: 0 errors. If the `as ItemCategory` cast trips a type check, widen to `string` temporarily and revisit — the migration guarantees DB values are Manivel 15, so the cast is safe at runtime.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/item-suggestions-queries.ts
git commit -m "feat(queries): getItemSuggestions for ItemCombobox data source"
```

---

## Task 6: Create `ItemCombobox` component + `filterAndRank` helper

**Files:**
- Create: `apps/erp/src/components/forms/item-combobox.tsx`

- [ ] **Step 1: Create the component file with types + filter**

Create `apps/erp/src/components/forms/item-combobox.tsx` with:

```typescript
'use client';

import * as React from 'react';
import { Plus, Package } from 'lucide-react';
import { Input } from '@repo/ui';
import type { ItemCategory } from '@/lib/boi-constants';
import { getCategoryLabel } from '@/lib/boi-constants';

export interface ItemSuggestion {
  description: string;
  category: ItemCategory;
  unit: string;
  base_price: number;
  source: 'price_book' | 'boq';
}

export interface ItemComboboxProps {
  /** Current description value (controlled) */
  value: string;
  /** Called on every keystroke. `picked` is set when user selects a suggestion. */
  onChange: (description: string, picked?: ItemSuggestion) => void;
  /** Full suggestion corpus loaded once by the parent. */
  suggestions: ItemSuggestion[];
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Extra classes for the underlying Input (e.g. `text-xs h-8`). */
  className?: string;
}

/**
 * Ranks suggestions against a query.
 *
 * Exact prefix > substring > Jaccard token overlap.
 * Price Book rows get a +5 bonus so curated entries win ties.
 */
export function filterAndRank(
  query: string,
  suggestions: ItemSuggestion[],
  limit = 8,
): ItemSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return suggestions.slice(0, limit);

  const scored = suggestions.map((s) => {
    const desc = s.description.toLowerCase();
    let score = 0;
    if (desc.startsWith(q)) {
      score = 100;
    } else if (desc.includes(q)) {
      score = 50;
    } else {
      const qTokens = new Set(q.split(/\s+/).filter(Boolean));
      const dTokens = new Set(desc.split(/\s+/).filter(Boolean));
      const intersection = [...qTokens].filter((t) => dTokens.has(t)).length;
      const union = new Set([...qTokens, ...dTokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      score = jaccard * 30;
    }
    if (s.source === 'price_book') score += 5;
    return { s, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}
```

- [ ] **Step 2: Append the React component to the same file**

Append to `apps/erp/src/components/forms/item-combobox.tsx`:

```typescript
export function ItemCombobox({
  value,
  onChange,
  suggestions,
  placeholder = 'Type to search items…',
  disabled = false,
  autoFocus = false,
  className = 'text-xs h-8',
}: ItemComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<number>(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(
    () => filterAndRank(value, suggestions, 8),
    [value, suggestions],
  );

  // Show "Create new" row unless query exactly matches an existing suggestion.
  const exactMatch = React.useMemo(
    () => filtered.some((s) => s.description.toLowerCase() === value.trim().toLowerCase()),
    [filtered, value],
  );
  const showCreateNew = value.trim().length > 0 && !exactMatch;

  const totalRows = filtered.length + (showCreateNew ? 1 : 0);

  // Close on outside click
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function pickSuggestion(s: ItemSuggestion) {
    onChange(s.description, s);
    setOpen(false);
    setHighlighted(-1);
  }

  function pickCreateNew() {
    // Keep current value; no `picked` arg means "new item"
    onChange(value);
    setOpen(false);
    setHighlighted(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        setHighlighted(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      setHighlighted((h) => Math.min(h + 1, totalRows - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlighted((h) => Math.max(h - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (highlighted < 0) return;
      if (highlighted < filtered.length) {
        const row = filtered[highlighted];
        if (row) pickSuggestion(row);
      } else if (showCreateNew) {
        pickCreateNew();
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlighted(-1);
      e.preventDefault();
    } else if (e.key === 'Tab') {
      if (highlighted >= 0 && highlighted < filtered.length) {
        const row = filtered[highlighted];
        if (row) pickSuggestion(row);
      }
      // fall through — don't preventDefault, let Tab move focus
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className={className}
        autoComplete="off"
      />

      {open && totalRows > 0 && (
        <div
          className="absolute left-0 top-full mt-1 z-50 w-[420px] max-w-[92vw] bg-white border border-n-200 rounded shadow-lg overflow-hidden"
          role="listbox"
        >
          {filtered.map((s, i) => {
            const isHighlighted = i === highlighted;
            return (
              <button
                key={`${s.source}-${s.description}-${s.category}-${i}`}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                onMouseDown={(e) => {
                  // onMouseDown (not onClick) so the Input doesn't lose focus first
                  e.preventDefault();
                  pickSuggestion(s);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`w-full text-left px-3 py-2 text-xs border-b border-n-100 last:border-b-0 ${
                  isHighlighted ? 'bg-p-50' : 'bg-white hover:bg-n-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <Package className="h-3.5 w-3.5 text-n-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-n-800 truncate">{s.description}</div>
                    <div className="text-[11px] text-n-500 flex items-center gap-1.5 mt-0.5">
                      <span>{getCategoryLabel(s.category)}</span>
                      <span className="text-n-300">·</span>
                      <span>{s.unit}</span>
                      <span className="text-n-300">·</span>
                      {s.base_price > 0 ? (
                        <span className="font-mono">₹{s.base_price.toLocaleString('en-IN')}</span>
                      ) : (
                        <span className="text-amber-600 font-medium">Rate pending</span>
                      )}
                    </div>
                  </div>
                  {s.source === 'price_book' && (
                    <span className="text-[10px] text-p-600 bg-p-50 px-1.5 py-0.5 rounded border border-p-200 flex-shrink-0">
                      Price Book
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {showCreateNew && (
            <button
              type="button"
              role="option"
              aria-selected={highlighted === filtered.length}
              onMouseDown={(e) => {
                e.preventDefault();
                pickCreateNew();
              }}
              onMouseEnter={() => setHighlighted(filtered.length)}
              className={`w-full text-left px-3 py-2 text-xs border-t border-n-200 ${
                highlighted === filtered.length ? 'bg-p-50' : 'bg-white hover:bg-n-50'
              }`}
            >
              <div className="flex items-center gap-2 text-n-600">
                <Plus className="h-3.5 w-3.5" />
                <span>
                  Create new: <span className="font-medium text-n-800">&ldquo;{value}&rdquo;</span>
                </span>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: 0 errors. If `Input` from `@repo/ui` doesn't accept a `ref`, wrap with `React.forwardRef` in the ui package or use a `<input>` directly (match the styling of the existing `Input` by copying its className).

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/forms/item-combobox.tsx
git commit -m "feat(ui): ItemCombobox + filterAndRank (keyboard nav, create-new row)"
```

---

## Task 7: Unit tests for `filterAndRank`

**Files:**
- Create: `apps/erp/src/__tests__/item-combobox-filter.test.ts`

- [ ] **Step 1: Create the test file**

Create `apps/erp/src/__tests__/item-combobox-filter.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { filterAndRank, type ItemSuggestion } from '../components/forms/item-combobox';

const SAMPLE: ItemSuggestion[] = [
  { description: 'Waree 540Wp Mono PERC WSMD-540', category: 'solar_panels', unit: 'Nos', base_price: 13500, source: 'price_book' },
  { description: 'Solar Panel 540W Adani Mono', category: 'solar_panels', unit: 'Nos', base_price: 14200, source: 'price_book' },
  { description: 'Sungrow SG50CX 50kW Inverter', category: 'inverter', unit: 'Nos', base_price: 325000, source: 'price_book' },
  { description: 'Polycab 4 sq mm DC Cable Red', category: 'dc_accessories', unit: 'Meter', base_price: 35, source: 'price_book' },
  { description: 'Polycab 4 sq mm DC Cable Black', category: 'dc_accessories', unit: 'Meter', base_price: 35, source: 'boq' },
  { description: 'Havells 40A DC Isolator', category: 'dc_accessories', unit: 'Nos', base_price: 1200, source: 'boq' },
  { description: 'MC4 Connector Pair', category: 'dc_accessories', unit: 'Pair', base_price: 45, source: 'price_book' },
];

describe('filterAndRank', () => {
  it('returns the top N suggestions when query is empty', () => {
    const result = filterAndRank('', SAMPLE, 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe(SAMPLE[0]);
  });

  it('ranks exact prefix matches highest', () => {
    const result = filterAndRank('waree', SAMPLE);
    expect(result[0]?.description).toContain('Waree');
  });

  it('finds substring matches when no prefix matches', () => {
    const result = filterAndRank('sungrow', SAMPLE);
    expect(result[0]?.description).toContain('Sungrow');
  });

  it('falls back to Jaccard token overlap', () => {
    // "dc cable polycab" — no single word matches as prefix/substring of a full desc
    const result = filterAndRank('dc cable polycab', SAMPLE);
    expect(result.length).toBeGreaterThan(0);
    const top = result[0]?.description ?? '';
    expect(top.toLowerCase()).toMatch(/polycab.*dc cable|dc cable.*polycab/);
  });

  it('prefers Price Book over BOQ when scores tie', () => {
    // "Polycab 4 sq mm DC Cable" appears in both price_book (Red) and boq (Black).
    // They should tie on substring score; Price Book wins via +5 bonus.
    const result = filterAndRank('polycab 4 sq mm', SAMPLE);
    expect(result[0]?.source).toBe('price_book');
  });

  it('respects the limit parameter', () => {
    const result = filterAndRank('', SAMPLE, 3);
    expect(result).toHaveLength(3);
  });

  it('returns zero results when nothing matches', () => {
    const result = filterAndRank('completely-unrelated-xyz', SAMPLE);
    expect(result).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const lower = filterAndRank('waree', SAMPLE);
    const upper = filterAndRank('WAREE', SAMPLE);
    const mixed = filterAndRank('WaReE', SAMPLE);
    expect(lower).toEqual(upper);
    expect(upper).toEqual(mixed);
  });

  it('handles whitespace-only query like empty query', () => {
    const result = filterAndRank('   ', SAMPLE, 5);
    expect(result).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp/apps/erp"
pnpm test -- item-combobox-filter
```

Expected: all 9 tests pass. If the Jaccard or Price Book bonus tests fail, double-check the scoring math in `filterAndRank` (Task 6 Step 1) — the Price Book bonus is `+5` after the base score calculation.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
git add apps/erp/src/__tests__/item-combobox-filter.test.ts
git commit -m "test(ui): filterAndRank scoring tests for ItemCombobox"
```

---

## Task 8: Wire `ItemCombobox` into `BoiInlineAddRow`

**Files:**
- Modify: `apps/erp/src/components/projects/forms/bom-line-form.tsx` (lines 279-405, the `BoiInlineAddRow` function)

- [ ] **Step 1: Add the new imports to the top of the file**

In `apps/erp/src/components/projects/forms/bom-line-form.tsx`, locate the imports block (lines 1-9). Add these two imports:

```typescript
import { ItemCombobox, type ItemSuggestion } from '@/components/forms/item-combobox';
import type { ItemCategory } from '@/lib/boi-constants';
```

The imports block should now look like:

```typescript
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@repo/ui';
import { Plus, Trash2, Save, X } from 'lucide-react';
import { addBomLine, deleteBomLine, lockBoi, unlockBoi, addBoqItem, deleteBoqItem, submitBoiVersion, approveBoiVersion, lockBoiVersion, unlockBoiVersion, createBoiVersion } from '@/lib/project-step-actions';
import { Lock, Unlock, Send, CheckCircle, PlusCircle } from 'lucide-react';
import { BOI_CATEGORIES } from '@/lib/boi-constants';
import { ItemCombobox, type ItemSuggestion } from '@/components/forms/item-combobox';
import type { ItemCategory } from '@/lib/boi-constants';
```

- [ ] **Step 2: Update the `BoiInlineAddRow` signature to accept suggestions**

Find the line:

```typescript
export function BoiInlineAddRow({ projectId, boiId, disabled }: { projectId: string; boiId?: string; disabled?: boolean }) {
```

Replace with:

```typescript
export function BoiInlineAddRow({
  projectId,
  boiId,
  disabled,
  suggestions,
}: {
  projectId: string;
  boiId?: string;
  disabled?: boolean;
  suggestions: ItemSuggestion[];
}) {
```

- [ ] **Step 3: Replace the description `<Input>` with `<ItemCombobox>`**

Inside `BoiInlineAddRow`, find the description cell (the `<td>` containing the Input with `value={row.item_description}`). It currently looks like:

```typescript
        <td className="px-3 py-1.5">
          <Input
            value={row.item_description}
            onChange={(e) => setRow({ ...row, item_description: e.target.value })}
            placeholder="Item Name"
            className="text-xs h-8"
          />
        </td>
```

Replace the contents of that `<td>` with:

```typescript
        <td className="px-3 py-1.5">
          <ItemCombobox
            value={row.item_description}
            onChange={(description, picked) => {
              if (picked) {
                setRow({
                  ...row,
                  item_description: description,
                  item_category: picked.category,
                  unit: picked.unit,
                  unit_price: picked.base_price > 0 ? String(picked.base_price) : row.unit_price,
                });
              } else {
                setRow({ ...row, item_description: description });
              }
            }}
            suggestions={suggestions}
            placeholder="Type to search items…"
            className="text-xs h-8"
          />
        </td>
```

- [ ] **Step 4: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: one type error in `step-bom.tsx` where `<BoiInlineAddRow ... />` is called without the new `suggestions` prop. That's fixed in Task 10.

Leave the error for now — Task 10 fixes it. Do not commit yet.

---

## Task 9: Wire `ItemCombobox` into `BomInlineAddRow` + delete `BOM_CATEGORIES`

**Files:**
- Modify: `apps/erp/src/components/projects/forms/bom-line-form.tsx` (lines 17-39 + 59-205, the `BOM_CATEGORIES` constant and `BomInlineAddRow` function)

- [ ] **Step 1: Delete the local `BOM_CATEGORIES` constant**

In `apps/erp/src/components/projects/forms/bom-line-form.tsx`, delete lines 16-39 (the `// Legacy BOM categories...` comment and the `BOM_CATEGORIES` array). The next line after deletion should be:

```typescript
const UNITS = ['Nos', 'No', 'Meter', 'Set', 'Lot', 'Pair', 'kWp', 'kW', 'Lumpsum', 'nos', 'set', 'meter', 'kg', 'sqft'];
```

(`BOI_CATEGORIES` is already imported from `@/lib/boi-constants` and takes over.)

- [ ] **Step 2: Update `BomInlineAddRow` signature to accept suggestions**

Find:

```typescript
export function BomInlineAddRow({ projectId, hasProposal }: BomLineFormProps) {
```

Replace with:

```typescript
export function BomInlineAddRow({
  projectId,
  hasProposal,
  suggestions,
}: BomLineFormProps & { suggestions: ItemSuggestion[] }) {
```

- [ ] **Step 3: Replace the category `<Select>` with one sourced from `BOI_CATEGORIES`**

Inside `BomInlineAddRow`, find:

```typescript
        <td className="px-3 py-1.5">
          <Select
            value={row.item_category}
            onChange={(e) => setRow({ ...row, item_category: e.target.value })}
            className="text-xs h-8 w-[130px]"
          >
            <option value="">Category...</option>
            {BOM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </td>
```

Replace with:

```typescript
        <td className="px-3 py-1.5">
          <Select
            value={row.item_category}
            onChange={(e) => setRow({ ...row, item_category: e.target.value })}
            className="text-xs h-8 w-[160px]"
          >
            <option value="">Category...</option>
            {BOI_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </td>
```

- [ ] **Step 4: Replace the description `<Input>` with `<ItemCombobox>`**

Inside `BomInlineAddRow`, find:

```typescript
        <td className="px-3 py-1.5">
          <Input
            value={row.item_description}
            onChange={(e) => setRow({ ...row, item_description: e.target.value })}
            placeholder="Description"
            className="text-xs h-8"
          />
        </td>
```

Replace with:

```typescript
        <td className="px-3 py-1.5">
          <ItemCombobox
            value={row.item_description}
            onChange={(description, picked) => {
              if (picked) {
                setRow({
                  ...row,
                  item_description: description,
                  item_category: picked.category,
                  unit: picked.unit,
                  unit_price: picked.base_price > 0 ? String(picked.base_price) : row.unit_price,
                });
              } else {
                setRow({ ...row, item_description: description });
              }
            }}
            suggestions={suggestions}
            placeholder="Description"
            className="text-xs h-8"
          />
        </td>
```

- [ ] **Step 5: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected:
- `bom-line-form.tsx`: 0 errors (the `BOM_CATEGORIES` reference is gone)
- `step-bom.tsx`: still has the "missing `suggestions` prop" error from Task 8
- Any parent of `BomInlineAddRow` (proposal wizard) may have a new "missing `suggestions` prop" error

Locate all callers with Grep to find what Task 13 will need to fix. Don't commit yet — Tasks 10-13 land the fixes together.

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
```

(Use the Grep tool with pattern `BomInlineAddRow` and `BoiInlineAddRow` to get the full caller list.)

---

## Task 10: Thread suggestions through `step-bom.tsx`

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-bom.tsx`

- [ ] **Step 1: Import `getItemSuggestions` at the top of the file**

In `apps/erp/src/components/projects/stepper-steps/step-bom.tsx`, locate the import block (lines 1-14). Add this line after the existing `@/lib/boi-constants` import:

```typescript
import { getItemSuggestions } from '@/lib/item-suggestions-queries';
```

- [ ] **Step 2: Fetch suggestions in the `Promise.all`**

Locate the `Promise.all(...)` on approximately lines 36-40. It currently reads:

```typescript
  const [bois, boiState, boqData] = await Promise.all([
    getBoisForProject(projectId),
    getBoiState(projectId),
    getStepBoqData(projectId),
  ]);
```

Replace with:

```typescript
  const [bois, boiState, boqData, suggestions] = await Promise.all([
    getBoisForProject(projectId),
    getBoiState(projectId),
    getStepBoqData(projectId),
    getItemSuggestions(),
  ]);
```

- [ ] **Step 3: Pass `suggestions` to `BoiInlineAddRow`**

Find the `<BoiInlineAddRow ... />` JSX (approximately line 237). It currently reads something like:

```typescript
<BoiInlineAddRow projectId={projectId} boiId={boi.id} disabled={boi.status !== 'draft'} />
```

Replace with:

```typescript
<BoiInlineAddRow
  projectId={projectId}
  boiId={boi.id}
  disabled={boi.status !== 'draft'}
  suggestions={suggestions}
/>
```

(If `BoiInlineAddRow` is rendered in more than one place in this file, update every call site.)

- [ ] **Step 4: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: the `step-bom.tsx` error from Task 8 is now resolved. Any remaining errors are in other files that render `BoiInlineAddRow` or `BomInlineAddRow` — those are fixed in Tasks 11 and 13.

---

## Task 11: Wire `ItemCombobox` into `BoqAddItemRow` (in `boq-variance-form.tsx`)

**Files:**
- Modify: `apps/erp/src/components/projects/forms/boq-variance-form.tsx`

- [ ] **Step 1: Read the current `BoqAddItemRow` implementation**

Open `apps/erp/src/components/projects/forms/boq-variance-form.tsx` and locate the `export function BoqAddItemRow(...)` block. It has the same pattern as `BoiInlineAddRow`: a description `<Input>`, a category `<Select>` using `BOI_CATEGORIES`, and action buttons.

- [ ] **Step 2: Add the combobox imports at the top of the file**

Add to the existing import block:

```typescript
import { ItemCombobox, type ItemSuggestion } from '@/components/forms/item-combobox';
```

- [ ] **Step 3: Update `BoqAddItemRow` props to accept `suggestions`**

Find the props destructure for `BoqAddItemRow`, e.g.:

```typescript
export function BoqAddItemRow({ projectId, ... }: { projectId: string; ... }) {
```

Add `suggestions: ItemSuggestion[]` to the props type and destructure:

```typescript
export function BoqAddItemRow({
  projectId,
  suggestions,
  // ...existing props
}: {
  projectId: string;
  suggestions: ItemSuggestion[];
  // ...existing props
}) {
```

- [ ] **Step 4: Replace the description `<Input>` with `<ItemCombobox>`**

Find the description `<Input>` inside `BoqAddItemRow` (it will look like `<Input value={...item_description...} onChange={...}`). Replace with the same combobox wiring as Task 8 Step 3:

```typescript
<ItemCombobox
  value={row.item_description}
  onChange={(description, picked) => {
    if (picked) {
      setRow({
        ...row,
        item_description: description,
        item_category: picked.category,
        unit: picked.unit,
        unit_price: picked.base_price > 0 ? String(picked.base_price) : row.unit_price,
      });
    } else {
      setRow({ ...row, item_description: description });
    }
  }}
  suggestions={suggestions}
  placeholder="Item name"
  className="text-xs h-8"
/>
```

(Adapt the `row` state setter calls to match the local state variable names in this file — the pattern is identical but the variable might be `newRow` / `form` / similar.)

- [ ] **Step 5: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: `boq-variance-form.tsx` has 0 errors internally; `step-boq.tsx` now has a "missing suggestions prop" error — fixed in Task 12.

---

## Task 12: Thread suggestions through `step-boq.tsx`

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-boq.tsx`

- [ ] **Step 1: Import `getItemSuggestions`**

Add to the import block (alongside the existing `getStepBoqData` import):

```typescript
import { getItemSuggestions } from '@/lib/item-suggestions-queries';
```

- [ ] **Step 2: Fetch suggestions in the `Promise.all`**

Locate the `Promise.all(...)` (approximately lines 53-58). It currently reads:

```typescript
  const [boqData, bomData, boiState, siteExpenses] = await Promise.all([
    getStepBoqData(projectId),
    getStepBomData(projectId),
    getBoiState(projectId),
    getApprovedSiteExpenses(projectId),
  ]);
```

Replace with:

```typescript
  const [boqData, bomData, boiState, siteExpenses, suggestions] = await Promise.all([
    getStepBoqData(projectId),
    getStepBomData(projectId),
    getBoiState(projectId),
    getApprovedSiteExpenses(projectId),
    getItemSuggestions(),
  ]);
```

- [ ] **Step 3: Pass `suggestions` to `<BoqAddItemRow />`**

Find the `<BoqAddItemRow ... />` JSX (approximately line 322). Add the `suggestions={suggestions}` prop:

```typescript
<BoqAddItemRow
  projectId={projectId}
  suggestions={suggestions}
  // ...any existing props
/>
```

- [ ] **Step 4: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: `step-boq.tsx` now compiles. Any remaining errors are in files using `BomInlineAddRow` (proposal wizard) — fixed in Task 13.

---

## Task 13: Thread suggestions to all `BomInlineAddRow` callers

**Files:**
- Modify: whatever files render `<BomInlineAddRow />` (located via Grep)

- [ ] **Step 1: Locate every caller of `BomInlineAddRow`**

Use Grep to find the call sites:

```
pattern: BomInlineAddRow
glob: **/*.tsx
```

Expected: one or two files under `apps/erp/src/components/proposals/` or `apps/erp/src/app/(erp)/proposals/`. Note each caller's file path.

- [ ] **Step 2: If a caller is a server component**

For each server-component caller:

1. Add the imports:
   ```typescript
   import { getItemSuggestions } from '@/lib/item-suggestions-queries';
   ```
2. Fetch suggestions in the component body or in the existing `Promise.all`:
   ```typescript
   const suggestions = await getItemSuggestions();
   ```
3. Pass the prop:
   ```typescript
   <BomInlineAddRow projectId={projectId} hasProposal={hasProposal} suggestions={suggestions} />
   ```

- [ ] **Step 3: If a caller is a client component**

For each client-component caller, the suggestions must come from a server parent. Walk up the tree until you find a server component, add the fetch there, and thread `suggestions` down as a prop through each layer.

If `BomInlineAddRow` is only used inside `proposal-wizard` (which is a client wizard), the cleanest fix is to load suggestions in the server `page.tsx` for `/proposals/new` or `/proposals/[id]`, then pass down through the wizard's `initialData` or equivalent.

- [ ] **Step 4: If the caller is the BOM step of a multi-step wizard**

Check `apps/erp/src/components/proposals/proposal-wizard/step-bom.tsx` specifically. If it exists and renders `BomInlineAddRow`, look at its parent at `apps/erp/src/components/proposals/proposal-wizard/index.tsx` to see how other data (e.g., price book items) is threaded in.

- [ ] **Step 5: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: 0 errors across all packages. If errors persist, another caller was missed — re-run the Grep.

- [ ] **Step 6: Commit the full combobox wiring (Tasks 8-13 together)**

```bash
git add apps/erp/src/components/projects/forms/bom-line-form.tsx \
        apps/erp/src/components/projects/stepper-steps/step-bom.tsx \
        apps/erp/src/components/projects/forms/boq-variance-form.tsx \
        apps/erp/src/components/projects/stepper-steps/step-boq.tsx
# Plus whatever file(s) Task 13 Step 1 identified:
# git add apps/erp/src/components/proposals/...

git commit -m "feat(forms): wire ItemCombobox into BOI + BOQ + proposal BOM inline add rows

Replaces the dual-vocab category dropdowns (21 legacy values in BomInlineAddRow,
14 Manivel in BoiInlineAddRow) with a single BOI_CATEGORIES source, and swaps the
plain description <Input> for <ItemCombobox> which autocompletes from Price Book
+ recent BOQ items (~950 deduped suggestions). Kills the bug that made
applyPriceBookRates find zero matches because the lookup was cross-vocabulary."
```

---

## Task 14: Role guard on `price-book-actions.ts`

**Files:**
- Modify: `apps/erp/src/lib/price-book-actions.ts`

- [ ] **Step 1: Add the imports + `assertCanEditPriceBook` helper**

In `apps/erp/src/lib/price-book-actions.ts`, add these imports below the existing `createClient` import:

```typescript
import type { AppRole } from '@/lib/roles';
```

Then, immediately after the existing imports (before `getPriceBookItems`), add:

```typescript
const ALLOWED_PRICE_BOOK_EDITORS: AppRole[] = [
  'founder',
  'purchase_officer',
  'finance',
  'project_manager',
];

async function assertCanEditPriceBook(): Promise<
  { ok: true } | { ok: false; error: string; code: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated', code: 'UNAUTHENTICATED' };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (error || !profile) {
    console.error('[assertCanEditPriceBook] profile lookup failed:', error);
    return { ok: false, error: 'Profile lookup failed', code: 'PROFILE_MISSING' };
  }

  if (!ALLOWED_PRICE_BOOK_EDITORS.includes(profile.role as AppRole)) {
    return {
      ok: false,
      error: 'Only founder, purchase officer, finance, and project manager can edit Price Book',
      code: 'ROLE_DENIED',
    };
  }

  return { ok: true };
}
```

Note: this file currently returns `{ success, error }` objects (not `ActionResult<T>`). The helper mirrors that shape with `{ ok, error, code }` to avoid refactoring every existing action in the same pass. Callers translate to `{ success: false, error }` inline.

- [ ] **Step 2: Guard `createPriceBookItem`**

In the `createPriceBookItem` function, add the guard as the first line of the function body (before `const op = ...`):

```typescript
export async function createPriceBookItem(input: {
  // ...existing params
}): Promise<{ success: boolean; error?: string }> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return { success: false, error: guard.error };

  const op = '[createPriceBookItem]';
  const supabase = await createClient();
  // ...rest unchanged
}
```

- [ ] **Step 3: Guard `updatePriceBookItem`**

Add the guard to the top of `updatePriceBookItem`:

```typescript
export async function updatePriceBookItem(input: {
  id: string;
  data: Record<string, any>;
}): Promise<{ success: boolean; error?: string }> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return { success: false, error: guard.error };

  const op = '[updatePriceBookItem]';
  // ...rest unchanged
}
```

- [ ] **Step 4: Guard `deletePriceBookItem`**

Add the guard to the top of `deletePriceBookItem`:

```typescript
export async function deletePriceBookItem(id: string): Promise<{ success: boolean; error?: string }> {
  const guard = await assertCanEditPriceBook();
  if (!guard.ok) return { success: false, error: guard.error };

  const op = '[deletePriceBookItem]';
  // ...rest unchanged
}
```

- [ ] **Step 5: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: 0 errors. If the `AppRole` import path is wrong, adjust to match the actual export — `roles.ts` exports `AppRole` as a type alias over `Database['public']['Enums']['app_role']`.

- [ ] **Step 6: Commit**

```bash
git add apps/erp/src/lib/price-book-actions.ts
git commit -m "feat(security): role guard on price book mutations

Only founder, purchase_officer, finance, and project_manager can create,
update, or delete price book items. Read remains open (RLS-governed).
Non-allowed roles get a clear error via the existing { success, error } shape."
```

---

## Task 15: Add `/price-book` to `project_manager` sidebar

**Files:**
- Modify: `apps/erp/src/lib/roles.ts`

- [ ] **Step 1: Add a "Reference" section to the `project_manager` entry**

In `apps/erp/src/lib/roles.ts`, locate the `project_manager` key under `SECTIONS_BY_ROLE` (approximately lines 110-120). It currently reads:

```typescript
  project_manager: [
    { label: 'Overview',     items: [ITEMS.dashboard, ITEMS.myTasks, ITEMS.myReports] },
    { label: 'Projects',     items: [ITEMS.projects, ITEMS.tasks, ITEMS.dailyReports] },
    { label: 'Approvals',    items: [ITEMS.vouchers] },
    { label: 'Execution',    items: [ITEMS.qcGates] },
    { label: 'Procurement',  items: [ITEMS.purchaseOrders, ITEMS.inventory] },
    // Liaison rehomed to marketing_manager per revamp - PMs see the read-only
    // Liaison step embedded in /projects/[id] detail, no top-level link.
    { label: 'O&M',          items: [ITEMS.serviceTickets, ITEMS.amcSchedule] },
    { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
  ],
```

Replace with:

```typescript
  project_manager: [
    { label: 'Overview',     items: [ITEMS.dashboard, ITEMS.myTasks, ITEMS.myReports] },
    { label: 'Projects',     items: [ITEMS.projects, ITEMS.tasks, ITEMS.dailyReports] },
    { label: 'Approvals',    items: [ITEMS.vouchers] },
    { label: 'Execution',    items: [ITEMS.qcGates] },
    { label: 'Procurement',  items: [ITEMS.purchaseOrders, ITEMS.inventory] },
    { label: 'Reference',    items: [ITEMS.priceBook] },
    // Liaison rehomed to marketing_manager per revamp - PMs see the read-only
    // Liaison step embedded in /projects/[id] detail, no top-level link.
    { label: 'O&M',          items: [ITEMS.serviceTickets, ITEMS.amcSchedule] },
    { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
  ],
```

- [ ] **Step 2: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: 0 errors. `ITEMS.priceBook` is already defined in the `ITEMS` constant at line 54, so no new icon registration needed.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/roles.ts
git commit -m "feat(nav): show Price Book in project_manager sidebar under Reference"
```

---

## Task 16: Rewrite Price Book import script for Manivel 15 + upsert

**Files:**
- Modify: `scripts/import-price-book-from-gdrive.ts`

- [ ] **Step 1: Replace `CATEGORY_MAP` with Manivel-15 targets**

In `scripts/import-price-book-from-gdrive.ts`, locate the `CATEGORY_MAP` constant (approximately lines 42-75). Replace the entire `CATEGORY_MAP` and `mapCategory` block with:

```typescript
// Manivel's sheet header labels → Manivel 15 vocabulary.
// Keeps the quirky spellings (e.g. "Misscellaneous") that exist in the master sheet.
const CATEGORY_MAP: Record<string, string> = {
  'panel': 'solar_panels',
  'solar panel': 'solar_panels',
  'inverter': 'inverter',
  'battery': 'battery',
  'structure': 'mms',
  'mounting structure': 'mms',
  'dc cable': 'dc_accessories',
  'dc & access': 'dc_accessories',
  'dc access': 'dc_accessories',
  'dcdb': 'dc_accessories',
  'ac cable': 'ac_accessories',
  'acdb': 'ac_accessories',
  'lt panel': 'ac_accessories',
  'conduit': 'conduits',
  'conduits': 'conduits',
  'gi cable tray': 'conduits',
  'cable tray': 'conduits',
  'earthing': 'earthing_accessories',
  'earth & access': 'earthing_accessories',
  'earth access': 'earthing_accessories',
  'net meter': 'generation_meter',
  'civil work': 'transport_civil',
  'transport': 'transport_civil',
  'installation labour': 'ic',
  'installation & labour': 'ic',
  'labour': 'ic',
  'miscellaneous': 'miscellaneous',
  'misscellaneous': 'miscellaneous', // Manivel's spelling in the master sheet
  'misc': 'miscellaneous',
  'walkway': 'safety_accessories',
  'handrail': 'safety_accessories',
  'other': 'others',
};

function mapCategory(raw: string): string {
  const key = raw.trim().toLowerCase();
  return CATEGORY_MAP[key] ?? 'others';
}
```

- [ ] **Step 2: Replace the batched insert with a batched upsert**

Locate the commit section (approximately lines 224-238). It currently reads:

```typescript
console.log(`\n${op} COMMITTING to price_book table...`);
const batchSize = 100;
let inserted = 0;
for (let i = 0; i < records.length; i += batchSize) {
  const batch = records.slice(i, i + batchSize);
  const { error } = await supabase.from('price_book').insert(batch as never);
  if (error) {
    console.error(`${op} Batch ${i / batchSize + 1} failed:`, error.message);
    process.exit(1);
  }
  inserted += batch.length;
  console.log(`${op} Inserted ${inserted}/${records.length}`);
}
console.log(`${op} Done — ${inserted} items inserted.`);
```

Replace with:

```typescript
console.log(`\n${op} COMMITTING to price_book table via upsert...`);
const batchSize = 100;
let upserted = 0;
for (let i = 0; i < records.length; i += batchSize) {
  const batch = records.slice(i, i + batchSize);
  // Stamp rate audit fields on every upserted row. rate_updated_by = null
  // distinguishes bulk imports from manual UI edits in the audit trail.
  const stamped = batch.map((r) => ({
    ...r,
    rate_updated_at: new Date().toISOString(),
    rate_updated_by: null,
  }));
  const { error } = await supabase
    .from('price_book')
    .upsert(stamped as never, {
      onConflict: 'item_description,item_category',
      ignoreDuplicates: false,
    });
  if (error) {
    console.error(`${op} Batch ${i / batchSize + 1} upsert failed:`, error.message);
    process.exit(1);
  }
  upserted += batch.length;
  console.log(`${op} Upserted ${upserted}/${records.length}`);
}
console.log(`${op} Done — ${upserted} items upserted.`);
```

- [ ] **Step 3: Run `tsc --noEmit`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: 0 errors. The script is plain TS executed by `tsx`, no JSX — compilation should be quick.

- [ ] **Step 4: Commit the script changes**

```bash
git add scripts/import-price-book-from-gdrive.ts
git commit -m "feat(script): price book import targets Manivel 15 + upsert on (description, category)

Rewrites CATEGORY_MAP to collapse Manivel's sheet labels into Manivel 15 target
values. Changes the batched insert to an upsert keyed on the new unique index
from migration 057, so re-running the script updates existing rows in place
instead of inserting duplicates. Bulk-import rows get rate_updated_by = null
in the audit trail to distinguish them from manual UI edits."
```

---

## Task 17: Execute Price Book re-import

**Files:** (no files modified — this runs the script)

- [ ] **Step 1: Dry-run the import**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
npx tsx scripts/import-price-book-from-gdrive.ts
```

Expected output includes:
- `Mode: DRY-RUN (no DB writes)`
- `Read N raw rows from tab "..."`
- `Detected columns: { category: ..., item: ..., ... }`
- `Parsed N records`
- `Records by DB category:` followed by a breakdown where every category value is one of Manivel 15
- `Raw → DB category mapping:` showing each sheet label and its Manivel target
- `N with rate, M rate-pending`
- `Sample records` (first 3 as JSON)
- `DRY-RUN complete. No DB writes performed.`

If the `Records by DB category:` section shows any value NOT in Manivel 15 (most likely `others` catching an unmapped label), inspect the `Raw → DB category mapping:` section, identify the unmapped label, and add it to `CATEGORY_MAP` in the script before running the commit.

- [ ] **Step 2: Commit the import**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
npx tsx scripts/import-price-book-from-gdrive.ts --commit
```

Expected output:
- `Mode: COMMIT (will insert)`
- `COMMITTING to price_book table via upsert...`
- Progress lines `Upserted 100/217`, `Upserted 200/217`, `Upserted 217/217`
- `Done — 217 items upserted.`

If any batch fails, the script exits non-zero with an error message. Read the error — likely a row with an unmapped category value, or a unique-constraint violation if the index creation in migration 057 somehow didn't run.

- [ ] **Step 3: Verify the price_book row counts**

Run this in the Supabase SQL Editor:

```sql
SELECT COUNT(*) AS active_rows,
       COUNT(*) FILTER (WHERE base_price = 0) AS rate_pending,
       COUNT(DISTINCT item_category) AS categories
FROM price_book
WHERE deleted_at IS NULL AND is_active = true;
```

Expected: `active_rows` around 252 or higher (existing rows + new sheet rows that weren't present before), `categories` <= 15.

- [ ] **Step 4: Spot-check 5 rows**

Compare rates in `/price-book` UI (or via SQL) against the live Google Sheet for 5 items Manivel updated recently. The post-import `base_price` should match the sheet.

---

## Task 18: Run CI gates

**Files:** (no files modified — this is verification)

- [ ] **Step 1: Run `pnpm check-types`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm check-types
```

Expected: 0 errors across all 4 packages (~36s).

- [ ] **Step 2: Run `pnpm lint`**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
pnpm lint
```

Expected: 0 warnings, 0 errors. If any new ESLint warnings appear from Tasks 5-13 code (e.g., unused imports), fix them inline and re-run.

- [ ] **Step 3: Run the unit tests**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp/apps/erp"
pnpm test
```

Expected: all test files pass, including the 2 new ones from Tasks 4 + 7. If tests fail, read the error, fix the code or the test, re-run.

- [ ] **Step 4: Run the forbidden-patterns ratchet**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp"
bash scripts/ci/check-forbidden-patterns.sh
```

Expected: exit 0. Baseline should not grow (57 or lower). If Tasks 5, 6, 8, 9, 11, 14 introduced new `as any`, `count: 'exact'`, or inline supabase imports in `src/app` or `src/components`, the script will call them out — fix the code to use typed rows from `@repo/types`.

If the baseline shrank because Task 14 happened to clean up an old violation, ratchet it down:

```bash
bash scripts/ci/check-forbidden-patterns.sh --update-baseline
git add scripts/ci/.forbidden-patterns-baseline
git commit -m "chore(ci): ratchet forbidden-patterns baseline after category standardisation"
```

---

## Task 19: Manual end-to-end verification

**Files:** (no files modified — this is user-facing verification)

- [ ] **Step 1: Start the dev server**

```bash
cd "C:/Users/vivek/Projects/shiroi-erp/apps/erp"
pnpm dev
```

- [ ] **Step 2: BOI step — combobox + auto-pricing**

1. Navigate to a test project's BOI step: `/projects/<id>` → BOI tab.
2. Create a draft BOI (if none exists) via "Create New BOI".
3. Click "Add Item".
4. In the description cell, type `waree`. Expect: dropdown shows Price Book rows starting with "Waree".
5. Use ↓ and ↵ to pick a row. Expect: category + unit + rate auto-fill.
6. Save the row. Expect: it appears in the BOI table with the Price Book rate.
7. Type `4 in 1 out junction box` (a phrase unlikely to match anything). Expect: no Price Book suggestions, only the `+ Create new: "…"` row at the bottom.
8. Pick create-new. Expect: row created with the typed description, category empty (user must pick manually).

- [ ] **Step 3: BOQ step — combobox + auto-pricing**

1. Navigate to the same test project's BOQ step.
2. Click "Add Item" on the BOQ inline add row.
3. Repeat the combobox flow from Step 2 (search, pick, save).
4. Click "Auto-Price from Price Book" on an existing BOQ line that has `base_price = 0`.
5. Expect: the rate fills in (the row was matched via the 4-strategy fuzzy match). The count should be greater than 0 (previously always 0 due to the dual-vocab bug).

- [ ] **Step 4: Proposal wizard — combobox**

1. Navigate to `/proposals/new` or open an existing draft proposal.
2. Advance to the BOM step.
3. In the add-row description cell, type a query. Expect: combobox shows matching suggestions.
4. Pick a row. Expect: category dropdown shows Manivel 15 values (not the old 21 legacy values).
5. Save. Expect: `proposal_bom_lines` gets a row with a Manivel-15 `item_category` — no CHECK constraint violation.

- [ ] **Step 5: Role visibility — `project_manager` sees Price Book**

1. Log in as a `project_manager` test user.
2. Expect: `/price-book` link visible in the sidebar under a "Reference" section.
3. Navigate to `/price-book`.
4. Double-click a rate cell to edit it. Expect: save succeeds.
5. Log in as a `sales_engineer` test user.
6. Expect: no `/price-book` link in the sidebar.
7. Navigate directly to `/price-book` via URL. Expect: read works (RLS allows SELECT).
8. Try to edit a rate. Expect: server action returns `ROLE_DENIED` error; UI shows the error toast.

- [ ] **Step 6: Price Book re-import verification**

1. Pick 3 items Manivel updated recently in the Google Sheet.
2. Verify their rates on `/price-book` match the sheet values.
3. Check the `rate_updated_at` column — it should be the time of Task 17 Step 2 execution.
4. Check `rate_updated_by` — should be NULL for bulk-imported rows.

- [ ] **Step 7: Regression check — existing historical data**

1. Navigate to `/proposals` and open an old proposal (created before migration 057).
2. Expect: BOM lines still render. Legacy category values (e.g., `dc_cable`, `panel`) display correctly — either via `getCategoryLabel` fallback or via `mapLegacyToManivel`.
3. Do NOT edit an old proposal's BOM line — the CHECK expansion accepts legacy values, so updates to existing rows still work, but we don't want to add a mixed-vocab row in the same proposal.

- [ ] **Step 8: Update CLAUDE.md with completion status**

Open `C:/Users/vivek/Projects/shiroi-erp/CLAUDE.md` and update the CURRENT STATE table. Add a row near the top of the status table:

```markdown
| Category standardisation | ✅ Complete (Apr 15) | Migration 057: 3 tables (project_boq_items, price_book, delivery_challan_items) collapsed to Manivel 15 (strategy C — proposal_bom_lines + purchase_order_items keep legacy via expanded CHECK union). ItemCombobox wired into BOI/BOQ/proposal BOM inline add rows with ~950 deduped suggestions from Price Book + BOQ. BomInlineAddRow's local 21-value BOM_CATEGORIES deleted — now imports BOI_CATEGORIES. Price Book re-imported from Manivel's Google Sheet via upsert on new unique index. project_manager sidebar now shows /price-book under Reference. 0 type errors, all tests pass. |
```

Commit:

```bash
git add CLAUDE.md
git commit -m "docs: mark category standardisation complete in CURRENT STATE"
```

- [ ] **Step 9: Push to GitHub**

```bash
git push origin main
```

Expected: GitHub Actions CI runs `pnpm check-types`, `pnpm lint`, and `scripts/ci/check-forbidden-patterns.sh`. All green.

---

## Out of Scope (from spec §12)

These are NOT part of this plan:

1. Mass migration of `proposal_bom_lines` (33,450 rows) + `purchase_order_items` (2,381 rows) to Manivel vocab.
2. Auto-adding new BOI items to the Price Book.
3. Fuzzy Price Book dedup.
4. `project_site_expenses.expense_category` (separate 8-value enum, 1,168 rows, 99% NULL).
5. Re-rendering historical PDF documents (DCs, POs, invoices).
6. Renaming `boi-constants.ts` → `item-categories.ts`.

---

## Risks (from spec §13, abridged)

| Risk | Task with mitigation |
|---|---|
| Wrong mapping → 701 BOQ rows miscategorized | Task 1 Step 6 (sanity checks abort on any unmapped value) |
| Price Book upsert duplicates if unique index mismatch | Task 1 Step 3 (dedup before index) + Task 16 Step 2 (exact onConflict string) |
| `bom-line-form.tsx` fix breaks existing proposal BOM editing | Task 19 Step 4 (manual test in proposal wizard) |
| `proposal_bom_lines` CHECK missed a legacy value | Task 1 Step 5 lists 31 legacy values — if any rare `item_category` is missing, migration will fail on first UPDATE to an existing row; fix by adding to the union and re-running |
| Service account UUID for `rate_updated_by` missing | Task 16 Step 2 explicitly sets NULL |

---

## Completion Definition

All 19 tasks complete, with:
- `pnpm check-types` clean
- `pnpm lint` clean
- `pnpm test` green (including 2 new test files)
- `scripts/ci/check-forbidden-patterns.sh` exits 0
- Migration 057 applied to dev Supabase
- Price Book re-imported (217 rows upserted)
- Manual verification steps 2-7 pass
- CLAUDE.md updated
- Changes pushed to `main` and GitHub Actions green

Prod deployment is deferred until employee testing week finishes on dev.
