# Shiroi Energy ERP — Comprehensive Roadmap

**Date:** April 8, 2026
**Author:** Auto-generated from CLAUDE.md + SHIROI_MASTER_REFERENCE_3_0.md
**Status:** For Vivek's review

---

## Executive Summary

**Current state:** The Shiroi Energy ERP is a single-tenant solar EPC management system in **Phase 3** (Advanced Features + Deployment).

| Metric | Value |
|--------|-------|
| Screens / routes | 57+ (all real, 0 placeholders) |
| Database tables | 137+ with RLS on every table |
| Triggers | 91+ |
| Migrations committed | 36 files (001–026) |
| Tests | 142 passing (Vitest) |
| Design system components | 22 (V2) |
| Data migrated | 1,115 leads, 751 proposals, 314 projects, 3,450 BOM lines, 1,290 photos |
| WhatsApp records staged | 4,164 in review queue |
| Deployment | erp.shiroienergy.com on Vercel (pointing at DEV Supabase) |

**Phases 1A, 2A, 2B, 2C** are complete. Key Phase 3 items (AI narrative, net metering, handover pack, inventory) are done. Marketing redesign, PM corrections R2, and data quality overhaul are complete.

**What remains:** ~58 tasks across 7 categories, organized into 10 sprints spanning ~27+ weeks.

---

## Task Catalog

### Category A: Production Deployment (P0 — Blocking)

These tasks block the ERP going live. Nothing else matters until these are done.

| # | Task | Status | Dependencies | Source | Notes |
|---|------|--------|--------------|--------|-------|
| A1 | Apply dev migrations 013–026 to prod Supabase | Pending | A2, A3 | CLAUDE.md | 14 migrations pending on prod |
| A2 | Vivek review of WhatsApp import queue (4,164 records) | Pending | WA Import UI ✅ | CLAUDE.md | Approve/reject before prod deploy |
| A3 | Vivek review of data quality results | Pending | Data quality overhaul ✅ | CLAUDE.md | Proposals 341→751, BOM 7→3,450, photos 0→1,290 |
| A4 | Connect Vercel to GitHub repo properly | Ready | Domain registered ✅ | Master Ref S15 | erp.shiroienergy.com on GoDaddy |
| A5 | Set up git branching (main/staging/feature) | Pending | A4 | Master Ref S15 | Currently no branch strategy |
| A6 | Configure Vercel env vars for prod Supabase | Pending | A4 | CLAUDE.md | Currently deployed against DEV |
| A7 | Prod data migration: run verified data into prod DB | Pending | A1, A2, A3 | Master Ref S11 | Clean schema approach |

---

### Category B: UI/UX Overhaul R2 Completion (P1 — In Progress)

| # | Task | Status | Dependencies | Source | Notes |
|---|------|--------|--------------|--------|-------|
| B1 | Remaining EmptyState components (15 pages) | In Progress | None | CLAUDE.md | Part of R2 scope |
| B2 | Remaining loading.tsx skeletons (~15 pages) | In Progress | None | CLAUDE.md | Part of R2 scope |
| B3 | Eyebrow pattern on remaining 25 pages | In Progress | None | CLAUDE.md | Part of R2 scope |
| B4 | Breadcrumbs on 4 more pages | In Progress | None | CLAUDE.md | Part of R2 scope |
| B5 | Toast notifications on 4 more forms | In Progress | None | CLAUDE.md | Part of R2 scope |
| B6 | Form conversions to react-hook-form+Zod (4 forms) | In Progress | None | CLAUDE.md | Incremental during feature work |

**Discrepancy:** Master Reference v3.5 marks R2 as COMPLETE, but CLAUDE.md (more recent, Apr 8) still shows "In Progress". CLAUDE.md is treated as authoritative.

---

### Category C: Phase 2 Remaining — Field & Customer (P1)

