# H3 — AI Roadmap

> Plan date: 2026-05-25
> Goal: evaluate 8 candidate AI features beyond H1 + H2; recommend a priority order.

Each entry has consistent shape — goal, what's already there, what's new, effort (in 3-hour sessions), AI cost at expected volume, dependencies, risks. Vivek picks the build queue.

---

## Feature F1 — Daily/weekly executive briefing on WhatsApp

**Goal:** Push to Vivek (+ optionally Prem + Manivel) every morning at 07:00 IST: yesterday's wins, key numbers, decisions needed today.

**What's already there:**
- E8 `project-daily-report.ts` AI singleton already wraps Anthropic
- `ai-caller.ts` provider abstraction
- n8n morning-digest workflow scaffolding (#19 Vivek 7AM exists, currently data-driven not AI-narrated)
- All the underlying RPCs: `get_lead_stage_counts`, `get_company_cash_summary_v2`, `get_pipeline_close_window`, `get_payments_expected_this_week`, `get_msme_aging_summary`

**What's new:**
- New action `generateExecutiveBriefing(date)` — gathers ~8 KPI buckets + serialises into one Haiku prompt
- One Haiku call per recipient per morning (4 recipients × 30 days = 120 calls/month)
- Augment existing n8n workflow #19 to call the ERP `/api/briefing/run` endpoint before composing the WhatsApp message

**Effort:** 2 sessions (one for the briefing action + prompt, one for n8n wiring)
**AI cost:** ~120 calls × 3k tokens = 360k tokens = ~$1.50 / ₹125 per month
**Dependencies:** None (everything already exists)
**Risks:** Quality varies if data is sparse on a quiet day. Mitigate: prompt explicitly says "if no major signal, write a 1-sentence 'quiet day' acknowledgement."

---

## Feature F2 — AI customer message personalisation for F1 drip

**Goal:** Today's F1 customer drip workflows (#40–47) use fixed Meta templates with variable substitution. Add a per-customer flavor pass that personalises the placeholder copy while staying within Meta's template constraints.

**What's already there:**
- F1 8 workflows + 8 Meta templates pending approval
- `customer_message_log` audit table

**What's new:**
- Per-message Haiku call to generate the variable values with customer-specific tone (e.g., for the 90-day check-in: rotate between "How's your bill looking?" / "Generation steady?" / "Any maintenance needs?" based on prior interaction history)
- Audit trail in `customer_outreach_queue.ai_personalisation` JSONB

**Effort:** 1 session (after F1 templates are approved + workflows active)
**AI cost:** ~1000 customer messages/month × 1k tokens = ~$4 / ₹335 per month
**Dependencies:** F1 must be live first; Meta template approval; F2 Meta Business Verification (already done)
**Risks:** Meta templates are rigid — too much variation may violate template parameter limits. Constrain prompt to a fixed set of pre-vetted phrasings.

---

## Feature F3 — Vendor bill OCR + GST extraction

**Goal:** Extend the existing `process-document` Edge Function to handle vendor bills: extract supplier GSTIN, line items, totals, due date → auto-create `vendor_bills` row pending finance approval.

**What's already there:**
- `process-document` Edge Function with Anthropic vision for PDF/image extraction (E6, mig 125)
- `vendor_bills` + `vendor_bill_items` schema (mig 067)
- `documents` table with category linking

**What's new:**
- New extraction profile in `process-document` for `category = 'vendor_bill'`
- Specific prompt template for Indian GST invoice format (GSTIN, HSN, CGST/SGST/IGST split, line items, total, due date)
- New action `createVendorBillDraftFromDocument(documentId)` that creates `vendor_bills` row in `status='draft'` linked to the document
- Finance review page lists draft bills awaiting approval

**Effort:** 3 sessions (prompt iteration is hard; needs ~50 real bills for testing)
**AI cost:** Sonnet (vision better than Haiku for OCR) — ~$15/M tokens output. 500 bills/month × 8k tokens = ~$60 / ₹5000/month. Higher than other features but offsets ~20 hours/month of manual entry.
**Dependencies:** `ANTHROPIC_API_KEY` for Edge Function (currently unset — same blocker as Tier B re-extraction)
**Risks:** Indian vendor invoices are highly variable in layout. Sonnet handles most but ~15% will need human review. Build with a confidence-score gate from day 1.

---

## Feature F4 — Cash-flow forecast

**Goal:** Predict next 30/60/90-day cash position from payment-pattern history. Score each `expected_payment` row's probability based on historical patterns of similar customers/projects.

**What's already there:**
- `customer_payments` history
- `proposal_payment_schedule` with milestone-linked SLAs
- `payment_followup` + `payment_escalation` tasks
- `get_company_cash_summary_v2` for current snapshot

**What's new:**
- New `cash_flow_forecasts` table with weekly snapshots
- Python or SQL model (probably SQL with simple weighted moving averages — AI not strictly needed)
- Founder dashboard widget showing 30/60/90 day projections with confidence band
- Optional: AI narrative explaining the forecast ("collections likely to dip in early June due to FY-end customer reluctance")

**Effort:** 4 sessions — most of it is data modelling, not AI
**AI cost:** Minimal (~$2/mo if narrative is added)
**Dependencies:** Clean payment-pattern data (the 2026-05-24 review flagged 76 unmatched Zoho projects + Tier B/D recovery gaps — those need closing before forecasts will be trustworthy)
**Risks:** Garbage in / garbage out. Don't ship until D2/D3/D4 data cleanup is done.

---

## Feature F5 — AI lead routing

**Goal:** Inbound lead from website / WhatsApp → AI scores it (residential/commercial, ticket size, geo, urgency) → auto-assigns to the right sales engineer + sets `closure_probability`.

**What's already there:**
- `leads.estimated_size_kwp`, `leads.segment`, `leads.city`, `leads.assigned_to`
- `channel_partners.is_internal` for routing logic
- Lead creation paths: website (Phase 2C), WhatsApp marketing chat (H1 update path), manual

**What's new:**
- New action `scoreAndRouteLead(leadId)` that:
  - Reads lead context (extracted city, message text if from WhatsApp, kWp hint, urgency keywords)
  - Calls Haiku to extract: segment (residential/commercial/industrial), urgency (low/med/high), territory match
  - Looks up sales engineer load (active lead count) + territory map
  - Assigns + sets `closure_probability` per a simple rule + initial follow-up task

**Effort:** 2 sessions
**AI cost:** ~30 new leads/day × 600 tokens = 540k tokens/mo = ~$2 / ₹170
**Dependencies:** Defined territory map (currently informal — need a `sales_territories` table or just a JSON config)
**Risks:** Auto-assignment can frustrate humans if wrong. Default to AI-suggested-but-human-confirmed for week 1.

---

## Feature F6 — Smart task suggestions

**Goal:** "Mr Kumar lead has been stale for 14 days — suggest follow-up call" auto-creates a task via existing `tasks` table. Today the `sync_lead_followup_task` trigger fires only on `next_followup_date` change.

**What's already there:**
- `tasks` table with `category='lead_followup'`
- `sync_lead_followup_task` trigger (mig 108)
- `MyTasks` dashboard widget

**What's new:**
- New pg_cron job: every morning at 06:00 IST, find leads where:
  - `status NOT IN ('won','lost','disqualified','converted')`
  - `updated_at < NOW() - INTERVAL '7 days'` for low-priority OR `>14 days` for any
  - No open `lead_followup` task already
- For each: Haiku-generate a 1-sentence task description ("Mr Kumar — quick quote sent 14 days ago, no response. Call to confirm interest.") and insert as a new task assigned to the lead owner.

**Effort:** 2 sessions
**AI cost:** ~50 suggestions/day × 400 tokens = 600k tokens/mo = ~$2.5 / ₹210
**Dependencies:** None
**Risks:** Could spam users with low-quality tasks. Cap at 5 suggestions per user per day. Make easy-dismiss.

---

## Feature F7 — BOQ vs Actual variance narrative

**Goal:** Extends E11 (`bom_actual_vs_budgetary` table — schema-only today) with a narrative summary per project: "DC cable consumed 18% over BOQ — flag to PM for next project's costing".

**What's already there:**
- `bom_actual_vs_budgetary` table with per-project per-category variance rows (mig 128, no UI)
- E12 `get_om_profitability` for project-level P&L

**What's new:**
- New action `generateBoqVarianceNarrative(projectId)` — reads variance rows, calls Haiku to produce 3-sentence summary
- Surface on project detail page Profitability sub-section
- Cron: nightly run for projects that closed in the last 30 days

**Effort:** 1 session (small, isolated)
**AI cost:** ~10 projects/week × 800 tokens = 32k tokens/mo = trivial (<$0.50 / ₹40)
**Dependencies:** Needs `bom_actual_vs_budgetary` to actually have data — needs an ingest path (which doesn't exist yet — would need to populate from BOQ items + DC items reconciliation)
**Risks:** Garbage in (E11 has no ingest yet). Lower priority until E11 data flows.

---

## Feature F8 — AI proposal generation assist

**Goal:** Prem describes requirements in plain English; AI drafts the BOM line items. Reuses existing `price_book` + `budgetary-quote.ts` logic — AI just maps customer wording → catalog items.

**What's already there:**
- `price_book` table with ~600 items + brand + model + unit price
- `budgetary-quote.ts` generator (rule-based, recently fixed)
- BomPicker UI component on the proposal page

**What's new:**
- New action `suggestBomFromDescription(leadId, description)` — Haiku reads description + price_book sample + returns suggested line items with rationale
- New "AI Suggest" button on the BomPicker that pre-fills the BOM
- Confidence flag per suggested line; designer reviews before commit

**Effort:** 3 sessions
**AI cost:** ~30 proposals/month × 2k tokens = 60k tokens = ~$1.50 / ₹125
**Dependencies:** Vivek's BOM standard (which catalogs to prefer)
**Risks:** Bad AI suggestions could waste the designer's time more than help. Pilot with a single designer (Shravan?) for 2 weeks before opening to Prem.

---

## Recommended priority order

| Rank | Feature | Effort | Monthly cost | Why |
|------|---------|--------|--------------|-----|
| 1 | **F6 — Smart task suggestions** | 2 sessions | ₹210 | High value, no data dependencies, easy to A/B |
| 2 | **F7 — BOQ variance narrative** | 1 session | ₹40 | Small build, unblocks E11 — start surfacing the data |
| 3 | **F1 — Daily executive briefing** | 2 sessions | ₹125 | Compounds with H1 (you're already getting comfy with WA-based AI by then) |
| 4 | **F5 — AI lead routing** | 2 sessions | ₹170 | Defer until territory map exists + lead volume justifies it |
| 5 | **F2 — Customer message personalisation** | 1 session | ₹335 | After F1 drip is live + Meta-approved |
| 6 | **F8 — AI proposal assist** | 3 sessions | ₹125 | Lower urgency; current BOM generator works |
| 7 | **F3 — Vendor bill OCR** | 3 sessions | ₹5,000 | Highest cost; defer until vendor bill volume + finance complaints justify |
| 8 | **F4 — Cash-flow forecast** | 4 sessions | ₹165 | Blocked on D2/D3/D4 data cleanup |

## Rationale

- **F6 + F7 + F1 in the first wave** because each is short, cheap, valuable, and uses Haiku.
- **F5 + F2** in second wave once the foundations from H1/H2/wave 1 stabilise.
- **F8** later — current BOM generator works fine; this is polish.
- **F3** defer — the cost is real (~$60/month) and Indian vendor invoice variability is a hard problem. Worth doing once finance complaint volume justifies it.
- **F4** defer — useless without clean data.

Combined first-wave AI cost (H1 + H2 + F6 + F7 + F1): **~₹3,500/month** total at expected volumes. Trivial compared to the operational time saved.

## Ready-to-execute checklist (for whichever you pick)

- [ ] `ANTHROPIC_API_KEY` set in `.env.local` + Vercel + Supabase Edge Function env (only F3 needs the last one)
- [ ] `AI_MODEL` env override path tested (use Haiku for F6/F7/F1/F5/F2/F8; Sonnet for F3)
- [ ] After build: 1-week pilot with 1 user before opening to others
- [ ] Founder gets the audit log for any feature that auto-creates DB rows (F6 tasks, F5 routings, F3 vendor bills)
