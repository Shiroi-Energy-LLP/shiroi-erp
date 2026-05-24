# H1 — WhatsApp Two-Way for Employees

> Plan date: 2026-05-25
> Spec/design captured inline (no separate spec file).
> Goal: employees query the ERP + update leads via WhatsApp.

---

## Goal

Two capabilities, same inbound channel:

**A. Natural-language queries (read-only).** Examples:
- "sales last month" → won leads count + total + top 3
- "inflow last week" → customer_payments sum + by-project breakdown
- "MSME aging" → vendor bills due to MSMEs in 30/60/90 buckets
- "expected payments this week" → list with customer + amount + project
- "my leave balance" → caller's own balance
- "pipeline" → leads by stage with counts + total kWp

**B. Lead updates via NL message + AI extraction (write, gated by confirmation).**
- Prem: "Mr Kumar Adyar agreed to ₹4.5L for 5 kWp residential"
- ERP: "Found PV/L/2026-27/0123 Mr Kumar (Adyar). Update total to ₹4.5L + status to negotiation? Reply YES."
- YES → applies + logs activity + replies "Done. https://erp.shiroienergy.com/sales/<id>"

## Constraints (Vivek-approved)

- **AI provider: Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) via the existing `apps/erp/src/lib/ai/ai-caller.ts` abstraction. Per-call model override; `AI_PROVIDER=anthropic` stays as default.
- **Hosting: existing 2GB DO droplet, no Ollama yet.** May migrate to local DO Ollama later — `ai-caller.ts` abstraction handles the swap.
- **Catalog approach for queries, NOT text-to-SQL.** Hand-written catalog of ~30 query patterns; AI's only job is intent → catalog ID + params + result formatting.
- **Role-gated per query.** WhatsApp sender phone → `employees.whatsapp_number` → `profiles.role` → allowed catalog entries.
- **WhatsApp plain text output.** Indian rupee format (₹1,23,456 — not $123,456). Cap reply at ~400 chars + link to web for full result.

## The canned query catalog (~30 entries)

Most map to existing RPCs. 5 new ones needed for "last N period" patterns.

