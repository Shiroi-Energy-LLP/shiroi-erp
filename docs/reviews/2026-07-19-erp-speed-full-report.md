# ERP Speed — Full Report (Code + Infrastructure)

> **Execution status (2026-07-19, same day):** P0-2 and P1 items DONE on dev — mig 206 (RLS initplan wrap: 185 advisor warnings → 0), mig 207 (`list_bucket_objects` RPC replaces all 6 app `storage.search` call-site groups; Documents tab 33→2 calls), mig 208 (price-book facets RPC), mig 209 (43 provably-redundant indexes dropped), and the full G5 lazy-load sweep (`/tasks`, `/my-tasks`, `/activities`, `/price-book`, proposal editor). CI green (types/lint/patterns/build). **Remaining for Vivek: P0-1 Vercel region flip `iad1`→`icn1` (+ reset `pg_stat_statements` just before), P0-3 Micro→Small trial, and a 2-min picker smoke-test** (open: create-task dialog, My Tasks quick-add, Add Activity dialog, a project Documents tab, lead design Files panel — each picker/file list should populate on first open). Reconciliation-page rewrite deliberately not attempted (big rewrite, separate session).

**Date:** 2026-07-19
**Question asked:** "The ERP is slow — is it the code, or the hardware/hosting?"
**Answer in one line:** It is mostly **geography** (a Chennai→US→Seoul round-trip topology), partly the **starved Micro DB instance**, partly **RLS policy CPU overhead**, and only residually the code — the June-19 code audit already shipped most of the code-side fixes.

Live sources used today: Vercel project API (function region), Supabase Management API (project/region), `pg_stat_statements`, Supabase performance advisors (1,243 findings), `pg_settings`, `storage.objects`, repo code + `docs/reviews/2026-06-19-page-load-perf-audit.md` + `2026-06-18-projects-leads-search-perf.md`.

---

## 1. Where everything actually runs (verified today)

| Component | Where | Spec | Serves the ERP? |
|---|---|---|---|
| ERP web (Next.js SSR) | **Vercel, functions in `iad1` = Washington DC, US East** (verified via API: `serverlessFunctionRegion: "iad1"`, Fluid compute on) | Serverless | **YES — every page render runs here** |
| Database + Auth + Storage + PostgREST | **Supabase dev `actqtzoxjilqnldnacqz`, `ap-northeast-2` = Seoul** | **Micro instance**: shared 2-core ARM, 1 GB RAM (`shared_buffers` 224 MB, `work_mem` 12 MB, 60 max connections). DB is only **186 MB**, cache hit ratio 100% | YES — all data + every `auth.getUser()` |
| DigitalOcean droplet `shiroi-erp` | Bangalore (BLR1), `68.183.91.111` | 1 vCPU, 2 GB RAM, 50 GB SSD, $12/mo | **NO** — runs only n8n + Caddy (+ future PVLib). It never sits in the page-load path. |
| Users | Chennai | — | — |

