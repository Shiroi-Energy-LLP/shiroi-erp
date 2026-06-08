# Leads Page — Referrer Filter Simplification, MGMT Rename, dd/mm/yyyy Date Picker

**Date:** 2026-06-08
**Module:** sales (leads)
**Status:** design approved (2026-06-08) — **implementation PAUSED**, awaiting concurrent VIP→MGMT rename to land.

> **Scope update (2026-06-08).** A concurrent process is renaming VIP→**"MGMT REF"** (canonical term, confirmed by Vivek) across the badge, picker, lead-form, sales page, and comments — it's nearly done. To avoid double-editing, **this plan pauses until that rename is committed**, then covers only the **untouched** threads:
> - §4.A/B/C — 3-bucket referrer filter (No referrer / MGMT / Customer) + query layer.
> - §4.E — `DateRangeFilter` (dd/mm/yyyy calendar) + the July-leak fix.
> - §4.F — `FilterRange` clobber fix.
> - Migration 168 (`p_no_referrer`).
> - Mop-up only if the rename misses it: `leads/[id]/page.tsx` still shows `[VIP]` → `[MGMT REF]`.
>
> The bulk **§4.D VIP→MGMT rename is now OUT of scope** (handled concurrently). Re-verify the final state against the committed rename before writing the implementation plan.

---

## 1. Context & problem

Three issues on the leads page (`apps/erp/src/app/(erp)/leads/page.tsx`), reported by Vivek:

1. **Two "All Sources" dropdowns.** The marketing `source` dropdown is fine. The second dropdown is the **referrer** filter, but its blank default is *also* labelled "All Sources" (duplicate wording), and it carries a redundant "All Internal (Vivek / Mgmt)" sentinel plus the full per-partner list. It should collapse to a small, clear set of buckets.

2. **"VIP" terminology.** Internal/management referrers are surfaced as **VIP** (table badge, picker group, inline-edit prefixes, lead-detail prefix, lead-form helper text). Vivek wants **MGMT** used everywhere; no "VIP".

3. **The "Closing" date filter is wrong in two ways.**
   - The native `<input type="date">` shows the **browser-locale** format (mm/dd/yyyy on a US-locale browser), not dd/mm/yyyy.
   - Filtering **June 1–30 still shows July leads.** Verified against dev DB (`expected_close_date`, non-deleted):

     | window | count |
     |---|---|
     | June 1–30 inclusive | 19 |
     | July | 2 |
     | June 1 onward (no upper bound) | 22 |

     The 22 = 19 June + 2 July + 1 later. Seeing July leads means **only `closeFrom` reaches the query and the upper bound `closeTo` is dropped.** Root cause: `FilterRange` (`apps/erp/src/components/filter-range.tsx`) rebuilds the URL from a **render-time snapshot** of `searchParams` on each input's blur, so the second blur clobbers the first bound.

---

## 2. Goals

1. Replace the leads referrer filter with **"All Referrers" (default, no filter) + No referrer + MGMT + Customer**.
2. Rename **VIP → MGMT** in all user-facing text and supporting comments.
3. Replace the leads "Closing" filter with a **custom dd/mm/yyyy calendar-grid range picker** that commits both bounds atomically (eliminating the dropped-bound bug). The date **display** format ("08 Jun 2026") is unchanged.
4. Fix the shared `FilterRange` snapshot-clobber bug so the **kWp** range (leads + sales) can't silently drop a bound either.

## 3. Non-goals / scope boundaries

- **No change to the global date display format.** `formatDate` / `formatDateFromTimestamp` (256 uses across 90 files) stay as "08 Jun 2026". Confirmed by Vivek.
- **Sales page (`/sales`):** VIP→MGMT labels are updated there too, but its referrer filter keeps its current structure and its date filter keeps native inputs (it still benefits from the `FilterRange` clobber fix). The 3-bucket simplification and calendar picker can be mirrored to sales later on request.
- **Leads inline-edit referrer column** stays best-effort (`partnerOptions=[]`) — unchanged.

---

## 4. Detailed design

### A. Referrer filter → 3 buckets

**Dropdown** (leads page filter bar), replacing the dynamic `referrerOptions`:

