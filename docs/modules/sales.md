# Sales Module

> Lead intake → quote → proposal → won. Includes channel partners and closure band approvals.
> Related modules: [design], [projects], [finance]. Cross-cutting references: master reference §6.1, §6.2.

## Overview

The sales module owns the entire customer-acquisition funnel, from first-touch lead through a signed proposal and the automatic spawn of a project. It supports two parallel paths — a fast Quick Quote (budgetary) lane and a slower Detailed Proposal lane gated by site survey and design — and enforces a margin-band closure rule that auto-approves healthy deals, routes borderline deals to the founder, and blocks unprofitable ones. Channel partner (consultant) relationships with locked commissions and TDS-aware per-tranche payouts are tracked here too.

## User Flow / Screens

```
/sales                       ← pipeline list (HubSpot-style DataTable, stage-nav)
/sales/new                   ← create lead
/sales/[id]/                 ← lead detail layout (tabs)
  ├── page.tsx               ← Details tab (default)
  ├── activities/            ← activity timeline
  ├── tasks/                 ← task list scoped to this lead
  ├── files/                 ← proposal-files bucket under leads/{id}/
  ├── payments/              ← payment schedule + receipts
  └── proposal/              ← Quote tab (Quick Quote + Detailed Proposal editor)

/leads, /leads/*             ← legacy — 307 redirect to /sales (see middleware.ts)
/proposals                   ← 307 → /sales ; /proposals/[id] still serves historical detail

/partners                    ← channel partner list
/partners/[id]               ← partner detail (leads, pending payouts, YTD paid)
```

The sales list page has a stage-based pipeline nav (`lead-stage-nav.tsx`) with colored section borders for Path A / Path B / closure_soon. Closure_soon leads render an amber banner in `/sales/[id]/layout.tsx` with the live margin band and an `AttemptWonButton`.

## Key Business Rules

- **Path A (Quick Quote):** `new → contacted → quick_quote_sent → won` (fast lane, budgetary proposal only).
- **Path B (Detailed Proposal):** `new → contacted → site_survey_scheduled → site_survey_done → design_in_progress → design_confirmed → detailed_proposal_sent → negotiation → closure_soon → won`.
- **`lead_status` enum:** `new, contacted, quick_quote_sent, site_survey_scheduled, site_survey_done, design_in_progress, design_confirmed, detailed_proposal_sent, negotiation, closure_soon, won, lost, on_hold`. Legacy values `proposal_sent` / `converted` / `disqualified` exist in DB but are no longer offered in UI dropdowns.
- **Closure band** (`closure-actions.ts#classifyBand`):
  - green ≥10% margin → `attemptWon` flips lead to `won` immediately
  - amber 8–10% → inserts row into `lead_closure_approvals`, notifies founder; founder approves/rejects via `ClosureApprovalsPanel` on dashboard
  - red <8% → blocked; user must increase quote or reduce BOM cost
- **Won cascade:** `trg_mark_proposal_accepted_on_lead_won` (migration 055) fires on any `UPDATE leads SET status = 'won'`. It finds the most recent in-play proposal (detailed preferred, most recent wins), marks it `accepted`, which cascades into the existing `create_project_from_accepted_proposal` trigger → project spawns automatically. Works from dropdown, `attemptWon`, `approveClosure`, or raw UPDATE.
- **Consultant commission:** `fn_lock_consultant_commission_on_partner_assignment` (BEFORE UPDATE on leads, migration 052) computes and locks commission at the moment a channel_partner_id is assigned. `fn_create_consultant_payout_on_customer_payment` (AFTER INSERT on customer_payments) creates a pending payout row per tranche with 5% TDS deducted.
- **Phone uniqueness:** Partial unique index on `leads.phone` excludes `disqualified` and `lost` statuses, so re-engaging a lost customer doesn't fail.
- **Payment SLAs:** `proposal_payment_schedule.followup_sla_days` + `escalation_sla_days` drive the `create_payment_followup_tasks` + `enqueue_payment_escalations` triggers. Follow-up tasks are assigned to `marketing_manager` (Prem).

## Key Tables

- `leads` — main entity; includes `channel_partner_id`, `consultant_commission_amount`, `base_quote_price`, `design_confirmed_at`, `draft_proposal_id`
- `proposals` — budgetary / detailed types; `status` drives the won cascade
- `proposal_bom_lines` — BOM with `price_book_id` FK for the Quote→BOQ→PO sync chain
- `proposal_payment_schedule` — milestone tranches with `followup_sla_days` + `escalation_sla_days`
- `lead_status_history` — audit of every stage change (FK `changed_by` → `employees.id`, nullable for system ops)
- `lead_closure_approvals` — amber-band founder approval queue
- `channel_partners` — consultants / referrals / architects / MEP firms
- `consultant_commission_payouts` — per-tranche disbursements linked to customer_payments
- `activities` + `activity_associations` — HubSpot-style timeline across leads/proposals/projects

## Key Files

