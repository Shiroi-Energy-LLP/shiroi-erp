# Current Status

> Weekly-refreshed snapshot of what's in flight and where dev ↔ prod stand.
> History lives in `docs/CHANGELOG.md`. Specs in `docs/superpowers/specs/`.
> **"Last updated" is ONE line — replace it each session, never stack updates.** (This file reached 110 KB / a single 59 KB "Last updated" essay before the 2026-06-19 reset; detail belongs in the changelog + review docs, not here.)

> **Last updated: 2026-06-21** — BOM + voucher import pipeline shipped to dev (mig 198; `/bom-review/import` upload→parse→match→review→confirm; 48 se-master-file sheets staged in `pending_bom_imports` for Manivel to review/confirm). Spec `2026-06-21-bom-voucher-import-design.md`.

---

## Prod cutover (dev → prod) — PLANNED, NOT SCHEDULED

> We are **not** migrating now. Full design + runbook: [`docs/superpowers/specs/2026-06-09-dev-to-prod-migration-design.md`](superpowers/specs/2026-06-09-dev-to-prod-migration-design.md). Execution waits for Vivek's go (after dev is validated + the team is working on dev).
>
> **Shape:** one-shot freeze → CLI dump/restore (~118 MB DB) + rclone S3→S3 (~16 GB / ~20k Storage objects) into the existing **paused** Tokyo prod project (`kfkydkwycgijvexqiysc`). Dev is read-only during, so rollback = "don't flip the app"; a per-table row-count-parity gate blocks cutover until prod matches dev. Landmines solved in the spec: vault pgcrypto key (re-create on prod), auth UUIDs preserved (keeps `created_by`/`assigned_to` FKs), storage-metadata collision (rclone-only, `storage.objects` excluded from the SQL dump), 7 pg_cron jobs re-created, JWT secret kept prod-side.

---

## Phase

**Feature build — Phases B / C-purchase / C-finance / C-ops / C-HR / E / F + inverter 7 & 8 — all shipped by 2026-05-24.** Per-phase detail is in `docs/CHANGELOG.md` (grep the date) and the module docs. F2 (Meta Business Verification, tier 2,000 msgs/24h) done; F5 (Tamil content) deferred (manual, outside ERP).

**Now (June 2026): post-feature hardening + Manivel feedback** — performance, theming, redundancy cleanup, plant monitoring, and docs. Not a numbered phase; tracked under "In flight" below.

---

## In flight (June 2026)