```
All Referrers     value=""          → no referrer filter (default)
No referrer       value="none"      → channel_partner_id IS NULL
MGMT              value="mgmt"      → channel_partner_id IN (internal partner ids)
Customer          value="customer"  → channel_partner_id IN (external partner ids)
```

> Note: Vivek asked for "only 3 options (No referrer / MGMT / Customer)". A `<select>` still needs a no-filter state, so "All Referrers" is retained as the top default. **Confirmed at review (2026-06-08).**

**Bucket → id resolution (server, in `page.tsx`):**
- `mgmt` → `getInternalReferrers()` ids (`is_internal = TRUE`).
- `customer` → `getExternalPartnerIds()` (all `is_internal = FALSE`) — matches the "Customer" badge semantics (any external partner, not only `partner_type='referral'`).
- `none` → no ids; set `noReferrer` flag.

The page no longer needs `getReferralPartners()` for a dropdown list; it fetches the id lists only to resolve the active bucket.

### B. Query layer (`apps/erp/src/lib/leads-queries.ts`)

- `LeadFilters`: add **`noReferrer?: boolean`**. Keep existing `referrer` / `referrerIds` fields (the legacy `internal_all` + specific-id paths remain so **/sales does not break**).
- **Normal builder (`getLeads`):**
  - `noReferrer` → `query.is('channel_partner_id', null)`.
  - `referrerIds` (mgmt/customer) → `query.in('channel_partner_id', referrerIds)` (already present).
- **Search path (`getLeadsViaSearchRpc`):** pass `referrerIds` via existing `p_referrer_ids`; pass new **`p_no_referrer`** (see migration).

### C. Migration 168 — `search_leads_by_query` gains `p_no_referrer`

The RPC (migration 152) filters referrers via `p_referrer_ids` (IN-list) and `p_referrer_id` (eq). It has **no way to express `channel_partner_id IS NULL`**, so the "No referrer" bucket would silently no-op when a text search is active. Fix:

- New file: **`supabase/migrations/168_2026-06-08-search-leads-no-referrer.sql`** — `CREATE OR REPLACE FUNCTION search_leads_by_query(...)` adding:
  - param `p_no_referrer BOOLEAN DEFAULT FALSE`,
  - WHERE clause `AND ($N::boolean = FALSE OR l.channel_partner_id IS NULL)`,
  - append the arg to the dynamic-SQL `USING` list with correct placeholder numbering.
- The added param has a DEFAULT, so existing callers are unaffected.
- **Regenerate `packages/types/database.ts`** in the same commit (RPC signature changed → `Functions` type). Run `strip-view-fk-entries.mjs` + `check-types` (per CLAUDE.md regen flow).
- Apply **dev first → verify → prod**.

### D. VIP → MGMT rename

| Location | Now | After |
|---|---|---|
| Table badge — `data-table.tsx:419` | `VIP` / `Customer` | **`MGMT`** / `Customer` |
| Comments — `data-table.tsx:386,412` | VIP | MGMT |
| Picker internal group — `referrer-picker.tsx:46` | `Internal (VIP)` | **`MGMT`** |
| Picker external group — `referrer-picker.tsx:55` | `External Partners` | **`Customer`** |
| Picker prefix — `referrer-picker.tsx:49` | `[VIP] {name}` | `{name}` (group label conveys it) |
| Picker doc comment — `referrer-picker.tsx:20` | VIP | MGMT |
| Sales inline-edit — `sales/page.tsx:198` (+comment :194) | `[VIP] {name}` | **`[MGMT]`** `{name}` |
| Lead detail — `leads/[id]/page.tsx:50` (+comment :44) | `[VIP] ` prefix | **`[MGMT]`** prefix |
| Lead form helper — `lead-form.tsx:264` | "for VIP-track leads" | "for MGMT-referral leads" |
| Comments — `column-config.ts:49`, `partners-queries.ts:88,145` | VIP | MGMT |

External referrers keep the label **"Customer"** (badge already uses it; consistent with the new filter bucket).

### E. New component — `date-range-filter.tsx` (calendar grid)

New client component: `apps/erp/src/components/date-range-filter.tsx`.

**Props:** `label` (e.g. "Closing"), `fromParam` (`"closeFrom"`), `toParam` (`"closeTo"`), optional `className`.