**The droplet is exonerated.** It does not serve a single ERP request. Upgrading it will not make any page faster. (Its 1 vCPU is fine for n8n's cron load; the inverter-poll writes it generates are 2–7 ms each on the DB.)

### The topology problem — the single biggest finding

Every SSR page load travels:

```
Chennai user ──(~220 ms RTT)──> Vercel function in Washington DC (iad1)
                                   │
                                   ├─ auth.getUser()  ──(~160–180 ms RTT)──> Seoul
                                   ├─ query 1         ──(~160–180 ms RTT)──> Seoul
                                   ├─ query 2..N      ──(~160–180 ms RTT)──> Seoul
                                   ▼
                              HTML back to Chennai (~220 ms)
```

The June-19 audit measured that pages fire **4–15 Supabase round-trips**, partially serialized. Even after the [G1] auth dedup, a typical page does ~4–8 trips. From iad1 each trip costs ~160–180 ms of pure network. So:

- **Today:** TTFB ≈ 220 + (4–8 × 170, partly serial) ≈ **1.2 – 2.5 s** before any rendering — matching the felt slowness. The DB executes each query in 4–33 ms; >90% of wall-clock is ocean crossing.
- **With functions moved to Seoul (`icn1`):** function↔DB trips drop to **~1–3 ms each**. TTFB ≈ Chennai↔Seoul once (~140 ms) + DB time ≈ **300–500 ms**. Same code, ~5× faster.
- **End-state (prod in Mumbai + functions `bom1`):** both hops ~30 ms → **~150–250 ms** TTFB.

Nobody chose iad1 — it is Vercel's default, and the repo sets no `preferredRegion` anywhere (verified by grep). This was invisible because deploys are done from the dashboard/CLI and the region setting was never touched.

---

## 2. Database instance (the "hardware" of the ERP)

The dev instance is the smallest tier (**Micro**). Findings from June still hold and were re-verified:

- **Cold-planning tax:** 95-column `projects` table with 14 indexes plans at **57–68 ms cold** vs 1.5 ms warm; the starved instance keeps evicting catalog cache, so pages repeatedly pay planning ≫ execution (execution is 4–10 ms).
- **Contention spikes:** `storage.search` (file/folder listings) is **27.9% of all DB time** (7,356 calls, mean 848 ms, **max 19.7 s**) since stats began. When a multi-second listing runs on a 2-shared-vCPU box, quick queries queue behind it → the intermittent 1–4.7 s stalls users report as "sometimes it just hangs".
- **Caveat:** `pg_stat_statements` has **never been reset** (2026-03-28 → today), so means are 4-month cumulative. The storage *insert* storm (June's WhatsApp/site-photo import: ~41k object inserts) has stopped — 0 new objects in any user bucket in the last 7 days — but the `.list()` read pattern in the app is unchanged (see §4), so listing bursts still happen whenever file tabs are used against **site-photos (10,229 objects)** and **proposal-files (7,650)**.
- Background write load is constant but healthy: inverter polling has done 141k readings-inserts (mean 7 ms) + 141k status updates (mean 2.2 ms); `inverter_readings` **is** partitioned (relkind `p`) per the time-series rule.

**Verdict:** the Micro box is a real contributor (planning-cache eviction + contention headroom), and the **Small upsize (~+$5/mo, prorated hourly — can be tested for pennies)** already sits in "Open decisions" in `CURRENT_STATUS.md`. But even an XL instance would not fix the 1.2–2.5 s network topology. Order of operations: **region first, size second.**

---

## 3. RLS policy overhead — new finding (Supabase advisors, run today: 1,243 items)

| Advisor | Count | Meaning |
|---|---|---|
| `multiple_permissive_policies` (WARN) | **394** | Tables with several permissive policies for the same role+action — Postgres evaluates **every** policy on **every row** of **every query**. |
| `auth_rls_initplan` (WARN) | **185** | Policies calling `auth.uid()` / `current_setting()` **per row** instead of once per query (`(select auth.uid())` wrapper missing). On `profiles`, `employees`, `lead_*`, and ~180 more. |
| `unindexed_foreign_keys` (INFO) | 296 | FKs without covering indexes — join/cascade risk, mostly latent at dev row counts. |
| `unused_index` (INFO) | 367 | Never-scanned indexes — write overhead + they bloat the planner work that the cold-plan tax pays for. Overlaps the "~40 never-scanned" open decision. |

The two WARN classes are pure CPU multiplication on the weakest instance tier, applied to literally every query the ERP runs. The `initplan` fix is mechanical (wrap `auth.uid()` in a sub-select in each policy — one migration, no behavior change). Consolidating the 394 multiple-permissive tables is a bigger, careful pass — worth doing table-by-table starting with the hottest (leads, projects, tasks, expenses, storage-adjacent).

---

## 4. Code — what's already fixed vs. still open

The June-19 audit (`docs/reviews/2026-06-19-page-load-perf-audit.md`) fixed most of the code-side disease. **Shipped:** [G1] request-scoped auth `cache()` (killed the 2–4× `auth.getUser()` per page), [G2] pg_trgm + 14 GIN search indexes (mig 190), procurement pagination + counts RPC (mig 192), bom-review/data-quality summary RPCs (mig 194), `get_project_financials` (mig 195), `get_purchase_request_aggregates` (mig 196), `getProject` embed trim, sub-route header swaps, `/om/inverters` + `/om/amc` lazy dialogs.

**Still open (carried forward, re-verified today):**

1. **Storage `.list()` callers never touched** — the #1 DB-time consumer has zero app-side mitigation. 8 call sites: `project-files/helpers.ts` (fans out per-folder + whatsapp + per-month against the 10k-object bucket), `documents-tab.tsx` (limit 500), `lead-files-panel.tsx`, leads/proposals file pages. Fix: replace folder listings with a `project_files` DB table maintained on upload (path strings per the file rule), or cache listings (60 s `unstable_cache` keyed on folder is fine — no auth data), and cap per-month walks.
2. **[G5] remaining eager fetches** — `/tasks` (478-project list feeds CreateTaskDialog + per-row EditTaskDialog; 5-file change), `/activities`, `/price-book`, `/sales/[id]/proposal` (always-visible pickers → combobox-on-focus fetch). Needs runtime smoke-testing, deliberately not blind-shipped.
3. **Reconciliation page rewrite** — 3 unbounded full-table selects + JS join shipped to the client → summary RPC + pagination.
4. Low: `/om/profitability` JS totals, `/qc-gates` + `/daily-reports` `SELECT *` trims.

---

## 5. Prioritized action plan

| # | Action | Type | Cost | Expected effect | Effort |
|---|---|---|---|---|---|
| **P0-1** | **Vercel → Settings → Functions → Function Region: `iad1` → `icn1` (Seoul)**, colocated with the DB. Redeploy. | Infra (dashboard toggle) | Free | **The big one.** ~1.2–2.5 s TTFB → ~300–500 ms on every SSR page. | 5 min + a smoke test |
| **P0-2** | RLS `initplan` migration: wrap `auth.uid()`/`current_setting()` in `(select …)` across the 185 flagged policies. | SQL migration | Free | Removes per-row auth re-evaluation on every query; biggest DB-CPU reclaim available. | ~half day (mechanical, scriptable from advisor output) |
| **P0-3** | **Upsize dev DB Micro → Small** (prorated hourly — trial it for a day and measure cold-plan times). | Infra | ~+$5/mo | Stops catalog-cache eviction (57–68 ms plan tax) + headroom against storage.search bursts. | 10 min |
| **P1-1** | Kill app-driven `storage.search` load: file-listing table or cached listings for the 8 `.list()` call sites; stop per-month folder walks over site-photos. | Code | Free | Removes the 27.9%-of-DB-time contention source → ends the intermittent 1–4.7 s stalls. | 1–2 days |
| **P1-2** | Consolidate `multiple_permissive_policies` on the ~15 hottest tables; add missing FK indexes on tables that actually join (advisor lists both). | SQL migration(s) | Free | Steady per-query CPU reduction. | Iterative |
| **P1-3** | Finish [G5] lazy-loads (`/tasks`, `/activities`, `/price-book`, proposal picker) + reconciliation RPC rewrite. | Code | Free | Per-page payload + round-trip cuts on the heaviest remaining pages. | 2–3 days total |
| **P1-4** | Prune the 367 never-scanned indexes (already an open decision; do the safe subset now, keep FK/filter ones per the mig-188/189 verification method). | SQL migration | Free | Faster writes + smaller planner state (helps the cold-plan tax at any instance size). | Half day |
| **P2-1** | **At prod cutover: create prod in Mumbai (`ap-south-1`)** — already recommended in the dev→prod notes; prod today is an empty paused Tokyo project, so this is near-free — and flip Vercel functions to `bom1` at the same time. | Infra/strategic | Free | End-state ~150–250 ms TTFB for Chennai users. | Part of the existing cutover runbook |
| **P2-2** | Reset `pg_stat_statements` at the start of the next perf window so measurements reflect current behavior, not the March–June history. | Hygiene | Free | Trustworthy before/after numbers for P0-1/P0-3. | 1 min (do it right before flipping the region) |

### What NOT to spend money or time on

- **Upgrading the DigitalOcean droplet** — it does not serve the ERP.
- **Blanket query optimization** — every measured list/detail query executes in 4–33 ms; the queries were never the problem.
- **Adding more indexes** — the ERP is over-indexed (367 unused); more indexes worsen the planning tax.
- **Moving off Vercel / self-hosting the ERP** — the platform is fine; only its default region was wrong.

### Suggested sequencing for the next session

1. Flip the Vercel function region to `icn1` (+ reset pg_stat_statements just before, for clean before/after) → measure `/projects`, `/sales`, `/dashboard` TTFB from Chennai.
2. If still not snappy: upsize Micro → Small for a trial day, re-measure cold-plan times.
3. Ship the RLS initplan migration.
4. Then the P1 code items in order.

---

*Related: `docs/reviews/2026-06-19-page-load-perf-audit.md` (per-page code audit), `docs/reviews/2026-06-18-projects-leads-search-perf.md` (storage contention diagnosis), `docs/superpowers/specs/2026-06-09-dev-to-prod-migration-design.md` (cutover — add the Mumbai region decision).*
