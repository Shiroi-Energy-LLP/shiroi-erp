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
- **Won cascade:** `trg_mark_proposal_accepted_on_lead_won` (migration 055) fires on any `UPDATE leads SET status = 'won'`. It finds the most recent in-play proposal (detailed preferred, most recent wins), marks it `accepted`, which cascades into the existing `create_project_from_accepted_proposal` trigger → project spawns automatically. Works from dropdown, `attemptWon`, `approveClosure`, or raw UPDATE. **Bulk imports bypass this** — they INSERT proposals/projects directly; migration 104's `BEFORE INSERT` trigger on projects backstops the PM lookup so direct-INSERT projects still get assigned to Manivel. **Migration 107 blocks the won transition when no proposal exists**, but **migration 109 added the `leads.proposal_gate_bypassed` escape hatch** — when TRUE the trigger skips the check (UI toggle in the no-proposal banner, visible to founder + marketing_manager for historical cleanup). The Path A "must Quick Quote first" UX still holds for new business; the bypass is for legacy data without a proposal row. The **`CreateProjectFromLeadButton`** on `/sales/[id]` (visible only when status=won AND no project) is the manual fallback for the rare case where a proposal exists but the cascade missed (e.g. proposal already 'accepted' from an import).
- **Closure-band data quality** (mig 109 + `closure-helpers.ts`): `MarginSnapshot` now carries `dataQuality: 'ok' | 'no_bom_cost' | 'no_base_price' | 'no_data'`. When `basePrice > 0` but `bomCost = 0` (common for AI-extracted historical proposals), the band returns `green` with `dataQuality='no_bom_cost'` instead of red-blocking — a ⓘ note renders on the badge instead. The "Mark Won (skip margin)" secondary button on `AttemptWonButton` lets founder + marketing_manager bypass the closure-band entirely; audited via `leads.margin_skipped_at` + `margin_skipped_by`.
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

## /sales filtering, bulk actions, and dashboard widgets (mig 109)