| # | Task | Status | Dependencies | Source | Notes |
|---|------|--------|--------------|--------|-------|
| C1 | Offline-first mobile app (React Native + Expo + WatermelonDB) | Not started | None | Master Ref S15 | Major effort — entire mobile app |
| C2 | Photo gates + GPS verification | Not started | C1 | Master Ref S15 | Requires mobile app for GPS |
| C3 | Customer app (portal, docs, e-card, service tickets) | Not started | C1 | Master Ref S15 | Separate surface |
| C4 | O&M contracts full lifecycle | Not started | None | Master Ref S15 | Tables exist, UI partial |
| C5 | O&M scheduling and visit checklists (mobile) | Not started | C1, C4 | Master Ref S15 | Priority screen #7 |
| C6 | n8n WhatsApp automations (Phase 1 employee-forward) | Not started | F5 | Master Ref S15 | Uses message_delivery_log table |
| C7 | Completion percentage model (objective tracking) | Not started | None | Master Ref S15 | Calculated from sub-components |
| C8 | Intermediaries table (billing-through-architect) | Deferred | None | Master Ref S15 | Commercial arrangement for C&I |
| C9 | DC signatures (delivery challan signing) | Pending | None | CLAUDE.md | Listed under inventory |
| C10 | Service ticket lifecycle (multi-actor, SLA enforcement) | Not started | None | Master Ref S15 | Priority screen #8 |
| C11 | Marketing manager (Prem) feedback on redesign | Next | Marketing redesign ✅ | Master Ref | Same cycle as PM feedback |

---

### Category D: Phase 3 — Intelligence (P2)

| # | Task | Status | Dependencies | Source | Notes |
|---|------|--------|--------------|--------|-------|
| D1 | Plant monitoring (Sungrow/Growatt APIs) | Not started | **External:** API registrations (4–8 weeks) | Master Ref S15 | Blocked by vendor approval |
| D2 | Quarterly check-ins with AI narrative | Not started | Claude API ✅ | Master Ref S15 | Reuse AI narrative pattern |
| D3 | BOM correction factor active feedback loop | Not started | Sufficient project data ✅ | Master Ref S15 | 3,450 BOM lines available |
| D4 | Daily microlearning WhatsApp engine | Not started | C6, F5 | Master Ref S15 | Spaced repetition logic in DB |
| D5 | Onboarding tracks and assessments | Not started | Training tables exist ✅ | Master Ref S15 | DB schema ready |
| D6 | O&M profitability analytics | Not started | C4, C5 | Master Ref S15 | Needs O&M visit data |
| D7 | PVLib microservice (higher accuracy simulation) | Not started | F6 | Master Ref S15 | Python service on port 5001 |
| D8 | Google Drive historical proposals archiving | Not started | None | Master Ref S15 | 1,300 proposals from Drive |

---

### Category E: Phase 4 — Scale (P3)

| # | Task | Status | Dependencies | Source | Notes |
|---|------|--------|--------------|--------|-------|
| E1 | WhatsApp Business API direct (WATI.io) | Not started | **External:** WATI.io registration (2–4 weeks) | Master Ref S15 | Blocked by BSP registration |
| E2 | GST e-invoicing | Not started | Finance module | Master Ref S15 | Only if approaching ₹5Cr threshold |
| E3 | Full referral program automation | Not started | C6 | Master Ref S15 | Tables exist (lead_referrals, referral_rewards) |
| E4 | Language training bilingual scenarios | Not started | D4, D5 | Master Ref S15 | Requires training engine |
| E5 | Market salary benchmarking analytics | Not started | HR data in system | Master Ref S15 | Analytics feature |
| E6 | External customer-facing proposal portal | Not started | Proposal engine ✅ | Master Ref S15 | Public-facing portal |
| E7 | OpenRouter for model flexibility | Not started | Claude API ✅ | Master Ref S15 | Alternative AI models |

---

### Category F: Data & Infrastructure (P1–P2)

| # | Task | Status | Dependencies | Source | Notes |
|---|------|--------|--------------|--------|-------|
| F1 | Remaining 1,300 proposals from Google Drive | Next | None | Master Ref S11 | Step 3 in import sequence |
| F2 | Full Drive scan — upload all remaining files | Not started | F1 | Master Ref S11 | Moved from Phase 4 to 2C |
| F3 | Partial project data reconciliation | Not started | F1, F2 | Master Ref S11 | Cross-check all sources |
| F4 | Commissioning data → plants + customers tables | Not started | F3 | Master Ref S11 | Enables customer app |
| F5 | n8n setup on spare laptop (Ubuntu, systemd) | Not started | Hardware available | Master Ref S2 | **Blocks C6, D4, G1–G10** |
| F6 | PVLib microservice setup on spare laptop | Not started | F5 (same machine) | Master Ref S2 | Python, port 5001 |
| F7 | WhatsApp import queue: approve/reject 4,164 records | Pending | Vivek review | CLAUDE.md | UI built, data staged |
| F8 | Nightly cron jobs via n8n (lock_stale_reports, cashflow) | Not started | F5 | Master Ref S5.4 | Critical for data integrity |

