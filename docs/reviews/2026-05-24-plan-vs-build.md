# Plan-vs-Build Review — 2026-05-24

> Asked: "review the plans for each module against what was actually
> implemented." Five parallel review agents read every plan under
> `docs/superpowers/plans/`, the master plan B/C/E/F roadmap, and the
> matching module docs + actual code/migrations.
>
> Companion to `docs/reviews/2026-05-24-comprehensive-review.md`. This file
> is about plan↔implementation drift specifically; that one is about
> correctness + UX defects.

## Headline

**The shipped modules are ~85% aligned with their plans.** The remaining 15%
splits roughly into three buckets:

1. **Latent bugs** — work that shipped but doesn't actually function as the
   plan or module doc claims. Eight of these. Most have small blast radius
   today (cron-only paths, edge cases) but two are immediate trust issues
   (project completion % can show 100 without handover; DC certificate
   immutability is app-only and bypassable).
2. **Backlog stalled mid-execution** — scripts written, audits run, but the
   bulk follow-through never landed. Four of these (Tier B AI re-extraction,
   Tier D HubSpot re-import, 1,353-Drive-folder backfill, document
   extraction backfill). Plans promised them; reality is in limbo.
3. **Documentation drift** — module docs now lie about schema or behaviour
   in 6+ places. Misleads next reader (Claude or human).

Everything else — including the Phase B / C / E / F roadmap from
`2026-05-23-erp-master-plan-revised.md` — landed substantially as designed,
including the post-ship review-pass fixes (migs 134–136) that closed the
critical defects from the comprehensive review.

## Per-module scorecard

| Module | Aligned | Notable drift |
|--------|---------|---------------|
| **Sales** | ✅ Strong | Tier B + Tier D recovery scripts never executed; `proposal_total_sanity` DB CHECK never shipped; `/partners/[id]` stale vs mig 131 schema |
| **Design** | ✅ Strong | `proposal_total_sanity` CHECK skipped; Quick vs Detailed PDFs now live in two folders (drift risk) |
| **Contacts** | ✅ Strong | `[id]/edit` routes documented but never built |
| **Projects** | 🟠 Drift | 13 tabs ship but doc claims 12; stepper order changed; DC-cert "immutability" is app-only not DB; `step-actuals.tsx` orphan code |
| **Inventory** | 🟠 Partial | No DC/GRN → `stock_pieces` automation; two parallel cut-length systems (mig 006a + mig 121) that don't talk |
| **Purchase** | ✅ Strong | Only minor naming drift (mig number shifts) |
| **Finance** | ✅ Strong | Migs 075 + 124 missing; 6 duplicate migration numbers; `recordVendorPayment` has no dialog UI |
| **Expenses** | ✅ Exemplary | Tightest plan↔ship alignment in the repo |
| **HR** | 🟠 Drift | `salary_benchmarks` schema doesn't match `hr.md`; "double-entry ledger" claim is single-entry in practice |
| **Settings** | ✅ Strong | Plan had 3 tabs; shipped 4 (System tab added post-plan) |
| **Tasks** | 🟠 Partial | "Auto-create task on lead status change" missing; founder dashboard has no task widget |
| **WhatsApp Import** | 🟠 Partial | No `case 'lead'` in approve flow; photo upload to Storage never wired |
| **O&M** | ✅ Strong | E13/E14 admin UI pending; `process-document` idempotency race |
| **Liaison** | ✅ Strong | `get_liaison_summary()` is SECURITY DEFINER with no role gate |
| **Documents** | 🟠 Partial | `om_ticket_id` FK never added; 1,353-folder Drive backfill never ran; workflow #29 is a scaffold |
| **n8n** | 🔴 Compound gap | Router has 17 Switch cases, `ErpEventName` defines 30+; 3 events referenced by F1 customer drip workflows have no emit site in ERP code |

## The eight latent bugs (in priority order)

1. **Project completion % skips handover.** `get_project_completion_pct`
   (mig 121:121-130) defines weights for 9 components summing to 100;
   `handover` is in the `project_completion_items` CHECK constraint but
   has no row in the weights CTE. A project can show 100% complete
   without handover being marked done.

2. **DC certificate "immutability" is app-only.** `dc-certificate-actions.ts:50-68`
   refuses re-sign when `signed_at IS NOT NULL`, but mig 122's `dc_certs_update`
   policy still allows DB-level UPDATE for founder/PM/site_supervisor. A
   service-role mutation or any non-action path can re-sign a signed
   certificate. Module doc claims mig 134 fixed this in the DB — it didn't.