| ID | NL aliases | Maps to | Roles |
|----|------------|---------|-------|
| sales.pipeline | "pipeline", "leads", "leads by stage" | `get_lead_stage_counts` (mig 028) | founder, marketing_manager, sales_engineer |
| sales.won_period | "sales last month", "sales this month", "sales Q1", "won YTD" | **NEW RPC** `get_sales_won_period(start, end)` | founder, marketing_manager |
| sales.lost_period | "lost last month", "deals lost" | **NEW RPC** `get_sales_lost_period(start, end)` | founder, marketing_manager |
| sales.expected_orders | "expected orders this week", "expected orders this month" | `get_expected_orders(window_days)` (mig 094) | founder, marketing_manager |
| sales.closing_window | "closing this week", "closing this month" | `get_pipeline_close_window(start, end)` (mig 109) | founder, marketing_manager |
| cash.inflow_period | "inflow last week", "collections this month" | **NEW RPC** `get_cash_inflow_period(start, end)` | founder, finance |
| cash.outflow_period | "outflow last week", "vendor payments this month" | **NEW RPC** `get_cash_outflow_period(start, end)` | founder, finance |
| cash.position_now | "cash position", "cash today" | `get_company_cash_summary_v2()` | founder, finance |
| cash.expected_payments | "payments expected this week" | `get_payments_expected_this_week()` (mig 117) + `get_expected_payments(window_days)` (mig 094) | founder, finance, marketing_manager |
| cash.receivables | "receivables", "AR outstanding" | `get_receivables_reconciliation()` (mig 118) | founder, finance |
| cash.payment_tracker | "payment follow-ups", "what's overdue from customers" | `get_payment_tracker_rows()` (mig 088) | founder, finance, marketing_manager |
| finance.msme_aging | "MSME aging", "MSME 45 day" | `get_msme_aging_summary()` | founder, finance |
| finance.vendor_bills_outstanding | "vendor bills outstanding" | `get_payment_tracker_rows()` filtered to vendor side | founder, finance |
| projects.profitability | "project X profitability" | `get_project_profitability_v2(project_id)` | founder, finance, project_manager (own projects only) |
| projects.in_progress | "active projects", "projects in progress" | **NEW** simple SELECT count + per-PM breakdown | founder, project_manager |
| projects.delayed | "delayed projects", "projects late" | **NEW** SELECT WHERE planned_end_date < CURRENT_DATE AND status NOT IN ('completed') | founder, project_manager |
| om.profitability_period | "OM profitability last quarter" | `get_om_profitability(start, end)` (mig 128) | founder, om_technician |
| om.tickets_open | "open tickets", "service tickets" | **NEW** SELECT count grouped by SLA status | founder, om_technician |
| liaison.summary | "TNEB pipeline", "liaison status" | `get_liaison_summary()` (mig 115 + mig 137 role gate) | founder, marketing_manager, project_manager |
| hr.attendance_today | "team attendance today", "who's in today" | `get_team_attendance_for_month(month, year)` filtered to today | founder, hr_manager |
| hr.pending_leaves | "pending leaves" | `get_pending_leave_requests()` (mig 120) | founder, hr_manager, project_manager (own reports) |
| hr.my_leave_balance | "my leave balance", "leaves left" | `get_leave_balances_for_employee(employee_id)` (mig 120) | ALL |
| hr.salary_benchmark_role | "benchmark for X role", "salary for project manager" | `get_salary_benchmark_report()` (mig 132) | founder, hr_manager |
| referrals.pending_payouts | "pending referral payouts" | SELECT FROM referral_payouts WHERE status='pending' | founder, finance |
| inventory.low_stock | "low stock", "cables running out" | `getLowStockCutLengths()` query | founder, project_manager, site_supervisor |
| purchase.pending_pos | "pending POs", "POs to approve" | SELECT FROM purchase_orders WHERE approval_status='pending_approval' | founder, purchase_officer, project_manager |
| settings.help | "help", "what can I ask" | static help text listing top 10 query aliases | ALL |
| meta.who_am_i | "who am I", "my role" | lookup caller's employee + profile + role | ALL |
| meta.now | "what time is it", "today's date" | static (IST formatted) | ALL |

**5 new RPCs to write** (all small, ~20 lines each):
- `get_sales_won_period(start DATE, end DATE)` — returns `(count BIGINT, total_value NUMERIC, top_3 JSON)`
- `get_sales_lost_period(start DATE, end DATE)` — returns `(count BIGINT, total_lost_value NUMERIC, reasons JSON)`
- `get_cash_inflow_period(start DATE, end DATE)` — returns `(total NUMERIC, by_project JSON)` summing `customer_payments.amount`
- `get_cash_outflow_period(start DATE, end DATE)` — returns `(total NUMERIC, by_vendor JSON)` summing `vendor_payments.amount_paid`
- `get_active_projects_by_pm()` — returns `(pm_id, pm_name, project_count, total_value)` for in-progress projects

## Intent classification prompt (Haiku)

```
You are an intent classifier for the Shiroi Energy ERP WhatsApp interface.
Given a user message + the current date (IST), classify it into one of:

A) "query" — caller wants to read data
B) "update" — caller wants to update a specific record
C) "unclear" — ambiguous

For "query" type: return one of the catalog IDs below + parameters.
For "update" type: extract the entity (lead/project/customer), the proposed
change, and any disambiguators (customer name, phone, project number).

Catalog IDs available to this caller (role-filtered server-side before this prompt):
{INSERT_CATALOG_FOR_ROLE}

Date interpretation rules:
- "last month" / "this month" — calendar month boundaries (1st to last)
- "last week" / "this week" — Monday to Sunday IST
- "Q1" / "Q2" — Jan-Mar / Apr-Jun (NOT Indian FY)
- "FY" / "this FY" — Indian FY (Apr 1 to Mar 31)
- "today" — IST date

Return ONLY valid JSON. No prose. Examples:

User: "sales last month"
Today: 2026-05-25
Output: {"type":"query","catalog_id":"sales.won_period","params":{"start":"2026-04-01","end":"2026-04-30"}}

User: "Mr Kumar Adyar agreed to 4.5L"
Today: 2026-05-25
Output: {"type":"update","entity":"lead","extracted":{"customer_hints":["Mr Kumar","Adyar"],"proposed_total":450000,"proposed_status":"negotiation"}}

User: "thanks!"
Today: 2026-05-25
Output: {"type":"unclear","reason":"not_a_query_or_update"}

User: "what's my leave balance"
Today: 2026-05-25
Output: {"type":"query","catalog_id":"hr.my_leave_balance","params":{}}
```

