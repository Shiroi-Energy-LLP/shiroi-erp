# Proposal financial corruption — investigation + recovery plan

**Status:** REVISED 2026-04-30 — Vivek's decisions applied. Awaiting final OK + HubSpot CSV before Tier A migration runs.
**Date:** 2026-04-26 (initial), revised 2026-04-30
**Origin:** Discovered while fixing dashboard pipeline-value bug (commit `bd82559`).
**Branch:** `claude/friendly-montalcini-e601d1` (worktree)

## Vivek's decisions (2026-04-30)

1. **Threshold:** per-proposal — ₹2L/kWp if `proposals.system_size_kwp` matches `leads.estimated_size_kwp` or `projects.system_size_kwp` within 20%, else ₹5L/kWp. Also: **for any doubtful-kWp Tier A case, flag the kWp itself as uncertain** (not just the financials) — that proposal needs a re-quote AND a re-confirmation of system size.
2. **Reset action:** set financial fields to 0 + add two new boolean columns: `financials_invalidated` (all 130 Tier A) and `system_size_uncertain` (the 24 doubtful-kWp subset). UI banner reads both.
3. **Tier B (17 cases below threshold):** AI re-extraction from each proposal's docx/pdf via Claude Sonnet (~$2 total). Anything that re-extracts to a sane value gets restored; the rest stay banner-flagged.
4. **HubSpot subset (63 proposals):** **Tier D — re-import** with fresh HubSpot CSV that Vivek will provide. May add new leads/projects.
5. **DB CHECK constraint:** ship after data migration (final regression net).
6. **PR ordering:** importer fixes ship as a small standalone PR first; data migration second.

---

## TL;DR

The `proposals.total_after_discount` corruption is **not** a parse-time concatenation bug as initially suspected. It's downstream of two distinct upstream problems:

1. **Lead folders contain mixed files from unrelated customers** (Google Drive migration co-mingled them). Example: the lead folder for "Agro Hyto-Sundar" (4.4 kWp residential) contains `costing_200_kW.xlsx` for a 200 kW BOOT project + files for "Navtoj Pristine Nest" + "Ramaniyam Ratnagiri" — all unrelated.
2. **`extract-bom-all-unprocessed.ts` blindly attaches the largest Excel BOM in each lead folder.** It also accepts pricing matrix / capex summary sheets as if they were per-line BOMs, picking up rows like "Cost /KW in Rs" with `qty=197,211` and `unit_price=₹66,832` as a single line item.

Result: `proposal_bom_lines` ends up with totally wrong totals, and the `subtotal_supply` / `total_after_discount` fields on `proposals` are derived from those wrong BOM sums (×1.12 for GST).

The user-supplied list (PV147, PV121, PV306, SE/PV/069, PV320) confirms this — every single one has `total_after_discount ≈ subtotal_supply × 1.12 ≈ BOM_sum × 1.12`. The 1.12 factor is GST, not the corruption ratio.

A second, smaller failure mode: **63 of 144 HubSpot-migrated proposals also have implausibly high totals**, sourced from HubSpot's `Total Project Value` field via `parseAmount()`. This is data quality in HubSpot, not a parse bug — but our importer doesn't sanity-check it.

## Scope under Vivek's adaptive threshold rule (verified 2026-04-30)

`scripts/verify-kwp-and-tier-b.ts` was run against dev. Full Tier A list saved to `scripts/data/tier-a-targets.json`.

| Bucket | Count | What happens |
|---|---|---|
| Total proposals | 752 | — |
| With non-zero total | 647 | — |
| Suspicious (≥₹2L/kWp) | 210 | — |
| **Tier A — confident kWp, total > ₹2L/kWp** | **106** | **Reset financials, set `financials_invalidated = true`** |
| **Tier A — doubtful kWp, total > ₹5L/kWp** | **24** | **Reset financials, set `financials_invalidated = true`** |
| **Tier A total (non-HubSpot)** | **130** | mass UPDATE in migration 088 |
| Tier B — non-HubSpot, ≥₹2L/kWp, below threshold | 17 | UI banner only; deferred for manual review (none have automated truth signals — see below) |
| **Tier D — HubSpot-migrated, ≥₹2L/kWp** | **63** | re-import workflow (separate PR) once Vivek provides fresh HubSpot CSV |