3. **Referral payout backfill needed.** `fn_auto_create_referral_payout`
   was double-broken between mig 131 (May 24 morning) and mig 134 (May 24
   evening): `NEW.stage` referenced a non-existent column AND
   `partner_type='internal'` referenced a non-existent enum value. Every
   `leads.status='won'` transition with a `channel_partner_id` in that
   window failed silently. Audit SQL:
   ```sql
   SELECT id, customer_name, channel_partner_id, won_at
     FROM leads
    WHERE status = 'won' AND channel_partner_id IS NOT NULL
      AND id NOT IN (SELECT lead_id FROM referral_payouts);
   ```

4. **n8n event-bus router missing ~13 Switch cases.** `ErpEventName` (in
   `apps/erp/src/lib/n8n/emit.ts:23-65`) defines 30+ events; the router
   `00-event-bus-router.json` handles 17. Events emitted-but-unrouted:
   `customer_checkin.due`, `lead.drive_folder_requested`,
   `proposal.accepted_by_customer`. Events referenced by F1 customer drip
   workflows but never emitted from ERP code:
   `lead.won`, `project.milestone_complete`, `net_metering.application_submitted`.
   F1 customer drip activation is materially blocked on this until both
   sides of the wire are reconciled.

5. **`process-document` Edge Function concurrency hole.** `index.ts:294-306`
   checks `extraction_status === 'done'` then flips to `'processing'` with
   no `worker_id` lock. Two concurrent invocations (e.g., n8n cron + a
   backfill script running together) both pass the check and both burn
   Anthropic + OpenAI quota on the same document. Flagged in `om.md:171`,
   still open.

6. **`generateCustomerCheckinsForWeek` will reject n8n cron calls.**
   `customer-outreach-actions.ts:23` requires the caller to have a
   `profiles.role` of `founder` or `om_technician`. A service-role JWT
   from an n8n Monday cron has no `profiles.role` row → fails the role
   gate. The whole E10 weekly check-in path is therefore inactive.

7. **`get_liaison_summary()` SECURITY DEFINER with no internal role
   check.** Mig 115 grants EXECUTE to authenticated. Any authenticated
   user (including future customer-app accounts) can read org-wide
   net-metering counts. Same antipattern that mig 135 had to fix on
   `fn_get_po_bill_reconciliation`.

8. **WhatsApp Import never creates leads.** `whatsapp-import-actions.ts:60-260`
   handles `customer_payment`, `task`, `activity`, `daily_report`, `contact`,
   `boq_item` — but has no `case 'lead'`. The plan promised lead creation
   from marketing chat; marketing extracts only land as `contacts` rows
   with `lifecycle_stage: 'lead'`, never as actual `leads`.

## The four stalled backlogs

1. **Tier B AI re-extraction.** `scripts/ai-reextract-tier-b.ts` exists; no
   migration applies the recoveries. 17 Tier B proposals stay
   banner-flagged.

2. **Tier D HubSpot re-import.** `scripts/reimport-hubspot-financials.ts`
   exists; the May 2026 plan said it waits on a fresh Vivek CSV. Unclear
   whether the CSV was ever delivered. 63 HubSpot proposals remain
   banner-flagged.

3. **`proposal_total_sanity` DB CHECK constraint.** Proposal corruption
   recovery plan called for `CHECK (total_after_discount <=
   system_size_kwp * 1000000)` as the final regression net. Mig 089 ended
   up holding the flag columns instead; no follow-up migration ships the
   CHECK. Bulk-import paths (Zoho, HubSpot, AI extraction) are still
   active — one bad import away from fresh corruption.

4. **1,353 Drive-folder backfill into `documents`.** Spec for documents
   lifecycle promised migration of historical Drive proposal folders into
   `documents` rows. No script in repo. `scripts/data/documents-backfill-storage-audit.csv`
   (7,636 lines) suggests the audit happened; the actual write-back didn't.

## Documentation drift to fix

| File | Drift |
|------|-------|
| `docs/modules/projects.md` | Says "12-stage stepper"; actually 13 tabs. Claims mig 134 added DC-cert immutability in the DB; it's only in app code. |
| `docs/modules/hr.md:120` | Lists `salary_benchmarks(role, city, segment, p25, median, p75, source, captured_at)`. Actual schema is `(role, designation, market_median, market_p25, market_p75, source, updated_at)` — no city or segment. |
| `docs/modules/contacts.md` | Lists `/contacts/[id]/edit` and `/companies/[id]/edit` routes. Those directories don't exist. |
| `docs/modules/inventory.md` | Implies `inventory_cut_records` and `stock_pieces` are integrated; they have no FK between them. |
| `docs/modules/finance.md` | `e_invoice_status` enum lists `awaiting_gsp`; actual constraint is `not_required|pending|generated|cancelled|failed`. |
| `docs/modules/om.md` | "Admin UI for learning modules: pending" — accurate but worth restating that E13/E14 are schema-only. |

