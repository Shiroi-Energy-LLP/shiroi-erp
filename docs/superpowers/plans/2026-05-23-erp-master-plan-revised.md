# Shiroi ERP — Revised Master Plan

> **Supersedes:** `docs/superpowers/specs/2026-04-03-phase2c-roadmap-design.md`
> **Last updated:** 2026-05-23

## Strategy

Build in dev until Phase B (Marketing) + Phase C (Operations) are complete and the Phase D manual data cleanup is done. Then employee testing week → prod migration. Phase E/F features continue in parallel with C and D — external blockers on E don't block C or B. Mobile (Phase G) is a separate phase.

**Prod gate:** data cleanup done + Prem signs off on marketing + Manivel/Vinodh sign off on operations + employee testing week passes.

---

## Phase A — Complete ✅

Everything built through the original Phase 1A/2A/2B/2C foundation:
- Core ERP, auth, design system, all 53 screens scaffolded
- HubSpot import (1,111 leads), Google Drive migration, Zoho Books import (13-phase)
- Sales/CRM, Contacts, Design, Projects, Purchase (5-stage), Finance, Expenses, O&M, Liaison (TNEB), Settings, Tasks, Documents Phase 1
- n8n WhatsApp automation (6 workflows live, direct Meta Cloud API)
- Vercel deployment at `erp.shiroienergy.com` (pointing at dev Supabase)

---

## Phase B — Marketing Complete

**Gate:** Prem signs off on `/sales` + payment tracker + quotes.

| ID | Task | Migration | Status |
|----|------|-----------|--------|
| B1 | Payment tracker: `follow_up_date` + `expected_payment_date` per payment-schedule row | yes | 🔲 |
| B2 | Payment tracker: "Payments Expected This Week" KPI card on dashboard + `/cash` | no | 🔲 |
| B3 | Payment tracker: follow-up action — mark contacted, reschedule date, add note | yes | 🔲 |
| B4 | BOM generator: add missing categories — AC cable, earthing, conduit, misc/civil so Quick Quote totals are meaningful | no | 🔲 |
| B5 | Quick Quote PDF: fix bad sections, align to real Shiroi format | no | 🔲 |
| B6 | Detailed Quote: prominent flow — surface create/edit as primary action in lead detail | no | 🔲 |
| B7 | Detailed Quote PDF: improvement pass to match real detailed proposal format | no | 🔲 |

---

## Phase C — Operations Complete

**Gate:** Manivel (Projects/Purchase) + Vinodh (Finance) + HR head sign off.

| ID | Task | Migration | Status |
|----|------|-----------|--------|
| C1 | Purchase: gap review + any missing workflow steps | tbd | 🔲 |
| C2 | Finance: invoice raising from within ERP | yes | 🔲 |
| C3 | Finance: payment collection recording (mark paid, partial payments) | yes | 🔲 |
| C4 | Finance: receivables reconciliation view — match invoices to payments, show gaps | no | 🔲 |
| C5 | HR: full leave management — request, approve, track balance | yes | 🔲 |
| C6 | HR: employee profile — salary details, bank details, documents | yes | 🔲 |
| C7 | HR: attendance tracking | yes | 🔲 |
| C8 | Inventory: cut-length tracking (wire/cable) | yes | 🔲 |
| C9 | Projects: completion % — objective model from sub-components (structure, electrical, panels, inverter, net meter) | yes | 🔲 |
| C10 | Documents: drag-drop file upload UI, better organisation by category | no | 🔲 |
| C11 | Handover pack auto-generation PDF (system specs, warranty, bank details, as-built summary) | no | 🔲 |
| C12 | DC digital signatures | yes | 🔲 |

---

## Phase D — Manual Gate (runs in parallel, not a build blocker)

| ID | Task | Who |
|----|------|-----|
| D1 | Zoho orphan triage — 303 invoices + 659 payments at `/cash/orphan-invoices` | Prem + Manivel |
| D2 | 76 unmatched Zoho projects — match in `zoho_project_mapping` | Vivek |
| D3 | 39 Payments-pipeline deals — triage, create missing ERP projects | Vivek |
| D4 | 24 `[Likely-Duplicate-Reconcile]` projects — merge/delete | Vivek + Prem |
| D5 | Employee accounts setup on dev (all ~50) | Vivek |
| D6 | Employee testing week | All roles |
| D7 | Fix feedback from testing | Claude |
| D8 | Apply migrations 013–latest to prod | Vivek |
| D9 | Selective data migration to prod | Claude + Vivek |

---

## Phase E — Intelligence (parallel with C and D)