The dashboard fix in `bd82559` (filter to `negotiation` only) hides this for the dashboard, but `/sales/[id]` and other surfaces still display the absurd numbers directly.

### kWp confidence definition

A proposal's `system_size_kwp` is treated as **confident** if EITHER:
- `leads.estimated_size_kwp` exists AND differs from proposal kWp by less than 20%, OR
- A `projects` row exists for this proposal AND `projects.system_size_kwp` differs by less than 20%.

Otherwise **doubtful**. Examples in the doubtful bucket: `PV200/24` (proposal=284 kWp, lead=4.4 kWp), `PV295/24-25` (proposal=2 kWp, lead=72 kWp), several with `lead.estimated_size_kwp = NULL`.

### Tier B verification — what we tried

For the 17 Tier B candidates (non-HubSpot, ₹2L–threshold kWp), we checked three automated truth signals:

| Signal | Hits |
|---|---|
| `projects.contracted_value` for accepted proposals | 0 |
| Sum of `payments.amount` for the project | 0 |
| Sane sister revision (different `proposals` row for same lead with per-kWp < ₹2L) | 0 |

**None of the 17 have any automated recovery signal in dev.** This is partly because the Shiroi ERP is early-stage — payments and projects are sparsely populated. Conclusion: defer the 17 to a UI banner, no migration action. Optional fallback: AI re-extraction from the proposal's docx/pdf via `scripts/ai-extract-pipeline.ts` (Claude-Sonnet, ~$0.10 per doc) if Vivek wants, but cheap to defer.

## Evidence — what's actually in the data

For PV147/25-26 (Agro Hyto-Sundar, lead size 4.4 kWp):
- `total_after_discount` = ₹98,509 Cr
- `subtotal_supply` = ₹87,954 Cr; `gst_supply` = ₹10,554 Cr (≈ 12% of supply)
- `total ≈ subtotal_supply × 1.12` ✓ (so the field arithmetic is internally consistent)
- 28 BOM lines summing to ₹87,954 Cr — top contributors:
  - Line 26: "Unnamed item" qty=680,000 LS unit=₹761,600 total=₹51,788 Cr
  - Line 27: "Unnamed item" qty=500,000 LS unit=₹560,000 total=₹28,000 Cr
  - Line 28: "Unnamed item" qty=270,000 LS unit=₹302,400 total=₹8,164 Cr
  - Line 1: "Solar Modules 550 Wp" qty=240,000 Watts unit=₹13.9 total=₹37.36 L (real-ish; 240,000 Wp ≈ 240 kWp project, not 4.4 kWp)
- Lead folder contents: `costing_200_kW.xlsx` (200 kW BOOT) + Navtoj Pristine Nest files + Ramaniyam Ratnagiri 4.4 kWp files. The 4.4 kWp lead got someone else's 240 kW BOM.

For PV306/24-25 (Balu, 3.3 kWp): the lead folder also contains `Proposal_for_1.3_MW_Eddamanal.docx`. The BOM has 63 lines but only 22 unique (description, unit_price) pairs — many rows triplicated. Top two contributing lines are blank-description summary rows with `total = ₹1,665 Cr` and `₹833 Cr`.

For SE/PV/069/22-23 (Ponnis Hotel, 10 kWp): 69 BOM lines, top contributors are rows literally named "Cost /KW in Rs" with `qty = 197,211 LS` and `unit_price = ₹66,832/kW` totalling ₹1,318 Cr — these are not BOM lines, they're cells from a capex-summary sheet that the Excel parser misinterpreted as line items.

## Root cause — confirmed

Three failures stack:

### 1. Lead folders co-mingled (Google Drive migration era)
Files for unrelated customers ended up in the same lead's `proposal-files/<lead_uuid>/` folder. This is historical and probably not fully reversible without a manual review of each folder — there's no clean "which file belongs to which lead" signal beyond filename + customer name.

### 2. `extract-bom-all-unprocessed.ts` over-eager file-matching
At `scripts/extract-bom-all-unprocessed.ts:198`, the script does direct match by `file.folder_id === target.lead_id` — i.e., any Excel in the lead's folder is fair game. The fuzzy filename matching at `tokenize`+`matchScore` is only used for cross-folder strategies; intra-folder it just takes the first costing/BOM file by name.

