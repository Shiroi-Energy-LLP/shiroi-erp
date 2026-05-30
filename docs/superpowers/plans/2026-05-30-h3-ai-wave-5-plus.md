# H3 AI Roadmap — Wave 5+ — 2026-05-30

> Plan date: 2026-05-30 (Wave 5+ — the next 8–12 AI features after Waves 1–4 shipped May 22–25)
> Companion plans: `2026-05-25-ai-roadmap-plan.md` (Waves 1–4 — DONE), `2026-05-25-whatsapp-two-way-plan.md`, `2026-05-25-automated-handover-plan.md`
> Lighter-detail catalog draft. One feature per dispatchable agent run.
> Goal: lock the next ~10 features so subagents can pick them up in order.

---

## Recap

Waves 1–4 (May 22–25 — migrations 138 + 139) shipped the AI substrate Shiroi runs on today: **provider abstraction** (`ai-caller.ts` + OpenRouter swap via env var), **RAG Phase 1 + 2** (docs, proposals, service tickets, lead activities indexed in `rag_chunks`; nightly cron #72), **internal Q&A** (`/ask` + `knowledge-qa.ts` with rate limits), **smart task suggestions** (`task-suggestion-*`), **BOQ variance narratives** (`boq-variance-narrative.ts`), **daily exec briefing** (`briefing-narrator.ts` → workflow #19), **Tamil voice site reports** (`sarvam-client.ts` + workflow #64), **monthly customer performance** (`monthly-perf-*` + #65), **drip personalisation** (`drip-personaliser.ts`), **AI lead scoring + routing + win/loss patterns** (`lead-scorer.ts` / `lead-router.ts` / `win-loss-analyser.ts` + Sunday cron #68), **plant anomaly alerts** (`anomaly-*` + daily cron #69), **photo QC AI** (`photo-qc-analyzer.ts` + #70), and **vendor invoice email ingest** (`vendor-invoice-extractor.ts` + IMAP #71). Across `apps/erp/src/lib/ai/` there are now ~30 helpers, and the n8n event-bus router carries 11 AI-specific event names (`lead.scored`, `qc.photo_finding_created`, `vendor.bill_ai_extracted`, etc.). Cost is tracking ~₹3,500/mo combined LLM + ASR + embeddings — well below the ₹10k Ollama-migration threshold. **Wave 5+ builds on this substrate, not parallel to it.**

---

## Wave 5+ feature catalog

### W5-1: Customer churn-risk score (post-install)

- **Value to**: founder, om_technician, project_manager
- **One-line**: Score every commissioned customer 0–100 on "likely to file a complaint / cancel AMC / refuse referral in next 90 days" so we triage outreach.
- **Tech sketch**: New `customer_risk_scores` table (project_id, score, top_risk_factor, ai_narrative, scored_at). Inputs: open `om_service_tickets` count + age, last `customer_checkins` outcome, `plant_anomaly_log` unresolved count, days since commissioning, payment delay history from `customer_payments`, monthly perf variance trend from `monthly_performance_reports`. Server action `scoreCustomerChurnRisk(projectId)` → Haiku via `callAi()` with structured output. Weekly cron (new workflow `#73-churn-risk-weekly`) rescore all commissioned projects. Surface in `/om/customers` as a sortable column; "High risk" badge on project detail page. Emit `customer.churn_risk_high` event when score crosses 70 → drip into Vivek's WhatsApp.
- **Effort**: M
- **Depends on**: Waves 1+4 (anomaly log, monthly perf). No external setup.
- **Dispatch-ready task**:
  > "Add a customer churn-risk feature. Migration N adds `customer_risk_scores` table (project_id UUID FK + score INT 0–100 + top_risk_factor TEXT + contributing_factors JSONB + ai_narrative TEXT + ai_model + ai_tokens_used INT + scored_at TIMESTAMPTZ + UNIQUE(project_id, scored_at::date)). Write `apps/erp/src/lib/ai/churn-risk-scorer.ts` exporting `scoreCustomerChurnRisk(projectId)`: pull last 90 days of om_service_tickets, customer_checkins, plant_anomaly_log, customer_payments, monthly_performance_reports for the project — pass to Haiku via callAi() with the prompt 'Given these post-install signals, score 0–100 churn risk and name the top factor.' Persist row, emit `customer.churn_risk_high` if score≥70. Add `/api/churn-risk/run` route that takes optional project_id (single) or scans all completed projects with commissioned_date≥18-months-ago. Add workflow `73-churn-risk-weekly.json` (Sunday 06:00 IST cron → HTTP to /api/churn-risk/run). Add risk column to `/om/customers` table and high-risk badge to project detail page. Add `customer.churn_risk_high` to ErpEventName + route case in 00-event-bus-router. CI gates green; CHANGELOG line; commit + push."

### W5-2: WhatsApp inbound auto-categorization

- **Value to**: founder, marketing_manager, om_technician (whoever monitors WA inbox)
- **One-line**: Every inbound WA message routed by AI into {lead, support, vendor, spam, internal} so the right person gets pinged, not Vivek.
- **Tech sketch**: Already have `whatsapp_import_queue` (mig 025) + Meta delivery webhook #57. Extend the inbound webhook to call new `categoriseInboundWhatsapp(sender, body, hasMedia)` (Haiku) — returns category + confidence + suggested_assignee_role + first_line_summary. Persist on `whatsapp_import_queue` (new columns `ai_category`, `ai_confidence`, `ai_assignee_role`, `ai_summary`). Spam → silent drop into archive bucket. Lead → existing marketing extractor (already wired). Support → create `om_service_tickets` draft. Vendor → email/route to purchase. Use a fallback rule: low confidence (<0.6) keeps current behavior (manual review queue). Surface in a new `/whatsapp/inbox` page (founder, marketing_manager).
- **Effort**: M
- **Depends on**: WA two-way work in `2026-05-25-whatsapp-two-way-plan.md` (if shipped). If not, scope this to the existing `whatsapp_import_queue` rows only.
- **Dispatch-ready task**:
  > "Categorise inbound WhatsApp messages with AI. Migration adds columns `ai_category` (TEXT CHECK IN lead/support/vendor/spam/internal/unknown), `ai_confidence` (NUMERIC(3,2)), `ai_assignee_role` (TEXT), `ai_summary` (TEXT), `ai_categorised_at` (TIMESTAMPTZ) to whatsapp_import_queue. Write `apps/erp/src/lib/ai/whatsapp-categoriser.ts` exporting `categoriseInboundWhatsapp(sender, body, hasMedia)` — Haiku via callAi(). Hook the categoriser into the inbound webhook handler (find the existing handler reading whatsapp_import_queue). For spam: mark `processed_at`, no further action. For support: insert om_service_tickets draft + emit `om_ticket.created`. For vendor: emit new `whatsapp.vendor_message_received`. For lead: hand to existing marketing extractor. Add `/whatsapp/inbox` page (founder + marketing_manager) showing recent inbound with category badge + confidence. Smoke against 10 historical rows. CI gates green; CHANGELOG; commit + push."

### W5-3: AI cost-overrun predictor on active projects

- **Value to**: founder, project_manager
- **One-line**: For every in-progress project, predict whether actual BOM trajectory will exceed budget at completion — flag before the overrun lands.
- **Tech sketch**: Inputs are `bom_actual_vs_budgetary` (mig 128) + grn_items consumed-to-date + `purchase_orders.total_amount` committed + project completion %. Compute "if we're 40% done and consumed 55% of cable, projected overrun = +37%". Haiku narrates the projected gap by category and suggests likely cause from past projects (RAG into similar completed projects). New `project_cost_predictions` table. Surface on project detail Profitability subsection above the existing variance narrative. Weekly cron `#74-cost-overrun-predict-weekly` runs all active projects. Emit `project.cost_overrun_predicted` when predicted overrun ≥10% AND completion ≤70%.
- **Effort**: M
- **Depends on**: Wave 1 (BOQ variance narrative — uses same data shape). RAG Phase 2 (proposals indexed).
- **Dispatch-ready task**:
  > "Add cost-overrun prediction. Migration N: `project_cost_predictions` table (project_id, prediction_date, predicted_overrun_pct, predicted_overrun_inr, completion_pct_at_prediction, category_breakdown JSONB, similar_past_projects JSONB, ai_narrative, ai_model, created_at; UNIQUE(project_id, prediction_date)). Write `apps/erp/src/lib/ai/cost-overrun-predictor.ts` exporting `predictCostOverrun(projectId)` — fetch bom_actual_vs_budgetary rows + project_completion_components for the project; fetch RAG `retrieve(project.address + ' ' + segment, {source_types:['proposal'], top_k:3})` for similar past completed projects; pass everything to Haiku. Persist + emit `project.cost_overrun_predicted` if predicted_overrun_pct ≥10 AND completion ≤70. Add `/api/cost-overrun/run` route + workflow `74-cost-overrun-predict-weekly.json` (Monday 06:30 IST). Surface on project detail Profitability section as an amber alert card when prediction exists and is recent. Add event to ErpEventName + router. CI green; CHANGELOG; commit + push."

### W5-4: Lead enrichment from public sources (Google Places + GST)

- **Value to**: marketing_manager, founder
- **One-line**: On lead insert (or button-click), auto-fill the company's verified address, business type, GST status, sector code — so Prem doesn't ask.
- **Tech sketch**: New `lead_enrichment` table (lead_id, source ENUM google_places/gst_registry/mca, raw_data JSONB, enriched_at, ai_summary, confidence). Server action `enrichLead(leadId)` triggers from "Enrich" button on lead detail OR auto-fires post-insert via existing event-bus listener. Google Places API for address + place_id verification (uses lead.address). Public GST search (services.gst.gov.in) for B2B leads — Haiku scrapes the response page. Optional MCA endpoint (commercial scrape — defer until lead volume justifies). AI summarises into 2 lines surfaced on lead detail. Rate limit: 50 enrichments/day org-wide.
- **Effort**: M
- **Depends on**: None internal. External: Google Places API key (~₹0.20/lookup), GST search is free but rate-limited.
- **Dispatch-ready task**:
  > "Add lead enrichment from public sources. Migration: `lead_enrichment` table (lead_id, source ENUM, raw_data JSONB, ai_summary TEXT, confidence NUMERIC, enriched_at, created_by). Add env var `GOOGLE_PLACES_API_KEY`. Write `apps/erp/src/lib/enrichment/google-places.ts` exporting `lookupAddress(addressString)` → returns place_id + verified address + business name + business type. Write `apps/erp/src/lib/enrichment/gst-lookup.ts` exporting `lookupGstByName(companyName)` — POSTs to services.gst.gov.in/services/searchtp; HTML response parsed to extract GSTIN if found. Write `apps/erp/src/lib/enrichment/enrich-lead.ts` exporting `enrichLead(leadId)`: run both, pass results to Haiku for a 2-line `ai_summary`, persist row. Server action wired to an 'Enrich' button on lead detail page (marketing_manager + founder only). Rate-limit 50/day at the action layer. CI green; CHANGELOG; commit + push."

### W5-5: Auto-drafted vendor negotiation emails

- **Value to**: founder, project_manager (anyone who runs purchase)
- **One-line**: When raising a new PO, AI drafts a negotiation email based on this vendor's past quote/PO history — savings prompts, payment-term asks, delivery-time asks.
- **Tech sketch**: New `vendor_negotiation_drafts` table (vendor_id, draft_text, context_summary, ai_model, generated_at, used_at). Server action `draftNegotiationEmail(vendorId, rfqContext)` — pulls last 12 months of purchase_orders + vendor_bills + grn_items for the vendor, computes avg discount actually granted, on-time delivery %, line-item price history. Passes to Haiku with the new RFQ context. Returns draft email with hooks ("Your Q1 delivery slipped 8 days on avg — please commit to a confirmed dispatch date"). Surface as "Draft Email" button on RFQ + PO pages. Marketing_manager + founder + project_manager.
- **Effort**: S
- **Depends on**: None.
- **Dispatch-ready task**:
  > "Add vendor negotiation draft emails. Migration: `vendor_negotiation_drafts` table (id, vendor_id FK, rfq_id FK nullable, po_id FK nullable, context_summary JSONB, draft_text TEXT, ai_model, ai_tokens_used INT, generated_at, generated_by UUID FK profiles, used_at TIMESTAMPTZ). Write `apps/erp/src/lib/ai/vendor-negotiation-drafter.ts` exporting `draftNegotiationEmail(vendorId, rfqContext)`: fetch vendor's last 12 months of purchase_orders, vendor_bills, grn_items; compute avg discount %, on-time delivery %, top 5 line-items with price trend; pass to Haiku via callAi() with a structured prompt asking for a 6-sentence email. Persist + return. Add 'Draft Negotiation Email' button to RFQ detail + PO creation page (founder + project_manager). CI green; CHANGELOG; commit + push."

### W5-6: AI-generated commissioning checklist per project type

- **Value to**: project_manager, om_technician, site_supervisor
- **One-line**: At commissioning kickoff, AI generates the project-specific checklist (industrial vs residential vs commercial; coastal vs urban; net-meter present vs absent) from RAG over past commissioning reports.
- **Tech sketch**: Use `commissioning_reports` (mig 004c) as the RAG source — index existing successful reports into `rag_chunks` (source_type='commissioning_report' — add to CHECK constraint). New server action `generateCommissioningChecklist(projectId)`: pulls project.segment + capacity + ceig_scope + address state; retrieves 5 similar past reports via RAG; passes to Haiku asking for a 15–25 item checklist with category tags. Persists as `project_commissioning_checklists` table linked to `project_completion_components` (so it integrates with the existing completion % engine). UI: "Generate Checklist" button on project detail Progress tab.
- **Effort**: M
- **Depends on**: Wave 3 RAG Phase 2 — needs the chunk type added + ingest script. Also touches `project_completion_components` (mig 004a) — write completion items in the same shape.
- **Dispatch-ready task**:
  > "AI-generate commissioning checklists. Migration: extend rag_chunks.source_type CHECK to include 'commissioning_report'; create `project_commissioning_checklists` table (id, project_id FK, ai_narrative_summary, item_count INT, ai_model, generated_at, generated_by). Write `scripts/rag/ingest-commissioning-reports.ts` — flatten each commissioning_reports row to one chunk per report; reuse existing chunk-and-embed pipeline. Write `apps/erp/src/lib/ai/commissioning-checklist-generator.ts` exporting `generateCommissioningChecklist(projectId)`: pull project segment + capacity + ceig_scope + state from address; retrieve(project.segment + ' commissioning', {source_types:['commissioning_report'], top_k:5}); Haiku writes 15–25 items as JSON; insert each as project_completion_components row with `component_type='commissioning_checklist'`. UI: 'Generate Checklist' button on project detail Progress tab (project_manager + founder). Add ingest to nightly cron #72 (rag-ingest-cron). CI green; CHANGELOG; commit + push."

### W5-7: Inverter anomaly root-cause AI

- **Value to**: om_technician, project_manager, founder
- **One-line**: When `plant_anomaly_log` fires, automatically correlate inverter logs + weather + recent rainfall + nearby project performance to suggest a root cause (vs the current "AI narrative" that's narrative-only).
- **Tech sketch**: Extends Wave 4 anomaly orchestrator. New `plant_anomaly_root_causes` table (anomaly_id, weather_snapshot JSONB, peer_performance JSONB, ai_root_cause TEXT, ai_confidence, ai_model). Pull weather via OpenWeather API (lat/lng from project address) for the anomaly date. Peer performance: same-day generation kWh/kWp for the 5 nearest commissioned projects (uses haversine + `inverter_readings_daily` rollup). Haiku correlates: "Generation down 35% on 2026-05-15 — weather snapshot shows 28mm rain that morning; 4 of 5 peer projects also down 25–40% — most likely cause: weather, not equipment fault." Surface on anomaly detail page (and influence the workflow #69 WhatsApp narrative — if cause confidence ≥0.7, append "Likely cause: <X>" to the alert).
- **Effort**: M
- **Depends on**: Wave 4 plant_anomaly_log. External: OpenWeather API key (free tier suffices).
- **Dispatch-ready task**:
  > "Add root-cause AI to plant anomalies. Migration: `plant_anomaly_root_causes` table (id, anomaly_id FK plant_anomaly_log ON DELETE CASCADE, weather_snapshot JSONB, peer_performance JSONB, ai_root_cause TEXT, ai_confidence NUMERIC, ai_model, ai_tokens_used, created_at; UNIQUE(anomaly_id)). Add env `OPENWEATHER_API_KEY`. Write `apps/erp/src/lib/weather/openweather.ts` exporting `getHistoricalWeather(lat,lng,date)`. Write `apps/erp/src/lib/ai/anomaly-root-cause.ts` exporting `analyseAnomalyRootCause(anomalyId)`: fetch the anomaly + project location; fetch weather + nearest-5-peer-projects' inverter_readings_daily for same date (haversine RPC already in mig 127); pass to Haiku for narrative. Hook into existing anomaly-orchestrator: after narrateAndPersistAnomaly, fire analyseAnomalyRootCause. Update workflow #69 send-WhatsApp template: if root cause exists with confidence≥0.7, append 'Likely cause: <ai_root_cause>'. CI green; CHANGELOG; commit + push."

### W5-8: Site survey Tamil voice → structured survey data (extend B1)

- **Value to**: site_supervisor, project_manager, marketing_manager (Manivel runs surveys)
- **One-line**: Today B1 turns voice → daily report. Extend it: a "Site survey" mode where Manivel records a 2-min Tamil walkthrough during a sales visit → AI extracts roof area + shading notes + structure type + connection load → pre-fills the `lead_site_surveys` form.
- **Tech sketch**: New WhatsApp keyword convention — message body "SURVEY <lead_ref>" preceding the audio. Inbound webhook routes to new endpoint `/api/whatsapp/site-survey-voice` (vs existing `/voice-report`). Sarvam transcribes; Haiku extracts structured `lead_site_surveys` fields (mig 002a) — `roof_type`, `shading_notes`, `structure_recommendation`, `existing_load_kw`, `available_area_sqm` (estimated from voice description). New `lead_site_survey_drafts` table for the AI-extracted draft (so we don't auto-write the real table). Manivel reviews on `/sales/leads/[id]/survey-draft/[draft_id]` → "Accept" merges into lead_site_surveys.
- **Effort**: M
- **Depends on**: Wave 1 B1 (Sarvam infra). Wave 2-4 (`voice-report-structurer.ts` pattern).
- **Dispatch-ready task**:
  > "Extend B1 to site surveys. Migration: `lead_site_survey_drafts` table (id, lead_id FK, transcript_text TEXT, extracted_fields JSONB, audio_path TEXT, ai_model, sender_employee_id, accepted_at TIMESTAMPTZ, accepted_by). Write `apps/erp/src/lib/ai/site-survey-extractor.ts` exporting `extractSiteSurveyFromVoice(audioBytes, leadId)`: Sarvam transcribe → Haiku extract structured fields matching lead_site_surveys schema → persist draft. Add route `/api/whatsapp/site-survey-voice` mirroring `/api/whatsapp/voice-report` but with the survey keyword convention. Add review page `/sales/leads/[id]/survey-draft/[draft_id]` with side-by-side transcript + editable form (founder + marketing_manager + project_manager); 'Accept' merges into lead_site_surveys row. Modify workflow `#64` Switch node to route SURVEY-prefixed messages to the new endpoint. CI green; CHANGELOG; commit + push."

### W5-9: Vendor performance scorecard (auto-rank)

- **Value to**: project_manager, founder
- **One-line**: Weekly auto-computed vendor scorecard ranking every vendor by delivery time, quality (NCR count), price competitiveness, and AI bill-extraction acceptance rate — surfaces under-performing vendors before the next RFQ.
- **Tech sketch**: New `vendor_scorecards` table (vendor_id, period_start, period_end, on_time_delivery_pct, ncr_count, avg_price_index NUMERIC, ai_bill_accept_rate NUMERIC, composite_score INT 0–100, ai_summary TEXT). RPC `compute_vendor_scorecard(vendor_id, period_start, period_end)` does the SQL math (never aggregate in JS). Server action wraps the RPC + Haiku-narrates the scorecard with action recommendation ("Consider sourcing from VEN/0042 — 22% cheaper on identical SKU, on-time 96% vs current 78%"). Cron weekly. Surface on `/vendors` list as sortable column + `/vendors/[id]` detail tab "Scorecards".
- **Effort**: M
- **Depends on**: Vendor bill AI from Wave 4 (S17) for the ai_bill_accept_rate dimension. Otherwise just SQL + Haiku.
- **Dispatch-ready task**:
  > "Add vendor performance scorecards. Migration: `vendor_scorecards` table (id, vendor_id FK, period_start, period_end, total_orders INT, on_time_delivery_pct NUMERIC, ncr_count INT, avg_price_index NUMERIC, ai_bill_accept_rate NUMERIC, composite_score INT, ai_summary TEXT, ai_model, created_at; UNIQUE(vendor_id, period_start, period_end)) + RPC `compute_vendor_scorecard(vendor_id UUID, period_start DATE, period_end DATE)` returning the metrics (must NOT aggregate in JS — pure SQL with grn_items / vendor_delivery_challans / vendor_bills / qc_non_conformance_reports joins). Write `apps/erp/src/lib/ai/vendor-scorecard.ts` exporting `generateVendorScorecard(vendorId, periodStart, periodEnd)` — calls RPC, then Haiku for ai_summary. `/api/vendor-scorecards/run-weekly` route walks all vendors with ≥1 order in the period. Workflow `75-vendor-scorecard-weekly.json` (Monday 07:00 IST cron). Add Scorecards tab to vendor detail page. CI green; CHANGELOG; commit + push."

### W5-10: Knowledge base auto-update (RAG propose-on-upload)

- **Value to**: founder
- **One-line**: When a new SOP/spec/policy doc is uploaded to `documents`, AI compares it against the closest existing RAG chunks and proposes which sections of which existing docs should be updated/superseded.
- **Tech sketch**: Existing `documents` extraction pipeline (`process-document` Edge Function, mig 125) embeds + extracts text. After extraction, new step: `proposeRagUpdates(documentId)` — retrieves(extracted_text first 2000 chars, top_k=10) finds closest existing chunks; Haiku diffs the new doc against each top chunk; outputs `rag_update_proposals` rows ("Doc X section 3.2 conflicts with new doc — recommend update" / "New doc supersedes Doc Y entirely"). Surface in `/admin/rag-debug` as a "Pending proposals" panel; founder Accept → updates the corresponding source markdown file via a follow-up PR (or marks the old chunks `superseded_by_doc_id` so retrieve() filters them out).
- **Effort**: L (PR-generation step is non-trivial; can MVP without it by just marking superseded)
- **Depends on**: Wave 1 RAG + E6 process-document Edge Function.
- **Dispatch-ready task**:
  > "Add RAG knowledge-base auto-update proposals. Migration: `rag_update_proposals` table (id, new_document_id FK documents, affected_chunk_id FK rag_chunks, proposal_type TEXT CHECK IN ['update','supersede','no_action'], ai_rationale TEXT, ai_confidence NUMERIC, status TEXT CHECK IN ['pending','accepted','rejected'] DEFAULT 'pending', reviewed_by, reviewed_at, created_at) + `rag_chunks.superseded_by_document_id` (UUID FK). Write `apps/erp/src/lib/ai/rag-update-proposer.ts` exporting `proposeRagUpdates(documentId)`: fetch document text; retrieve(text.slice(0,2000), top_k=10); for each top chunk call Haiku to classify update/supersede/no_action with rationale; insert proposal rows. Hook into process-document Edge Function: after extraction success, async-fire `/api/rag/propose-updates?document_id=X`. Extend `/admin/rag-debug` page with 'Pending proposals' panel (founder only) — accept marks `rag_chunks.superseded_by_document_id` and proposal.status='accepted'. Update retrieve() to filter `superseded_by_document_id IS NULL`. CI green; CHANGELOG; commit + push. SCOPE NOTE: this iteration ships with mark-superseded only; PR-generation deferred to a follow-up."

### W5-11: Vivek's weekly AI insight digest

- **Value to**: founder (Vivek only)
- **One-line**: Sunday evening WhatsApp + email — AI pattern detection across the entire week's ERP activity surfaces 3–5 non-obvious insights ("Industrial leads from Coimbatore region have 40% higher win rate this quarter — consider doubling outreach there").
- **Tech sketch**: New server action `generateVivekWeeklyInsights(weekEndingDate)` — pulls 12 KPI snapshots (sales, pipeline, project margins by segment, vendor delivery slips, anomaly clusters, churn-risk shifts, AI cost burn-rate, support ticket trends, etc.) + retrieves recent win/loss patterns from `lead_win_loss_patterns` + RAG over recent project_decisions. Sonnet (quality-critical) generates 3–5 insights with supporting numbers and a "recommended action" each. Persists to new `vivek_weekly_insights` table. New workflow `76-vivek-weekly-insights-sunday.json` (Sunday 18:00 IST cron). Surfaces on `/dashboard` as a collapsible "This Week's AI Insights" card (founder only).
- **Effort**: M
- **Depends on**: All of Waves 1–4. Highest payoff feature in this batch.
- **Dispatch-ready task**:
  > "Build Vivek's weekly AI insight digest. Migration: `vivek_weekly_insights` table (id, week_ending_date DATE UNIQUE, insights JSONB array of {title, narrative, supporting_metric, recommended_action, confidence}, ai_model, ai_tokens_used, generated_at). Write `apps/erp/src/lib/ai/vivek-weekly-insights.ts` exporting `generateVivekWeeklyInsights(weekEndingDate)`: gather 12 KPI snapshots via existing RPCs + new `get_weekly_pattern_snapshot()` RPC; retrieve(recent_decisions_text, source_types=['project_decision','plan'], top_k=5); pass to Sonnet via callAi({model: 'claude-sonnet-4-20250514'}); parse JSON output; persist. `/api/insights/weekly/run` route + workflow `76-vivek-weekly-insights-sunday.json` (Sunday 18:00 IST cron) sends WhatsApp to founder with top 3 insight titles + a link to dashboard. Add `WeeklyInsightsCard` to `/dashboard` (founder only) — collapsible, renders insights with metric+action. CI green; CHANGELOG; commit + push."

### W5-12: Lead-won probability scorer (per-lead, continuous)

- **Value to**: marketing_manager, founder
- **One-line**: Wave 3 shipped `leads.ai_score` (0–100 lead "quality"). This adds a separate, continuously-updated **win probability** (0–1) re-computed on every status change + activity insert, using historical win-rate by stage × segment × source × score.
- **Tech sketch**: Distinct from `ai_score` (which is intent/quality at lead inception). New columns `leads.win_probability`, `leads.win_probability_updated_at`, `leads.win_probability_model`. SQL RPC `compute_lead_win_probability(lead_id)` returns the baseline from cohort win rates (last 12 months) by stage × segment × source bucket. Server-side `refineLeadWinProbability(lead_id)` calls the RPC, then Haiku adjusts up/down ±15% based on recent activity sentiment + competitor presence in lead_competitors. Triggered by an after-update trigger on leads (status change) and on lead_activities INSERT. Surface in `/sales` as a sortable "Win %" column.
- **Effort**: M
- **Depends on**: Wave 3 lead scorer (data + pattern). Migration 139 already has ai_score.
- **Dispatch-ready task**:
  > "Add per-lead continuous win-probability scoring. Migration: ALTER leads ADD win_probability NUMERIC(4,3) CHECK (win_probability BETWEEN 0 AND 1), win_probability_updated_at TIMESTAMPTZ, win_probability_model TEXT; index `idx_leads_win_prob ON leads (win_probability DESC) WHERE status NOT IN ('won','lost','disqualified')`. SQL RPC `compute_lead_win_probability(p_lead UUID)` returns baseline from cohort win rates by (stage, segment, source) in last 365 days. Write `apps/erp/src/lib/ai/win-probability-refiner.ts` exporting `refineLeadWinProbability(leadId)`: call RPC for baseline, fetch last 5 lead_activities + lead_competitors, Haiku adjusts ±15%, persist. Server action wrapper invoked from existing lead status-change action + a new trigger on lead_activities INSERT (or RPC-from-trigger via pg_notify pattern). Add 'Win %' column to /sales leads table sortable. CI green; CHANGELOG; commit + push."

---

## Sequencing recommendation

**Phase 1 — low-risk wins (parallelisable, ~1 overnight):**
- W5-5 vendor negotiation drafter (S, isolated, immediate value to founder)
- W5-12 lead win-probability scorer (M, reuses ai_score infra)
- W5-9 vendor scorecard (M, pure SQL + thin AI layer)

**Phase 2 — medium (parallelisable, ~1 overnight):**
- W5-1 customer churn risk
- W5-3 cost-overrun predictor
- W5-2 WA inbound categorisation (depends on whether two-way WA plan ships first; if not, scope to import queue only)

**Phase 3 — depends on external setup or larger surface:**
- W5-7 inverter anomaly root cause (needs OpenWeather API key)
- W5-8 site survey voice extension (B1 muscle memory; ~3h)
- W5-4 lead enrichment (needs Google Places API key + monthly budget review)

**Phase 4 — research/iterate-heavy, ship last:**
- W5-6 commissioning checklist generator (needs RAG ingest of commissioning_reports + UI surface)
- W5-10 RAG auto-update proposer (largest, may need a v2 for PR-generation)
- W5-11 Vivek's weekly insight digest (highest-value but quality only improves after 2–3 weeks of real data)

**Suggested batch order for subagent dispatch:**
1. Burst Phase 1 (3 agents in parallel) → ship + verify in dev.
2. Burst Phase 2 (3 agents in parallel) → ship.
3. Vivek sets up external API keys (OpenWeather, Google Places).
4. Burst Phase 3 (3 agents in parallel) → ship.
5. Phase 4 sequentially with founder smoke-test between each.

Steady-state monthly cost delta vs Wave 4 baseline: **+₹1,500–2,500** (still well under the ₹10k Ollama threshold).

---

## Open questions for Vivek

1. **W5-4 lead enrichment** — Are we OK paying Google Places (~₹0.20/lookup, ~₹500/mo at 100 leads/mo)? Or use only GST search (free) for v1?
2. **W5-7 root cause AI** — OpenWeather free tier is 60 calls/min. At 5 anomalies/day max, free tier is fine. OK to sign up + key in env?
3. **W5-2 WA inbound categorisation** — Should we ship this BEFORE the two-way WA plan (`2026-05-25-whatsapp-two-way-plan.md`), scoped to whatsapp_import_queue only? Or wait until two-way is live so we have richer message flow?
4. **W5-6 commissioning checklist** — Are existing `commissioning_reports` rows complete enough to ingest into RAG, or do we need a backfill pass first?
5. **W5-10 RAG auto-update** — v1 ships mark-superseded only. Is that enough, or is PR-generation a hard requirement?
6. **W5-11 weekly insights** — Sunday 18:00 IST too late (you may not check WA on Sunday)? Move to Monday 07:00 IST cascade after the daily briefing?
7. **W5-12 win probability** — One column or two (intent ai_score + outcome win_probability)? My recommendation is two — they answer different questions.
8. **Provider** — Stick with Anthropic Haiku for all of these, or A/B test OpenRouter for cost on W5-9 + W5-12 (the high-volume ones)?
9. **Cost ceiling** — At what combined monthly LLM spend do we trigger the Ollama migration plan? Wave 4 left us at ~₹3.5k. Phases 1–3 will add ~₹1.5–2.5k. Phase 4 (especially W5-11 using Sonnet) adds ~₹500. Total around ~₹5.5–6.5k. Still under ₹10k threshold.
10. **Out of catalog** — Worth flagging? Customer LTV forecasting, AI proposal counter-suggester, predictive maintenance scheduling, site photo auto-tagging from labels (extends W5-6 work). Park for Wave 6 unless any of these is a "must" now.

---

## Ready-to-execute checklist

Once Vivek approves:

### Pre-flight (Vivek manual steps)
- [ ] Sign up OpenWeather (openweathermap.org) → `OPENWEATHER_API_KEY` in `.env.local` + Vercel + n8n (only if W5-7 ships)
- [ ] Decide W5-4: Google Places yes/no
- [ ] Decide W5-11 timing (Sun 18:00 IST vs Mon 07:00 IST)
- [ ] Confirm RAG cron #72 is running healthily (Wave 1+3 prerequisite)

### Per-feature subagent done criteria
- All sub-tasks in the dispatch-ready paragraph done
- New migration (numbered) applied to dev — verify in SQL Editor
- `pnpm check-types` + `pnpm lint --max-warnings 0` + `pnpm build` + vitest + forbidden-patterns all green
- Module doc updated (e.g., `docs/modules/om.md` for W5-1)
- CHANGELOG line added
- n8n workflow JSON pushed to droplet (active: false) — Vivek activates after smoke
- Commit + push to main with detailed message

### Wave 5 done criteria
- 8 of 12 features shipped, CI green, on prod
- Vivek smoke-tested W5-1 (churn-risk) + W5-2 (WA categorisation) + W5-11 (weekly insights) end-to-end
- Module docs updated across om / sales / purchase / projects
- Monthly cost report shows total under ₹6.5k

---

*Drafted 2026-05-30 by Claude as one of 3 plans for tonight. Builds on `2026-05-25-ai-roadmap-plan.md` + migration 139 schema. Light-detail catalog by design — every feature has a self-contained dispatch paragraph.*