## Master-plan B/C/E/F task-level status

Cross-referencing `2026-05-23-erp-master-plan-revised.md`:

| Phase | Task | Status | Notes |
|-------|------|--------|-------|
| B1 | Payment tracker follow-up + expected date | ✅ Shipped | mig 117 + `updatePaymentFollowUp` action + dialog |
| B2 | "Payments Expected This Week" KPI | ✅ Shipped | On `/payments` + `/cash` |
| B3 | Follow-up action (mark contacted, reschedule, note) | ✅ Shipped | |
| B4 | BOM generator: AC cable, earthing, conduit, misc/civil | ✅ Shipped | `budgetary-quote.ts` rewrite |
| B5 | Quick Quote PDF fix | ✅ Shipped | 8-page branded |
| B6 | Detailed Quote: prominent flow | ✅ Shipped | CTA + amber nudge on lead detail |
| B7 | Detailed Quote PDF revamp | ✅ Shipped | May 20 revamp, Class A/B split |
| C1 | Purchase: gap review | ✅ Shipped | mig 123 (material requisitions + bills panel + reconciliation) |
| C2 | Finance: invoice raising | ✅ Shipped | mig 118 + `raiseProjectInvoice` |
| C3 | Finance: payment recording | ✅ Shipped | `recordProjectPayment` + dialog |
| C4 | Finance: receivables reconciliation | ✅ Shipped | `get_receivables_reconciliation()` + `/payments/reconciliation` page |
| C5 | HR: leave management | ✅ Shipped | + mig 136 atomic RPC fix |
| C6 | HR: employee profile | ✅ Shipped | `blood_group`/`bank_name` + SensitiveField |
| C7 | HR: attendance | ✅ Shipped | + mig 134/136 RLS lockdown |
| C8 | Inventory: cut-length | ✅ Shipped | `inventory_cut_records` + Materials tab |
| C9 | Projects: completion % | 🟠 Shipped with bug | `handover` not in weights CTE — see latent bug #1 |
| C10 | Documents: drag-drop upload | ✅ Shipped | `DocumentDropZone` + project-files bucket routing |
| C11 | Handover pack PDF | ✅ Shipped | 3-page react-pdf doc |
| C12 | DC digital signatures | 🟠 Shipped with bug | Immutability app-only — see latent bug #2 |
| E1 | Growatt adapter | ✅ Shipped | with inlined MD5 fix |
| E2 | Sungrow OAuth2 adapter | ✅ Shipped | |
| E3 | SolarMan/Goodwe stubs | ✅ Shipped | synthetic mode |
| E4 | `/om/inverters` UI | ✅ Shipped | |
| E5 | Edge Function + n8n cron | ✅ Shipped | workflow #60 |
| E6 | Documents AI extraction | 🟠 Shipped with race | concurrency hole — see latent bug #5 |
| E7 | Zoho live sync | ✅ Shipped | workflow #62 (config pending) |
| E8 | AI daily report narrative | ✅ Shipped | `project-daily-report.ts` rewritten against real schema in mig 134 batch |
| E9 | Photo gates + GPS | ✅ Shipped | `milestone_photos` + `haversine_distance_m()` (backend only, no UI) |
| E10 | Customer outreach queue | 🟠 Will reject cron | role-gate vs service-role mismatch — see latent bug #6 |
| E11 | BOM actual vs budgetary | ✅ Shipped | `bom_actual_vs_budgetary` table |
| E12 | OM profitability | ✅ Shipped | RPC + page |
| E13 | Microlearning engine | 🟠 Schema only | admin UI pending |
| E14 | Onboarding tracks | 🟠 Schema only | admin UI pending |
| E15 | PVLib microservice | ✅ Shipped | live at `pvlib.shiroienergy.com` |
| F1 | Customer drip sequences | 🟠 8 workflows + templates exist | router missing cases + missing emit sites — see latent bug #4 |
| F2 | Meta Business Verification | ✅ Done | tier at 2k msgs/24h |
| F3 | GST e-invoicing | ✅ Honest stub | `generateEInvoice` returns `err()` until GSP onboarded |
| F4 | Referral program | 🟠 Shipped with backfill gap | needs payout audit — see latent bug #3 |
| F5 | Tamil microlearning | ⏸️ Deferred | manual content step |
| F6 | Salary benchmarking | 🟠 Shipped + doc drift | schema doesn't match `hr.md` |
| F7 | Customer portal | ✅ Shipped | `/p/[token]` + PDF route + accept action |
| F8 | OpenRouter | ✅ Shipped | `ai-caller.ts` provider switch |

