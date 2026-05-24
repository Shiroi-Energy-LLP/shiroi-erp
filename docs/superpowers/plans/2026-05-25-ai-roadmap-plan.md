# H3 — AI Roadmap (revised)

> Plan date: 2026-05-25 (rev 2 — post Vivek's scope cuts + provider migration + RAG addition)
> Supersedes the 8-candidate v1 draft.
> Companion spec: `docs/superpowers/specs/2026-05-25-shiroi-rag-design.md`
> Goal: structured rollout of AI capabilities across the ERP, organised by waves.

---

## Decisions baked in (Vivek-approved)

1. **OpenAI is out.** Replaced everywhere with non-OpenAI providers:
   - **LLM:** Claude Haiku 4.5 (default) + Claude Sonnet (vision + quality-critical paths)
   - **Embeddings:** Jina `jina-embeddings-v3` (1024-dim, multilingual including Tamil)
   - **ASR:** Sarvam `Saaras-v2` (Tamil + Tanglish) with Bhashini as free fallback
   - **Future local migration path:** F8 `ai-caller.ts` abstraction makes per-feature provider swap a config change

2. **Customer-facing AI deferred** to a separate next-phase plan: A1 self-service WA bot, A2 electricity bill OCR, A3 residential calculator. **Exception**: A4 monthly customer performance reports (post-install) is in Wave 2.

3. **Custom Shiroi RAG built early** — Phase 1 (docs only) goes into Wave 1 as foundation. Phase 2 (proposals, tickets, activities) added in Wave 3 when sales-intelligence features need it.

4. **Local Ollama deferred until needed.** Stay all-Haiku/Sonnet until monthly LLM bill exceeds ~₹10,000 OR a customer contract requires on-prem data residency. F8 abstraction makes the eventual swap trivial.

5. **All Tamil voice input goes through Sarvam → Claude Haiku for structuring** (transcribe + translate + extract in two API calls).

## Wave structure

| Wave | Focus | Sessions | Monthly cost (steady state) |
|------|-------|----------|------------------------------|
| **Wave 1** | Foundations: providers + RAG + 5 high-leverage features | 7 | ~₹2,200 |
| Wave 2 | Customer post-install touch + drip personalization | 3 | +₹600 |
| Wave 3 | Sales intelligence (needs RAG Phase 2) | 4 | +₹500 |
| Wave 4 | Operations intelligence (vision-heavy) | 4 | +₹3,500 |
| **Next-phase plan** (separate spec) | Customer-facing AI (A1, A2, A3) | TBD | TBD |
| **Deferred** | F3 direct vendor bill OCR, F4 cash forecast, E1/E2/E3 cockpit, F8+ design review, D2 ticket triage, B4 photo gate | — | — |

---

## Wave 1 — Foundations + first features (7 sessions, ~₹2,200/mo)

### S1 — Provider migration (no OpenAI, add Sarvam + Jina)

**Goal:** Swap OpenAI embeddings out of the `process-document` Edge Function. Add Sarvam + Jina env infrastructure.

Tasks:
- [ ] S1.1 — Add env vars to `turbo.json` globalEnv: `JINA_API_KEY`, `SARVAM_API_KEY`, `BHASHINI_API_KEY` (optional fallback), `COHERE_API_KEY` (optional embed fallback).
- [ ] S1.2 — Update `process-document` Edge Function: replace OpenAI embeddings client with Jina v3 (1024-dim). Migration 138 changes `documents.embedding` column from `vector(1536)` to `vector(1024)`.
- [ ] S1.3 — Re-embed all existing `documents` rows that had `extraction_status='done'` — write a one-shot script `scripts/rag/re-embed-documents.ts` that pages through them and re-embeds via Jina.
- [ ] S1.4 — Write `apps/erp/src/lib/ai/sarvam-client.ts` — calls Sarvam Saaras-v2 for ASR. Same shape as existing `anthropic-client.ts`.
- [ ] S1.5 — Write `apps/erp/src/lib/ai/jina-client.ts` — embeddings + dimension assertion.
- [ ] S1.6 — Run `pnpm check-types && pnpm build` — must be green.
- [ ] S1.7 — Document the new env vars in `CLAUDE.md` env list.

Effort: 3 hours.
Risk: Re-embedding 7,636+ existing documents will take ~30 min of API time. Run during off-hours.

### S2 — Shiroi RAG Phase 1 (docs only)

**Goal:** Per the spec doc. Build the schema + ingest + retrieve API + debug page.

Tasks:
- [ ] S2.1 — Migration 138 (append to S1 migration OR mig 139): `rag_chunks` table + HNSW index + RLS per the spec.
- [ ] S2.2 — Write `scripts/rag/chunk-markdown.ts` — heading-aware splitter using `js-tiktoken`.
- [ ] S2.3 — Write `scripts/rag/embed.ts` — Jina client with Cohere fallback (uses `jina-client.ts` from S1).
- [ ] S2.4 — Write `scripts/rag/sources.ts` — glob mapping per the spec (modules, master ref, CLAUDE.md, specs, plans, reviews, changelog).
- [ ] S2.5 — Write `scripts/rag/ingest-docs.ts` — walks sources, chunks, hashes, diffs, embeds new/changed, upserts. Add `pnpm rag:ingest-docs` script in root package.json.
- [ ] S2.6 — Initial run: `pnpm rag:ingest-docs` — expect ~50k chunks across all docs. Confirm via SQL.
- [ ] S2.7 — Write `apps/erp/src/lib/rag/retrieve.ts` — the `retrieve(query, opts)` API per the spec.
- [ ] S2.8 — Write `apps/erp/src/app/(erp)/admin/rag-debug/page.tsx` (founder-only) — query input + top-5 results with similarity score + 👍/👎 buttons logging to a new `rag_query_log` table.
- [ ] S2.9 — Founder smoke test: Vivek runs 10 sample questions, eyeballs results, tunes top_k if needed.
- [ ] S2.10 — Add daily cron via pg_cron at 02:00 IST: pull latest main + run ingest. Need to decide ingest trigger — recommend an n8n workflow (`63-rag-ingest-cron.json`) that SSHes to the droplet OR a GitHub Actions workflow. Vivek picks.

Effort: 4 hours.
Risk: Jina rate limits during initial bulk ingest. Batch in groups of 100 with 200ms delay.

### S3 — D1 internal knowledge Q&A (the first RAG consumer)

**Goal:** Anyone (Vivek, Prem, Manivel, future hires) can ask "what's our standard payment terms?" / "which MMS brand at industrial?" / "TNEB delay >30 days handling?" via the web OR WhatsApp (once H1 lands) and get a grounded answer with citations.

Tasks:
- [ ] S3.1 — Write `apps/erp/src/lib/ai/knowledge-qa.ts` — `answerInternalQuestion(question, opts)` calls `retrieve()` → wraps in Haiku prompt → returns `{ answer, citations: RagChunk[] }`.
- [ ] S3.2 — Prompt template — strict instruction to cite sources by `source_path`, refuse to answer if retrieval comes back empty or low-similarity.
- [ ] S3.3 — Add `apps/erp/src/app/(erp)/ask/page.tsx` — simple input + answer view with expandable "Sources" section. Open to all authenticated roles (RLS on `rag_chunks` already filters).
- [ ] S3.4 — Rate limit: 30 questions/user/day (any non-founder). Founder unlimited.
- [ ] S3.5 — Audit log to `rag_query_log` table (extended schema if needed).
- [ ] S3.6 — Documentation: append a section to `docs/SHIROI_MASTER_REFERENCE.md` describing the knowledge Q&A.

Effort: 2 hours.
Risk: Answer quality varies by question type. Iterate the prompt over a week of real questions.

### S4 — F6 smart task suggestions

**Goal:** Daily cron finds stale leads/projects/tickets and auto-creates suggested tasks for the owner.

Tasks:
- [ ] S4.1 — Migration extension: pg_cron job at 06:00 IST that scans for stale items. Inserts into a `task_suggestion_queue` staging table.
- [ ] S4.2 — Server-side processor that walks new suggestions, calls Haiku to write a one-sentence task description per item, inserts into `tasks` with `category='lead_followup'` / `category='project_followup'` / etc.
- [ ] S4.3 — `task_suggestion_queue` row marked processed; tracks AI tokens used.
- [ ] S4.4 — Cap: 5 AI-suggested tasks per user per day to avoid spam.
- [ ] S4.5 — Add an "AI suggested" badge to the existing tasks UI so users can distinguish.

Effort: 2 hours.
AI provider: Haiku.

### S5 — F7 BOQ variance narrative

**Goal:** Per project, after completion: AI summary "DC cable consumed 18% over BOQ — likely cause: longer cable runs in industrial site type. Flag for next project's costing."

Tasks:
- [ ] S5.1 — Confirm `bom_actual_vs_budgetary` table (mig 128) is populated OR populate from existing BOQ + DC items if empty. If empty, write a one-shot ingest script (this is the gap H3 v1 flagged).
- [ ] S5.2 — Server action `generateBoqVarianceNarrative(projectId)` — reads variance rows, calls Haiku, writes narrative to a new `bom_variance_narratives` column on `projects` (or a separate table).
- [ ] S5.3 — Surface on project detail page Profitability subsection.
- [ ] S5.4 — Nightly cron: run for any project that completed in the last 7 days and doesn't have a narrative yet.

Effort: 2 hours (assuming `bom_actual_vs_budgetary` ingest works — otherwise +2 hours).

### S6 — F1 daily executive briefing (RAG-augmented)

**Goal:** WhatsApp to Vivek at 07:00 IST: yesterday's wins, key numbers, anomalies, decisions needed. With RAG context for "what's normal at Shiroi."

Tasks:
- [ ] S6.1 — Server action `generateExecutiveBriefing(date, recipientRole)` — gathers 8 KPI buckets (sales won, cash inflow, projects in progress, MSME aging, expected payments, anomalies) via existing RPCs.
- [ ] S6.2 — RAG context augmentation: call `retrieve("what's a typical day at Shiroi", { source_types: ['module_doc'], top_k: 3 })` to give the AI a baseline.
- [ ] S6.3 — Haiku prompt with the KPI bundle + RAG context → 3-paragraph narrative.
- [ ] S6.4 — Modify existing n8n workflow `19-vivek-daily-7am.json` to call ERP `/api/briefing/run` BEFORE composing the WhatsApp message; use the AI narrative as the message body.
- [ ] S6.5 — Optional secondary recipients (Prem head 8AM, Manivel head 8AM) — flip a flag.

Effort: 3 hours.
AI provider: Haiku.

### S7 — B1 Tamil voice-to-text site reports

**Goal:** Manivel + site supervisors send 30-sec Tamil voice notes via WhatsApp → AI transcribes + structures + creates `daily_site_reports` row + flags any action items (material shortages, safety issues).

Tasks:
- [ ] S7.1 — n8n workflow `64-employee-voice-report.json` — listens for inbound WhatsApp **audio** messages from known employee numbers → downloads .ogg → POSTs to ERP `/api/whatsapp/voice-report`.
- [ ] S7.2 — Server-side handler: validate webhook secret + employee identity → POST audio bytes to Sarvam Saaras-v2 → get Tamil/Tanglish transcript.
- [ ] S7.3 — Haiku call with the transcript + project lookup + daily_site_reports schema + `material_requisitions` schema. Prompt outputs structured JSON with project_match, report fields, and detected_actions array.
- [ ] S7.4 — Reply to officer in Tamil + English: "Got it: 12 panels, structure complete. Reply YES to save."
- [ ] S7.5 — On YES: insert `daily_site_reports` row + create any flagged `material_requisitions` rows.
- [ ] S7.6 — Save the original .ogg in Supabase Storage `voice-reports/<project_id>/<date>.ogg` for audit.
- [ ] S7.7 — Audit row in a new `voice_report_log` table (id, sender, transcript, structured_json, applied_at, audio_path).
- [ ] S7.8 — Cost monitor: alert if Sarvam monthly cost crosses ₹500.

Effort: 4 hours.
AI providers: Sarvam (ASR), Haiku (structuring).

### Wave 1 monthly cost estimate

| Feature | Provider | Calls/month | Tokens/month | Cost (₹) |
|---------|----------|-------------|--------------|----------|
| RAG embeddings (ingest) | Jina v3 | ~6,000 | 5M | 0 (free tier) |
| RAG query embeddings (D1) | Jina v3 | ~3,000 | 600k | 0 (free tier) |
| D1 Q&A | Haiku | 1,500 | 2.5M | 250 |
| F6 task suggestions | Haiku | 1,500 | 600k | 50 |
| F7 BOQ variance | Haiku | 40 | 80k | 5 |
| F1 executive briefing | Haiku | 120 | 360k | 125 |
| B1 voice transcription | Sarvam | 900 (30/day) | 15min/day | 450 |
| B1 voice structuring | Haiku | 900 | 2.7M | 250 |
| Existing process-document (Haiku vision) | Sonnet | 200 | 4M | 600 |
| **Total** | | | | **~₹1,730/mo** |

Round to **~₹2,200/mo** including buffer + spikes. Within budget envelope from earlier discussion.

---

## Wave 2 — Post-install customer touch (3 sessions, +₹600/mo)

### S8 — A4 monthly customer performance reports

**Goal:** Every commissioned customer with inverter credentials gets a monthly WhatsApp: "Your VAF system generated 1,847 kWh in May (₹14,776 saved). 8% better than April. Top day: 15-May."

Tasks:
- [ ] S8.1 — Identify the customer cohort: `projects` with `status='completed'` AND `commissioned_date IS NOT NULL` AND a `plant_monitoring_credentials` row with `status='connected'`. Currently ~5 of 500+; will grow with Phase 7/8 inverter rollout.
- [ ] S8.2 — Server action `generateMonthlyPerformanceReport(projectId, month)`: pulls inverter rollup data (mig 050 partitions), pulls PVLib expected via the microservice, computes delta, calls Haiku for narrative.
- [ ] S8.3 — Meta template `monthly_performance` (utility) — submit for approval. 5 variables.
- [ ] S8.4 — n8n workflow `65-customer-monthly-performance.json` — monthly cron 1st of month 10:00 IST, walks the cohort, fires the Meta template per customer.
- [ ] S8.5 — Audit in `customer_message_log` with `channel='whatsapp'`, `template_name='monthly_performance'`.

Effort: 3 hours.
AI provider: Haiku.
Cost: ~₹250/mo at 500 customers.

### S9 — F2 customer drip personalization

**Goal:** Existing F1 customer drip templates (#40–47) use static variable substitution. Add a per-customer flavour pass that personalises within Meta template constraints.

Tasks:
- [ ] S9.1 — For each drip workflow, identify which template variables can be AI-flavoured (vs static).
- [ ] S9.2 — Server action `personaliseDripMessage(customerId, templateName)` returns the AI-generated variable values.
- [ ] S9.3 — Modify drip workflows to call ERP for variable values before firing the Meta template.
- [ ] S9.4 — Add `ai_personalisation` JSONB to `customer_outreach_queue` for audit.

Effort: 2 hours.
AI provider: Haiku.
Cost: ~₹350/mo.

### S10 — Wave 2 polish + docs

- [ ] Update `docs/modules/om.md` + `sales.md` with new features.
- [ ] CI gates + commit + push.
- [ ] Founder smoke test on 5 real commissioned customers.

---

## Wave 3 — Sales intelligence (RAG Phase 2 + 3 features, 4 sessions, +₹500/mo)

### S11 — RAG Phase 2: index structured data (proposals + tickets + activities)

- [ ] Write `scripts/rag/ingest-proposals.ts` — per the spec, 1 chunk per proposal with flattened content.
- [ ] Write `scripts/rag/ingest-service-tickets.ts`.
- [ ] Write `scripts/rag/ingest-lead-activities.ts`.
- [ ] Add to nightly cron.
- [ ] Verify RLS — chunks should only be retrievable if the underlying row is.

### S12 — F5 AI lead routing

- [ ] Auto-score + assign new leads via Haiku on INSERT.
- [ ] Sales territory map config (new `sales_territories` table OR JSON config).

### S13 — C1 lead scoring + C2 win/loss patterns

- [ ] Lead score per lead via Haiku on INSERT + status change.
- [ ] Weekly win/loss pattern report (uses RAG Phase 2 for retrieving similar past deals).

### S14 — Wave 3 polish + docs

---

## Wave 4 — Operations intelligence (vision-heavy, 4 sessions, +₹3,500/mo)

### S15 — B3 plant performance anomaly alerts (uses A4 data + PVLib expected)

### S16 — B2 photo QC AI (Claude vision on milestone_photos)

### S17 — D3 vendor invoice email ingest (Claude vision; same as F3 plan but email-driven)

### S18 — Wave 4 polish + docs

---

## Deferred (decide later)

- **F3 vendor bill OCR direct upload path** — D3 (email) covers most of it
- **F4 cash forecast** — blocked on D2/D3/D4 data cleanup
- **C3 pricing AI** — uses RAG Phase 2; defer until volume justifies (post-Wave 3)
- **E1 conversational analytics** — H1 catalog approach is safer for now
- **E2 proactive anomaly briefing** — folded into F1 once F1 is live
- **E3 capacity decision support** — manual-for-now
- **F8+ design review** — needs CAD/sketchup ingest; defer
- **D2 ticket triage** — needs ticket volume; revisit after Wave 4
- **B4 missing photo gate** — nice-to-have; revisit after Wave 4
- **D4 standalone semantic search UI** — RAG Phase 2 ingest makes this trivial later; defer until requested

## Next-phase plan (separate spec file)

Customer-facing AI deferred:
- A1 customer self-service WA bot
- A2 electricity bill OCR (customer sends bill via WhatsApp)
- A3 residential calculator (website/WhatsApp pre-sales)

These deserve their own design spec because they touch customer trust + the customer-facing portal. Write that when Vivek is ready.

---

## Overall execution path

Wave 1 → ~7 sessions of agent work (~21 hours real, 1 overnight if parallelised).
Wave 1 unlocks immediate value:
- D1 = you stop being the corporate WhatsApp helpdesk
- B1 = field officers + Manivel send Tamil voice notes; data quality 10×s
- F1 = morning briefing that's actually useful
- F6 = stale leads + projects auto-flagged
- F7 = first AI-on-Shiroi-data feature (BOQ variance)
- RAG = unblocks 5+ later features

Wave 2 → 3 sessions; customer-facing post-install touch.

Wave 3 → 4 sessions; sales intelligence depends on RAG Phase 2.

Wave 4 → 4 sessions; vision-heavy ops AI.

**Total to ship all four waves: ~18 sessions across ~3 weeks of overnight runs.**

## Open questions for Vivek before exec

1. **Provider sign-up: Jina + Sarvam — OK to register?** Both free-tier friendly; email + API key. No credit card on Jina at our volume. Sarvam needs a small balance ~₹500 to start.
2. **Bhashini (free ASR fallback) — set up now or skip?** Setup is government-portal painful. Recommend skip — Sarvam quota is generous.
3. **B1 audio storage** — save .ogg files to Supabase Storage `voice-reports/` (~5MB/day) or discard after transcript? Recommend save for audit trail; trivial storage cost.
4. **D1 — open to all roles or founder + managers only?** Recommend all roles initially with per-role rate limits.
5. **F1 daily briefing — also send to Prem (sales head) + Manivel (PM head) at 08:00?** Or keep founder-only at 07:00? Recommend cascade.
6. **B1 confirmation step (YES to save)** — keep this gate or auto-save? Recommend gate for v1; remove once trust builds.
7. **RAG re-index trigger** — pg_cron (in-DB) or n8n workflow (SSH to host)? Recommend n8n — closer to the source-of-truth (git on the droplet host).
8. **Wave 2 cohort** — start with 1 commissioned customer for testing, then 5, then full? Recommend 1 → 5 → full over 3 weeks.
9. **Ollama trigger threshold** — auto-migrate at ₹10k/mo combined LLM cost? Or your call always? Recommend auto-flag at ₹10k, you decide.

---

## Ready-to-execute checklist

Once Vivek approves:

### Pre-flight (Vivek must do before agent runs)
- [ ] Sign up Jina (jina.ai) → `JINA_API_KEY` in `.env.local` + Vercel
- [ ] Sign up Sarvam (sarvam.ai) → `SARVAM_API_KEY` + ~₹500 balance loaded
- [ ] Optional: Cohere fallback key
- [ ] Optional: Bhashini fallback
- [ ] Confirm `pgvector` extension on dev (`\dx vector` in SQL Editor)
- [ ] Decide on the open questions above

### Agent execution order (per session)
1. **Provider migration (S1)** — must complete first; everything else depends on Jina + Sarvam
2. **RAG Phase 1 (S2)** — runs second; D1 + F1 depend on retrieve()
3. **D1, F6, F7, F1, B1 (S3–S7)** — can run in parallel after S2
4. Run discipline gates after each session
5. Commit + push per session (not big-bang at end) — easier to roll back if any feature breaks

### Per-session done criteria
- All sub-tasks checked
- `pnpm check-types` + `pnpm lint` + `pnpm build` + vitest + forbidden-patterns all green
- Module doc updated (e.g., new section in om.md for B1)
- CHANGELOG line added
- Commit + push to main with detailed message

### Wave 1 done criteria
- Vivek runs 10 real questions through D1 and 8+ get good answers
- Manivel sends 3 real Tamil voice notes and 3 reports correctly saved
- F1 fires at 07:00 IST with quality narrative
- F6 has suggested at least 1 useful task in the first 48h
- All Wave 1 features documented in module docs + master reference
