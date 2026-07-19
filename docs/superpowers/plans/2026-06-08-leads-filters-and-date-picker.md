# Leads Filters + dd/mm/yyyy Date Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the leads referrer filter with 3 buckets (No referrer / MGMT / Customer), build a dd/mm/yyyy calendar date-range picker that fixes the "June shows July" bug, fix the shared FilterRange clobber bug, and mop up the two spots the concurrent VIP→"MGMT REF" rename missed.

**Architecture:** Filter buckets resolve server-side off `channel_partners.is_internal` into `referrerIds`/`noReferrer` query fields (pure helper). "No referrer" + text-search needs a new `p_no_referrer` param on the `search_leads_by_query` RPC (migration 171). The date picker is a self-contained client component (calendar popover, no new dependency) that commits both URL bounds in a single navigation.

**Tech Stack:** Next.js 14 RSC + client components, Supabase (PostgREST + plpgsql RPC), Tailwind, vitest (pure-function tests only — the codebase has no component/query mock harness).

**Canonical term:** **"MGMT REF"** (matches the committed concurrent rename). Date display stays "08 Jun 2026" (unchanged).

---

## File structure

| File | Change |
|---|---|
| `apps/erp/src/lib/leads-helpers.ts` | + pure `resolveReferrerFilter()` + `ReferrerBucket` type |
| `apps/erp/src/lib/leads-queries.test.ts` | + tests for `resolveReferrerFilter` |
| `apps/erp/src/lib/date-range-utils.ts` | **new** — pure date helpers |
| `apps/erp/src/lib/date-range-utils.test.ts` | **new** — tests |
| `apps/erp/src/components/date-range-filter.tsx` | **new** — calendar range picker |
| `apps/erp/src/components/filter-range.tsx` | clobber fix (ref-based atomic commit) |
| `apps/erp/src/lib/leads-queries.ts` | `noReferrer` field + IS NULL + `p_no_referrer` + re-export helper |
| `apps/erp/src/app/(erp)/leads/page.tsx` | 3-bucket dropdown, bucket resolution, swap Closing → DateRangeFilter |
| `supabase/migrations/171_2026-06-08-search-leads-no-referrer.sql` | **new** — drop+recreate RPC with `p_no_referrer` |
| `packages/types/database.ts` | regenerated (RPC signature) |
| `apps/erp/src/app/(erp)/leads/[id]/page.tsx` | `[VIP]` → `[MGMT REF]` (mop-up) |
| `apps/erp/src/components/leads/referrer-picker.tsx` | external group `External Partners` → `Customer` |

---

### Task 1: Pure helper `resolveReferrerFilter` (TDD)

**Files:** Modify `apps/erp/src/lib/leads-helpers.ts`; Test `apps/erp/src/lib/leads-queries.test.ts`.

- [ ] **Step 1: Add the failing test** — append to `leads-queries.test.ts`:

```ts
import { resolveReferrerFilter } from './leads-helpers';

describe('resolveReferrerFilter', () => {
  it('none → noReferrer flag', () => {
    expect(resolveReferrerFilter('none', ['a'], ['b'])).toEqual({ noReferrer: true });
  });
  it('mgmt → internal ids', () => {
    expect(resolveReferrerFilter('mgmt', ['a', 'c'], ['b'])).toEqual({ referrerIds: ['a', 'c'] });
  });
  it('customer → external ids', () => {
    expect(resolveReferrerFilter('customer', ['a'], ['b', 'd'])).toEqual({ referrerIds: ['b', 'd'] });
  });
  it('empty / unknown / undefined → no filter', () => {
    expect(resolveReferrerFilter('', ['a'], ['b'])).toEqual({});
    expect(resolveReferrerFilter(undefined, ['a'], ['b'])).toEqual({});
    expect(resolveReferrerFilter('internal_all', ['a'], ['b'])).toEqual({});
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @repo/erp test -- leads-queries` → fails (no export `resolveReferrerFilter`).

- [ ] **Step 3: Implement** — append to `leads-helpers.ts`:

