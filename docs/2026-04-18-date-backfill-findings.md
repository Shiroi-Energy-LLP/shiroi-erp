# Historical Date Backfill — Findings (Apr 18, 2026)

Autonomous run while Vivek was AFK. Task: "ensure that all projects, proposals and leads have the correct year or date of the project" — the overnight Zoho import (067–072) had clobbered `created_at` on many rows with the 2026-04-02 batch timestamp.

## What shipped

Three migrations applied to dev (`actqtzoxjilqnldnacqz`). All use `LEAST()` so dates only move *earlier*, never later — idempotent.

| Migration | Source signal | Rows moved |
|-----------|---------------|------------|
| **073** (already applied before AFK) | `MIN(invoice/bill/PO/expense date)` on Zoho-linked projects | 12 projects + 5 proposals + 5 leads |
| **076** | `project_number` FY (SHIROI/PROJ/YYYY-YY/NNNN) + `actual_start_date` | 154 projects + cascade |
| **077** | `proposal_number` year (multiple legacy formats) + cascade to leads | 428 proposals + ~400 leads |

### Final state on dev

| Entity | Total | Still stuck at April 2026 | Sep-2025 HubSpot cluster |
|--------|-------|---------------------------|---------------------------|
| projects  |  316 | **2** (legit FY2026-27) |  140 (within FY2025-26, acceptable) |
| proposals |  752 | **10** (3 legit FY2026-27 + 7 unparseable sequential numbers like "137", "138") |  140 |
| leads     | 1141 | **1** |  513 (↓ from 903) |

Earliest valid date now: **2021-03-31** (on proposals with "SE/PV/XXX/21-22" style numbers).

## Why not Google Drive folder dates?

Drive folder metadata was collected — `docs/gdrive-folder-dates.csv` has 179 folders across 2024 + 2025 parent folders. I built a fuzzy-match script (`scripts/match-gdrive-folders-to-projects.ts`) that produces `docs/gdrive-project-matches.csv` with Jaro-Winkler similarity scores.

Why I didn't apply it:
1. **Bulk-reorg artifact.** ~20 of the 2024 folders all have `createdTime = 2025-01-28 10:55` — that's when the Drive was reorganized, not when the project happened. Using `createdTime` as-is would snap all 2024 projects to Jan 2025 instead of their real dates in 2024.
2. **Cross-family false matches.** The fuzzy matcher tripped on builder families (e.g. "Ramaniyam Abinaya" folder → "Ramaniyam Manasa" project at 0.94 score — *different* projects from the same customer).
3. **`project_number` was better.** `SHIROI/PROJ/2024-25/NNNN` is structured, deterministic, and encodes the fiscal year exactly. No fuzzy matching needed.

The Drive data is still useful for manual spot-checks — both CSVs are committed if you want to audit individual projects. I can write a follow-up migration to apply just the *high-confidence, non-bulk-reorg* Drive dates if you want sharper resolution (e.g. "Ramaniyam Adhri was Aug 2024, not just 'FY2024-25'").

## Zoho Quote.xls dead end

The export file is empty (0 rows) — Shiroi never used Zoho's quotation module. Quotations flow through Drive folders + proposals table only.

## HubSpot dead end

ERP dates in the Sep-2025 cluster (140 projects, 140 proposals, 513 leads) exactly match HubSpot "Create Date" with IST/UTC shift. That means HubSpot itself has clustered dates from a bulk import it did — we can't recover finer dates from HubSpot. These rows all sit *within* their correct fiscal year (FY2025-26 started April 2025, cluster is September 2025), so they're acceptable.

## Remaining gaps (worth deciding together)

1. **10 proposals still stuck at April 2026**, of which 7 are sequential-number format with no parseable year ("137", "137.2", "138", "139", "PV81/ 24" with stray space, "SE/RP/001"). Options: inspect manually via their `lead_id` customer name, or snap to a conservative 2020-01-01, or leave them.
2. **1 lead still at April 2026** — has no linked proposal to cascade from. Can inspect individually.
3. **Drive folder dates** — could apply as a tertiary refinement for ~130 high-confidence 2025-folder matches that have *non-bulk-reorg* `createdTime` in 2025 (would give month-level precision instead of FY-start precision).

## Files to review

- `supabase/migrations/073_backfill_dates_from_zoho.sql`
- `supabase/migrations/076_backfill_dates_from_project_number_fy.sql`
- `supabase/migrations/077_backfill_dates_from_proposal_number.sql`
- `scripts/fetch-gdrive-folder-dates.ts`
- `scripts/match-gdrive-folders-to-projects.ts`
- `docs/gdrive-folder-dates.csv` (raw Drive data)
- `docs/gdrive-project-matches.csv` (fuzzy-match reconciliation, for manual audit)

## Prod

Prod project `kfkydkwycgijvexqiysc` is INACTIVE (paused). Migrations not applied there — will go in the next coordinated prod window per normal workflow.