---

### Category G: Business Alerts & Automation (P1–P2)

All items in this category are blocked by **F5** (n8n setup).

| # | Task | Priority | Dependencies | Source | Notes |
|---|------|----------|--------------|--------|-------|
| G1 | No daily report by 7pm → PM WhatsApp alert | P1 | F5, C6 | Master Ref S14 | n8n automation |
| G2 | Payroll export not generated by 25th → Vivek alert | P1 | F5 | Master Ref S14 | Critical business alert |
| G3 | Employee certification expiry 30-day alert | P2 | F5 | Master Ref S14 | blocks_deployment enforcement |
| G4 | MSME vendor payment Day 40 alert | P1 | F5 | Master Ref S14 | **Legal compliance** |
| G5 | Overdue customer invoice escalation chain | P1 | F5 | Master Ref S6.4 | Day 1→5→10→30 escalation |
| G6 | Service ticket SLA breach alert | P2 | F5, C10 | Master Ref S14 | 4h SLA for critical tickets |
| G7 | Plant no monitoring data 24h alert | P2 | D1 | Master Ref S14 | Requires plant monitoring |
| G8 | Insurance addition pending >25 days alert | P2 | F5 | Master Ref S14 | HR automation |
| G9 | DISCOM objection open >14 days alert | P2 | F5 | Master Ref S14 | Liaison automation |
| G10 | Project cash-negative >3 days daily digest | P1 | F5 | Master Ref S14 | Founder alert |
| G11 | n8n Global Error Handler workflow | P1 | F5 | Master Ref S14 | Any workflow failure → WhatsApp to admin |

---

## Dependency Graph

```
A2 (Vivek reviews WA queue) ──┐
A3 (Vivek reviews data)    ───┼──→ A1 (migrations to prod) ──→ A7 (prod data migration)
                               │
A4 (Vercel + GitHub) ─────────┼──→ A5 (git branching)
                               └──→ A6 (prod env vars)

F5 (n8n setup) ────────────────┬──→ C6 (WhatsApp automations) ──→ D4 (microlearning)
                               ├──→ F8 (nightly crons)                    │
                               ├──→ G1–G6, G8–G11 (all alerts)            └──→ E4 (bilingual)
                               └──→ F6 (PVLib) ──→ D7 (PVLib microservice)

C1 (mobile app) ──────────────┬──→ C2 (photo gates + GPS)
                               ├──→ C3 (customer app)
                               └──→ C5 (O&M mobile checklists)

C4 (O&M contracts) ───────────┬──→ C5 (O&M mobile)
                               └──→ D6 (O&M profitability)

C10 (service tickets) ────────┬──→ G6 (SLA breach alerts)

D1 (plant monitoring) ────────┬──→ G7 (no-data 24h alert)
    ⚠️ External: Sungrow/Growatt API (4–8 weeks)

E1 (WATI.io)
    ⚠️ External: BSP registration (2–4 weeks)

F1 (Drive proposals) ──→ F2 (full Drive scan) ──→ F3 (reconciliation) ──→ F4 (commissioning data)
```

---

## Sprint Execution Plan

### Sprint 0: Production Readiness (Week 1)

| Task | Owner | Notes |
|------|-------|-------|
| A2 — Review WhatsApp import queue | Vivek | 4,164 records to approve/reject |
| A3 — Review data quality results | Vivek | Verify proposals, BOMs, photos |
| A1 — Apply migrations 013–026 to prod | Dev | 14 migrations |
| A4 — Connect Vercel to GitHub | Dev | Already on erp.shiroienergy.com |
| A5 — Set up git branching | Dev | main/staging/feature |
| A6 — Configure prod env vars | Dev | Switch from DEV to PROD Supabase |
| A7 — Run prod data migration | Dev | Clean verified data only |

### Sprint 1: Complete In-Progress Work (Week 2)