## Result formatting prompt (Haiku)

```
You are formatting an ERP query result for WhatsApp.
Constraints:
- Plain text only. NO markdown. NO emojis except ✅ ⚠️ ❌ for status.
- Indian rupee format: ₹1,23,456 or ₹1.2 Cr / ₹5.0 L / ₹50 K for KPIs.
- Cap output at 400 characters.
- If the result has >5 items, show top 3 + "...and N more. Full list: {LINK}"
- Always end with the deep link to the ERP web view if one is provided.

Input shape:
{
  "catalog_id": "...",
  "params": {...},
  "result_data": {...},
  "link": "https://erp.shiroienergy.com/..."
}

Examples:

Input:
{"catalog_id":"sales.won_period","result_data":{"count":18,"total_value":24000000,"top_3":[{"customer":"Mr Kumar Adyar","value":450000},{"customer":"Jains Aadheeswar","value":1100000},{"customer":"VAF Industries","value":1560000}]},"link":"https://erp.shiroienergy.com/sales?range=apr-26"}

Output:
✅ April sales

₹2.4 Cr · 18 won leads
Avg deal: ₹13.3L

Top 3:
1. VAF Industries — ₹15.6L
2. Jains Aadheeswar — ₹11L
3. Mr Kumar (Adyar) — ₹4.5L

Full report: https://erp.shiroienergy.com/sales?range=apr-26
```

## Role × catalog permission matrix

Stored as a JSON map keyed by catalog_id with an allowed-roles array. Loaded once at boot. Catalogs filtered by caller role BEFORE the intent prompt sees them.

Self-scoped entries (`my_leave_balance`, `who_am_i`) bypass role check (everyone) but the data fetched is scoped to the caller's employee_id.

## Schema additions (migration 138)

```sql
CREATE TABLE whatsapp_query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_phone TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id),
  raw_message TEXT NOT NULL,
  parsed_intent TEXT NOT NULL CHECK (parsed_intent IN ('query','update','unclear','rejected')),
  catalog_id TEXT,
  query_params JSONB,
  result_summary TEXT,
  ai_tokens_in INT,
  ai_tokens_out INT,
  ai_cost_usd NUMERIC(8,4),
  ai_provider TEXT NOT NULL DEFAULT 'anthropic',
  ai_model TEXT NOT NULL,
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wa_query_log_sender ON whatsapp_query_log (sender_phone, created_at DESC);
CREATE INDEX idx_wa_query_log_employee ON whatsapp_query_log (employee_id, created_at DESC) WHERE employee_id IS NOT NULL;
ALTER TABLE whatsapp_query_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_query_log_founder_read ON whatsapp_query_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'founder')
  );

CREATE TABLE whatsapp_update_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_phone TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id),
  raw_message TEXT NOT NULL,
  target_entity TEXT NOT NULL CHECK (target_entity IN ('lead','project','contact')),
  target_id UUID,
  proposed_changes JSONB NOT NULL,
  confirmation_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_confirmation'
    CHECK (status IN ('awaiting_confirmation','confirmed_applied','rejected','expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wa_update_queue_sender ON whatsapp_update_queue (sender_phone, created_at DESC);
CREATE INDEX idx_wa_update_queue_status ON whatsapp_update_queue (status) WHERE status = 'awaiting_confirmation';
ALTER TABLE whatsapp_update_queue ENABLE ROW LEVEL SECURITY;
-- service_role only; humans see via the audit log
```

## n8n workflow

**`infrastructure/n8n/workflows/48-employee-whatsapp-inbound.json`**