```
apps/erp/src/app/(erp)/
  sales/page.tsx
  sales/new/page.tsx
  sales/[id]/{layout,page}.tsx
  sales/[id]/{activities,tasks,files,payments,proposal}/page.tsx
  leads/** (legacy, 307 → /sales via middleware.ts)
  proposals/page.tsx (307 → /sales); proposals/[id]/page.tsx (historical detail kept alive)
  partners/page.tsx
  partners/[id]/page.tsx

apps/erp/src/lib/
  leads-queries.ts, leads-actions.ts, leads-task-actions.ts
  leads-pipeline-queries.ts    ← getLeadStageCounts (delegates to cached RPC)
  leads-helpers.ts             ← VALID_TRANSITIONS, STAGE_LABELS, DEFAULT_PROBABILITY
  proposals-queries.ts, proposal-actions.ts, proposal-calc.ts
  quote-actions.ts             ← createDraftDetailedProposal, finalizeDetailedProposal,
                                  escalateQuickToDetailed, addBomLineFromPriceBook,
                                  removeBomLine, updateBomLineQuantity
  budgetary-quote.ts           ← Quick Quote generator (accepts optional preferredBrands)
  excel-quote-parser.ts
  partners-queries.ts          ← listPartners, getPartner, getPartnerLeads,
                                  getPartnerPayouts, getPartnerSummary (FY-aware)
  partners-actions.ts          ← create/update/disable partner, assignPartnerToLead,
                                  unassignPartnerFromLead, markPayoutPaid
  closure-queries.ts           ← listPendingClosureApprovals, countPendingClosureApprovals
  closure-actions.ts           ← classifyBand, computeMargin, attemptWon,
                                  approveClosure, rejectClosure
  closure-helpers.ts
  payment-followups-queries.ts ← getPaymentFollowups, getPaymentFollowupsSummary

apps/erp/src/components/
  sales/
    closure-band-badge.tsx, closure-approvals-panel.tsx, closure-approval-actions.tsx
    attempt-won-button.tsx
    consultant-picker.tsx, bom-picker.tsx
    finalize-detailed-proposal-button.tsx
  data-table/*                 ← leads + proposals tables use this
```

## Known Gotchas

- **Silent RLS failure on leads UPDATE** — fixed in `status-change.tsx`, `inline-edit-actions.ts`, and `bulkChangeLeadStatus` to call `.select('id')` and treat a zero-length response as "Update blocked". Without this, Supabase returns success on RLS-blocked UPDATEs and the UI shows a misleading "Saved" toast. Apply this pattern to any new code that updates a lead.
- **Middleware** (`apps/erp/src/middleware.ts`) 307-redirects `/leads` + `/leads/*` → `/sales` + `/sales/*` and `/proposals` → `/sales`. `/proposals/[id]` still serves historical detail pages. Don't add new routes under `/leads`.
- **Single source of truth for stages:** always import `STAGE_LABELS` from `leads-helpers.ts`. Never hardcode stage strings in badges, filter dropdowns, or column configs.
- **Column config drift:** `LEAD_COLUMNS.status.options` in `column-config.ts` must match `STAGE_ORDER` in `lead-stage-nav.tsx`. This drifted once (missing the 4 new revamp stages) and broke inline edit on /sales — fixed in migration 056. Keep them in sync.
- **`budgetary-quote.ts`** accepts an optional `preferredBrands: { panel, inverter }` steering hook — use it when the customer has a specific brand preference.
- **Pipeline summary** comes from the `get_pipeline_summary()` RPC (migration 048), wrapped in `getCachedPipelineSummary` with 300s TTL. Never `.reduce()` over proposals in JS for dashboard numbers — rule #12.
- **`price_book_id` on BOM lines** is enforced for detailed proposals by `finalizeDetailedProposal` (validates every line has it). Legacy BOM lines can be free-text; `BomPicker` shows an amber chip for them.
- **FK on `lead_status_history.changed_by`** points to `employees.id`, not `auth.users.id`. Migration 055 fixed the trigger — look up via `profile_id = auth.uid()` with NULL fallback.

## Past Decisions & Specs

- `docs/superpowers/specs/2026-04-04-pm-leads-proposals-design.md` — initial leads/proposals redesign
- `docs/superpowers/plans/2026-04-06-marketing-redesign.md` — stage-based pipeline
- `docs/superpowers/plans/` — marketing + design revamp plan (April 15)
- **Migrations 051–053** — marketing + design revamp (enum additions, schema + triggers + RLS, seed)
- **Migration 055** — FK fix on `log_lead_status_change` + won→proposal→project cascade trigger + `employees.is_active` fix
- **Migration 056** — FK fix on `log_proposal_status_change` (dormant bug surfaced by 055's new trigger); column-config status options reconciled
- **Migration 088** — `leads_update` RLS expanded to include `sales_engineer` (aligns with `leads_insert` / `leads_read` and documented role access). Closes silent-RLS-failure footgun where unassigned leads appeared to update successfully but did not.
- **Migration 017** — Contacts V2 foundation (see `docs/modules/contacts.md`)
- **Migration 020** — pipeline fields (`expected_close_date`, `close_probability`, `is_archived`)
- **Migration 048** — `get_pipeline_summary()` RPC + supporting indexes

## Role Access Summary

- **`marketing_manager`** (Prem): full CRUD on leads, proposals, proposal_bom_lines, proposal_payment_schedule, channel_partners, net_metering_applications, lead_closure_approvals, consultant_commission_payouts; read-only on projects
- **`founder`**: full access everywhere; approves amber-band closures via `ClosureApprovalsPanel`
- **`sales_engineer`**: full access on leads and proposals; simplified sidebar (Overview / Sales / Contacts)
- **`designer`**: read-only window onto leads + projects; full access on `price_book` and the design workspace
- **`project_manager`**: read-only on leads (can see the pipeline to anticipate incoming work, can't edit)
- **`finance`**: read-only on leads; full access on payment-related tables
