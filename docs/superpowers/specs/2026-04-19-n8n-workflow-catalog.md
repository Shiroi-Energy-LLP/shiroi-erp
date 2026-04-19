# n8n Workflow Catalog — Shiroi ERP

**Created:** 2026-04-19
**Status:** Roadmap (intent captured, not yet scheduled)
**Author:** Vivek + Claude

---

## Intent

Shiroi ERP has the transactional data. n8n makes it _actionable_ by ensuring the right human gets the right message at the right time, on WhatsApp. This spec is the canonical list of every automation workflow the ERP needs to become a system that actively runs the business instead of passively recording it.

**Total workflows: ~59.** Tier 1+6 is the MVP (~20 workflows). Full catalog at 3–5/week = ~3–4 months of implementation.

---

## Architectural principle

> **ERP fires the webhook. n8n decides who/how/when. External channel delivers.**

- ERP stays transactional and authoritative — no business logic leaks into n8n.
- n8n is orchestration only — routing, templating, scheduling, retry. It is _not_ version-controlled line-by-line the way the ERP is.
- Every workflow has a timeout and a fallback: if WhatsApp fails, log + fall back to email. If email fails, log + alert Vivek.
- All workflows must be exportable as JSON and committed to `infrastructure/n8n/workflows/` for reproducibility.

---

## Prerequisites (gate Tier 1)

1. **WhatsApp Business API credential** — Meta Cloud API (direct, free for first 1000 convos/mo, requires ~2–3 day business verification) OR Gupshup (India-focused, faster setup, ~₹0.25/msg) OR Twilio (global, more expensive). **All Tier 1/3/4 workflows are blocked on this.**
2. **Gmail OAuth credential in n8n** — Google Cloud project → Gmail API → OAuth client → n8n credential.
3. **Supabase service-role credential in n8n** — paste `PROD_SUPABASE_SECRET_KEY` as n8n credential (for digest queries).
4. **n8n API key** — Settings → API → Generate. Enables programmatic workflow push from this repo.
5. **`employees.whatsapp_number`** — verify field exists; if not, migration to add + backfill.
6. **WhatsApp message templates** — customer-facing marketing/utility templates require Meta pre-approval (24–48h each). Transactional templates for notifications are easier but still need submission.
7. **Global error handler** (Tier 6 #55) — must be built **before** any other workflow so failures are visible.

---

## Single ingress decision (open)

Two options for ERP → n8n:

**A) Per-event webhook URLs:** `N8N_LEAD_CREATED_URL`, `N8N_PO_CREATED_URL`, … (30+ env vars). Clean separation. Tedious.

**B) Single ingress router:** `N8N_EVENT_BUS_URL` receives `{event: "lead.created", payload: {...}}`. n8n workflow-level routing via Switch node. One env var. Easier to manage, slightly more n8n complexity.

**Recommendation: B.** Matches event-bus pattern. Single source of auth secret rotation. Add one Switch node per event family.

---

## Build order (recommended)

1. **Week 1:** Tier 6 #55 (global error handler) + Tier 1 #2 (new lead) as reference implementations. Validates the pattern end-to-end.
2. **Week 2:** Tier 1 #3–#10 (sales + projects handoffs — highest coordination pain today).
3. **Week 3:** Tier 1 #11–#18 (finance/HR handoffs).
4. **Week 4:** Tier 2 #19–#28 (digests — one query-heavy workflow per role head).
5. **Month 2:** Tier 3 (monitoring) + Tier 6 (meta).
6. **Month 3:** Tier 4 (customer-facing) + Tier 5 (compliance reports). Tier 4 blocked on WhatsApp template approval cycle.

---

## Legend

🔔 ERP event · ⏰ cron · 🔌 external ingest · W=WhatsApp · E=email · I=in-app

---

## Tier 1 — Handoff notifications (~18 workflows, MVP)

Every role handoff in the ERP. Prevents dropped balls. Each fires when an ERP record transitions state.

| # | Event | Who gets pinged | Channel | Source table/event |
|--|--|--|--|--|
| 1 | Bug report submitted | Vivek | W | `bug_reports` insert |
| 2 | New lead created | Assigned salesperson | W+E | `leads` insert |
| 3 | Lead unacted >24h | Salesperson + Sales head | W | `leads` cron sweep |
| 4 | Proposal requested | Design head | W | `proposals` insert |
| 5 | Design submitted | Salesperson | W | `proposals.status → ready` |
| 6 | Proposal approved by customer | PM + Finance | W+E | `proposals.status → approved` |
| 7 | PO created | Purchase head + Finance | W | `purchase_orders` insert |
| 8 | Vendor payment due (>₹5L → Vivek too) | Finance | W | cron on `vendor_payments.due_date` |
| 9 | GRN recorded | Finance | W | `grns` insert |
| 10 | Installation scheduled | Install team + customer | W | `projects.install_date` set |
| 11 | Installation complete | Liaison + Commissioning | W | `projects.status → installed` |
| 12 | CEIG approval received | Commissioning + customer | W | `ceig_approvals` insert |
| 13 | Commissioning done | Finance + customer | W+E | `projects.status → commissioned` |
| 14 | Customer payment received | Salesperson (commission) + Finance | W | `payments` insert |
| 15 | O&M ticket created | O&M lead + assigned tech | W | `om_tickets` insert |
| 16 | Expense claim submitted | Manager | W | `expense_claims` insert |
| 17 | Leave request submitted | Manager | W | `leave_requests` insert |
| 18 | New hire added | IT + HR + manager | W+E | `employees` insert |