- **Multi-status filter** — `?status=new,contacted,negotiation` (comma-separated URL param). `getLeads` accepts `LeadStatus | LeadStatus[]`. UI: `FilterMultiSelect` popover with checkboxes, label "All Statuses (N)". Source for options is `STAGE_LABELS` minus terminal/legacy entries (`converted`, `proposal_sent`, `disqualified`).
- **kWp range filter** — `?kwpMin=5&kwpMax=15`. `FilterRange` component (dual-mode: `type='number'` here, `type='date'` for closure-date range). Indexed by `idx_leads_estimated_size_kwp` (mig 109).
- **Closure date range filter** — `?closeFrom=2026-05-20&closeTo=2026-06-30`. Same `FilterRange` component, `type='date'`.
- **Referrer filter** — `?referrer=<channel_partner_id>` or `?referrer=internal_all`. `channel_partners.is_internal` (mig 109) flags in-house referrers; seed includes "Vivek Sridhar (Founder)" + "Management Referral". The `internal_all` sentinel is resolved in the page layer into a `referrerIds: string[]` passed to `getLeads`.
- **Bulk actions** — `BulkActionBar` is rendered in `LeadsTableWrapper` when `selectedIds.length > 0`. Bulk Assign, Change Status, Merge (when exactly 2), Delete. Status options derived from `STAGE_LABELS` (single source of truth). `bulkChangeLeadStatus` reports partial-update count (RLS-blocked rows) via toast.
- **PipelineSummary** is a 5-card grid: Active Leads, Weighted Pipeline, **Closing This Week** (Link to `/sales?closeFrom&closeTo`), **Closing This Month** (Link), Won. The two Closing cards show count + total kWp + total ₹, fetched in SQL via `get_pipeline_close_window(start, end)` RPC (mig 109) — never aggregate money in JS (NEVER-DO #12).
- **Status badge** (`lead-status-badge.tsx`) — 12 distinct Tailwind colour pairs (slate/blue/cyan/amber/indigo/violet/orange/emerald/rose/zinc) keyed by `LeadStatus`. Renders short labels from `STAGE_LABELS_SHORT` (long form `STAGE_LABELS` stays for dropdowns). `max-w-[140px] truncate` clamps any overflow.
- **Follow-up tasks auto-create** — `upsertLeadFollowupTask(leadId, dueDate)` action in `leads-task-actions.ts` is called from `status-change.tsx` (after a successful status UPDATE) AND from `inline-edit-actions.ts` when `next_followup_date` is edited inline. Idempotent — UPDATEs the open `lead_followup` task if one exists for the lead, INSERTs otherwise. Failure is non-fatal (logged, not surfaced).
- **`getMyTasks`** filters `is_completed=false` (mig 109 batch); completed tasks visible via `/sales/tasks?show=all`.
- **`get_expected_orders` widened** — now spans `quick_quote_sent`, `detailed_proposal_sent`, `design_confirmed`, `negotiation`, `closure_soon` (was just `negotiation` + `closure_soon`). The dashboard Expected Orders card now reflects leads that actually might close in the window.

## Quick Quote PDF (mig 109 batch)

The Quick Quote PDF (`apps/erp/src/lib/pdf/budgetary-quote-pdf.tsx`) is now an **8-page branded document** matching the detailed proposal's look:

1. Cover (with "Budgetary Estimate — subject to site survey" disclaimer)
2. About Shiroi (shared with detailed)
3. System Overview (kWp, type, structure, indicative generation)
4. Savings (shared `SavingsPage`)
5. Investment Summary — high-level cost groups (panels / inverter / BoS / installation / optional liaison / optional civil), NOT line-by-line BOM
6. Payment Schedule stub — standard 30/40/20/10 with trigger labels (no dates)
7. Warranty + T&C (shared)
8. Why Shiroi (shared)

Shared page components extracted to `apps/erp/src/lib/pdf/shared-pages.tsx` so future polish lands in both PDFs at once.

## Past Decisions & Specs

- `docs/superpowers/specs/2026-04-04-pm-leads-proposals-design.md` — initial leads/proposals redesign
- `docs/superpowers/plans/2026-04-06-marketing-redesign.md` — stage-based pipeline
- `docs/superpowers/plans/` — marketing + design revamp plan (April 15)
- **Migrations 051–053** — marketing + design revamp (enum additions, schema + triggers + RLS, seed)
- **Migration 055** — FK fix on `log_lead_status_change` + won→proposal→project cascade trigger + `employees.is_active` fix
- **Migration 056** — FK fix on `log_proposal_status_change` (dormant bug surfaced by 055's new trigger); column-config status options reconciled
- **Migration 088** — `leads_update` RLS expanded to include `sales_engineer` (aligns with `leads_insert` / `leads_read` and documented role access). Closes silent-RLS-failure footgun where unassigned leads appeared to update successfully but did not.
- **Proposal PDF revamp** (May 20): rebuilt the May-19 placeholder PDFs to match Shiroi's actual 3-year customer-facing format. Analysis of 24 `.docx` files from `Drive/Proposals YYYY/*` (2022–2025/26 via service-account) surfaced two canonical templates — Class A (Detailed, 7 pages) and Class B (Quick, 4 pages) — that are now compiled from 11 shared/mode-specific page components under `apps/erp/src/lib/pdf/proposal/`. Cover, 14-row Technical Specification BOM table, and brand footer are shared. Detailed adds Executed Project (4-sector past-client grid, hardcoded in `quote-constants.ts`), System Sizing & Production, Scope of Work, Terms & Conditions, Documents Needed. Quick adds Pricing (Supply + Services split), Note, Account Details (bank + GSTIN). Fixed long-standing legal-name regression: cover now correctly reads "SHIROI ENERGY LLP" instead of "Private Limited". Spec: `2026-05-20-proposal-format-revamp-design.md`. Sample analysis: `scripts/data/proposal-samples/docx/_summary.md` (gitignored).
- **Migration 110** — `lead_activities` RLS realignment (May 20): mig 052's marketing sweep missed this single table. Now marketing_manager + project_manager can read AND marketing_manager can write (designer excluded from write — they read the funnel but don't log customer activities). Same migration triggered a side cleanup: `add-activity-form.tsx` moved from inline browser-side `createClient` (NEVER-DO #15) to new `addLeadActivity` server action in `leads-activity-actions.ts`, and `activity_type='phone_call'` was renamed to `'call'` to match the DB CHECK constraint. Quick Quote modal also fixed to call `onClose()` on success (was leaving the modal stuck on "Generating..." even though the proposal was created — the modal lives in the layout which persists across the `router.push` to the Quote tab).
- **Migration 109** — marketing feedback batch (May 19): `leads.proposal_gate_bypassed` (gate escape hatch), `leads.margin_skipped_at/by` (closure-band audit), `channel_partners.is_internal` flag with Vivek + Management referral seeds, widened `get_expected_orders` status filter, new `get_pipeline_close_window(start, end)` RPC powering clickable Closing-This-Week + This-Month cards, `idx_leads_estimated_size_kwp` for kWp range filter. UI: bulk-select fixed, follow-up tasks auto-create, multi-status/kWp/date/referrer filters, 12-colour status badge palette, multi-page Quick Quote PDF.
- **Migration 094** — `leads.map_link TEXT NULL` added (optional Google Maps URL, mirrors `projects.location_map_link`); `create_project_from_accepted_proposal` trigger now inherits the link onto the new project; RPCs `get_expected_orders(window_days)` + `get_expected_payments(window_days)` powering the dashboard cards; backfill of `payment_followup`/`payment_escalation` tasks to the oldest active marketing_manager (no-op at apply time but kept as a safety net). (Originally drafted as mig 089 but renumbered after origin/main shipped 088-091 in parallel.)
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