Result: a folder containing `costing_200_kW.xlsx` (intended for a different project) gets parsed and attached to the lead's only proposal.

### 3. `excel-parser.ts` (`parseCostingSheet`) lacks sanity checks
At `scripts/excel-parser.ts:357`:
- `parseBOMSheet` accepts ANY row with description + numeric values as a BOM line, including:
  - Capex-summary rows like "Cost /KW in Rs"
  - Pricing matrix totals
  - Subtotal rows that escape the `/^(sub)?total|grand\s*total/i` skip
- `parseSummarySheet` regex-matches "Supply Cost" / "Installation Cost" / "Grand Total" cells, but doesn't validate the values are in the expected per-kWp range.
- The fallback at line 405 (`summary.total_cost = bestLines.reduce((sum, l) => sum + l.total_price, 0)`) blindly sums whatever `parseBOMSheet` returned, including the garbage rows.
- No "is this plausible for the system size" guardrail anywhere.

## Recovery approach

Four tiers, three different actions. No recovery from BOM lines (they're the corruption source — recomputing from them gives the same wrong answer).

### Tier A — adaptive threshold (130 proposals, non-HubSpot)

**Rule:**
- If `proposals.system_size_kwp` matches `leads.estimated_size_kwp` within 20% (or there's a sane `projects.system_size_kwp` match): threshold is **₹2L/kWp** → 106 proposals.
- Otherwise (lead size NULL or mismatched): threshold is **₹5L/kWp** → 24 proposals.

**Action:** Reset all financial fields to 0; set new `financials_invalidated = true` flag; append audit note. Delete contaminating BOM lines.

The migration uses two `audit_targets` CTEs — one per threshold — then the UPDATE / DELETE applies to their union. Schema change: a new `financials_invalidated BOOLEAN NOT NULL DEFAULT FALSE` column on `proposals` (migration 087).

```sql
-- Migration: 087_proposal_data_quality_flags.sql
BEGIN;
ALTER TABLE proposals
  ADD COLUMN financials_invalidated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN financials_invalidated_at TIMESTAMPTZ,
  ADD COLUMN financials_invalidated_reason TEXT,
  ADD COLUMN system_size_uncertain BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_proposals_financials_invalidated
  ON proposals(financials_invalidated)
  WHERE financials_invalidated = TRUE;

CREATE INDEX idx_proposals_system_size_uncertain
  ON proposals(system_size_uncertain)
  WHERE system_size_uncertain = TRUE;
COMMIT;
```

```sql
-- Migration: 088_reset_corrupted_proposal_financials.sql
BEGIN;

-- Tier A targets: union of confident-kWp + doubtful-kWp under Vivek's adaptive rule.
-- HubSpot-migrated proposals (hubspot_deal_id IS NOT NULL) are excluded — those go
-- through the Tier D re-import workflow, not this reset.
CREATE TEMP TABLE tier_a_targets AS
WITH lead_sizes AS (
  SELECT id, estimated_size_kwp FROM leads
),
project_sizes AS (
  SELECT proposal_id, MAX(system_size_kwp) AS projects_size_kwp
  FROM projects
  WHERE proposal_id IS NOT NULL
  GROUP BY proposal_id
),
classified AS (
  SELECT
    p.id,
    p.proposal_number,
    p.system_size_kwp,
    p.total_after_discount,
    p.total_after_discount / NULLIF(p.system_size_kwp, 0) AS per_kwp,
    p.hubspot_deal_id,
    ls.estimated_size_kwp AS lead_size,
    ps.projects_size_kwp,
    -- "confident" = lead size OR project size matches proposal size within 20%
    (
      (ls.estimated_size_kwp IS NOT NULL
        AND ls.estimated_size_kwp > 0
        AND ABS(p.system_size_kwp - ls.estimated_size_kwp)
            / GREATEST(p.system_size_kwp, ls.estimated_size_kwp) < 0.2)
      OR
      (ps.projects_size_kwp IS NOT NULL
        AND ps.projects_size_kwp > 0
        AND ABS(p.system_size_kwp - ps.projects_size_kwp)
            / GREATEST(p.system_size_kwp, ps.projects_size_kwp) < 0.2)
    ) AS kwp_confident
  FROM proposals p
  LEFT JOIN lead_sizes ls ON ls.id = p.lead_id
  LEFT JOIN project_sizes ps ON ps.proposal_id = p.id
  WHERE p.total_after_discount IS NOT NULL
    AND p.total_after_discount > 0
    AND p.system_size_kwp > 0
    AND p.hubspot_deal_id IS NULL  -- Tier D handles these separately
)
SELECT id, proposal_number, system_size_kwp, total_after_discount, per_kwp,
       lead_size, projects_size_kwp, kwp_confident
FROM classified
WHERE
  (kwp_confident AND per_kwp > 200000)      -- ₹2L/kWp threshold for confident
  OR (NOT kwp_confident AND per_kwp > 500000); -- ₹5L/kWp threshold for doubtful

-- Sanity check before mutating. Expect ~130 rows in dev as of 2026-04-30.
SELECT
  COUNT(*) AS total_targets,
  COUNT(*) FILTER (WHERE kwp_confident) AS confident_targets,
  COUNT(*) FILTER (WHERE NOT kwp_confident) AS doubtful_targets,
  MAX(per_kwp) AS max_per_kwp,
  MIN(per_kwp) AS min_per_kwp
FROM tier_a_targets;

-- Reset financials and flag the row. The 24 doubtful-kWp rows ALSO get
-- system_size_uncertain = TRUE so the UI tells the SE to verify the kWp itself
-- before requoting (not just the price).
UPDATE proposals AS p
SET
  total_after_discount = 0,
  total_before_discount = 0,
  subtotal_supply = 0,
  subtotal_works = 0,
  gst_supply_amount = 0,
  gst_works_amount = 0,
  shiroi_revenue = 0,
  shiroi_cost = 0,
  gross_margin_amount = 0,
  gross_margin_pct = 0,
  financials_invalidated = TRUE,
  financials_invalidated_at = NOW(),
  financials_invalidated_reason = format(
    'Reset by migration 088 on %s. Original total_after_discount=%s for system_size_kwp=%s (per-kWp=%s, threshold=%s, kwp_confident=%s). Cause: BOM extracted from wrong file in co-mingled lead folder. Re-quote to populate.',
    NOW()::date,
    t.total_after_discount,
    t.system_size_kwp,
    ROUND(t.per_kwp),
    CASE WHEN t.kwp_confident THEN '₹2L/kWp' ELSE '₹5L/kWp' END,
    t.kwp_confident
  ),
  system_size_uncertain = NOT t.kwp_confident
FROM tier_a_targets t
WHERE p.id = t.id;

-- Drop the contaminating BOM lines (otherwise re-summing them re-corrupts).
DELETE FROM proposal_bom_lines
WHERE proposal_id IN (SELECT id FROM tier_a_targets);

COMMIT;
```

### Tier B — AI re-extraction + banner (17 proposals, non-HubSpot, ≥₹2L/kWp but below threshold)

**Step 1 — AI re-extraction.** Script `scripts/ai-reextract-tier-b.ts` is ready (worktree-local). For each candidate:
1. List files in the lead's storage folder.
2. Pick the most plausible proposal doc (prefers customer-name match in filename, latest revision, `.docx` over `.pdf`).
3. Extract text via `mammoth` (docx) or `pdf-parse` (pdf).
4. Send to Claude Sonnet with the existing `PROPOSAL_EXTRACTION_PROMPT` from `scripts/ai-extract-prompts.ts`.
5. Validate against `ProposalDocSchema` from `scripts/ai-extract-schemas.ts`.
6. Compare extracted `total_cost / system_size_kwp` to stored values.
7. Classify: **recoverable** (extracted per-kWp ≤ ₹2L), **still-suspicious** (extracted also implausible), or **no-signal** (no doc / parse failed / Claude returned nothing).

Output saved to `scripts/data/tier-b-reextraction-results.json`. Estimated cost ~$2 for 17 docs at ~1k tokens each.

> **Blocker:** `ANTHROPIC_API_KEY` is empty in `.env.local` (line 12). Add it before running PR 2 step that executes this script.

**Step 2 — Apply recoveries.** A second migration 088b applies extracted values for `recoverable` rows, leaves the rest untouched. Specific UPDATE generated from the JSON output.

**Step 3 — Banner.** For everything still flagged after re-extraction (still-suspicious + no-signal), the same UI banner from migration 088 surfaces them — driven by either `financials_invalidated = TRUE` OR `total_after_discount / system_size_kwp > 200000`. SE manually re-quotes from there.

We confirmed via `verify-kwp-and-tier-b.ts` that none of the 17 have `projects.contracted_value`, `payments.amount`, or sane sister revisions populated, so AI re-extraction is the only automated recovery path remaining.

### Tier C — Leave alone (everything below ₹2L/kWp)

437 proposals. Includes legitimate premium hybrid installs and small data quality issues that don't justify a mass UPDATE.

### Tier D — HubSpot re-import (63 proposals)

These came from `migrate-hubspot.ts` using HubSpot CSV's `Total Project Value` field. They're excluded from the Tier A migration via `hubspot_deal_id IS NULL` in the temp table.

Workflow (separate PR after Vivek delivers the fresh CSV):
1. Vivek exports an updated HubSpot deals CSV (with corrected `Total Project Value` per deal).
2. New script `scripts/reimport-hubspot-financials.ts`:
   - For each row in the CSV, look up `proposals` by `hubspot_deal_id`.
   - If found: UPDATE `total_before_discount`, `total_after_discount`, `shiroi_revenue` to the CSV value. Run the same ₹5L/kWp sanity check; reject if exceeded.
   - If not found: INSERT new lead + proposal + (if won) project, exactly as `migrate-hubspot.ts` does today, with the importer fix applied.
3. Set `financials_invalidated = FALSE` for any HubSpot proposal that got refreshed.
4. Anything still suspicious after re-import gets the Tier B UI banner treatment.

Until Vivek provides the CSV, the 63 corrupted HubSpot proposals continue to display wrong values **but** the UI banner from Tier B (above) flags them as "needs review", so they're not silently misleading.

## Importer fixes (must ship alongside the data migration)

Without these, the next BOM extraction run reintroduces the corruption.

### 1. `scripts/excel-parser.ts` — sanity-check parsed totals

```ts
// At the end of parseCostingSheet, before returning:
const MAX_PLAUSIBLE_PER_KWP = 500_000;  // ₹5L/kWp — already very generous
if (systemSize && summary.total_cost) {
  const perKwp = summary.total_cost / systemSize;
  if (perKwp > MAX_PLAUSIBLE_PER_KWP) {
    quality = 'low';
    summary.total_cost = null;
    summary.supply_cost = null;
    summary.installation_cost = null;
    // Don't propagate corrupted summary; let downstream skip via empty quality.
  }
}

// In parseBOMSheet, reject obviously-not-a-line-item rows:
// — qty exceeding plausible scale (e.g. > 100,000 with unit "LS"/"No's")
// — desc that's only "Unnamed item" or empty after cleanup
// — total_price > ₹50L for residential (panel ≤ 50 in count); current rows have ₹500Cr+
```

### 2. `scripts/extract-bom-all-unprocessed.ts` — stricter file matching

Currently at line 198 the direct-folder-match takes any costing/BOM file. Add:

```ts
// For "direct lead_id match" strategy:
// — require filename to contain at least one customer-name token (≥4 chars), OR
// — flag file as ambiguous (multiple customer names appear in folder) → skip
const customerTokens = tokenize(target.customer_name);
const fileTokens = tokenize(file.filename);
const fileMatchesCustomer = customerTokens.some(t =>
  fileTokens.some(ft => ft.includes(t) && t.length >= 4)
);
if (!fileMatchesCustomer) continue;  // Don't trust an arbitrary BOM in a co-mingled folder.
```

This wouldn't have caught PV306 (file `Balu.xlsx` matches customer "Balu"), but would have caught PV147 (`costing_200_kW.xlsx` doesn't match "Agro Hyto-Sundar").

### 3. `scripts/migrate-hubspot.ts` — validate Total Project Value

```ts
// Around line 1152, before assigning totalProjectValue:
const tpv = parseAmount(deal['Total Project Value']) ?? 0;
const sizeKwp = sizeKwp ?? 5;
if (tpv > sizeKwp * MAX_PLAUSIBLE_PER_KWP) {
  console.warn(`${op} Skipping implausible TPV ₹${tpv} for ${sizeKwp} kWp deal "${dealName}"`);
  // Either set to 0 or store NULL with note. Don't propagate the bad number.
  totalProjectValue = 0;
  notesAddendum = `[HubSpot Migration] Original TPV ₹${tpv} dropped — implausible for ${sizeKwp} kWp.`;
}
```

### 4. (Optional) DB-level guardrail

```sql
-- Migration: 089_proposal_total_sanity_constraint.sql
ALTER TABLE proposals
  ADD CONSTRAINT proposal_total_sanity
  CHECK (
    total_after_discount IS NULL
    OR system_size_kwp IS NULL
    OR system_size_kwp = 0
    OR total_after_discount <= system_size_kwp * 1000000  -- ₹10L/kWp absolute ceiling
  );
```

This rejects writes more extreme than ₹10L/kWp at the DB level. Set higher than the importer's ₹5L threshold so importer warnings happen first; the DB constraint is a final safety net.

## What I am NOT doing in this plan

- **Not** recovering original values. The corrupted writes destroyed whatever was there before (the importers ran `UPDATE` blindly). The original proposal documents (Word/PDF in storage) remain intact and could be re-extracted, but that's a separate effort.
- **Not** un-mingling the lead folders. That requires manual review per folder.
- **Not** fixing HubSpot-side data quality.
- **Not** touching the 112 modest cases.
- **Not** applying anything in production. This is dev-only until Vivek reviews.

## Execution order (locked)

Per Vivek's decision #6 — split into two PRs.

### PR 1 — Importer fixes (no data changes)

1. `scripts/excel-parser.ts` — sanity check, reject summary > ₹5L/kWp; reject obviously-not-a-line BOM rows.
2. `scripts/extract-bom-all-unprocessed.ts` — require filename token to match customer name in direct-folder strategy.
3. `scripts/migrate-hubspot.ts` — validate `Total Project Value` against system size before inserting.
4. Add a unit test or two in `scripts/__tests__/` for the parser sanity checks.

This is safe to merge alone. Without it, any rerun of BOM extraction reintroduces corruption.

### PR 2 — Data migration + DB constraint + UI banner

1. **Migration 087** — add `financials_invalidated` (+ `_at`, `_reason`) columns.
2. Regenerate `packages/types/database.ts` (per CLAUDE.md "Never ship schema changes without regenerating types in the same commit").
3. **Migration 088** — Tier A reset. Run in dev first; review `tier_a_targets` count (~130) with Vivek; spot-check 5 proposals on `/sales/[id]`.
4. **Migration 089** — `proposal_total_sanity` CHECK constraint at ₹10L/kWp (a final regression net wider than the importer's ₹5L threshold).
5. UI banner in `apps/erp/src/app/(erp)/proposals/[id]/page.tsx` and `apps/erp/src/app/(erp)/sales/[id]` — show yellow notice when `financials_invalidated = TRUE` OR `per_kwp > 200000`.
6. Repeat 087–089 in prod once dev is verified.

### PR 3 — HubSpot re-import (waits on Vivek's CSV)

1. Vivek delivers the cleaned HubSpot deals CSV.
2. New script `scripts/reimport-hubspot-financials.ts` — UPDATE existing-by-`hubspot_deal_id`, INSERT new, with importer fixes already in place from PR 1.
3. Clear `financials_invalidated` for any HubSpot proposal that gets a fresh sane value.

## What I am NOT doing in this plan

- **Not** recovering original values. The corrupted writes destroyed whatever was there before. Re-quoting via the live ERP is the only path to truth.
- **Not** un-mingling the lead folders. Manual review per folder; outside scope.
- **Not** touching the 437 sub-₹2L/kWp proposals.
- **Not** applying anything in prod until Vivek confirms dev results.

## Investigation artifacts (worktree-local, not committed)

- `scripts/investigate-corrupted-proposals.ts` — named bad proposals + top-N + distributions.
- `scripts/investigate-bom-detail.ts` — grouped BOM lines + storage file lists for named proposals.
- `scripts/quantify-corruption.ts` — full classification across all 752 proposals.
- `scripts/verify-kwp-and-tier-b.ts` — kWp confidence + Tier B signal check; produces `scripts/data/tier-a-targets.json`.

These can be folded into a permanent `scripts/data-integrity-check.ts` extension covering financial sanity once the migration ships, or deleted.