**Behaviour:**
- Reads current `closeFrom`/`closeTo` from `searchParams` (stored as `yyyy-mm-dd`).
- **Trigger button** mirrors the `filter-multi-select` style: empty → shows `label`; set → shows **`dd/mm/yyyy – dd/mm/yyyy`** (or single side, e.g. `≤ 30/06/2026`); active state coloured; has an X to clear.
- **Popover** (absolute panel, outside-click close — same pattern as `filter-multi-select.tsx`) containing a **single-month calendar**:
  - header with `‹` / `›` month nav + "Mon YYYY";
  - weekday row; day grid (leading/trailing blanks for alignment);
  - two-click range selection (1st = from, 2nd = to; if 2nd < 1st, swap); selected range highlighted; today marked;
  - **Apply** (commits) and **Clear** buttons.
- **Atomic commit:** Apply builds one `URLSearchParams` from current `searchParams`, sets/deletes BOTH `fromParam` and `toParam`, deletes `page`, single `router.push`. → the dropped-bound bug is impossible by construction.
- Pure TypeScript, **no new dependency**; uses `@repo/ui` `Button` + Tailwind. Target < 200 LOC; self-contained.

Leads page swaps `<FilterRange label="Closing" minParam="closeFrom" maxParam="closeTo" type="date" />` → `<DateRangeFilter label="Closing" fromParam="closeFrom" toParam="closeTo" />`.

Dates are handled as `yyyy-mm-dd` strings end-to-end (URL → query → DB `gte`/`lte`), compared lexicographically — no timezone drift, no `new Date()` parsing in the filter path.

### F. `FilterRange` clobber fix (kWp + sales)

Give the min/max inputs refs; on blur of **either**, commit **both** values from the refs in a single `router.push` (other params copied from the `searchParams` snapshot — unaffected). This removes the snapshot race for the remaining `FilterRange` usages (kWp on leads + sales, sales date range).

---

## 5. Files touched

- `apps/erp/src/app/(erp)/leads/page.tsx` — 3-bucket referrer dropdown; bucket→id/flag resolution; swap Closing filter to `DateRangeFilter`.
- `apps/erp/src/lib/leads-queries.ts` — `noReferrer` filter; `none`/`mgmt`/`customer` handling in both paths; pass `p_no_referrer`.
- `apps/erp/src/components/date-range-filter.tsx` — **new** calendar range picker.
- `apps/erp/src/components/filter-range.tsx` — clobber fix.
- `apps/erp/src/components/leads/referrer-picker.tsx` — MGMT group, drop `[VIP]`.
- `apps/erp/src/components/data-table/data-table.tsx` — badge `MGMT`; comments.
- `apps/erp/src/components/data-table/column-config.ts` — comment.
- `apps/erp/src/app/(erp)/sales/page.tsx` — `[MGMT]` inline-edit; comment.
- `apps/erp/src/app/(erp)/leads/[id]/page.tsx` — `[MGMT]` prefix; comment.
- `apps/erp/src/components/leads/lead-form.tsx` — helper text.
- `apps/erp/src/lib/partners-queries.ts` — comments.
- `supabase/migrations/168_2026-06-08-search-leads-no-referrer.sql` — **new** RPC migration.
- `packages/types/database.ts` — regenerated (RPC signature).
- `apps/erp/src/lib/leads-queries.test.ts` — extend (bucket resolution + close range).

## 6. Testing

- **Unit** (`leads-queries.test.ts`): referrer bucket → correct filter (none/mgmt/customer); close-range inclusive bounds. Mock the supabase client query builder as existing tests do.
- **Verification (preview):** filter Closing = 01/06/2026–30/06/2026 → **19 leads, no July**; each referrer bucket filters as expected; badges read MGMT/Customer; calendar shows dd/mm/yyyy and spans months.
- **Migration:** apply on dev, sanity-check `search_leads_by_query(..., p_no_referrer => true)` returns only null-referrer leads; then prod.
- **CI gates (all four, read stdout):** `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`.

## 7. Edge cases

- Only one bound set (open-ended range) — `gte`/`lte` already handle this; the picker allows a single-sided selection.
- Range picked end-before-start — swapped on Apply.
- "No referrer" + active text search — correct after migration 168.
- Empty calendar Apply with no selection — treated as Clear.
- `is_internal` toggled on a partner later — buckets resolve ids per request, so always current.