| Task | Owner | Notes |
|------|-------|-------|
| B1–B6 — Finish UI/UX R2 | Dev | ~15 EmptyStates, ~15 skeletons, 25 eyebrows, 4 breadcrumbs, 4 toasts, 4 forms |
| C11 — Prem's feedback on marketing redesign | Vivek/Prem | Collect and action |

### Sprint 2: Infrastructure Foundation (Weeks 3–4)

| Task | Owner | Notes |
|------|-------|-------|
| F5 — n8n setup on spare laptop | Dev/Infra | Ubuntu, systemd, port 5678. **Unblocks all of Category G** |
| F6 — PVLib microservice setup | Dev | Python, port 5001 on same machine |
| F8 — Nightly cron jobs | Dev | lock_stale_reports, cashflow snapshot |
| C7 — Completion percentage model | Dev | Objective tracking from sub-components |

### Sprint 3: Core Business Automation (Weeks 5–6)

| Task | Owner | Notes |
|------|-------|-------|
| C6 — n8n WhatsApp Phase 1 | Dev | Employee-forward automations |
| G4 — MSME Day 40 alerts | Dev | **Legal compliance** — 45-day payment law |
| G5 — Customer invoice escalation | Dev | Day 1→5→10→30 chain |
| G10 — Cash-negative project alerts | Dev | Daily digest to founder |
| G2 — Payroll export alerts | Dev | 25th of month deadline |

### Sprint 4: O&M + Service (Weeks 7–8)

| Task | Owner | Notes |
|------|-------|-------|
| C4 — O&M contracts full lifecycle | Dev | Tables exist, build UI |
| C10 — Service ticket lifecycle | Dev | Multi-actor, SLA enforcement |
| C9 — DC signatures | Dev | Delivery challan signing |
| G1 — Daily report alerts | Dev | 7pm deadline WhatsApp |
| G3 — Certification expiry alerts | Dev | 30-day warning |

### Sprint 5: Data Completeness (Weeks 9–10)

| Task | Owner | Notes |
|------|-------|-------|
| F1 — Import 1,300 proposals from Drive | Dev | Google Drive scan |
| F2 — Full Drive scan and upload | Dev | All remaining files |
| F3 — Data reconciliation | Dev | Cross-check all sources |
| D8 — Archive historical proposals | Dev | Index and store |

### Sprint 6: Intelligence Features (Weeks 11–14)

| Task | Owner | Notes |
|------|-------|-------|
| D2 — Quarterly check-ins with AI | Dev | Reuse Claude API pattern |
| D3 — BOM correction factor feedback | Dev | 3,450 BOM lines available |
| D5 — Onboarding tracks | Dev | DB schema ready |
| C8 — Intermediaries table | Dev | Commercial arrangement for C&I |
| D6 — O&M profitability analytics | Dev | Depends on C4/C5 data |
| F4 — Commissioning → plants/customers | Dev | Enables customer app |

### Sprint 7: Mobile App (Weeks 15–22)

| Task | Owner | Notes |
|------|-------|-------|
| C1 — React Native + Expo foundation | Dev | Major effort (~8 weeks) |
| C2 — Photo gates + GPS verification | Dev | Mobile-dependent |
| C5 — O&M visit checklists (mobile) | Dev | Mobile-dependent |
| C3 — Customer app | Dev | Portal, docs, e-card, service tickets |

### Sprint 8: Training & WhatsApp (Weeks 23–26)

| Task | Owner | Notes |
|------|-------|-------|
| D4 — Daily microlearning engine | Dev | Spaced repetition via WhatsApp |
| E1 — WATI.io WhatsApp direct | Dev | When BSP registration approved |
| E3 — Full referral program | Dev | Tables exist, wire automation |

### Sprint 9: Scale & Polish (Weeks 27+)

| Task | Owner | Notes |
|------|-------|-------|
| D1 — Plant monitoring (Sungrow/Growatt) | Dev | When API access granted |
| E2 — GST e-invoicing | Dev | If approaching ₹5Cr threshold |
| E4 — Language training bilingual | Dev | Requires D4, D5 |
| E5 — Salary benchmarking analytics | Dev | HR analytics |
| E6 — Customer proposal portal | Dev | Public-facing |
| E7 — OpenRouter integration | Dev | Model flexibility |
| G6 — Service ticket SLA alerts | Dev | Requires C10 |
| G7 — Plant monitoring alerts | Dev | Requires D1 |
| G8 — Insurance pending alerts | Dev | HR automation |
| G9 — DISCOM objection alerts | Dev | Liaison automation |