## Top 10 recommendations (in fix-priority order)

1. **Fix `get_project_completion_pct` weight bug** (mig 121). Either add
   `handover` to the weights CTE or drop it from the table CHECK. Today
   you can hit 100% completion without handover.
2. **Enforce DC-cert immutability in the DB.** Wrap mig 122's
   `dc_certs_update` policy in `USING (signed_at IS NULL)`. The app-only
   gate at `dc-certificate-actions.ts:50` is bypassable.
3. **Run the referral payout backfill audit** (SQL above) and create
   missing rows from the broken-trigger window.
4. **Reconcile n8n router + emit sites + F1 workflows.** ~13 Switch cases
   missing, 3 events referenced-but-never-emitted. Without this, F1
   customer drip is inactive even after Meta template approval. Tracking
   table:
   ```
   Router needs:        customer_checkin.due, lead.drive_folder_requested,
                        proposal.accepted_by_customer, vendor_payment.due,
                        invoice.overdue, document.expiring, lead.stale_24h,
                        lead.stage_changed, lead.quick_quote_sent,
                        proposal.rejected, purchase_order.created,
                        workflow.error, om_ticket.resolved
   ERP code needs:      emitErpEvent('lead.won', …),
                        emitErpEvent('project.milestone_complete', …),
                        emitErpEvent('net_metering.application_submitted', …)
   ```
5. **Add role gate inside `get_liaison_summary()`** (mig 115). Mirror the
   mig 135 pattern that fixed `fn_get_po_bill_reconciliation`. Audit every
   SECURITY DEFINER function since mig 050 for the same antipattern.
6. **Fix the `process-document` race** — CAS update with `WHERE
   extraction_status IS DISTINCT FROM 'processing'` and check rowCount.
7. **Fix `generateCustomerCheckinsForWeek` cron compatibility.** Either
   accept service-role JWTs explicitly or move to an Edge Function.
8. **Add `case 'lead'` to WhatsApp import approve flow.** Marketing chat
   extraction goes to `contacts` only today; promised leads creation
   doesn't happen.
9. **Decide on the four stalled backlogs.** Tier B / Tier D recoveries,
   `proposal_total_sanity` CHECK, 1,353-folder Drive backfill. Either
   ship them or strike them from the specs so docs stop promising
   undelivered work.
10. **Sweep documentation drift** (table above) and the migration-numbering
    cleanup (missing 075 + 124, six duplicate numbers). Module docs
    misleading the next contributor compounds over time.

## What's working well

Equally important to call out — most things are right:

- **Phase E intelligence layer landed substantially intact** (after the
  May 24 review-pass fixes to `project-daily-report.ts` +
  `customer-outreach-actions.ts`). E1–E5 inverter chain, E6 real Anthropic
  extraction, E12 OM profitability, E15 PVLib live — all green.
- **Phase C-purchase + Phase C-finance + Phase C-HR + Phase C-ops** all
  landed in a single overnight wave with minimal drift. The C8/C9/C10/C11/C12
  bundle (5 features in one migration pair) is impressive throughput; the
  C9 weight bug is a small footnote on otherwise clean work.
- **Phase F** mostly shipped — F2 done, F3 honest stub, F4/F6/F7/F8 live
  with the May 24 fixes; only F5 deferred for manual content work.
- **Sales pipeline + closure-band + channel partner refactor** matches
  the marketing-redesign plan tightly. State machine in `leads-helpers.ts`
  is single-source-of-truth.
- **Mig 134 + mig 135 + mig 136 review-pass discipline** caught the
  highest-severity defects and shipped fixes within hours. Process worked.
- **Expenses module** is exemplary plan↔ship alignment — the cleanest
  module in the repo.
- **PVLib microservice deployment** (E15) — Dockerfile + main.py + Caddy
  reverse-proxy + first-request HTTPS cert, all running on the existing
  droplet without disturbing n8n. Smoke test passed.

---

*Plan-vs-build review compiled 2026-05-24 by Claude Opus 4.7 from five
parallel agent passes. Plans read: 31 files in `docs/superpowers/plans/`.
Module docs read: 11 files in `docs/modules/`. Migrations cross-referenced:
001–136. Raw agent reports preserved in the session transcript.*