```ts
export type ReferrerBucket = 'none' | 'mgmt' | 'customer';

/**
 * Resolve the leads-page referrer filter bucket into query fields.
 * - 'none'     → leads with no channel partner (noReferrer)
 * - 'mgmt'     → referred by an internal partner (referrerIds = internalIds)
 * - 'customer' → referred by an external partner (referrerIds = externalIds)
 * Anything else (incl. '' / undefined / legacy 'internal_all') → no filter.
 */
export function resolveReferrerFilter(
  bucket: string | undefined,
  internalIds: string[],
  externalIds: string[],
): { referrerIds?: string[]; noReferrer?: boolean } {
  switch (bucket) {
    case 'none':
      return { noReferrer: true };
    case 'mgmt':
      return { referrerIds: internalIds };
    case 'customer':
      return { referrerIds: externalIds };
    default:
      return {};
  }
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @repo/erp test -- leads-queries`.
- [ ] **Step 5: Commit** — `git add apps/erp/src/lib/leads-helpers.ts apps/erp/src/lib/leads-queries.test.ts && git commit` (deferred — Vivek reviews; commit at end-of-task per his workflow).

---

### Task 2: Pure date utils (TDD)

**Files:** Create `apps/erp/src/lib/date-range-utils.ts`; Test `apps/erp/src/lib/date-range-utils.test.ts`.