Nodes:
1. **Meta webhook trigger** — POST `/webhook/employee-whatsapp-inbound`. Path configured in Meta App console.
2. **Filter: text messages only** — drop status/template/system events.
3. **Filter: known employee phone** — quick check against a Supabase RPC `is_known_employee_phone(phone)`. If unknown, send a polite "you're not registered with the ERP" reply via Meta API and exit.
4. **HTTP POST to ERP** — `POST $ERP_URL/api/whatsapp/inbound` with `x-webhook-secret` header + JSON `{from, text, message_id, timestamp}`.
5. **Send reply via Meta API** — body comes from the ERP response.
6. **Log** — append to `customer_message_log` with `channel='whatsapp_employee_inbound'`.

## ERP API route

**`apps/erp/src/app/api/whatsapp/inbound/route.ts`** — POST handler.

Flow:
1. Validate `x-webhook-secret` header against `N8N_WEBHOOK_SECRET`.
2. Look up sender_phone → employees → profile.role. Reject if not found.
3. Check `whatsapp_update_queue` for a row where `sender_phone=...` AND `status='awaiting_confirmation'` AND `expires_at > NOW()`. If exists AND incoming message is "YES" / "y" / "yes" (case-insensitive) → apply the pending update, mark `confirmed_applied`, return success message. If "NO" / "cancel" → mark `rejected`. Otherwise (any other message): expire the old confirmation row + continue to fresh intent classification.
4. Call `callAi()` with Haiku for intent classification (with role-filtered catalog).
5. **If type=query**: validate catalog_id is in allowed list → execute the mapped RPC/query → call `callAi()` again for result formatting → return.
6. **If type=update**: fuzzy-match the entity (use existing `scripts/whatsapp-import/fuzzy-match.ts` patterns) → if exactly 1 match, generate confirmation message + insert row in `whatsapp_update_queue` → return confirmation text. If 0 or >1 matches, return "Couldn't find / found multiple. Use the web at <link>."
7. **If type=unclear**: return a short help message.
8. Log the whole interaction in `whatsapp_query_log` regardless of outcome.

Run as a server-side route (not Edge Function) so we get the existing Supabase server client + `ai-caller.ts` + `emitErpEvent` without re-implementing.

## Cost estimate

Haiku 4.5 pricing: $1 / M input, $5 / M output tokens.

Per interaction:
- Intent prompt: ~600 input + ~150 output tokens
- Result format (queries only): ~500 input + ~200 output tokens
- Total ~1.4k tokens for a query, ~750 tokens for an update

| Volume | Monthly tokens | Monthly cost |
|--------|----------------|--------------|
| 50/day (~75% queries) | ~1.7M | **~$8 / ₹670** |
| 200/day | ~6.8M | **~$32 / ₹2,700** |
| 1000/day | ~34M | **~$160 / ₹13,400** |

Up to ~500/day, Haiku is the right answer. Past 1000/day, local Ollama starts winning.

## Step-by-step build plan

### Session 1 — Foundation (3-4 hours)

- [ ] T1.1 — Write migration 138 with the two new tables + RLS + indexes. Apply to dev. Regen types. (30 min)
- [ ] T1.2 — Write the 5 new RPCs (`get_sales_won_period`, `get_sales_lost_period`, `get_cash_inflow_period`, `get_cash_outflow_period`, `get_active_projects_by_pm`) — same migration 138. Apply. (45 min)
- [ ] T1.3 — Implement the catalog map at `apps/erp/src/lib/whatsapp/catalog.ts` — JSON with all 30 entries, role-filter helper, per-entry RPC binding. (45 min)
- [ ] T1.4 — Implement the intent classifier wrapper at `apps/erp/src/lib/whatsapp/intent.ts` — wraps `callAi()` with the intent prompt + role-filtered catalog. Returns parsed JSON. (30 min)
- [ ] T1.5 — Implement the result formatter at `apps/erp/src/lib/whatsapp/format-result.ts` — wraps `callAi()` with the result prompt. (30 min)
- [ ] T1.6 — Implement the API route at `apps/erp/src/app/api/whatsapp/inbound/route.ts` — query path only, no update yet. (45 min)
- [ ] T1.7 — Unit tests for the catalog dispatch + intent parser (mocked AI). (30 min)

