# Shiroi ERP — Phase 2C Roadmap & Full Status
**Date:** April 3, 2026
**Status:** Approved by Vivek

---

## Decisions Made This Session

1. **Daily file sync: Option C** — n8n cron (catches Google Drive stragglers) + in-ERP upload UI (new primary path). Drive usage fades over time.
2. **HubSpot: one-time cutover now** — Import all leads + deals, dedup against existing data, then stop using HubSpot.
3. **Proposals: 1,300 from Google Drive** — Multiple folders shared via same service account API key. Dedup by project name + system size + phone number.
4. **Full Google Drive scan now** — Not Phase 4 (moved from step 74). Scan entire drive, upload all remaining files.
5. **Prod DB: clean schema approach** — Run all migrations 001–010 on prod SQL Editor (no pg_dump clone). Migrate only verified clean data.
6. **Domain: erp.shiroienergy.com** — Owned on GoDaddy. CNAME to Vercel.
7. **Two-stage quoting:**
   - Budgetary quote (instant): Lead → auto-generate rough quote from price book rates. No design needed.
   - Detailed final quote (after design): Designer uploads AutoCAD/SketchUp → builds detailed BOM in ERP → auto-generates proposal with line items, GST, payment schedule.
8. **Branded proposal PDF templates** — Shiroi letterhead, terms, system specs, payment schedule, warranty. Auto-generated.
9. **Completion % tracking in Phase 2C** — Objective model from sub-components (structure %, electrical %, panels installed/total, inverter, net meter). Not supervisor estimate.
10. **Employee accounts** — Vivek will provide full list. All ~50 employees set up on prod at deployment time.

---

## Full Step List

### Done

| # | Step | Phase | Date |
|---|------|-------|------|
| 1–18 | Core ERP (monorepo, DB, auth, design system, 8 screens, Sentry, tests) | 1A | Mar 30, 2026 |
| 19–29 | Role dashboards (10 roles, PM stepper, role switcher) | 2A | Apr 1, 2026 |
| 30–39 | All 53 screens + Google Drive migration (vendors, projects, POs, expenses, files) | 2B | Apr 3, 2026 |

### Phase 2C — Data Completion + Automation + Deployment (Current)

| # | Step | Description |
|---|------|-------------|
| 40 | HubSpot one-time cutover | Import all leads + deals. Dedup against existing ~160 projects by phone + name |
| 41 | Proposals migration (1,300) | Scan Google Drive proposal folders. Extract proposal data + detailed BOMs. Dedup by project name + system size + phone |
| 42 | Full Google Drive scan + historical archive | Scan entire Shiroi Energy drive for all remaining files. Upload to Supabase Storage |
| 43 | Data integrity check | Every project has a lead, every PO links to valid project + vendor, no orphans |
| 44 | Budgetary quote engine | Lead → auto-generate rough quote from price book (system size x rates). Instant |
| 45 | Design-to-BOM workflow | Designer uploads layout → builds detailed BOM → links to price book for rates |
| 46 | Detailed proposal generation | BOM → detailed quote with line items, GST breakup, payment schedule, margin |
| 47 | Branded proposal PDF templates | Shiroi letterhead, terms, specs, payment schedule, warranty. Auto-generated |
| 48 | Completion % tracking | Objective model from sub-components, not supervisor estimate |
| 49 | Daily file sync (n8n) | Cron: scan Drive for files modified in last 24h → upload to Storage. 11 PM daily |
| 50 | In-ERP file upload UI | Drag-drop on project detail page. Direct to Supabase Storage |
| 51 | UI improvements | Usability, loading states, mobile responsiveness |
| 52 | Apply all migrations to prod | Run 001–010 on prod SQL Editor (clean schema) |
| 53 | Set up employee accounts on prod | All ~50 employees from Vivek's list |
| 54 | Migrate verified data to prod | Run scripts against prod (clean data only) |
| 55 | Git branching | main / staging / feature |
| 56 | Vercel deployment | Connect repo, env vars, deploy |
| 57 | Domain setup | erp.shiroienergy.com → Vercel (CNAME in GoDaddy) |
| 58 | Go-live smoke test | All 10 roles verify dashboards, data, RLS |

### Phase 3 — Field Apps + Automation

| # | Step |
|---|------|
| 59 | n8n WhatsApp employee-forward |
| 60 | Photo gates + GPS verification |
| 61 | AI daily report narrative (Claude API) |
| 62 | Offline-first mobile app (React Native + Expo + WatermelonDB) |
| 63 | O&M visit checklists (mobile) |
| 64 | Net metering + CEIG full workflow |
| 65 | Handover pack auto-generation |
| 66 | Customer app (portal, docs, e-card, service tickets) |
| 67 | Inventory cut-length tracking |
| 68 | DC digital signatures |
| 69 | Intermediaries table |

### Phase 4 — Intelligence

| # | Step | Blocker |
|---|------|---------|
| 70 | Sungrow iSolarCloud integration | Registration in progress |
| 71 | Growatt API integration | Registration in progress |
| 72 | Quarterly customer check-ins (AI) | — |
| 73 | BOM correction factor feedback | — |
| 74 | Daily microlearning engine | Needs WATI or n8n |
| 75 | Onboarding tracks + assessments | — |
| 76 | O&M profitability analytics | — |
| 77 | PVLib microservice (port 5001) | — |

### Phase 5 — Scale

| # | Step | Blocker |
|---|------|---------|
| 78 | WATI.io WhatsApp direct | Registration in progress |
| 79 | GST e-invoicing | — |
| 80 | Full referral program | — |
| 81 | Bilingual microlearning | — |
| 82 | Salary benchmarking analytics | — |
| 83 | External customer proposal portal | — |
| 84 | OpenRouter model flexibility | — |

### Summary: 39 done, 19 in current phase, 26 planned = 84 total
