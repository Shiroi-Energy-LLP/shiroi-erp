# Category Standardisation — Design Spec

**Date:** 2026-04-15
**Author:** Claude (approved by Vivek)
**Scope:** Unify 5 modules (BOI, BOQ, Actuals, Purchase, Price Book) on Manivel's 15-category vocabulary; add smart combobox item entry; re-import Price Book from Google Sheet; grant `project_manager` role Price Book access.

---

## 1. Problem Statement

Manivel reported 4 linked issues during PM testing week:

1. **BOM is not pricing from Price Book automatically.** `applyPriceBookRates` finds zero matches because the BOI write path uses one vocabulary (Manivel's 14) while `price_book` uses another (legacy 24 from migration 046). Lookup by `item_category` never intersects, so the earlier Jaccard fix from the April 14 audit (which only runs *within* a category) has no effect.

2. **BOM/BOI forms use two different category dropdowns.** `bom-line-form.tsx` ships two inline add rows:
   - `BomInlineAddRow` (proposal wizard) → local 21-value legacy list → writes to `proposal_bom_lines`
   - `BoiInlineAddRow` (project detail BOI step) → `BOI_CATEGORIES` (Manivel's 14) → writes to `project_boq_items`

   Same user, same file, two vocabularies. This is the structural root cause, not a data issue.

3. **Line item entry is slow and repetitive.** No autocomplete, no suggestions from existing Price Book or recently-used BOQ items. Users type every description from scratch, producing typos and near-duplicates ("Solar Panel 540W Waree" vs "Waree 540W Panel").

4. **Price Book is stale** vs. Manivel's live Google Sheet (217 items). Previous seed in migration 015 was only 35 items; the 217-item import in early April used legacy category mappings. Sheet rates have since changed.

5. **Bonus:** `project_manager` role has no `/price-book` sidebar link, even though PMs are the people on-site getting live vendor quotes.

### Vocabulary gaps found during exploration

- **Battery** has no home in Manivel's 14. 126 `proposal_bom_lines` + 3 `price_book` rows + live BOI items use it. Hybrid projects always have batteries with distinct vendors (Exide, Luminous, lithium imports) and distinct rate bands.
- **`I&C`** currently labelled in `BOI_CATEGORIES` as "I&C (Instrumentation & Control)" (equipment). Manivel's new spec says "I&C (Installation & Commissioning)" (labor — manpower to install panels, commission the inverter, hand over to client). Meaning change, not a typo.

### Data volumes touched

| Table | Rows | Pre-state |
|---|---:|---|
| `proposal_bom_lines` | 33,450 | 100% legacy vocab |
| `project_boq_items` | 701 | ~87% legacy / ~13% Manivel |
| `purchase_order_items` | 2,381 | 100% legacy |
| `price_book` | 252 | 100% legacy |
| `delivery_challan_items` | 59 | mixed |
| `project_site_expenses.expense_category` | 1,168 | 99% NULL (out of scope — separate 8-value enum) |

---

## 2. Decisions Locked With Vivek

| # | Decision | Value |
|---|---|---|
| D1 | Migration strategy | **C — hybrid**. Migrate `project_boq_items` + `price_book` + `delivery_challan_items` only. Leave `proposal_bom_lines` + `purchase_order_items` on legacy vocab (no 33k-row rewrite). |
| D2 | Battery gap | **Add as 15th category**. Final list is 15 values. |
| D3 | I&C meaning | **Installation & Commissioning (labor)**. Value stays `ic`, label changes. |
| D4 | `gi_cable_tray` mapping | **→ `conduits`** (cable routing function, not switchgear) |
| D5 | `lightning_arrestor` mapping | **→ `earthing_accessories`** (protection system routes to earth) |
| D6 | Autocomplete UX | **Combobox** — dropdown below description cell, keyboard-friendly, create-new as last option |
| D7 | Suggestion corpus | **Price Book + `project_boq_items`** (≈950 unique strings after dedup, both on Manivel vocab post-migration) |
| D8 | Auto-add new BOI items to Price Book | **No, BOI-only** — Price Book stays curated. Ship simple first; v2 can add fuzzy-match dedup + auto-promote. |
| D9 | Price Book re-import strategy | **Upsert by `(LOWER(item_description), item_category)`** — no data loss, re-runnable whenever Manivel updates the sheet |
| D10 | Who can edit Price Book rates | **founder + purchase_officer + finance + project_manager** (add PM to existing triple) |

---

## 3. Final Category Vocabulary (15 values)

| # | Value | Display Label |
|---:|---|---|
| 1 | `solar_panels` | Solar Panels |
| 2 | `inverter` | Inverter |
| 3 | `battery` | Battery *(new)* |
| 4 | `mms` | MMS (Module Mounting Structure) |
| 5 | `dc_accessories` | DC & Accessories |
| 6 | `ac_accessories` | AC & Accessories |
| 7 | `conduits` | Conduits |
| 8 | `earthing_accessories` | Earthing & Accessories |
| 9 | `safety_accessories` | Safety & Accessories |
| 10 | `generation_meter` | Generation Meter & Accessories |
| 11 | `ic` | I&C (Installation & Commissioning) *(label change)* |
| 12 | `statutory_approvals` | Statutory Approvals |
| 13 | `transport_civil` | Transport & Civil |
| 14 | `miscellaneous` | Miscellaneous |
| 15 | `others` | Others |

Display order in UI dropdowns: follows the numbered order above (panel → inverter → battery → MMS → DC → AC → conduits → earthing → safety → meter → I&C → statutory → transport → misc → others). This matches the physical flow of a solar installation and is the order Manivel lists categories in verbally.

---

## 4. Legacy → Manivel Mapping Table

Used by migration 055 and by the rewritten `scripts/import-price-book-from-gdrive.ts` CATEGORY_MAP.

| Legacy value(s) | → Manivel 15 | Notes |
|---|---|---|
| `solar_panel`, `panel` | `solar_panels` | Duplicate legacy values both collapse |
| `inverter` | `inverter` | Identity |
| `battery` | `battery` | Identity (new #15, no migration needed) |
| `mounting_structure`, `structure` | `mms` | Duplicate legacy values both collapse |
| `dc_cable`, `dc_access`, `dcdb`, `connector`, `junction_box` | `dc_accessories` | All DC-side BOS |
| `ac_cable`, `acdb`, `lt_panel`, `ht_cable`, `ht_panel`, `transformer`, `bus_duct` | `ac_accessories` | All AC-side BOS + distribution gear |
| `conduit`, `gi_cable_tray` | `conduits` | Cable routing (Vivek correction: GI tray here, not AC accessories) |
| `earthing`, `earth_access`, `lightning_arrestor` | `earthing_accessories` | Vivek correction: LA belongs with earthing |
| `safety_equipment`, `walkway`, `handrail` | `safety_accessories` | Fall prevention + PPE |
| `net_meter`, `monitoring` | `generation_meter` | Meter + monitoring portal both attach here |
| `installation_labour` | `ic` | Labor → I&C |
| `liaison` | `statutory_approvals` | CEIG, DISCOM, net metering |
| `transport`, `civil_work` | `transport_civil` | Identity group |
| `miscellaneous` | `miscellaneous` | Identity |
| `other` | `others` | Singular → plural |

Any row already on a Manivel value passes through unchanged (the `ELSE item_category` branch in the CASE WHEN).

---

## 5. Schema Changes — Migration 055

**File:** `supabase/migrations/055_category_standardisation.sql`

### 5.1. `project_boq_items`

```sql
-- Migrate legacy values to Manivel 15
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

-- Drop any existing CHECK (none exists on this table per migration 024, but be safe)
ALTER TABLE project_boq_items DROP CONSTRAINT IF EXISTS project_boq_items_item_category_check;

-- Add new CHECK = Manivel 15 only
ALTER TABLE project_boq_items ADD CONSTRAINT project_boq_items_item_category_check
  CHECK (item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));
```

### 5.2. `price_book`

Same UPDATE block as 5.1 (different table). Then:

```sql
ALTER TABLE price_book DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE price_book ADD CONSTRAINT price_book_item_category_check
  CHECK (item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));

-- Unique index for upsert conflict target (migration 015 didn't have one)
CREATE UNIQUE INDEX IF NOT EXISTS price_book_desc_cat_unique
  ON price_book (LOWER(TRIM(item_description)), item_category)
  WHERE deleted_at IS NULL;
```

### 5.3. `delivery_challan_items`

Same UPDATE block as 5.1. No existing CHECK (per migration 024). Add new CHECK:

```sql
ALTER TABLE delivery_challan_items ADD CONSTRAINT delivery_challan_items_item_category_check
  CHECK (item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));
```

### 5.4. `proposal_bom_lines` + `purchase_order_items`

**No data migration.** Strategy C leaves these alone.

But the `bom-line-form.tsx` fix (see §7) makes `BomInlineAddRow` start writing Manivel values to `proposal_bom_lines`. Without a schema change, those inserts would fail the existing legacy-26 CHECK constraint from migration 023.

**Fix:** expand the CHECK constraint to accept the *union* of legacy 26 + Manivel 15:

```sql
-- proposal_bom_lines
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

-- purchase_order_items — same expansion
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_item_category_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_item_category_check
  CHECK (item_category IN (
    -- (same union as above)
  ));
```

After the full codebase is on Manivel 15, a future migration can tighten these back down to the 15. Not this pass.

### 5.5. Migration verification

At the end of the migration, run sanity selects inside the same transaction:

```sql
-- Should return 0 for each table
SELECT COUNT(*) FROM project_boq_items
WHERE item_category NOT IN (/* Manivel 15 */);

SELECT COUNT(*) FROM price_book
WHERE item_category NOT IN (/* Manivel 15 */) AND deleted_at IS NULL;

SELECT COUNT(*) FROM delivery_challan_items
WHERE item_category NOT IN (/* Manivel 15 */);
```

Wrap these in `DO $$ BEGIN ... IF count > 0 THEN RAISE EXCEPTION ... END $$;` blocks so the migration aborts on any mapping gap.

---

## 6. Shared Vocabulary Layer

**File:** `apps/erp/src/lib/boi-constants.ts` (kept in place for minimal churn; not renamed)

### 6.1. Changes

```typescript
export const BOI_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'solar_panels',         label: 'Solar Panels' },
  { value: 'inverter',             label: 'Inverter' },
  { value: 'battery',              label: 'Battery' },                          // NEW #3
  { value: 'mms',                  label: 'MMS (Module Mounting Structure)' },
  { value: 'dc_accessories',       label: 'DC & Accessories' },
  { value: 'ac_accessories',       label: 'AC & Accessories' },
  { value: 'conduits',             label: 'Conduits' },
  { value: 'earthing_accessories', label: 'Earthing & Accessories' },
  { value: 'safety_accessories',   label: 'Safety & Accessories' },
  { value: 'generation_meter',     label: 'Generation Meter & Accessories' },
  { value: 'ic',                   label: 'I&C (Installation & Commissioning)' }, // label changed
  { value: 'statutory_approvals',  label: 'Statutory Approvals' },
  { value: 'transport_civil',      label: 'Transport & Civil' },
  { value: 'miscellaneous',        label: 'Miscellaneous' },
  { value: 'others',               label: 'Others' },
] as const;

export type ItemCategory = typeof BOI_CATEGORIES[number]['value'];

export const ITEM_CATEGORY_VALUES: ReadonlyArray<ItemCategory> =
  BOI_CATEGORIES.map(c => c.value);

export function getCategoryLabel(value: string): string {
  return BOI_CATEGORIES.find(c => c.value === value)?.label
    ?? value.replace(/_/g, ' ');
}
```

### 6.2. Legacy mapping helper (new export)

```typescript
/**
 * Maps a legacy category value to Manivel 15. Used by:
 * - Import scripts
 * - Historical data displayed from proposal_bom_lines / purchase_order_items
 * - The combobox fallback when suggesting items from tables that still have legacy values
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

This helper is used by: migration 055 (conceptually — the SQL mirrors this map), import script, any UI that displays historical legacy rows (e.g. proposal detail page showing old BOM lines).

---

## 7. Combobox Component

**New file:** `apps/erp/src/components/forms/item-combobox.tsx`

### 7.1. Component interface

```typescript
interface ItemSuggestion {
  description: string;
  category: ItemCategory;
  unit: string;
  base_price: number;
  source: 'price_book' | 'boq';
}

interface ItemComboboxProps {
  value: string;                                        // current description
  onChange: (description: string, picked?: ItemSuggestion) => void;
  category: ItemCategory | '';
  onCategoryChange: (cat: ItemCategory) => void;
  suggestions: ItemSuggestion[];                        // ~950 items, loaded once
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}
```

When `picked` is non-null, parent auto-fills category + unit + base_price. When `picked` is null, parent treats it as a new-item entry — description is the typed string, category stays whatever the user had selected manually.

### 7.2. Data source — `getItemSuggestions` server action

**New file:** `apps/erp/src/lib/item-suggestions-queries.ts`

```typescript
import 'server-only';
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types';
import type { ItemCategory } from './boi-constants';

export interface ItemSuggestionRow {
  description: string;
  category: ItemCategory;
  unit: string;
  base_price: number;
  source: 'price_book' | 'boq';
}

export async function getItemSuggestions(): Promise<ItemSuggestionRow[]> {
  const op = '[getItemSuggestions]';
  const supabase = await createClient();

  // Fetch Price Book (curated) — up to 500 rows (current count 252, headroom for growth)
  const { data: priceBook, error: pbError } = await supabase
    .from('price_book')
    .select('item_description, item_category, unit, base_price')
    .is('deleted_at', null)
    .eq('is_active', true)
    .limit(500);
  if (pbError) {
    console.error(`${op} price_book query failed:`, pbError);
    return [];
  }

  // Fetch BOQ items — up to 2,000 rows (current count 701, headroom)
  const { data: boqItems, error: boqError } = await supabase
    .from('project_boq_items')
    .select('item_description, item_category, unit, unit_price')
    .limit(2000);
  if (boqError) {
    console.error(`${op} project_boq_items query failed:`, boqError);
    return (priceBook ?? []).map(r => ({
      description: r.item_description,
      category: r.item_category as ItemCategory,
      unit: r.unit ?? 'Nos',
      base_price: Number(r.base_price ?? 0),
      source: 'price_book' as const,
    }));
  }

  // Dedupe by (LOWER(description), category). Price Book wins over BOQ on conflict.
  const seen = new Set<string>();
  const out: ItemSuggestionRow[] = [];

  for (const r of priceBook ?? []) {
    const key = `${(r.item_description ?? '').toLowerCase().trim()}::${r.item_category}`;
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

  for (const r of boqItems ?? []) {
    const key = `${(r.item_description ?? '').toLowerCase().trim()}::${r.item_category}`;
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
}
```

This is a pure read — no `ActionResult<T>` wrapper needed. Called once per parent page mount via `useEffect` and cached in component state.

### 7.3. Client filter + rank (inside the combobox component)

```typescript
function filterAndRank(
  query: string,
  suggestions: ItemSuggestion[],
  limit = 8,
): ItemSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return suggestions.slice(0, limit);

  // Rank: exact prefix > substring > token-overlap (Jaccard)
  const scored = suggestions.map(s => {
    const desc = s.description.toLowerCase();
    let score = 0;
    if (desc.startsWith(q)) score = 100;
    else if (desc.includes(q)) score = 50;
    else {
      // Jaccard token overlap
      const qTokens = new Set(q.split(/\s+/).filter(Boolean));
      const dTokens = new Set(desc.split(/\s+/).filter(Boolean));
      const intersection = [...qTokens].filter(t => dTokens.has(t)).length;
      const union = new Set([...qTokens, ...dTokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      score = jaccard * 30;
    }
    // Price Book bonus (prefer curated)
    if (s.source === 'price_book') score += 5;
    return { s, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.s);
}
```

### 7.4. UI behavior

- **Input state:** `value` (description string), `open` (dropdown visibility), `highlighted` (index of keyboard-highlighted row, `-1` = none)
- **On focus:** `open=true`, show top-8 suggestions (no query)
- **On type:** re-filter, re-rank, show top-8. Keep the `+ Create new: "<query>"` row always visible at the bottom *unless the query exactly matches an existing suggestion*
- **Dropdown row rendering:**
  - Price Book rows: `{description} · {category label} · ₹{base_price}` + amber "Rate pending" badge if `base_price === 0`
  - BOQ rows: same format, with a subtle "recent" tag instead of the curated badge
  - Create-new row: `+ Create new: "{query}"` in `text-muted-foreground` with a `Plus` icon
- **Keyboard:**
  - ↑ / ↓ → navigate highlighted row
  - ↵ → pick highlighted row (or create-new if highlighted)
  - Tab → pick highlighted row and move focus to next cell
  - Escape → close dropdown, restore input to last committed value
- **Mouse:** click a row to pick it, click outside to close

### 7.5. Integration points (3 files)

1. **`apps/erp/src/components/projects/stepper-steps/step-bom.tsx`** (BOI step)
   - Parent loads suggestions once via `await getItemSuggestions()`
   - Passes as prop to `BoiInlineAddRow`
   - `BoiInlineAddRow` swaps its `<input>` for `<ItemCombobox>` for the description cell

2. **`apps/erp/src/components/projects/stepper-steps/step-boq.tsx`** (BOQ step)
   - Same pattern. `BoqAddItemRow` gets the combobox.

3. **`apps/erp/src/components/projects/forms/bom-line-form.tsx`** (proposal wizard)
   - `BomInlineAddRow` gets the combobox *and* its local `BOM_CATEGORIES` (21 legacy values) is deleted — replaced with import from `BOI_CATEGORIES`.
   - This is where the dual-vocab bug dies.
   - New BOM lines written to `proposal_bom_lines` will be on Manivel 15, which is why the CHECK constraint in §5.4 must accept the union.

---

## 8. Price Book Re-Import Script

**File:** `scripts/import-price-book-from-gdrive.ts` (existing file — rewrite)

### 8.1. Category map rewrite

Replace the current `CATEGORY_MAP` (legacy 24 targets) with Manivel 15 targets. Keeps Manivel's sheet header spellings (including "Misscellaneous"):

```typescript
const CATEGORY_MAP: Record<string, ItemCategory> = {
  'panel': 'solar_panels',
  'solar panel': 'solar_panels',
  'inverter': 'inverter',
  'battery': 'battery',
  'structure': 'mms',
  'mounting structure': 'mms',
  'dc cable': 'dc_accessories',
  'dc & access': 'dc_accessories',
  'dc access': 'dc_accessories',
  'ac cable': 'ac_accessories',
  'dcdb': 'dc_accessories',
  'acdb': 'ac_accessories',
  'lt panel': 'ac_accessories',
  'conduit': 'conduits',
  'conduits': 'conduits',
  'earthing': 'earthing_accessories',
  'earth & access': 'earthing_accessories',
  'earth access': 'earthing_accessories',
  'net meter': 'generation_meter',
  'civil work': 'transport_civil',
  'installation labour': 'ic',
  'installation & labour': 'ic',
  'labour': 'ic',
  'transport': 'transport_civil',
  'miscellaneous': 'miscellaneous',
  'misscellaneous': 'miscellaneous',  // Manivel's spelling in the master sheet
  'misc': 'miscellaneous',
  'walkway': 'safety_accessories',
  'gi cable tray': 'conduits',
  'cable tray': 'conduits',
  'handrail': 'safety_accessories',
  'other': 'others',
};

function mapCategory(raw: string): ItemCategory {
  const key = raw.trim().toLowerCase();
  return CATEGORY_MAP[key] ?? 'others';
}
```

Note: `ItemCategory` is now imported from `apps/erp/src/lib/boi-constants.ts`. The script, which lives in a sibling `scripts/` folder, imports through `../apps/erp/src/lib/boi-constants` or (cleaner) copies the type inline — decide at implementation time based on whether ts-node / tsx can resolve the cross-package import.

### 8.2. Insert → upsert

Replace the batched insert with a batched upsert using the new unique index:

```typescript
for (let i = 0; i < records.length; i += batchSize) {
  const batch = records.slice(i, i + batchSize);
  const { error } = await supabase
    .from('price_book')
    .upsert(batch, {
      onConflict: 'lower(item_description), item_category',  // matches unique index
      ignoreDuplicates: false,
    });
  if (error) {
    console.error(`${op} Batch ${i / batchSize + 1} upsert failed:`, error.message);
    process.exit(1);
  }
}
```

On conflict, `base_price`, `vendor_name`, `unit`, `default_qty` all update from the sheet row. `rate_updated_at` and `rate_updated_by` should also be set — we'll need a service-account UUID or NULL them.

**Decision:** set `rate_updated_by = NULL` on import. `rate_updated_at = now()`. This distinguishes bulk imports from manual edits in the audit trail.

### 8.3. Dry-run flag unchanged

`--commit` still gates the actual writes. Default remains dry-run. Script logs the same summary output (records by category, sample records, raw → DB category mapping).

---

## 9. Role Visibility & Edit Permission

### 9.1. Sidebar — `apps/erp/src/lib/roles.ts`

Add `priceBook` to `project_manager` under a new "Reference" section (parallel to designer's and marketing_manager's layout):

```typescript
project_manager: [
  { label: 'Overview',     items: [ITEMS.dashboard, ITEMS.myTasks, ITEMS.myReports] },
  { label: 'Projects',     items: [ITEMS.projects, ITEMS.tasks, ITEMS.dailyReports] },
  { label: 'Approvals',    items: [ITEMS.vouchers] },
  { label: 'Execution',    items: [ITEMS.qcGates] },
  { label: 'Procurement',  items: [ITEMS.purchaseOrders, ITEMS.inventory] },
  { label: 'Reference',    items: [ITEMS.priceBook] },                    // NEW
  { label: 'O&M',          items: [ITEMS.serviceTickets, ITEMS.amcSchedule] },
  { label: 'Contacts',     items: [ITEMS.contacts, ITEMS.companies] },
],
```

`purchase_officer` already has `ITEMS.priceBook` under "Vendor Management" — no change.

### 9.2. Inline rate edit guard — `apps/erp/src/lib/price-book-actions.ts`

Add a role check to `updatePriceBookItem`, `createPriceBookItem`, `deletePriceBookItem`:

```typescript
const ALLOWED_ROLES: AppRole[] = [
  'founder', 'purchase_officer', 'finance', 'project_manager',
];

async function assertCanEditPriceBook(): Promise<ActionResult<void>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated', 'UNAUTHENTICATED');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (error || !profile) return err('Profile lookup failed', 'PROFILE_MISSING');

  if (!ALLOWED_ROLES.includes(profile.role as AppRole)) {
    return err('Only founder, purchase officer, finance, and project manager can edit Price Book', 'ROLE_DENIED');
  }
  return ok(undefined);
}
```

Call at the top of each mutation. Returns the error through the existing `ActionResult<T>` shape (NEVER-DO rule #19 — no throws).

### 9.3. Read visibility

Read (list + detail + lookup) already works for any authenticated user because of RLS. No change needed — the sidebar change alone controls menu visibility; the URL is always reachable if the user types it.

---

## 10. Files to Change — Complete List

| # | File | Change | Kind |
|---|---|---|---|
| 1 | `supabase/migrations/055_category_standardisation.sql` | New migration (§5) | CREATE |
| 2 | `apps/erp/src/lib/boi-constants.ts` | Add Battery, fix I&C label, export `mapLegacyToManivel`, `ItemCategory`, `ITEM_CATEGORY_VALUES` | EDIT |
| 3 | `apps/erp/src/lib/item-suggestions-queries.ts` | New query (`getItemSuggestions`) | CREATE |
| 4 | `apps/erp/src/components/forms/item-combobox.tsx` | New component (§7) | CREATE |
| 5 | `apps/erp/src/components/projects/stepper-steps/step-bom.tsx` | Load suggestions, pass to BoiInlineAddRow | EDIT |
| 6 | `apps/erp/src/components/projects/stepper-steps/step-boq.tsx` | Load suggestions, pass to BoqAddItemRow | EDIT |
| 7 | `apps/erp/src/components/projects/forms/bom-line-form.tsx` | Delete local `BOM_CATEGORIES`, import `BOI_CATEGORIES`, wire combobox into both `BoiInlineAddRow` and `BomInlineAddRow` | EDIT |
| 8 | `apps/erp/src/lib/price-book-actions.ts` | Add `assertCanEditPriceBook` + guard on 3 mutations | EDIT |
| 9 | `apps/erp/src/lib/roles.ts` | Add `ITEMS.priceBook` to `project_manager` under new "Reference" section | EDIT |
| 10 | `scripts/import-price-book-from-gdrive.ts` | Rewrite `CATEGORY_MAP` to Manivel 15, insert → upsert | EDIT |
| 11 | `packages/types/database.ts` | Regenerate after migration 055 | REGEN |
| 12 | `apps/erp/src/__tests__/boi-constants.test.ts` | Unit tests for `mapLegacyToManivel` | CREATE |
| 13 | `apps/erp/src/__tests__/item-combobox-filter.test.ts` | Unit tests for `filterAndRank` | CREATE |

Total: 2 new migrations/files, 7 edits to existing files, 4 new source files, 1 type regen.

---

## 11. Verification Plan

### 11.1. Pre-migration sanity checks

1. Count rows per category on all 6 tables:
   ```sql
   SELECT 'project_boq_items' AS tbl, item_category, count(*) FROM project_boq_items GROUP BY 1,2
   UNION ALL
   SELECT 'price_book', item_category, count(*) FROM price_book WHERE deleted_at IS NULL GROUP BY 1,2
   UNION ALL
   SELECT 'delivery_challan_items', item_category, count(*) FROM delivery_challan_items GROUP BY 1,2
   ORDER BY 1,2;
   ```
2. Save the output. After migration, run again — every row must be on one of the Manivel 15 values.

### 11.2. Migration 055 on dev

1. Paste `055_category_standardisation.sql` into Supabase SQL Editor (dev)
2. Run
3. Verify the in-migration sanity selects returned 0 (no aborts)
4. Re-run the pre-migration query from 11.1 — confirm all rows now Manivel 15
5. Regenerate types: `npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts`
6. `tsc --noEmit` from repo root — must pass

### 11.3. Re-import Price Book

1. `npx tsx scripts/import-price-book-from-gdrive.ts` — dry-run, inspect output
2. `npx tsx scripts/import-price-book-from-gdrive.ts --commit` — upsert
3. Verify row count on `/price-book` page — should match (sheet count) + (any existing rows not in sheet)
4. Spot-check 5 items where Manivel updated rates — confirm `base_price` matches sheet

### 11.4. BOM auto-pricing regression

1. Find a test project with zero-priced BOQ items
2. Click "Auto-Price from Price Book"
3. Expect: >0 items get priced (previously 0). Log the match count.

### 11.5. Combobox manual test

1. Open a BOI step on a test project
2. In the Add Row description cell, type `solar`
3. Expect: dropdown with Price Book items matching "solar" ranked by Jaccard; Price Book rows visually distinct from BOQ rows; `+ Create new: "solar"` at bottom
4. Press ↓ to navigate, ↵ to pick — verify category + unit + rate auto-fill
5. Type `4 in 1 out junction box` (no match) — verify only create-new row shows; press ↵ — verify row created with description filled, category empty
6. Test on BOQ and proposal wizard BOM forms as well

### 11.6. Role visibility

1. Log in as a `project_manager` test user (`/hr/employees` — create one if needed)
2. Verify `/price-book` link appears in sidebar under "Reference"
3. Navigate to `/price-book`, double-click a rate — verify edit succeeds
4. Log in as a `sales_engineer` test user — verify `/price-book` link is NOT in sidebar
5. If sales_engineer tries `/price-book` URL directly, read works (RLS allows), but any attempt to edit a rate returns `ROLE_DENIED`

### 11.7. CI gates

1. `pnpm check-types` — 0 errors across all 4 packages
2. `pnpm lint --max-warnings 0` — 0 new warnings
3. `bash scripts/ci/check-forbidden-patterns.sh` — baseline should NOT grow (ideally shrinks by 1–2 as queries are cleaned up)
4. `pnpm test` in `apps/erp` — new unit tests pass

### 11.8. Prod deployment

Deferred until employee testing week on dev completes. Same migration 055 + re-run the Google Sheet import script targeting prod Supabase.

---

## 12. Out of Scope

Deliberately excluded from this pass:

1. **Mass migration of `proposal_bom_lines` (33,450 rows) and `purchase_order_items` (2,381 rows).** Strategy C. Historical legacy vocab stays intact. Future migration can tighten the expanded CHECK constraints once the codebase is fully on Manivel 15.
2. **Auto-add new BOI items to Price Book.** Deferred v2. Requires fuzzy-dedup at insert time to prevent pollution — more design work needed.
3. **Fuzzy Price Book dedup.** Out of scope for this pass; if users create near-duplicates in Price Book via the manual "Add Item" dialog, Manivel cleans them up manually.
4. **`project_site_expenses.expense_category`.** Separate 8-value CHECK (travel, food, lodging, site_material, tools, consumables, labour_advance, miscellaneous) from migration 033. Not an item category. 1,168 vouchers, 99% NULL. Untouched.
5. **Category renaming in existing reports** (PDFs already generated). They capture a snapshot at render time — no need to re-render historical DCs/POs.
6. **Migrating BOI_CATEGORIES filename to `item-categories.ts`.** Bikeshedding; the imports work fine. Defer.

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mapping table has a wrong entry and 701 BOQ rows get miscategorized | Low | Medium | Migration's post-UPDATE sanity selects abort on any unknown value; Vivek reviewed the mapping table and corrected 2 entries |
| Price Book upsert conflict index is wrong and duplicates silently get created | Low | Low | Unique index is on `(LOWER(TRIM(item_description)), item_category)` — matches onConflict target exactly; dry-run verifies first |
| Combobox performance degrades as BOQ items grow past 2,000 | Low | Low | Client-side filter is O(n) over 950 items — no issue until n > 10k. Revisit with server-side search if that happens |
| `bom-line-form.tsx` fix accidentally breaks existing proposal BOM editing | Medium | High | Manual test on proposal wizard before commit; unit tests where possible |
| `proposal_bom_lines` CHECK constraint expansion misses a legacy value and existing rows fail validation on any UPDATE | Low | Medium | Migration queries `SELECT DISTINCT item_category` on that table first; any unrecognized value is added to the union |
| Service-account UUID for `rate_updated_by` on re-import is missing | Low | Low | Set to NULL explicitly — distinguishes bulk imports from manual edits |
| Manivel's sheet has a typo in a category name not in the CATEGORY_MAP | Medium | Low | Script's `mapCategory` falls back to `'others'` and logs a warning — visible in dry-run output |

---

## 14. Dependencies

- Migration 055 depends on migration 054 (storage RLS perf fix) being applied. Sequential, no conflict.
- Migration 055 must be applied **before** the code changes land, otherwise existing BOI writes will fail the new CHECK constraint on `project_boq_items`.
- Service account key at `C:\Users\vivek\Downloads\shiroi-migration-key.json` (existing, used by prior imports).
- Google Sheet owner `manivel@shiroienergy.com` has shared the sheet with the `shiroi-migaration` service account (existing permission, tested on 14 Apr).

---

## 15. Approval

Design approved by Vivek on 2026-04-15. All 10 decisions (D1–D10) locked. Vocabulary gaps (Battery, I&C) resolved. Mapping corrections applied (`gi_cable_tray` → `conduits`, `lightning_arrestor` → `earthing_accessories`).

Next step: invoke `superpowers:writing-plans` to generate the step-by-step implementation plan.