### Session 2 — Wire WhatsApp + queries live (3 hours)

- [ ] T2.1 — Write n8n workflow #48 + the `is_known_employee_phone` RPC. (30 min)
- [ ] T2.2 — Configure the Meta Business webhook URL in Meta App console (manual Vivek step — capture in run-book). (15 min Vivek)
- [ ] T2.3 — End-to-end test: Vivek sends "sales last month" from his phone, gets back the formatted reply. Iterate prompts. (60 min)
- [ ] T2.4 — Test all 30 catalog entries with a sample message each. Catch missing role gates, broken RPC bindings. (60 min)
- [ ] T2.5 — Add `/admin/whatsapp-log` page (founder-only) viewing the last 100 `whatsapp_query_log` rows. (30 min)

### Session 3 — Update path + confirmation flow (3-4 hours)

- [ ] T3.1 — Implement the update detection in the API route + insert into `whatsapp_update_queue`. (45 min)
- [ ] T3.2 — Implement the YES/NO confirmation handler. Apply the update via the existing lead/project actions. (60 min)
- [ ] T3.3 — Fuzzy match scoring — reuse `scripts/whatsapp-import/fuzzy-match.ts`. Handle 0/1/many cases. (45 min)
- [ ] T3.4 — Test the full update flow with Prem (or simulated): "Mr Kumar agreed to 4.5L" → confirmation → YES → applied. (60 min)
- [ ] T3.5 — Documentation: append a section to `docs/modules/sales.md` covering the WhatsApp two-way feature. (30 min)
- [ ] T3.6 — CI gates + commit + push. (30 min)

## What's already there

- ✅ `apps/erp/src/lib/ai/ai-caller.ts` + `ai-config.ts` — provider abstraction
- ✅ `apps/erp/src/lib/n8n/emit.ts` — outbound event helper (not used here but referenced)
- ✅ `infrastructure/n8n/workflows/57-meta-delivery-webhook.json` — existing Meta inbound webhook pattern to mimic
- ✅ `employees.whatsapp_number` (mig 082) — sender lookup
- ✅ Most of the catalog's underlying RPCs already exist (only 5 new)
- ✅ `scripts/whatsapp-import/fuzzy-match.ts` — reusable for entity match
- ✅ `customer_message_log` (mig 129) — for n8n inbound audit
- ✅ AI provider abstraction has Haiku model already declared (no code change needed)

## What's new

- Migration 138 (2 tables + 5 RPCs)
- Catalog map + intent + format wrappers under `apps/erp/src/lib/whatsapp/`
- API route `/api/whatsapp/inbound`
- n8n workflow 48
- Admin page `/admin/whatsapp-log`
- Documentation in sales.md

## Open questions for Vivek

1. **Which employees should be enrolled in pilot?** Recommend: Vivek + Prem + Manivel for week 1. Add the rest after stable.
2. **Should "unclear" messages be logged as a "support inbox" for you to review?** Recommend yes — appears in `/admin/whatsapp-log` as a filter tab.
3. **Sensitive query rate limit?** Recommend: max 30 queries/day per non-founder employee to control API spend.
4. **Confirmation window for updates** — default 10 minutes. Acceptable?
5. **Tamil messages** — handle now or later? Recommend later (Haiku does Tamil well but the catalog aliases are English-only; would need ~50 more aliases).
6. **PII in logs** — `whatsapp_query_log.raw_message` could contain customer names + amounts. Founder-only RLS already handles this. OK?

## Ready-to-execute checklist

- [ ] `ANTHROPIC_API_KEY` set in `.env.local` AND Vercel (production)
- [ ] `N8N_WEBHOOK_SECRET` set on droplet AND `.env.local`
- [ ] Meta Business webhook URL added in Meta App console (`https://n8n.shiroienergy.com/webhook/employee-whatsapp-inbound`)
- [ ] Vivek + Prem + Manivel have their `employees.whatsapp_number` populated correctly
- [ ] After session 1: dev tested locally before n8n wiring
- [ ] After session 3: founder spot-check 5 random queries + 2 updates before opening to others