- [ ] **Step 1: Write the test** (`date-range-utils.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { isoToDisplay, toIso, buildCalendarMatrix, addMonths, orderRange } from './date-range-utils';

describe('isoToDisplay', () => {
  it('formats yyyy-mm-dd as dd/mm/yyyy', () => {
    expect(isoToDisplay('2026-06-30')).toBe('30/06/2026');
  });
  it('returns empty string for invalid input', () => {
    expect(isoToDisplay('')).toBe('');
    expect(isoToDisplay('nonsense')).toBe('');
  });
});

describe('toIso', () => {
  it('zero-pads month and day', () => {
    expect(toIso(2026, 6, 3)).toBe('2026-06-03');
  });
});

describe('buildCalendarMatrix', () => {
  const cells = buildCalendarMatrix(2026, 6);
  it('returns 42 cells', () => {
    expect(cells).toHaveLength(42);
  });
  it('has exactly 30 in-month days for June', () => {
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
  });
  it('first in-month day is the 1st', () => {
    expect(cells.find((c) => c.inMonth)!.iso).toBe('2026-06-01');
  });
  it('starts the grid on a Monday', () => {
    // 2026-06-01 is a Monday, so cell 0 is in-month.
    expect(cells[0]!.iso).toBe('2026-06-01');
  });
});

describe('addMonths', () => {
  it('rolls forward across year', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
  it('rolls backward across year', () => {
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('orderRange', () => {
  it('swaps when out of order', () => {
    expect(orderRange('2026-06-30', '2026-06-01')).toEqual(['2026-06-01', '2026-06-30']);
  });
  it('leaves ordered/partial input alone', () => {
    expect(orderRange('2026-06-01', '')).toEqual(['2026-06-01', '']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @repo/erp test -- date-range-utils`.

- [ ] **Step 3: Implement** (`date-range-utils.ts`):

```ts
// Pure date helpers for DateRangeFilter. No React / no server imports — safe to
// unit-test and to import from a 'use client' component. All dates are
// 'yyyy-mm-dd' strings, compared lexicographically (no timezone drift).

/** 'yyyy-mm-dd' → 'dd/mm/yyyy'. Returns '' for empty/invalid input. */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Build a 'yyyy-mm-dd' string from numeric parts (month is 1-12). */
export function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface CalendarCell {
  iso: string;
  day: number;
  /** false for leading/trailing days spilled from adjacent months */
  inMonth: boolean;
}

/**
 * 6-row (42-cell) calendar matrix for the given month, weeks starting Monday.
 * Leading/trailing cells carry adjacent-month dates with inMonth=false so the
 * grid is always full and aligned.
 */
export function buildCalendarMatrix(year: number, month: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = (first.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(first);
  start.setUTCDate(1 - firstDow);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    cells.push({ iso: toIso(y, mo, day), day, inMonth: mo === month && y === year });
  }
  return cells;
}

/** Add `delta` months to {year, month(1-12)}. */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = month - 1 + delta;
  return { year: year + Math.floor(zero / 12), month: ((zero % 12) + 12) % 12 + 1 };
}

/** Order two isos ascending; either may be ''. */
export function orderRange(a: string, b: string): [string, string] {
  if (a && b && a > b) return [b, a];
  return [a, b];
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @repo/erp test -- date-range-utils`.
- [ ] **Step 5: Commit** (deferred).

---

### Task 3: `DateRangeFilter` component

**Files:** Create `apps/erp/src/components/date-range-filter.tsx`. Pattern mirrors `filter-multi-select.tsx` (button + absolute popover + outside-click close).

- [ ] **Step 1: Implement** — full component:

```tsx
'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { isoToDisplay, buildCalendarMatrix, addMonths, orderRange } from '@/lib/date-range-utils';

interface DateRangeFilterProps {
  /** Label on the trigger, e.g. "Closing" */
  label: string;
  /** URL param for the inclusive lower bound (yyyy-mm-dd) */
  fromParam: string;
  /** URL param for the inclusive upper bound (yyyy-mm-dd) */
  toParam: string;
  className?: string;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function todayIso(): string {
  // IST "today" for the initial calendar view (fixed offset, dep-free).
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0]!;
}

/**
 * Date-range filter with a dd/mm/yyyy display and a single-month calendar
 * popover. Commits BOTH bounds in one navigation (no per-input blur race —
 * unlike FilterRange), so the upper bound can never be silently dropped.
 * Values are 'yyyy-mm-dd' URL params consumed by the leads query.
 */
export function DateRangeFilter({ label, fromParam, toParam, className }: DateRangeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fromValue = searchParams.get(fromParam) ?? '';
  const toValue = searchParams.get(toParam) ?? '';

  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(fromValue);
  const [draftTo, setDraftTo] = useState(toValue);
  const [view, setView] = useState(() => {
    const seed = fromValue || toValue || todayIso();
    const [y, m] = seed.split('-');
    return { year: Number(y), month: Number(m) };
  });

  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  function openPopover() {
    setDraftFrom(fromValue);
    setDraftTo(toValue);
    const seed = fromValue || toValue || todayIso();
    const [y, m] = seed.split('-');
    setView({ year: Number(y), month: Number(m) });
    setOpen(true);
  }

  function pickDay(iso: string) {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(iso);
      setDraftTo('');
      return;
    }
    const [lo, hi] = orderRange(draftFrom, iso);
    setDraftFrom(lo);
    setDraftTo(hi);
  }

  function commit(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFrom) params.set(fromParam, nextFrom); else params.delete(fromParam);
    if (nextTo) params.set(toParam, nextTo); else params.delete(toParam);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function clear(e?: React.MouseEvent) {
    e?.stopPropagation();
    setDraftFrom('');
    setDraftTo('');
    commit('', '');
  }

  const isActive = !!fromValue || !!toValue;
  const rangeText = `${fromValue ? isoToDisplay(fromValue) : '…'} – ${toValue ? isoToDisplay(toValue) : '…'}`;
  const cells = buildCalendarMatrix(view.year, view.month);

  function inDraftRange(iso: string): boolean {
    if (draftFrom && draftTo) return iso >= draftFrom && iso <= draftTo;
    return iso === draftFrom;
  }

  return (
    <div className={`relative ${className ?? ''}`} ref={popoverRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm border rounded-md bg-white hover:bg-n-50 transition-colors ${
          isActive ? 'border-shiroi-green text-shiroi-green font-medium' : 'border-n-200 text-n-700'
        }`}
      >
        <span className="text-xs font-medium">{label}:</span>
        <span>{isActive ? rangeText : 'All'}</span>
        {isActive && (
          <span
            role="button"
            aria-label="Clear date range"
            onClick={clear}
            className="ml-0.5 flex items-center justify-center w-4 h-4 rounded-full hover:bg-shiroi-green/10 text-shiroi-green"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-n-200 rounded-md shadow-lg p-3 w-[268px]">
          <div className="flex items-center justify-between mb-2">
            <button type="button" aria-label="Previous month" onClick={() => setView((v) => addMonths(v.year, v.month, -1))} className="h-7 w-7 flex items-center justify-center rounded hover:bg-n-100 text-n-600">‹</button>
            <span className="text-sm font-medium text-n-900">{MONTHS[view.month - 1]} {view.year}</span>
            <button type="button" aria-label="Next month" onClick={() => setView((v) => addMonths(v.year, v.month, 1))} className="h-7 w-7 flex items-center justify-center rounded hover:bg-n-100 text-n-600">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-[10px] font-medium text-n-400 text-center py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c) => {
              const selected = inDraftRange(c.iso);
              const isEdge = c.iso === draftFrom || c.iso === draftTo;
              return (
                <button
                  key={c.iso}
                  type="button"
                  onClick={() => pickDay(c.iso)}
                  className={`h-8 text-xs rounded flex items-center justify-center transition-colors ${c.inMonth ? '' : 'text-n-300'} ${
                    isEdge ? 'bg-shiroi-green text-white font-semibold' : selected ? 'bg-shiroi-green/15 text-shiroi-green' : 'hover:bg-n-100 text-n-700'
                  }`}
                >
                  {c.day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-n-100">
            <button type="button" onClick={() => clear()} className="text-xs text-n-500 hover:text-n-900">Clear</button>
            <span className="text-[11px] text-n-500">
              {draftFrom ? isoToDisplay(draftFrom) : 'dd/mm/yyyy'} – {draftTo ? isoToDisplay(draftTo) : 'dd/mm/yyyy'}
            </span>
            <button type="button" onClick={() => commit(draftFrom, draftTo)} className="text-xs font-medium px-3 h-7 rounded-md bg-shiroi-green text-white hover:bg-shiroi-green/90">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `pnpm --filter @repo/erp check-types` passes; visual check deferred to Task 9 preview.

---

### Task 4: `FilterRange` clobber fix

**Files:** Modify `apps/erp/src/components/filter-range.tsx`.

- [ ] **Step 1:** Replace the body so both inputs use refs and any blur commits BOTH bounds in one push:

Replace the import line `import { useRouter, useSearchParams, usePathname } from 'next/navigation';` with:

```tsx
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useRef } from 'react';
```

Replace `handleBlur` (lines ~42-51) with:

```tsx
  const minRef = useRef<HTMLInputElement>(null);
  const maxRef = useRef<HTMLInputElement>(null);

  // Commit BOTH bounds from the live input refs in a single navigation.
  // Reading both refs (not just the blurred input) prevents the snapshot race
  // where a second blur, built from a stale searchParams, drops the first bound.
  function commit() {
    const params = new URLSearchParams(searchParams.toString());
    const min = minRef.current?.value ?? '';
    const max = maxRef.current?.value ?? '';
    if (min) params.set(minParam, min); else params.delete(minParam);
    if (max) params.set(maxParam, max); else params.delete(maxParam);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }
```

Update the two `<input>` elements: add `ref={minRef}` / `ref={maxRef}` and change `onBlur={(e) => handleBlur(minParam, e.target.value)}` / `onBlur={(e) => handleBlur(maxParam, e.target.value)}` both to `onBlur={commit}`.

- [ ] **Step 2: Verify** — `pnpm --filter @repo/erp check-types`.

---

### Task 5: Query layer — `noReferrer` + `p_no_referrer` + re-export

**Files:** Modify `apps/erp/src/lib/leads-queries.ts`.

- [ ] **Step 1:** Extend the re-export (line 7):

```ts
export { isValidTransition, normalizePhone, getValidNextStatuses, resolveReferrerFilter } from './leads-helpers';
export type { ReferrerBucket } from './leads-helpers';
```

- [ ] **Step 2:** Add to `LeadFilters` (after `referrerIds?` block, ~line 17):

```ts
  /** Leads-page "No referrer" bucket → channel_partner_id IS NULL */
  noReferrer?: boolean;
```

- [ ] **Step 3:** In `getLeads` non-search builder, after the `referrerIds` block (after line 144):

```ts
  if (filters.noReferrer) query = query.is('channel_partner_id', null);
```

- [ ] **Step 4:** In `getLeadsViaSearchRpc` `.rpc('search_leads_by_query', {...})` (after `p_referrer_id: referrerId,`):

```ts
    p_no_referrer: !!filters.noReferrer,
```

- [ ] **Step 5: Verify** — `pnpm --filter @repo/erp check-types` (will still pass against current DB types; `p_no_referrer` becomes valid after Task 7 regen — until then `.rpc()` arg is `any`-typed object so it type-checks; confirm).

---

### Task 6: Leads page — 3-bucket dropdown + swap date picker

**Files:** Modify `apps/erp/src/app/(erp)/leads/page.tsx`.

- [ ] **Step 1:** Imports — change line 9 and add new imports:

```ts
import { getInternalReferrers, getExternalPartnerIds } from '@/lib/partners-queries';
```
(remove `getReferralPartners`), add:
```ts
import { resolveReferrerFilter } from '@/lib/leads-queries';
import { DateRangeFilter } from '@/components/date-range-filter';
```

- [ ] **Step 2:** In the `Promise.all`, replace `getReferralPartners()` (line 102) with `getExternalPartnerIds()`, and rename the destructured `externalReferrers` (line 93) to `externalPartnerIds`.

- [ ] **Step 3:** Replace the `referrerIds` resolution (lines 107-108) with:

```ts
  const { referrerIds, noReferrer } = resolveReferrerFilter(
    referrerParam,
    internalReferrers.map((r) => r.id),
    externalPartnerIds,
  );
```

- [ ] **Step 4:** In `leadsFilters` (lines 110-127), remove the `referrer:` and `referrerIds,` lines and add:

```ts
    referrerIds,
    noReferrer,
```
(Leave `filters.referrer` unset — the page now resolves buckets to ids/flag; the legacy `referrer` eq-path in getLeads stays for /sales.)

- [ ] **Step 5:** Delete the `referrerOptions` array (lines 153-161).

- [ ] **Step 6:** Replace the referrer `<FilterSelect>` (lines 227-237) with static options:

```tsx
            <FilterSelect paramName="referrer" className="w-44 h-9 text-sm">
              <option value="">All Referrers</option>
              <option value="none">No referrer</option>
              <option value="mgmt">MGMT</option>
              <option value="customer">Customer</option>
            </FilterSelect>
```

- [ ] **Step 7:** Replace the Closing `<FilterRange ... type="date" />` (lines 248-253) with:

```tsx
            <DateRangeFilter label="Closing" fromParam="closeFrom" toParam="closeTo" />
```

- [ ] **Step 8: Verify** — `pnpm --filter @repo/erp check-types`.

---

### Task 7: Migration 171 — `p_no_referrer` on `search_leads_by_query`

**Files:** Create `supabase/migrations/171_2026-06-08-search-leads-no-referrer.sql`. Then apply to dev + regen types.

- [ ] **Step 1:** Write the migration — drop the old 20-arg signature, recreate with `p_no_referrer` appended (param + `$19` placeholder + USING append + GRANT append). Full SQL:

```sql
-- 171: add p_no_referrer to search_leads_by_query so the leads-page "No referrer"
-- bucket (channel_partner_id IS NULL) works when a text search is also active.
-- Adding a param changes the signature, so DROP the old one first (CREATE OR
-- REPLACE will not replace across a changed arg list — it would overload).

DROP FUNCTION IF EXISTS public.search_leads_by_query(
  TEXT, TEXT[], BOOLEAN, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, DATE,
  UUID[], UUID, BOOLEAN, UUID[], BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT
);

CREATE OR REPLACE FUNCTION public.search_leads_by_query(
  p_query                  TEXT     DEFAULT NULL,
  p_statuses               TEXT[]   DEFAULT NULL,
  p_exclude_converted      BOOLEAN  DEFAULT TRUE,
  p_source                 TEXT     DEFAULT NULL,
  p_segment                TEXT     DEFAULT NULL,
  p_assigned_to            UUID     DEFAULT NULL,
  p_kwp_min                NUMERIC  DEFAULT NULL,
  p_kwp_max                NUMERIC  DEFAULT NULL,
  p_close_from             DATE     DEFAULT NULL,
  p_close_to               DATE     DEFAULT NULL,
  p_referrer_ids           UUID[]   DEFAULT NULL,
  p_referrer_id            UUID     DEFAULT NULL,
  p_referred_by_clients    BOOLEAN  DEFAULT FALSE,
  p_external_partner_ids   UUID[]   DEFAULT NULL,
  p_archived_only          BOOLEAN  DEFAULT FALSE,
  p_include_archived       BOOLEAN  DEFAULT FALSE,
  p_sort                   TEXT     DEFAULT 'created_at',
  p_dir                    TEXT     DEFAULT 'desc',
  p_limit                  INT      DEFAULT 50,
  p_offset                 INT      DEFAULT 0,
  p_no_referrer            BOOLEAN  DEFAULT FALSE     -- channel_partner_id IS NULL filter
)
RETURNS TABLE (
  id                              UUID,
  customer_name                   TEXT,
  phone                           TEXT,
  email                           TEXT,
  city                            TEXT,
  state                           TEXT,
  segment                         TEXT,
  source                          TEXT,
  status                          TEXT,
  estimated_size_kwp              NUMERIC,
  address_line1                   TEXT,
  pincode                         TEXT,
  is_qualified                    BOOLEAN,
  next_followup_date              DATE,
  expected_close_date             DATE,
  close_probability               SMALLINT,
  is_archived                     BOOLEAN,
  assigned_to                     UUID,
  created_at                      TIMESTAMPTZ,
  ai_score                        INT,
  ai_score_reason                 TEXT,
  assigned_to_name                TEXT,
  weighted_value                  NUMERIC,
  referrer_name                   TEXT,
  referrer_is_internal            BOOLEAN,
  total_count                     BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort_col TEXT := COALESCE(NULLIF(p_sort, ''), 'created_at');
  v_dir      TEXT := CASE WHEN lower(COALESCE(p_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;
BEGIN
  IF NOT (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'finance'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'designer'::app_role,
    'marketing_manager'::app_role
  ])) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_sort_col NOT IN (
    'created_at','customer_name','status','estimated_size_kwp','expected_close_date',
    'close_probability','ai_score','next_followup_date'
  ) THEN
    v_sort_col := 'created_at';
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH base AS (
      SELECT
        l.id, l.customer_name, l.phone, l.email, l.city, l.state,
        l.segment::text AS segment, l.source::text AS source, l.status::text AS status,
        l.estimated_size_kwp, l.address_line1, l.pincode,
        l.is_qualified, l.next_followup_date, l.expected_close_date,
        l.close_probability, l.is_archived, l.assigned_to, l.created_at,
        l.ai_score, l.ai_score_reason,
        e.full_name AS assigned_to_name,
        ((COALESCE(l.estimated_size_kwp, 0) * 60000 * COALESCE(l.close_probability, 0)) / 100)::numeric AS weighted_value,
        cp.partner_name AS referrer_name,
        CASE WHEN cp.id IS NULL THEN NULL ELSE cp.is_internal END AS referrer_is_internal
      FROM leads l
      LEFT JOIN employees       e  ON e.id  = l.assigned_to
      LEFT JOIN channel_partners cp ON cp.id = l.channel_partner_id
      WHERE l.deleted_at IS NULL
        AND ($1::text IS NULL OR $1 = '' OR (
          l.customer_name ILIKE '%%' || $1 || '%%'
          OR l.phone        ILIKE '%%' || $1 || '%%'
        ))
        AND (
          ($2::text[] IS NOT NULL AND l.status::text = ANY ($2))
          OR ($2::text[] IS NULL  AND ($3::boolean = FALSE OR l.status::text <> 'converted'))
        )
        AND ($4::text  IS NULL OR l.source::text  = $4)
        AND ($5::text  IS NULL OR l.segment::text = $5)
        AND ($6::uuid  IS NULL OR l.assigned_to    = $6)
        AND ($7::numeric IS NULL OR l.estimated_size_kwp >= $7)
        AND ($8::numeric IS NULL OR l.estimated_size_kwp <= $8)
        AND ($9::date  IS NULL OR l.expected_close_date >= $9)
        AND ($10::date IS NULL OR l.expected_close_date <= $10)
        AND (
          ($11::uuid[] IS NOT NULL AND l.channel_partner_id = ANY ($11))
          OR ($11::uuid[] IS NULL AND ($12::uuid IS NULL OR l.channel_partner_id = $12))
        )
        AND (
          $13::boolean = FALSE
          OR (
            l.source::text = 'referral'
            AND l.channel_partner_id IS NOT NULL
            AND ($14::uuid[] IS NULL OR l.channel_partner_id = ANY ($14))
          )
        )
        -- "No referrer" bucket: channel_partner_id IS NULL
        AND ($19::boolean = FALSE OR l.channel_partner_id IS NULL)
        AND (
          ($15::boolean = TRUE AND l.is_archived = TRUE)
          OR ($15::boolean = FALSE AND ($16::boolean = TRUE OR l.is_archived = FALSE))
        )
    )
    SELECT
      base.*,
      COUNT(*) OVER () AS total_count
    FROM base
    ORDER BY %I %s NULLS LAST
    LIMIT $17 OFFSET $18
  $f$, v_sort_col, v_dir)
  USING
    p_query, p_statuses, p_exclude_converted, p_source, p_segment, p_assigned_to,
    p_kwp_min, p_kwp_max, p_close_from, p_close_to,
    p_referrer_ids, p_referrer_id,
    p_referred_by_clients, p_external_partner_ids,
    p_archived_only, p_include_archived,
    p_limit, p_offset, p_no_referrer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_leads_by_query(
  TEXT, TEXT[], BOOLEAN, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, DATE,
  UUID[], UUID, BOOLEAN, UUID[], BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT, BOOLEAN
) TO authenticated;

COMMENT ON FUNCTION public.search_leads_by_query IS
  'Parameterized leads search. Replaces apps/erp/src/lib/leads-queries.ts getLeads search branch. Returns flattened shape (assigned_to_name, weighted_value, referrer_name, referrer_is_internal) matching the JS post-map. Item 2b; +p_no_referrer (mig 171).';
```

- [ ] **Step 2:** Apply to **dev** via MCP `apply_migration` (project `actqtzoxjilqnldnacqz`, name `search_leads_no_referrer`).
- [ ] **Step 3:** Smoke test on dev via `execute_sql`: `SELECT count(*) FROM search_leads_by_query(p_no_referrer => true);` should equal `SELECT count(*) FROM leads WHERE channel_partner_id IS NULL AND deleted_at IS NULL AND status <> 'converted' AND is_archived = false;`.
- [ ] **Step 4:** Regenerate `packages/types/database.ts` (MCP `generate_typescript_types` → write → `node scripts/strip-view-fk-entries.mjs` → `pnpm check-types`).
- [ ] **Step 5:** **Prod** — left for Vivek to apply (note in handoff). Do NOT apply to prod autonomously.

---

### Task 8: Mop-up renames the concurrent pass missed

**Files:** `apps/erp/src/app/(erp)/leads/[id]/page.tsx`, `apps/erp/src/components/leads/referrer-picker.tsx`.

- [ ] **Step 1:** `leads/[id]/page.tsx` line 44 comment `"[VIP]" prefix` → `"[MGMT REF]" prefix`; line 50 `'[VIP] '` → `'[MGMT REF] '`.
- [ ] **Step 2:** `referrer-picker.tsx` line 55 `<optgroup label="External Partners">` → `<optgroup label="Customer">`.
- [ ] **Step 3: Verify** — `pnpm --filter @repo/erp check-types`.

---

### Task 9: Verify, docs, hand off

- [ ] **Step 1: CI gates (read stdout, don't trust exit notifications):**
  `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`
- [ ] **Step 2: Preview verification:** start dev server; on `/leads` set Closing = 01/06/2026–30/06/2026 → expect **19 leads, no July**; check each referrer bucket (None/MGMT/Customer) filters; calendar shows dd/mm/yyyy and navigates months; clearing works. Screenshot for Vivek.
- [ ] **Step 3: Docs:** append one line to `docs/CHANGELOG.md`; update `docs/modules/sales.md` (referrer filter buckets + date picker); mark spec status done.
- [ ] **Step 4: Commit + push** (after Vivek's review per his workflow): `git add` → `git commit` → `git push origin main`. Flag that **prod migration 171** still needs applying.

---

## Self-review

- **Spec coverage:** §4.A/B (3-bucket filter + query) → Tasks 1,5,6. §4.C migration → Task 7. §4.E DateRangeFilter → Tasks 2,3,6. §4.F FilterRange fix → Task 4. Rename mop-up → Task 8. Verification/docs → Task 9. ✓ No gaps.
- **Placeholders:** none — all code is complete.
- **Type consistency:** `resolveReferrerFilter(bucket, internalIds, externalIds)` defined Task 1, used Task 6; `noReferrer` defined Task 5, set Task 6, consumed Task 5; `p_no_referrer` defined Task 7, passed Task 5; `DateRangeFilter` props (`label`/`fromParam`/`toParam`) match Task 3 ↔ Task 6; date-utils signatures match Task 2 ↔ Task 3. ✓