---

## External Blockers

| Blocker | Affects | Est. Timeline | Action Required |
|---------|---------|---------------|-----------------|
| NREL PVWatts API key | Phase 1 simulation | ✅ **Done** | Registered, key in .env.local |
| Sungrow iSolarCloud API registration | D1 (plant monitoring), G7 (monitoring alerts) | 4–8 weeks | Registration in progress |
| Growatt API registration | D1 (plant monitoring) | 4–8 weeks | Registration in progress |
| WATI.io BSP registration + Facebook Business Manager | E1 (WhatsApp Business API direct) | 2–4 weeks | Registration in progress (FB BM required for WATI) |
| Vivek review of WA import queue | A1, A7 (prod deployment) | Vivek's schedule | 4,164 records staged for review |
| Vivek review of data quality | A1, A7 (prod deployment) | Vivek's schedule | Proposals, BOMs, photos to verify |
| Spare laptop availability | F5 (n8n), F6 (PVLib) | Hardware available | Ubuntu setup needed |

---

## Document Reconciliation Notes

The two source-of-truth documents — `CLAUDE.md` (updated continuously during development) and `SHIROI_MASTER_REFERENCE_3_0.md` (architectural reference, less frequently updated) — have drifted apart in several areas. This section documents each discrepancy with a resolution based on filesystem inspection.

### 1. UI/UX Overhaul R2 Status

| Document | Says |
|----------|------|
| CLAUDE.md (Apr 8, 2026) | 🔜 In Progress — lists specific remaining items |
| Master Reference v3.5 | ✅ Complete |

**Filesystem evidence:** CLAUDE.md enumerates concrete remaining work: 15 EmptyState components, ~15 loading.tsx skeletons, 25 Eyebrow patterns, 4 Breadcrumbs, 4 Toast integrations, and 4 form conversions to react-hook-form+Zod. These are incremental polish items, not architectural gaps.

**Resolution:** CLAUDE.md is authoritative here — R2 is **not complete**. The Master Reference likely marked it complete prematurely or based on the core color-token cleanup (339 hex→token replacements) being done. The remaining items are cataloged in Category B of this roadmap. Update Master Reference to match CLAUDE.md.

### 2. Migration File Count

| Document | Says |
|----------|------|
| CLAUDE.md | "36 files (001 through 026)" |
| Master Reference | "28+ files (001 through 012)" |
| **Actual filesystem** | **48 files** in `supabase/migrations/` |

**Filesystem evidence:** The directory contains 48 `.sql` files. The numbering system uses both letter suffixes (e.g., `002a`, `002b`, `003a`, `003b`, `003c`) for early migrations and duplicate number prefixes for later ones (e.g., two `018_*` files, two `019_*` files, two `022_*` files, two `023_*` files, two `024_*` files, two `025_*` files). Full listing:

- 001: 1 file (foundation)
- 002–007: 18 files (a/b/c/d/e/f sub-migrations)
- 008–017: 10 files
- 018–026: 19 files (some numbers have 2 files each)

**Resolution:** Both documents undercount. The actual count is **48 migration files** spanning prefixes 001–026. Update both documents. The Master Reference's "28+" is especially stale — it was accurate circa migration 012 but hasn't been updated since.

### 3. Route / Page Count

| Document | Says |
|----------|------|
| CLAUDE.md | "57+ routes total — all sidebar links are real data-driven pages, 0 placeholders" |
| Master Reference | 53 routes (from step tracking) |
| **Actual filesystem** | **71 `page.tsx` files** in `apps/erp/src/app/` |

**Filesystem evidence:** Running `find apps/erp/src/app -name "page.tsx"` returns 71 files. The gap between 57+ (CLAUDE.md) and 71 (actual) likely reflects pages added during PM Corrections R2, marketing redesign, WhatsApp import UI, inventory, and other Phase 3 work that incremented routes without updating the count in CLAUDE.md.

