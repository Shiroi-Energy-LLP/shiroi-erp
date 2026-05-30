# WhatsApp Two-Way Conversations — Plan — 2026-05-30

> Companion to `2026-05-25-whatsapp-two-way-plan.md` (employee-facing NL queries + lead updates).
> This plan covers the **customer reply path** — what happens when a customer (not an employee) replies to one of our drip / notification messages — plus the shared thread + intent infrastructure that both flows will use. Where the May-25 plan and this plan overlap (thread storage, intent classifier, 24h window logic), this plan is the canonical design — the employee plan will be refactored to plug into the same primitives during P2.
> Plan author: Claude. Awaiting Vivek sign-off before any implementation.

---

## Problem

Outbound WhatsApp from the ERP is live: 5 daily digest sends (#19/#20/#21/#22 + #56 heartbeat), the `erp_alert` template wired into 47 send-nodes across Tier 1 / Tier 2 workflows, and 8 customer drip workflows (#40–#47, pending Meta template approval). **Inbound from the customer-side is a black hole.** Workflow #57 (`infrastructure/n8n/workflows/57-meta-delivery-webhook.json`) does receive Meta's POST callbacks and *does* parse `messages` items (see `node-parse` line 71 onwards) — but the parsed items are dropped on the floor. A customer who replies "yes please" to `shiroi_cust_proposal_ready` gets silence. A customer who replies "this is wrong" to a payment reminder gets silence. A customer who asks "when is my installation?" gets silence. Founders and PMs only find out about the customer's side of the conversation if they happen to check the Meta inbox in Business Suite — which nobody does, because that's not where the work happens.

Two follow-on consequences:

1. **Lost-deal risk.** A "yes" or "please call me" reply on the proposal drip is the highest-intent signal we ever get from a customer, and we currently waste it.
2. **Customer-experience risk.** Service-ticket and CEIG-delay messages frequently provoke angry / urgent replies. The first 30 minutes of silence is when complaints become reviews.

The employee-facing plan (May 25) solves a sibling problem — *employees* querying the ERP and updating leads over WhatsApp — but specifically excludes the customer-reply path. This plan fills that gap and consolidates the shared inbound primitives (thread store, intent classifier, 24h-window handler, audit log) so the two flows share a single inbound webhook.

---

## Architecture

Single inbound webhook on n8n. Single ERP API route. Sender-type fork (customer vs employee vs unknown) at the earliest possible moment so the rest of the pipeline can be type-specific.

```
Meta Cloud API
   │  POST webhook (existing #57 endpoint, extended)
   ▼
n8n #80 "WhatsApp inbound receiver"
   │  - Filter: type=text or interactive (drop status events to #57's existing parser)
   │  - Pre-flight: reject if no message body
   │  - HTTP POST to ERP: /api/whatsapp/inbound
   ▼
apps/erp/src/app/api/whatsapp/inbound/route.ts (NEW)
   │  1. Validate x-webhook-secret header
   │  2. Insert raw row in whatsapp_messages (audit before processing)
   │  3. Identify sender via /api/whatsapp/identify-sender helper:
   │        phone → employees.whatsapp_number?  → "employee" path → delegate to May-25 catalog flow
   │        phone → customers.phone OR leads.phone?  → "customer" path (this plan)
   │        otherwise → "unknown" path (silent log, no reply)
   │  4. (customer path) Resolve thread:
   │        find or create whatsapp_threads row keyed on phone
   │        link the new message to the most recent outbound message
   │        (customer_message_log within 7 days) to establish context
   │  5. Classify intent via callAi(Haiku) → whatsapp_intents row
   │  6. Route to handler by intent type:
   │        - confirm/accept     → P2 confirmation handler (updates lead / proposal state)
   │        - reject/decline     → P2 confirmation handler (updates state, polite ack)
   │        - question           → P3 RAG handler (knowledge-qa.ts) → reply
   │        - complaint/urgent   → P4 escalation handler → notify Vivek + create internal task
   │        - chit-chat          → polite canned ack inside 24h window, silent outside
   │        - spam/unknown_phone → silent drop, log only
   │  7. Compose reply (text inside 24h service window, template outside)
   │  8. Fire emitErpEvent('whatsapp.inbound_received', {...}) so other workflows
   │     can subscribe (e.g. a future "AI auto-replied" digest line for Vivek)
   │  9. Return reply payload to n8n
   ▼
n8n #80 (continues)
   │  - If reply present: POST to Meta /messages (text or template per window)
   │  - Update whatsapp_messages with meta_wamid + sent_at
```

**Why one route and not three Edge Functions:** the May-25 plan already proposes routing employee inbound through a Next.js server route to reuse `callAi`, `emitErpEvent`, the Supabase server client, and the role-gated catalog without re-implementing them on Deno. Customer inbound shares 80% of those primitives. Splitting them across runtimes is duplicate code with no upside.

**Why the AI step does not happen inside n8n:** the 2GB droplet is already running n8n + Postgres + the inverter Edge function bridge. Adding an LLM call per inbound message that has to also pull Supabase context inside an n8n Code node is a debugging nightmare versus a single typed TypeScript handler in the ERP.

---

## DB schema (migration 140)

Three new tables. RLS on all three. Indexes on every column we filter or join by, per CLAUDE.md NEVER-DO #17.

```sql
-- ── whatsapp_threads ─────────────────────────────────────────────────────────
-- One row per phone-number conversation. A thread spans many inbound + outbound
-- messages. The "context" columns track what the conversation is *about* right
-- now (current lead, current project, current outbound that the customer is
-- replying to) — used for intent disambiguation and reply composition.

CREATE TABLE whatsapp_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,                            -- E.164 normalised, e.g. "+919876543210"
  sender_type TEXT NOT NULL
    CHECK (sender_type IN ('customer','lead','employee','unknown')),
  customer_id UUID REFERENCES customers(id),     -- set when sender_type='customer'
  lead_id UUID REFERENCES leads(id),             -- set when sender_type='lead' OR last context was a lead
  employee_id UUID REFERENCES employees(id),     -- set when sender_type='employee'
  current_project_id UUID REFERENCES projects(id),
  last_outbound_message_id UUID REFERENCES customer_message_log(id),
  last_outbound_template TEXT,                   -- e.g. 'shiroi_cust_proposal_ready'
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  window_expires_at TIMESTAMPTZ,                 -- Meta 24h service-window expiry (NULL until first inbound)
  message_count INT NOT NULL DEFAULT 0,
  escalation_open BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,                                    -- founder annotations
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone)                                 -- one thread per phone — sender_type can change over time
);

CREATE INDEX idx_wa_threads_customer ON whatsapp_threads (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_wa_threads_lead ON whatsapp_threads (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_wa_threads_employee ON whatsapp_threads (employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX idx_wa_threads_escalation_open ON whatsapp_threads (escalation_open, last_inbound_at DESC)
  WHERE escalation_open = TRUE;
CREATE INDEX idx_wa_threads_window ON whatsapp_threads (window_expires_at)
  WHERE window_expires_at IS NOT NULL;


-- ── whatsapp_messages ───────────────────────────────────────────────────────
-- One row per individual inbound message (replies). Outbound messages already
-- live in customer_message_log (mig 129) — we DO NOT duplicate them here.
-- For outbound, link via whatsapp_threads.last_outbound_message_id.
-- Storing message bodies in plaintext is an explicit founder decision (see
-- Open Questions). If we decide to redact later, we mask via app-side helper.

CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES whatsapp_threads(id) ON DELETE CASCADE,
  meta_wamid TEXT NOT NULL UNIQUE,               -- Meta's wamid; UNIQUE prevents double-processing on Meta retries
  meta_received_at TIMESTAMPTZ NOT NULL,         -- Meta's timestamp (epoch seconds → tz)
  direction TEXT NOT NULL CHECK (direction IN ('inbound')),  -- outbound lives in customer_message_log
  message_type TEXT NOT NULL                     -- 'text','interactive','button','image','audio','reaction','location'
    CHECK (message_type IN ('text','interactive','button','image','audio','reaction','location','document','sticker','unsupported')),
  body_text TEXT,                                -- text body or interactive payload's title; NULL for media
  media_meta_id TEXT,                            -- Meta's media object id for image/audio/document (downloadable via Graph API)
  reply_to_wamid TEXT,                           -- when customer uses "reply" feature, this references our outbound wamid
  processed_at TIMESTAMPTZ,                      -- NULL = not yet routed; set when handler completes
  handler_outcome TEXT
    CHECK (handler_outcome IN ('replied_text','replied_template','silent_drop','escalated','queued_for_human','error')),
  reply_text TEXT,                               -- what we sent back (NULL if silent)
  reply_meta_wamid TEXT,                         -- meta_wamid of our outbound reply
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wa_messages_thread ON whatsapp_messages (thread_id, meta_received_at DESC);
CREATE INDEX idx_wa_messages_unprocessed ON whatsapp_messages (created_at)
  WHERE processed_at IS NULL;
CREATE INDEX idx_wa_messages_outcome ON whatsapp_messages (handler_outcome, created_at DESC);


-- ── whatsapp_intents ────────────────────────────────────────────────────────
-- One row per AI classification call. Separated from whatsapp_messages so we
-- can re-classify a message (e.g. when prompt is improved) without rewriting
-- the message row. Also one classification per message for now (1:1) — future:
-- multi-pass classifier could produce >1 row per message.

CREATE TABLE whatsapp_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
  classifier_version TEXT NOT NULL,              -- e.g. 'haiku-v1', 'haiku-v2' — bump when prompt changes
  intent_type TEXT NOT NULL
    CHECK (intent_type IN (
      'confirm','reject','question','complaint','urgent',
      'chit_chat','opt_out','language_switch','spam','unknown'
    )),
  confidence NUMERIC(3,2),                       -- 0.00–1.00; from classifier self-report
  matched_outbound_template TEXT,                -- which template the reply seems to be in response to
  extracted_data JSONB,                          -- e.g. {"intent":"confirm","target":"proposal_acceptance","proposal_id":"..."}
  ai_provider TEXT NOT NULL DEFAULT 'anthropic',
  ai_model TEXT NOT NULL,                        -- e.g. 'claude-haiku-4-5-20251001'
  ai_tokens_in INT,
  ai_tokens_out INT,
  ai_cost_usd NUMERIC(8,4),
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wa_intents_message ON whatsapp_intents (message_id);
CREATE INDEX idx_wa_intents_type ON whatsapp_intents (intent_type, created_at DESC);


-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Founder: read everything. Marketing manager: read where lead_id is set
-- AND the lead is in their accessible scope. Service role: bypass for the
-- inbound API route. No client-side writes — all mutations via server actions.

ALTER TABLE whatsapp_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY wa_threads_founder_read ON whatsapp_threads FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'founder'));

CREATE POLICY wa_threads_marketing_read ON whatsapp_threads FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'marketing_manager')
    AND lead_id IS NOT NULL
  );

CREATE POLICY wa_threads_pm_read ON whatsapp_threads FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'project_manager')
    AND current_project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = current_project_id
        AND p.project_manager_id IN (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

-- Same SELECT policy pattern for whatsapp_messages and whatsapp_intents,
-- joined through thread_id → whatsapp_threads to inherit scope.


-- ── Helper RPC ───────────────────────────────────────────────────────────────
-- Idempotent: returns existing thread or creates a new one, atomic.
CREATE OR REPLACE FUNCTION wa_resolve_thread(
  p_phone TEXT,
  p_sender_type TEXT,
  p_customer_id UUID DEFAULT NULL,
  p_lead_id UUID DEFAULT NULL,
  p_employee_id UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_thread_id UUID;
BEGIN
  SELECT id INTO v_thread_id FROM whatsapp_threads WHERE phone = p_phone;
  IF v_thread_id IS NULL THEN
    INSERT INTO whatsapp_threads
      (phone, sender_type, customer_id, lead_id, employee_id, last_inbound_at, message_count)
    VALUES
      (p_phone, p_sender_type, p_customer_id, p_lead_id, p_employee_id, NOW(), 0)
    RETURNING id INTO v_thread_id;
  ELSE
    -- Promote thread when better identity becomes available (lead → customer, unknown → employee).
    UPDATE whatsapp_threads SET
      sender_type = COALESCE(NULLIF(p_sender_type,'unknown'), sender_type),
      customer_id = COALESCE(p_customer_id, customer_id),
      lead_id = COALESCE(p_lead_id, lead_id),
      employee_id = COALESCE(p_employee_id, employee_id),
      last_inbound_at = NOW(),
      message_count = message_count + 1,
      updated_at = NOW()
    WHERE id = v_thread_id;
  END IF;
  RETURN v_thread_id;
END;
$$ SECURITY DEFINER;
```

**Migration note:** add to `whatsapp_threads.window_expires_at` an opening trigger — whenever a row is inserted in `customer_message_log` for an outbound template send, set `window_expires_at = NULL` (templates do not open the service window in Meta's billing model, only inbound replies do). Whenever a row is inserted in `whatsapp_messages` for an inbound message, set `window_expires_at = meta_received_at + INTERVAL '24 hours'`. Captured in the migration as two triggers, not in app code.

---

## n8n workflows needed

All new workflows live under `infrastructure/n8n/workflows/` and follow the existing JSON-on-disk pattern. Push via `scripts/push-n8n-workflows.ts`. All have `errorWorkflow: REPLACE_WITH_GLOBAL_ERROR_HANDLER_WORKFLOW_ID` and `timezone: "Asia/Kolkata"` per the May-21 fix.

| # | Name | Trigger | Purpose | Phase |
|---|------|---------|---------|-------|
| **80** | `80-whatsapp-inbound-receiver.json` | Meta webhook POST `/whatsapp-inbound` (a new path, distinct from #57's `/meta-delivery` so #57's status-event parser keeps its single responsibility) | Receives all Meta inbound payloads, filters to `value.messages[]` entries, fan-outs one HTTP POST per message to ERP `/api/whatsapp/inbound` | P1 |
| **81** | (no workflow — sender identification lives entirely in the ERP API route since it needs Supabase client + complex fallback logic) | n/a | Phone → entity (customer / lead / employee / unknown) — see `apps/erp/src/lib/whatsapp/identify-sender.ts` in the API section | P1 |
| **82** | (no workflow — intent classification is a function call inside the ERP route; n8n adds zero value and one extra HTTP hop) | n/a | AI intent classification — see `apps/erp/src/lib/whatsapp/intent-classifier.ts` | P2 |
| **83** | `83-whatsapp-confirm-handler.json` | Called via emitErpEvent → router on `whatsapp.intent_confirmed` | Runs *after* the ERP route has already mutated state. Sends an analytics ping + a fan-out notification to the salesperson/PM that owns the lead. Decoupled so a slow downstream notification doesn't block the customer reply | P2 |
| **84** | (no workflow — RAG Q&A is a synchronous server-side call to `apps/erp/src/lib/ai/knowledge-qa.ts`. Adding a workflow here only buys async, which we don't want because the customer is waiting on a reply) | n/a | AI Q&A handler — see `apps/erp/src/lib/whatsapp/qa-handler.ts` | P3 |
| **85** | `85-whatsapp-escalation-router.json` | Called via emitErpEvent → router on `whatsapp.escalation_raised` | Sends `shiroi_emp_whatsapp_escalation` template to Vivek + (optional) sales/PM owner, creates a row in `tasks` (assigned to founder by default), updates `whatsapp_threads.escalation_open=TRUE` | P4 |

**Extension to #57.** Keep #57 as-is for status-event handling (it's working). The new path `/whatsapp-inbound` lives on a fresh webhook node in #80. We do not modify #57's parser. Rationale: Meta delivers status events at ~5×the volume of inbound messages; mixing them in one workflow makes debugging harder, and the `value.messages[]` branch in #57's parser becomes redundant once #80 is live (planned cleanup: remove the inbound-parse branch from #57 in P1 once #80 is verified end-to-end).

**Two new event-bus router cases** (modify `00-event-bus-router.json`):

- `whatsapp.inbound_received` → fan-out to #83 if intent=confirm/reject; #85 if intent=complaint/urgent; otherwise fall-through to `Log unhandled event` (which is correct — the ERP route already handled it synchronously).
- `whatsapp.escalation_raised` → `→ 85 WhatsApp escalation router`.

Two new `ErpEventName` values added to `apps/erp/src/lib/n8n/emit.ts`:
- `whatsapp.inbound_received`
- `whatsapp.escalation_raised`

---

## Intent taxonomy

10 intent types. Three layers of detection: deterministic match → AI classifier → fallback to `unknown`.

| Intent | Detection signal | Handler action | Reply policy |
|--------|------------------|----------------|--------------|
| `confirm` | Quick-reply button payload `YES`, OR text matches `/^(yes|y|ok|okay|confirm|agreed?|done|fine|sure|👍|✅)\W*$/i`, OR Haiku classifies as confirm with confidence ≥ 0.75 | Mutate state per `whatsapp_threads.last_outbound_template`: `shiroi_cust_proposal_ready` → set `proposals.accepted_by_customer_at`, fire `proposal.accepted_by_customer` event; `shiroi_cust_amc_renewal` → flag AMC renewal opt-in; default → log as confirm + notify sales | Reply with templated ack (`shiroi_cust_thanks_ack` — new template) or freeform text if inside 24h window |
| `reject` | Text matches `/^(no|n|cancel|stop|not now|later|decline|nope|👎|❌)\W*$/i`, OR Haiku ≥ 0.75 | Mark `customer_message_log` row as `rejected`; update lead activity feed; **do NOT** mutate the lead status (rejection isn't loss — could be just "not this week"). For `opt_out` semantics see separate row | Polite ack: "No problem, we'll be in touch later" (text inside window, template outside) |
| `question` | Text contains `?` OR Haiku ≥ 0.75 OR text matches interrogative patterns (when/how/where/why/what/who) | Route to `qa-handler.ts` → `answerInternalQuestion()` from `knowledge-qa.ts` with a customer-safe persona override (no internal jargon, no money figures unless they're in the customer's own contract). If RAG returns "not in docs" → escalate (low-priority) | Text reply inside window; template `shiroi_cust_will_get_back` outside window |
| `complaint` | Haiku detects negative sentiment ≥ 0.70 OR text matches `/(bad|terrible|worst|fraud|scam|cheat|lie|complain|sue|consumer court)/i` | Escalate immediately. Insert task assigned to Vivek + the owning salesperson/PM. Set `whatsapp_threads.escalation_open=TRUE`. Fire `whatsapp.escalation_raised` event. **No AI reply.** | Reply with `shiroi_cust_complaint_ack` template ("Vivek will personally reach out within 2 hours") |
| `urgent` | Text matches `/(urgent|asap|emergency|today|now|right now|immediately|🚨|🔥|help)/i` AND not also `complaint` | Same as complaint but task assigned with higher SLA flag | Same as complaint |
| `chit_chat` | Haiku classifier — pleasantries, thanks, emojis only, no action requested | Silent inside 24h window if no template available; light ack if a `shiroi_cust_thanks_ack` template is in stock | Skip reply outside window (cost-control) |
| `opt_out` | Text matches `/^(stop|unsubscribe|remove|don'?t (call|message))/i` AND Meta automatically opts the number out per their compliance rules | Set `customers.whatsapp_opt_out_at = NOW()` (new column, mig 140). Stop all future drip sends to that phone | Reply with `shiroi_cust_opt_out_ack` template confirming opt-out |
| `language_switch` | Text in Tamil / Hindi script detected (Unicode block check) | Tag thread with `language='ta'` or `'hi'`. Future-proof; for now reply in same language only if we have a translated template, else fall back to English | Out of scope for P1–P4. Vivek decides re. Tamil templates separately |
| `spam` | Phone doesn't match customer / lead / employee AND no recent outbound (last 30 days) AND no context | Silent drop. Log only. | No reply |
| `unknown` | Fall-through when nothing else fires AND Haiku confidence < 0.6 for everything | Log + queue for human triage. Founder sees in `/admin/whatsapp-inbox` (P4) | Inside window: reply with "Got your message — a team member will follow up." Outside: no reply |

**Quick-reply buttons (preferred path).** Where possible we upgrade outbound templates to include `quick_reply` buttons with explicit `payload` strings (`CONFIRM_PROPOSAL`, `REJECT_PROPOSAL`, `BOOK_AMC`). Quick-reply replies arrive as `message.type='interactive'` with a typed payload — zero AI cost to classify. Add quick-reply buttons in P2 to: `shiroi_cust_proposal_ready` (Confirm / Need more info), `shiroi_cust_amc_renewal` (Yes / Not now), `shiroi_cust_install_scheduled` (All good / Need to reschedule), `shiroi_cust_payment_reminder` (Paid / Need help / Dispute).

**Sentiment + complaint detection — concrete prompt sketch:**

```
You are classifying a customer reply to a Shiroi Energy solar company WhatsApp message.
The customer's last outbound message from us was a {{template_name}} template
about {{context_summary}} (e.g. "their solar proposal" / "their net metering application").

Classify the reply into ONE of:
  confirm | reject | question | complaint | urgent | chit_chat | opt_out | unknown

Return ONLY JSON: {"intent":"...", "confidence":0.0-1.0, "rationale":"<8 words"}

Examples (real Shiroi inbox):
  "yes please go ahead" → {"intent":"confirm","confidence":0.95,"rationale":"explicit yes"}
  "not now thanks"      → {"intent":"reject","confidence":0.9,"rationale":"polite decline"}
  "when will u install?" → {"intent":"question","confidence":0.9,"rationale":"asks timeline"}
  "still no current"    → {"intent":"complaint","confidence":0.85,"rationale":"power complaint"}
  "📞📞📞 call me"      → {"intent":"urgent","confidence":0.8,"rationale":"asks urgent call"}
  "thanks 🙏"           → {"intent":"chit_chat","confidence":0.95,"rationale":"gratitude only"}
  "STOP"                → {"intent":"opt_out","confidence":1.0,"rationale":"opt-out keyword"}

Reply text: {{INBOUND_TEXT}}
```

---

## 24-hour service window

Meta rules (documented at developers.facebook.com/docs/whatsapp/conversation-types):

- **Inside the 24h window** (window started by customer's last inbound to us): freeform text replies are allowed and cost a single "service" conversation charge.
- **Outside the window**: only pre-approved templates may be sent. Freeform text rejects with error code 131047.
- The 24h timer **resets** with each inbound message.

`whatsapp_threads.window_expires_at` is the canonical source of truth (set by the trigger above). The reply composer in the API route checks `NOW() < window_expires_at`; if false, it must compose with a template.

**Templates required for replies** (catalog new submissions to Meta, in order of priority — all UTILITY category):

| Template name | Purpose | Phase |
|---|---|---|
| `shiroi_cust_thanks_ack` | Generic ack for confirm intent (e.g. proposal accepted) | P2 |
| `shiroi_cust_will_get_back` | Outside-window ack for a question — "We've received your question, will respond by EoD" | P3 |
| `shiroi_cust_complaint_ack` | "Vivek will personally call you within 2 hours" | P4 |
| `shiroi_cust_opt_out_ack` | Confirms opt-out | P2 |
| `shiroi_cust_proposal_accepted_followup` | Post-acceptance: "Welcome! Your PM {{1}} will call within 24h" — already covered by `shiroi_cust_order_received`? Check before duplicating | P2 |
| `shiroi_emp_whatsapp_escalation` | Internal: notify Vivek that a customer-side complaint thread opened | P4 |

Most replies inside the window are plain text — no template needed. The above are only for outside-window scenarios + escalation routing.

---

## Phase breakdown

Four phases, each independently shippable. Each phase ends with the gates from CLAUDE.md (check-types, lint, forbidden-patterns, build) green.

### **P1 — Log inbound only (no replies)**

Goal: a customer reply lands in `whatsapp_messages`, sender is identified, intent is *not* classified yet (no AI cost), no reply is sent. Founder can view the inbox at `/admin/whatsapp-inbox` and see the conversation thread per phone.

Deliverables:
- Migration 140 (three tables + RLS + RPC + triggers).
- Regenerate `packages/types/database.ts`.
- `apps/erp/src/lib/whatsapp/identify-sender.ts` (lookups + normalisation).
- `apps/erp/src/lib/whatsapp/log-message.ts` (insert into `whatsapp_messages`, resolve thread).
- `apps/erp/src/app/api/whatsapp/inbound/route.ts` with intent classification stubbed to `unknown` for now.
- n8n workflow #80 pushed (active false; user enables).
- `apps/erp/src/app/(authenticated)/admin/whatsapp-inbox/page.tsx` (founder-only, threaded view, last 50 threads, click to expand).
- Modify #57 to drop its `value.messages[]` branch (it's been superseded).
- Add `whatsapp.inbound_received` to `ErpEventName` and the router.

Risk surface: small. No customer-visible behaviour change. Pure logging.

### **P2 — Confirmation intents**

Goal: customers can reply YES / NO / quick-reply button to actionable templates and the ERP mutates state accordingly. Other intent types still log + silent.

Deliverables:
- `apps/erp/src/lib/whatsapp/intent-classifier.ts` (Haiku wrapper for confirm/reject/opt_out only — the cheap deterministic intents).
- `apps/erp/src/lib/whatsapp/confirm-handler.ts` — maps `last_outbound_template` to state mutation:
  - `shiroi_cust_proposal_ready` → set `proposals.accepted_by_customer_at` + fire `proposal.accepted_by_customer`.
  - `shiroi_cust_amc_renewal` → flag AMC renewal opt-in.
  - `shiroi_cust_install_scheduled` → ack only (no mutation; PM still needs to act).
  - `shiroi_cust_payment_reminder` → mark customer-attested-payment flag on `payment_schedule` (PM/finance still verifies).
- Reply composer with 24h-window logic + 4 new Meta templates submitted (`shiroi_cust_thanks_ack`, `shiroi_cust_opt_out_ack`, plus the 2 confirmation-specific).
- Add quick-reply buttons to 4 outbound templates (`shiroi_cust_proposal_ready`, `shiroi_cust_amc_renewal`, `shiroi_cust_install_scheduled`, `shiroi_cust_payment_reminder`) and submit revised templates to Meta.
- n8n workflow #83 pushed (active false; user enables after templates approve).
- `customers.whatsapp_opt_out_at TIMESTAMPTZ NULL` column added in mig 140 (already listed; checkpoint here).
- `/admin/whatsapp-inbox` gains a "Confirmations" filter tab.

Risk surface: medium. A wrong intent classification could falsely mark a proposal accepted. Mitigation: log the inbound message that triggered the mutation prominently on the lead activity feed so the salesperson can catch + rollback. P2 confidence threshold for `confirm` raised to 0.85 (vs 0.75 baseline).

### **P3 — AI Q&A**

Goal: customers can ask freeform questions and get a useful AI-generated reply, scoped to their own project / proposal context only. No reveal of internal data (margins, BOM costs, other customers).

Deliverables:
- `apps/erp/src/lib/whatsapp/qa-handler.ts` — wraps `answerInternalQuestion()` (knowledge-qa.ts) with a customer-safe persona, scoped context loader (pulls only their own project / proposal / payment_schedule rows), and a guardrail prompt that explicitly refuses internal info.
- Context loader: `loadCustomerContext(thread)` returns a redacted summary of the customer's own active project + open proposals + recent payments + open service tickets.
- Reply composer: text inside window, `shiroi_cust_will_get_back` template outside window (Vivek then replies manually from `/admin/whatsapp-inbox`).
- Rate limit: max 5 AI Q&A answers per phone per day (cost control + abuse prevention). 6th question returns "I've answered a few today — a team member will pick this up shortly" and queues for human.
- Test fixtures with 15 realistic customer questions (subset: "when will my installation start?", "what's the warranty on the panels?", "how much will I save per month?", "is my proposal valid forever?", "do you also do batteries?").

Risk surface: high. AI saying wrong things to customers is the worst failure mode. Mitigation: aggressive grounding (RAG retrieval threshold ≥ 0.55 vs 0.45 baseline; refuse if no chunks); explicit refusal phrasing for off-topic questions; founder-only review queue for the first 100 AI replies before lifting that to a sample.

### **P4 — Escalation routing + thread management UI**

Goal: complaints, urgent flags, and unhandled threads land on Vivek's screen + WhatsApp. Founder can take over a thread from the AI at any point.

Deliverables:
- `apps/erp/src/lib/whatsapp/escalation-handler.ts` — composes complaint-ack template, opens a task, fires event, sets `escalation_open=TRUE`.
- n8n workflow #85 pushed (active false; user enables).
- `shiroi_emp_whatsapp_escalation` + `shiroi_cust_complaint_ack` templates submitted to Meta.
- `/admin/whatsapp-inbox` becomes a proper UI:
  - Three tabs: Open Escalations / Unprocessed / All.
  - Per-thread view shows full message history with directional indicators.
  - "Take over" button: pauses AI replies on that thread (sets `whatsapp_threads.escalation_open=TRUE`).
  - "Send reply" composer: founder types text → ERP sends via Meta → logged as outbound in `customer_message_log` + linked to thread.
  - "Mark resolved" closes escalation.
- `whatsapp_threads.escalation_open` is honoured in the API route — when TRUE, *no* AI reply fires; the inbound is logged and the founder is pinged.
- Daily 6PM IST cron (new workflow #86 — extends digest series): "WhatsApp inbox summary for Vivek" — count of new inbound today, count of open escalations, count of AI auto-replies, top 3 unanswered.

Risk surface: medium. The UI is the user-facing artefact and needs polishing iterations. The escalation logic itself is simple.

---

## Dispatch-ready agent tasks per phase

Each task is sized for a single agent run (~30–90 min) with a clear input contract and output deliverable. An agent can pick up a task and execute it without further clarification.

### P1 tasks

**P1-T1 — Migration 140 + types regen.** Write `supabase/migrations/140_whatsapp_two_way_inbound.sql` containing the three tables, indexes, RLS policies, the `wa_resolve_thread` RPC, the two `window_expires_at` triggers, and the `customers.whatsapp_opt_out_at` column. Apply to dev via Supabase SQL Editor. Regenerate `packages/types/database.ts` via MCP `generate_typescript_types` → strip-view-fk-entries script → check-types must pass. Commit with "feat(whatsapp): mig 140 inbound thread + messages + intents".

**P1-T2 — Sender identification module.** Create `apps/erp/src/lib/whatsapp/identify-sender.ts` exporting `identifyByPhone(phone: string): Promise<{type, customer_id?, lead_id?, employee_id?, name?}>`. Phone normalisation: strip `+`, leading `91`, all whitespace; compare normalised. Order of lookup: employees.whatsapp_number → customers.phone → leads.phone (most-recent first if multiple leads for same phone). Unit tests in `apps/erp/__tests__/whatsapp/identify-sender.test.ts` covering: known employee, known customer, known lead, multiple-lead disambiguation, unknown phone, malformed phone.

**P1-T3 — Message logger + thread resolver.** Create `apps/erp/src/lib/whatsapp/log-message.ts` exporting `logInboundMessage(payload)` which calls `wa_resolve_thread` RPC then inserts into `whatsapp_messages`. Handles all Meta `message.type` variants (text / interactive / button / image / audio / reaction / location / document / sticker / unsupported). Unit tests with mocked Supabase admin client.

**P1-T4 — API route /api/whatsapp/inbound.** Create `apps/erp/src/app/api/whatsapp/inbound/route.ts` with POST handler: validate `x-webhook-secret`, parse one Meta message payload, call identifier + logger, set `processed_at=NOW()`, `handler_outcome='silent_drop'`, return `{success:true, reply:null}`. No AI yet. Integration test with real dev Supabase + fixture payloads.

**P1-T5 — n8n workflow 80.** Create `infrastructure/n8n/workflows/80-whatsapp-inbound-receiver.json` with webhook trigger on `/whatsapp-inbound`, filter to `value.messages[]`, split-out each message, HTTP POST to ERP. Includes `errorWorkflow` reference + IST timezone. `active:false` on push. Document the Meta App-side webhook URL change needed (Vivek manual step).

**P1-T6 — Inbox UI scaffold.** Create `apps/erp/src/app/(authenticated)/admin/whatsapp-inbox/page.tsx` (founder + sidebar nav entry). Server component that loads last 50 threads via a new `getWhatsappThreads` query (in `whatsapp-queries.ts`). Per-thread expand shows messages chronologically. Plain table for v1 — fancy UI is P4. Add nav entry to sidebar.

**P1-T7 — Cleanup #57 + event registration.** Modify `57-meta-delivery-webhook.json` to drop the `value.messages[]` branch (status-only). Add `'whatsapp.inbound_received'` to `ErpEventName` in `apps/erp/src/lib/n8n/emit.ts`. Add Switch case in `00-event-bus-router.json`. CI gates + push.

### P2 tasks

**P2-T1 — Intent classifier (deterministic + Haiku).** Create `apps/erp/src/lib/whatsapp/intent-classifier.ts` with `classifyIntent(text, context)`. Layer 1: regex deterministic (confirm / reject / opt_out only). Layer 2: Haiku call if Layer 1 is `null`. Logs the `whatsapp_intents` row. Unit tests for the regex layer; integration test with mocked Haiku for the AI layer.

**P2-T2 — Confirm handler.** Create `apps/erp/src/lib/whatsapp/confirm-handler.ts` with one function per supported `last_outbound_template`. Each function returns `{success, mutationDescription, replyText}`. Wire into the API route. Add a lead activity log entry for every mutation.

**P2-T3 — Reply composer + 24h window logic.** Create `apps/erp/src/lib/whatsapp/compose-reply.ts` with `composeReply(intent, thread, content) → {type:'text'|'template', body|templateName, vars}`. Checks `thread.window_expires_at`. Returns the payload n8n needs to call Meta `/messages`. Unit tests for inside-window text, outside-window template, outside-window with no matching template (returns error).

**P2-T4 — Quick-reply button additions to 4 templates.** Edit `infrastructure/n8n/templates.md` to add quick-reply button rows to `shiroi_cust_proposal_ready`, `shiroi_cust_amc_renewal`, `shiroi_cust_install_scheduled`, `shiroi_cust_payment_reminder`. Update the 4 corresponding n8n workflows (40, 46-like, 41, 44) to include the `interactive` component in the Meta API call. Vivek re-submits to Meta.

**P2-T5 — n8n workflow 83.** Confirm-handler fan-out. Active false on push.

**P2-T6 — Inbox UI: confirmation filter.** Add a tab to `/admin/whatsapp-inbox` filtering threads with at least one `confirm` or `reject` intent in the last 7 days.

### P3 tasks

**P3-T1 — Customer-context loader.** Create `apps/erp/src/lib/whatsapp/customer-context.ts` exporting `loadCustomerContext(thread): Promise<ContextSnapshot>` — returns `{customer_name, active_project_summary, open_proposal_summary, recent_payments_summary, open_tickets_summary}` from real Supabase queries. Every field redacted of internal info (no margins, no BOM costs, no other customers).

**P3-T2 — Customer-safe persona prompt + qa-handler.** Create `apps/erp/src/lib/whatsapp/qa-handler.ts` wrapping `answerInternalQuestion` with a customer-safe system prompt overlay + the context from T1. Returns text reply + the citation chunks for audit. Refuses to answer about other customers / internal pricing / margins. Test against 15 realistic customer-question fixtures.

**P3-T3 — Rate limiter for AI Q&A per phone.** Create `apps/erp/src/lib/whatsapp/qa-rate-limit.ts` — checks last 24h count from `whatsapp_intents WHERE intent_type='question' AND thread_id=...`. If ≥ 5, returns "queued for human". Add a small unit test.

**P3-T4 — Integrate QA into the API route.** Wire P2's classifier (extended to detect `question`) + qa-handler + rate-limiter into the inbound route. Add `qa_chunks_cited` JSON to the message row for audit. Reply via composer.

**P3-T5 — `shiroi_cust_will_get_back` template + submission.** New utility template for outside-window question replies. Add to `templates.md` and submit.

**P3-T6 — Founder review queue gate.** Add `whatsapp_threads.ai_replies_locked BOOLEAN` (admin can flip on per-thread for risky cases). Add a global flag `system_settings.whatsapp_ai_qa_enabled` (mig 111 pattern). Both default to safe (locked=false, qa_enabled=false). Vivek must explicitly enable globally before P3 goes live.

### P4 tasks

**P4-T1 — Escalation handler.** Create `apps/erp/src/lib/whatsapp/escalation-handler.ts` — opens task assigned to founder (+ optional sales/PM owner), sets `escalation_open=TRUE`, fires `whatsapp.escalation_raised`, composes complaint-ack template. Wire into API route for `complaint` + `urgent` intents.

**P4-T2 — n8n workflow 85 + 86.** #85 escalation fan-out: sends `shiroi_emp_whatsapp_escalation` template to Vivek's number + the lead/project owner. #86 daily 6PM IST digest: "WhatsApp inbox summary" — counts new inbound + open escalations + AI replies. Sends to Vivek only.

**P4-T3 — Inbox UI: take-over + reply composer.** Real UI work. Thread detail page with chronological message bubbles (customer left / Shiroi right). "Take over" button sets `escalation_open=TRUE` (pauses AI). "Send reply" textarea + send button → fires server action that calls Meta directly + logs to `customer_message_log` + updates thread. "Mark resolved" sets `escalation_open=FALSE`.

**P4-T4 — `shiroi_emp_whatsapp_escalation` + `shiroi_cust_complaint_ack` templates.** Submission to Meta.

**P4-T5 — Founder-only override toggles.** Per-thread "lock AI replies" toggle (visible on thread detail). Global "kill switch" in `/settings → System` to disable all AI replies (defense-in-depth — Vivek's hand always on the wheel).

---

## Open questions for Vivek

1. **Reply-as.** All replies should send from the same WABA number used for outbound (i.e. one WhatsApp identity for customers, no number-juggling). Recommend: yes. Confirm?
2. **Privacy — log message bodies in DB or just metadata?** Right now the plan stores plain text. Alternatives: (a) hash-only with on-demand decrypt via founder-only key — adds complexity, makes the inbox UI useless; (b) redact PII (phone numbers / amounts) via regex before storage — fragile. Recommend: plain text in DB, founder-only RLS, no marketing-manager access to message bodies (only metadata). Confirm?
3. **Escalation channel — WhatsApp to Vivek, internal task, or both?** Recommend: both, every time. WhatsApp template ping for immediate visibility + task row so it's tracked.
4. **Spam handling.** Silent drop for completely unknown phones with no context is the default. Alternative: reply once with "we couldn't identify your number — please mention your project number". Risk: enables a spam reflector. Recommend: silent drop. Confirm?
5. **Template approval budget.** This plan needs **6 new utility templates** (`shiroi_cust_thanks_ack`, `shiroi_cust_will_get_back`, `shiroi_cust_complaint_ack`, `shiroi_cust_opt_out_ack`, `shiroi_cust_proposal_accepted_followup` if not redundant, `shiroi_emp_whatsapp_escalation`) plus revisions to 4 existing templates (quick-reply buttons). Meta typically approves 5–10 utility templates per submission batch without issue post-business verification. Confirm we can submit these in two waves (P2 wave first, P3+P4 wave second)?
6. **AI Q&A scope — first-party answers only or also general solar Q&A?** Recommend P3 launches with first-party only (customer's own project / proposal / payments). General solar Q&A ("how do solar panels work?", "what is net metering?") deferred to P5 because hallucination risk × low business value.
7. **Tamil + Hindi replies.** Customer-base reality: ~25% Tamil-preference, ~5% Hindi-preference, ~70% English-fine. Recommend deferring all multi-language to a separate plan after P4 ships — adds template ×2 + classifier retraining + 5 weeks of testing.
8. **AI rate-limit cost model.** Q&A at 5 questions/phone/day × 200 active customers × 30 days = 30k Haiku calls/month ≈ ₹15k spend. Cap raise/lower preference?
9. **Founder review queue for first 100 AI Q&A replies.** Recommend gating with `system_settings.whatsapp_ai_qa_enabled=FALSE` until Vivek has manually reviewed the first 100 → flip to TRUE. Adds ~2 weeks of latency to P3 going live. Acceptable?
10. **Customer opt-in disclosure.** Indian DPDPA + Meta TOS both require customers to know they're talking to an AI when they are. Recommend: on first AI reply per thread, prepend "(replying via Shiroi's AI assistant — type CALL ME to reach a human)". Adds friction but reduces complaint risk. Confirm phrasing?

---

## Risks

- **Spam / abuse / volume.** Pathological case: someone sends 1000 messages from one number in a minute. Mitigation: rate limit at API route (max 10 inbound per phone per minute, hard-drop above; max 100 AI calls per phone per day). Cost: a Redis-like throttle, which we don't have — implement in Postgres via a sliding-window count from `whatsapp_messages`.
- **Meta policy compliance.** Sending freeform outside the 24h window = account-level penalty (lower tier or suspension). Mitigation: the composer hard-refuses to compose freeform when window closed; falls back to template or no-reply.
- **AI hallucination → wrong reply to customer.** Worst case: customer asks "is GST included in my proposal?" and AI says yes when answer is no. Mitigation: aggressive RAG threshold; refuse if no docs; founder review for first 100 replies; per-thread "lock AI" toggle.
- **State mutation from wrong intent classification.** Customer types "ok thanks" after a proposal — does that mean accepted? Mitigation: P2 confidence threshold 0.85 for state mutations + ack-only template for low-confidence confirms (no DB write).
- **Missed messages = customer disappointment.** If the ERP API route is down, n8n retries 3 times then logs to `whatsapp_messages` with `handler_outcome='error'`. Daily digest #86 surfaces error rows to Vivek. Mitigation: monitor `whatsapp_messages WHERE handler_outcome='error'` count via the existing Sentry rules.
- **PII in AI prompts.** Customer name + project number + amounts go to Anthropic. Anthropic is SOC-2 + does not train on API data per ToS, so the legal posture is fine — but if Vivek prefers self-hosted Ollama later (per May-25 plan's note), the `ai-caller.ts` abstraction already supports the switch.
- **Two parallel inbound webhooks (#57 + #80) creating confusion.** Mitigation: P1-T7 cleans up #57's now-redundant inbound branch in the same phase #80 ships.
- **`whatsapp_threads.window_expires_at` drift from Meta's actual window.** Trigger sets it on inbound insert; Meta might reset it on certain edge cases (deleted message, conversation-bridging across phones). Mitigation: trust Meta's API error code 131047 as the ultimate source of truth — if compose-reply sends freeform and Meta returns 131047, retry-once with the most-appropriate template + log a warning.

---

## What's already there (reuse, don't rebuild)

- `apps/erp/src/lib/n8n/emit.ts` — outbound event emitter; we add 2 new event names.
- `apps/erp/src/lib/ai/ai-caller.ts` + `ai-config.ts` — AI provider abstraction.
- `apps/erp/src/lib/ai/knowledge-qa.ts` — RAG-grounded Q&A; reused with a customer-safe persona overlay in P3.
- `infrastructure/n8n/workflows/57-meta-delivery-webhook.json` — Meta delivery status webhook; P1 cleans up its now-redundant inbound branch.
- `infrastructure/n8n/workflows/00-event-bus-router.json` — single-ingress event router; we add 2 new cases.
- `infrastructure/n8n/workflows/40-47-customer-*.json` — drip workflows; P2 adds quick-reply buttons to 4 of these.
- `customer_message_log` (mig 129) — outbound message audit; we link thread → last outbound via FK.
- `employees.whatsapp_number` (mig 082) — sender identification for the employee path.
- `system_settings` (mig 111) — kill-switch pattern reused for `whatsapp_ai_qa_enabled`.
- `scripts/push-n8n-workflows.ts` — workflow deployment.
- The May-25 employee plan: P2 of this plan can absorb the May-25 intent classifier as a shared primitive once both flows are live.

## What's new (delivered by this plan)

- Migration 140 (3 tables + 3 indexes per table + RLS + RPC + 2 triggers + 1 column on customers).
- `apps/erp/src/lib/whatsapp/` directory: `identify-sender.ts`, `log-message.ts`, `intent-classifier.ts`, `confirm-handler.ts`, `qa-handler.ts`, `customer-context.ts`, `qa-rate-limit.ts`, `escalation-handler.ts`, `compose-reply.ts`.
- API route `/api/whatsapp/inbound`.
- `/admin/whatsapp-inbox` page (P1 scaffold → P4 polished UI with take-over composer).
- n8n workflows 80, 83, 85, 86.
- 6 new Meta utility templates + 4 modified for quick-reply buttons.
- 2 new `ErpEventName` values + router cases.

## Ready-to-execute checklist (pre-P1)

- [ ] Vivek answers the 10 open questions above.
- [ ] Meta WABA confirmed at 2,000-msg tier (already done per F2).
- [ ] `ANTHROPIC_API_KEY` set in `.env.local` + Vercel.
- [ ] `N8N_WEBHOOK_SECRET` set on droplet + `.env.local` + Vercel.
- [ ] Meta App webhook URL added/updated to add the `/whatsapp-inbound` path next to `/meta-delivery`.
- [ ] Decision on whether P2's quick-reply button additions count as a "minor edit" (Meta re-approves in hours) or "major edit" (re-review takes 24h). Likely minor — buttons can be added without changing body text.

---

*Plan author: Claude. Companion to `2026-05-25-whatsapp-two-way-plan.md`. Awaiting Vivek sign-off.*
