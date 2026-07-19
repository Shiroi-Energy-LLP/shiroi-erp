# Projects & Leads — tables/search slowness (2026-06-18)

**Report:** "Search and tables for projects and leads have become slow. They were very quick earlier."
**Scope:** dev DB `actqtzoxjilqnldnacqz` (Seoul). Diagnosis was evidence-first (EXPLAIN / `pg_stat_*` on the live instance), not code-reading.

## Root cause: the dev instance is CPU-starved (not query structure)

The list queries are correctly indexed and cheap to execute. The latency is **planning**, amplified by a throttled CPU on the smallest burstable compute tier.

| Signal | Measured | Reading |
|---|---|---|
| `EXPLAIN ANALYZE SELECT 1` | **5.4 ms** | Healthy <0.1 ms → CPU throttle |
| Projects/leads list — execution | 9–33 ms (uses `idx_*_created_at`) | Indexing is fine |
| Projects/leads list — planning | 26–83 ms, **750–890 buffers**, spiking to 400–665 ms | Planning dominates; grows under load |
| Same all-cached plan, re-run | exec 9→53 ms, planning 44→665 ms (0 disk reads) | Pure CPU-scheduling variance |
| Instance | `shared_buffers` 224 MB, `effective_cache_size` 384 MB (~1 GB RAM) | Micro/burstable; credits deplete → throttle |
| Competing load | `storage.search` 6,319 calls / max 19.7 s; expenses query 3.5 s mean ×51 | Other work eats the same CPU |
| Search RPCs | `ILIKE '%term%'` → **seq scan** (no `pg_trgm`) | ~30–57 ms now; scales badly |

"Was fast, now slow" = burstable CPU credits depleting as data/crons/traffic grew. It hits **both** tables and search because planning is paid on every query.

## Shipped (free path, dev only)

1. **mig 187** — dropped 4 redundant indexes, zero coverage loss (verified `project_number` still uses the UNIQUE index):
   - `idx_leads_company`, `idx_projects_company` — exact duplicates of the `_company_id` FK index.
   - `idx_projects_number`, `idx_projects_proposal` — shadowed by `UNIQUE(project_number)` / `UNIQUE(proposal_id)`.
   - Result: projects-list planning 753 → 715 buffers.
2. **`apps/erp/src/app/(erp)/leads/page.tsx`** — the two `channel_partners` lookups feed `resolveReferrerFilter` only (not rendered), so they now run **only** for the `mgmt`/`customer` referrer modes; and `getLeads` joins the page's parallel batch instead of running as a serial second wave. Common load: **9 → 7 queries, no serial tail.**

Gates: check-types 5/5, lint 2/2, forbidden-patterns (baseline 66), build forced 1/1 (0 cached). No `database.ts` regen (index drops don't change types).

## Deferred by design

- **`pg_trgm` search indexes.** On 478 / 1,271-row tables, added indexes raise planning cost (the actual bottleneck) for little execution gain; and leads search ORs `companies.name` across a join, so it can't be index-driven without an RPC rewrite. Revisit when these tables reach ~10k+ rows.
- **Caching the static leads-page lookups** (sales engineers, referrers) — modest win, ~5-min staleness trade-off; skipped in the targeted pass.

## The real lever (when ready): compute

The free path reduces CPU *demand* but can't undo a throttle. The org is on **Pro** (its $10 compute credit already covers the current Micro). Upgrades are prorated hourly and reversible:
- **Small** (2 GB) ≈ **+$5/mo** net.
- A **~$2 one-day Medium test** confirms CPU is the cause before committing to anything monthly.

Recommendation: keep the free wins on dev; size compute properly when **prod** is provisioned for the team.