| Item | Status |
|------|--------|
| **BOM + voucher import** (`spec 2026-06-21-bom-voucher-import-design.md`) | Shipped to dev (mig 198). `/bom-review/import` upload→parse→fuzzy-match→review→confirm pipeline live; 48 se-master-file sheets staged (`pending_bom_imports`) awaiting Manivel's per-sheet review/confirm; confirmed sheets cascade into `project_bois` + `project_boq_items` (contracted + actual + voucher). Phase-2: bulk rough-sheet voucher backfill + minting the ~40% missing projects (composes with `/om/import-review`). |
| **Page-load perf audit** (`docs/reviews/2026-06-19-page-load-perf-audit.md`) | In progress, dev-only. Shipped: mig 190 (pg_trgm search + tasks/milestone index), [G1] request-scoped session `cache()`, mig 192 (`/procurement/orders` pagination + `get_purchase_order_status_counts` RPC for the dashboard KPIs). Pending: dev compute upsize (Vivek's call) + the remaining round-trip/cold-plan items. |
| **Docs lean-reset** (`spec 2026-06-19-docs-lean-reset-design.md`) | ~Done. CHANGELOG 320→40 KB, this file reset, advisory CI length-check added. |
| **Theming → Solar Gold** | Token swap + 384-hex colour-shift + whole-rupee money shipped (June 18). Pending Vivek call: status-colour + label-map centralization (blocked on the label-wording decision). |
| **Manivel reconciliation + Command Center** (migs 180–185) | Shipped to dev. Write-back of reconciled values into `projects` still pending. |
| **Inverter monitoring** | FIMER/ABB + Sungrow + Deye live on dev; 4 residential FIMER EID lookups (Harsha / Baskar / Siddarth / Sriram) pending a portal lookup. |

---

## Open decisions for Vivek (flagged, not auto-applied)

- **Label-map wording** — system-type "On Grid" vs "On-Grid"; leave-type short vs long form (blocks the status/label-map centralization).
- **`ProjectLite` type consolidation** + **5-way employee-dropdown helper** unification (merge-safe; awaiting founder review).
- **~40 never-scanned-in-dev indexes** — drop before prod? (dev stats ≠ prod; revisit at prod-sizing time.)
- **Dev DB compute upsize** — projects/leads/search slowness is a CPU-starved ~1 GB instance, not query structure (`docs/reviews/2026-06-18-projects-leads-search-perf.md`); Small ≈ +$5/mo, prorated-hourly test possible.

---

## Migration state

| Env | Latest applied | Pending |
|-----|---------------|---------|
| **Dev** (`actqtzoxjilqnldnacqz`) | **198** (2026-06-21 — BOM + voucher import) | None |
| **Prod** (`kfkydkwycgijvexqiysc`) | ~012 (last coordinated window) | **013–190** waiting on the next prod window. The live ERP at `erp.shiroienergy.com` points at **dev** Supabase, so this gap doesn't block users today. |

**Prod deploy strategy:** batch-promote all pending migrations after employee-testing week (the Zoho-import tables are dev-only and won't all move).
**Gotchas:** mig 084 (nullable `project_id`) DDL is live but was applied outside `supabase_migrations.schema_migrations`. Mig 124 is an intentional numbering gap (abandoned branch). Mig 117 was applied in two passes (117 + 117c RPC fix). Full per-migration history: the `supabase/migrations/` files + `docs/CHANGELOG.md`.

---

## Environment URLs

| Thing | URL |
|-------|-----|
| Dev Supabase | `actqtzoxjilqnldnacqz.supabase.co` |
| Prod Supabase | `kfkydkwycgijvexqiysc.supabase.co` (paused) |
| ERP (points at **dev** Supabase) | `erp.shiroienergy.com` (Vercel, auto-deploys on push to `main`) |
| GitHub | `github.com/Shiroi-Energy-LLP/shiroi-erp` (private) |
| Local dev | `localhost:3000` |
| n8n | `https://n8n.shiroienergy.com` (DO Bangalore droplet `shiroi-erp`, `68.183.91.111`) |
| PVLib microservice | `https://pvlib.shiroienergy.com` (same droplet) |

---

## Active CI / discipline gates

Run on every PR + push to `main` (~5 min); also the mandatory local pre-push set:

1. `pnpm check-types` — 5 packages, 0 errors.
2. `pnpm lint` — `--max-warnings 0`.
3. `bash scripts/ci/check-forbidden-patterns.sh` — baseline-aware grep for NEVER-DO 11/13/15.
4. **`pnpm build`** (`next build`) — catches client/server boundary violations `check-types` misses (NEVER-DO #21; master ref §4.13). This is why "green CI → red Vercel" stopped.
5. `bash scripts/ci/check-changelog-entry-length.sh` — **advisory only**; warns on >400-char changelog entries, never fails the build (added with the 2026-06-19 docs lean-reset).

**Local pre-push:** `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`. Read the actual stdout — a background-task "exit 0" can lie (master ref §4.15). Playwright smoke (`e2e/smoke.spec.ts`) exists but isn't wired into CI yet.

---

## External registrations

| Item | Blocks | Status |
|------|--------|--------|
| Growatt API | Live Growatt polling | Registration started, 4–8 weeks |
| Sungrow iSolarCloud API | (Sungrow already live on dev via OAuth) | Polling live; formal API registration only if direct REST is needed |
| WATI.io WhatsApp BSP + FB Business Manager | Phase-2 direct WA sending | Registration started, 2–4 weeks (FB BM part of WATI) |

---

## Known open issues (non-blocking)

- **Growatt live polling** — awaiting API registration (4–8 wks). FIMER/ABB, Sungrow, and Deye already live on dev.
- **`ActionResult<T>` migration** — ~56 action files still on ad-hoc return shapes (NEVER-DO #19); the discipline gate stops new ones. Not urgent.
- **`as any` cleanup R2** — ~56 files remain after R1 (forbidden-pattern baseline 97→57 then).

---

## What counts as "this week's work"

This file is the weekly view. When something here ships:
1. It is **removed** from this file (and the "Last updated" line is **replaced**, not stacked).
2. One line is added to `docs/CHANGELOG.md`.
3. The relevant `docs/modules/<module>.md` is updated.

New work enters the "In flight" table above and (if big enough) gets a spec in `docs/superpowers/specs/`.