## Tier 2 — Daily/weekly digests (~10 workflows)

Morning digests to each head. Each is a scheduled n8n workflow that queries Supabase (service-role credential) and composes a WhatsApp message.

| # | When | To | Content |
|--|--|--|--|
| 19 | ⏰ Daily 7AM | Vivek | Yesterday: leads, POs, payments, commissioning, escalations |
| 20 | ⏰ Daily 8AM | Sales head | New leads, follow-ups today, quotes >3d silent |
| 21 | ⏰ Daily 8AM | Design head | WIP + designs pending >2d |
| 22 | ⏰ Daily 8AM | Projects head | Today's installs, overdue milestones, material shortfalls |
| 23 | ⏰ Daily 8AM | Purchase head | Pending POs, payments due, expected deliveries |
| 24 | ⏰ Daily 8AM | Finance head | Cashflow, invoices due, GST/TDS deadlines |
| 25 | ⏰ Daily 8AM | O&M head | Tickets >48h, AMC renewals in 30d, low-gen plants |
| 26 | ⏰ Daily 8AM | Liaison head | Filings pending, docs expiring in 30d |
| 27 | ⏰ Daily 8AM | HR head | Attendance anomalies, leave pending, birthdays |
| 28 | ⏰ Mon 8AM | Vivek | Weekly funnel + cashflow + fleet health |

## Tier 3 — Monitoring / anomalies (~9 workflows)

| # | Trigger | To |
|--|--|--|
| 29 | 🔌 Plant generation <80% expected, 2 days running | O&M tech + customer |
| 30 | 🔌 Inverter offline >24h | O&M tech |
| 31 | ⏰ Customer invoice >15d past due | Accounts + salesperson + customer |
| 32 | ⏰ Vendor payment overdue | Finance |
| 33 | ⏰ Lead stale >14d | Salesperson + sales head |
| 34 | ⏰ Proposal sent, no response >7d | Salesperson (with customer nudge template) |
| 35 | ⏰ Installed but not commissioned >30d | PM + Vivek |
| 36 | ⏰ Doc expiry 30/7/1d ahead (CEIG, IR, MSME, GST, electrician license) | Liaison + Finance |
| 37 | ⏰ Monthly low-generation summary per plant | Plant owner |

## Tier 4 — Customer-facing (~12 workflows)

All require pre-approved WhatsApp Business templates.

| # | Event/Schedule | Content |
|--|--|--|
| 38 | 🔔 Proposal approved | Welcome + PM contact + timeline |
| 39 | 🔔 Site survey done | Design ETA |
| 40 | 🔔 Design approved | Payment schedule link |
| 41 | 🔔 Materials dispatched | Expected date |
| 42 | 🔔 Installation started | Team lead contact |
| 43 | 🔔 Installation done | Photos + CEIG ETA |
| 44 | 🔔 Commissioning done | Portal link + generation tracking |
| 45 | ⏰ Monthly generation report per plant | Energy + savings + graph |
| 46 | ⏰ AMC renewal 60/30/7d before | Renewal offer |
| 47 | ⏰ 30d after commissioning | Google review request |
| 48 | 🔔 Payment receipt | After every payment |
| 49 | ⏰ Birthday/anniversary | From Vivek |

## Tier 5 — Compliance & management reports (~5 workflows)

| # | When | To | Content |
|--|--|--|--|
| 50 | ⏰ Monthly 1st | Finance + CA | GST + TDS prep data |
| 51 | ⏰ Monthly 25th | Finance | Payroll run + EPF/ESI data |
| 52 | ⏰ Quarterly | Vivek | P&L per completed project |
| 53 | ⏰ Monthly | Vivek | Ops report: projects, revenue, fleet, HR |
| 54 | ⏰ Monthly | Each AMC customer | Plant performance PDF |

## Tier 6 — Meta/infrastructure (~5 workflows, build FIRST)

| # | Purpose |
|--|--|
| 55 | **Global error handler** — any workflow fails → Vivek WhatsApp with workflow name + error. Build before Tier 1 #2. |
| 56 | Droplet health — CPU/RAM/disk >85% → Vivek |
| 57 | Nightly n8n DB backup → Supabase storage bucket, checksum verified |
| 58 | Sentry P0/P1 forwarder → WhatsApp (filtered, not every noise ping) |
| 59 | Daily training microlearning ⏰ 8AM per role |

---

## Open decisions

- [ ] WhatsApp provider: Meta Cloud API vs Gupshup vs Twilio
- [ ] Single ingress URL vs per-event URLs (leaning A: single ingress)
- [ ] Should daily digest times be per-role-preference or fixed 8AM? (leaning fixed)
- [ ] Escalation chains: if a head doesn't act on a digest within N hours, does Vivek get a copy? (undecided)
- [ ] Which alerts should also land in an in-app notification feed vs WhatsApp-only? (likely all, post-Tier 1)

---

*This spec is a living roadmap. Update the status of each row as workflows land. Do not expand the catalog without a deliberate decision — scope creep here means missed ship dates.*