| ID | Task | Blocked by | Status |
|----|------|-----------|--------|
| E1 | Inverter: Growatt OpenAPI real adapter (replace NotImplementedError) | Growatt support email to link token to EEVUWE001 | 🔄 In progress |
| E2 | Inverter: Sungrow OAuth2 callback route + adapter | — | 🔄 In progress |
| E3 | Inverter: SolarMan/Deye + Goodwe adapter stubs (synthetic-mode) | SolarMan paid plan, Goodwe India | 🔄 In progress |
| E4 | `/om/inverters` management UI | — | 🔄 In progress |
| E5 | Inverter Edge Function wired + n8n polling cron live | E1–E4 | 🔄 In progress |
| E6 | Documents AI extraction Phase 2 — edge function real impl (text extraction + embeddings) | ANTHROPIC_API_KEY in edge function env | 🔲 |
| E7 | Zoho live sync — n8n workflow consuming `zoho_sync_queue` → Zoho Books API | Zoho API credentials | 🔲 |
| E8 | AI daily report narrative per project/role (Claude API) | — | 🔲 |
| E9 | Photo gates + GPS verification on project milestones | — | 🔲 |
| E10 | Quarterly customer AI check-in (generates WhatsApp/email touchpoints) | — | 🔲 |
| E11 | BOM correction factor feedback loop (actual vs budgetary learning) | — | 🔲 |
| E12 | O&M profitability analytics (cost per visit, SLA compliance) | — | 🔲 |
| E13 | Daily microlearning engine (WhatsApp via n8n + Meta) | — | 🔲 |
| E14 | Onboarding tracks + assessments | — | 🔲 |
| E15 | PVLib microservice deployment on DO droplet | — | 🔲 |

---

## Phase F — Scale (parallel with E)

| ID | Task | Blocked by | Status |
|----|------|-----------|--------|
| F1 | Customer-facing WhatsApp drip sequences via n8n + Meta API — proposal sent, project milestones, O&M reminders, payment reminders to customers | — | 🔲 |
| F2 | Meta Business Verification — submit docs to lift messaging tier (manual: Vivek submits on business.facebook.com) | Manual | 🔲 |
| F3 | GST e-invoicing integration | GST API credentials | 🔲 |
| F4 | Full referral program — tracking, payout tracking, referrer portal | — | 🔲 |
| F5 | Bilingual microlearning — Tamil content | Content creation | 🔲 |
| F6 | Salary benchmarking analytics | — | 🔲 |
| F7 | External customer proposal portal | — | 🔲 |
| F8 | OpenRouter model flexibility | — | 🔲 |

---

## Phase G — Mobile (separate phase, after F)

| ID | Task |
|----|------|
| G1 | React Native + Expo + WatermelonDB setup |
| G2 | Field app — project status, photo upload, GPS check-in |
| G3 | O&M visit checklists (mobile-first) |
| G4 | Customer app — portal, documents, e-card, service tickets |
| G5 | Offline sync + conflict resolution |

---

## Execution Order

### Tonight (2026-05-23 → 2026-05-24)

**Wave 1 — Phase B (parallel):**
- Agent A: B1 + B2 + B3 — payment tracker migration + UI + follow-up actions
- Agent B: B4 + B5 — BOM generator missing categories + Quick Quote PDF fix
- Agent C: B6 + B7 — Detailed Quote prominent flow + PDF improvement

**Wave 2 — Phase C (parallel, after Wave 1):**
- Agent A: C1 + C2 + C3 + C4 — Purchase gaps + Finance invoice/payment/reconciliation
- Agent B: C5 + C6 + C7 — HR leave + profiles + attendance
- Agent C: C8 + C9 — Inventory cut-length + Projects completion %
- Agent D: C10 + C11 + C12 — Documents upload UI + Handover pack + DC signatures

**Wave 3 — Phase E (parallel with Wave 2):**
- Continues inverter integration E1–E5
- E6: Documents AI extraction framework (stub real calls, config pending)
- E7: Zoho live sync n8n workflow (framework, config pending)
- E8: AI daily report narrative
- E9: Photo gates + GPS
- E10–E15: remaining intelligence features

**Wave 4 — Phase F:**
- F1: Customer WhatsApp drip sequence n8n workflows
- F3: GST e-invoicing framework
- F4: Referral program
- F6: Salary benchmarking
- F7: Customer portal
- F8: OpenRouter

*F2/F5 require manual action (Meta verification, Tamil content) — documented but not buildable autonomously.*

---

## Migration State

| Env | Latest | Pending |
|-----|--------|---------|
| Dev (`actqtzoxjilqnldnacqz`) | **115** | 116+ from overnight run |
| Prod (`kfkydkwycgijvexqiysc`) | **012** | 013–115+ after employee testing |