**Resolution:** The actual route count is **71 pages**. Both documents undercount. Update CLAUDE.md from "57+" to "71+" and the Executive Summary table in this roadmap accordingly. The Master Reference's 53 is the most stale.

### 4. Vercel Deployment Status

| Document | Says |
|----------|------|
| CLAUDE.md | ✅ Live — "erp.shiroienergy.com — deployed against DEV Supabase, auto-deploys on push" |
| Master Reference | Has unchecked deployment items (GitHub integration, branch strategy, prod env vars) |

**Resolution:** Both are correct — they describe different things. The Vercel deployment **is live** and serving the app at erp.shiroienergy.com, but it points at **DEV Supabase**, not production. The Master Reference's unchecked items refer to production-readiness steps (proper GitHub integration, branch strategy, prod env vars) which are captured as tasks A4–A6 in this roadmap. No document update needed — the nuance is captured here.

### Summary of Required Document Updates (from reconciliation)

| Document | Update Needed |
|----------|---------------|
| CLAUDE.md | Migration count: 36 → 48. Route count: 57+ → 71+. |
| Master Reference | Migration count: 28+ → 48. Route count: 53 → 71+. UI/UX R2: Complete → In Progress. |

---

## Completeness Validation

Cross-referenced against all source documents on April 8, 2026.

| Source | Section | Unchecked Items | Roadmap Coverage |
|--------|---------|-----------------|------------------|
| Master Ref S15 Phase 2 (lines 1237–1248) | 6 unchecked + 1 partial (DC signatures) | C1–C9 | ✅ All 7 present |
| Master Ref S15 Phase 3 (lines 1250–1258) | 8 unchecked | D1–D8 | ✅ All 8 present |
| Master Ref S15 Phase 4 (lines 1260–1267) | 7 unchecked | E1–E7 | ✅ All 7 present |
| CLAUDE.md status table (non-✅ items) | UI/UX R2 (In Progress), Prod deployment (Next) | B1–B6, A1–A7 | ✅ All present |
| Master Ref S14 business alerts (lines 1086–1098) | 9 alert thresholds | G1–G4, G6–G10 | ✅ All 9 present |
| Master Ref S14 n8n error handler (line 1083) | 1 workflow | G11 | ✅ Added this pass |
| Master Ref S17 external registrations (lines 1357–1363) | 5 items | See below | ✅ All accounted for |

**External registrations disposition:**
- NREL PVWatts API key → ✅ Already registered (key in .env.local). Added to External Blockers as "Done".
- Sungrow iSolarCloud API → D1, External Blockers table ✅
- Growatt API → D1, External Blockers table ✅
- WATI.io WhatsApp BSP → E1, External Blockers table ✅
- Facebook Business Manager → Required for WATI.io, noted in External Blockers under E1 ✅

**Additional items from CLAUDE.md not in Master Ref phases:**
- G5 (Overdue customer invoice escalation) → from Master Ref S6.4 ✅
- C10 (Service ticket lifecycle) → implied by S14 SLA alert ✅
- C11 (Marketing manager feedback) → operational item ✅
- F7 (WhatsApp import queue review) → CLAUDE.md operational item ✅
- F8 (Nightly cron jobs) → Master Ref S5.4 ✅

---

## Summary

| Category | Count | Priority | Blocked By |
|----------|-------|----------|------------|
| A: Production Deployment | 7 | P0 | Vivek reviews |
| B: UI/UX R2 Completion | 6 | P1 | Nothing |
| C: Field & Customer | 11 | P1 | Mobile app (C1), n8n (F5) |
| D: Intelligence | 8 | P2 | n8n (F5), external APIs |
| E: Scale | 7 | P3 | Various |
| F: Data & Infrastructure | 8 | P1–P2 | n8n hardware, Vivek review |
| G: Business Alerts | 11 | P1–P2 | **F5 (n8n setup)** for all |
| **Total** | **58** | | |

**Critical path:** Vivek reviews (A2, A3) → Prod deployment (A1, A4–A7) → n8n setup (F5) → Business automations (G1–G10)

**Biggest single unlock:** F5 (n8n setup on spare laptop) unblocks 10 alerts + WhatsApp automations + nightly crons.

**Biggest single effort:** C1 (mobile app) — estimated 8 weeks, unlocks photo gates, O&M mobile, and customer app.
