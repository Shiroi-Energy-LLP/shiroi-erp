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
- **Won cascade:** `trg_mark_proposal_accepted_on_lead_won` (migration 055) fires on any `UPDATE leads SET status = 'won'`. It finds the most recent in-play proposal (detailed preferred, most recent wins), marks it `accepted`, which cascades into the existing `create_project_from_accepted_proposal` trigger → project spawns automatically. Works from dropdown, `attemptWon`, `approveClosure`, or raw UPDATE. **Bulk imports bypass this** — they INSERT proposals/projects directly; migration 104's `BEFORE INSERT` trigger on projects backstops the PM lookup so direct-INSERT projects still get assigned to Manivel. **Migration 107 blocks the won transition when no proposal exists**, but **migration 109 added the `leads.proposal_gate_bypassed` escape hatch** — when TRUE the trigger skips the check (UI toggle in the no-proposal banner, visible to founder + marketing_manager for historical cleanup). The Path A "must Quick Quote first" UX still holds for new business; the bypass is for legacy data without a proposal row. The **`CreateProjectFromLeadButton`** on `/sales/[id]` (visible only when status=won AND no project) is the manual fallback for the rare case where a proposal exists but the cascade missed (e.g. proposal already 'accepted' from an import). **Migration 169 (2026-06-08)** closes the remaining gap: when a lead is Won with *no* proposal at all (only possible while the gate is off), `fn_mark_proposal_accepted_on_lead_won` now auto-stubs an `accepted` budgetary proposal (`is_budgetary`, `financials_invalidated=TRUE`, value from `base_quote_price`) so the cascade always spawns a project + assigns Manivel — every Won deal reaches the PM regardless of gate state. Same migration backfilled 57 historically-stranded won leads (12 recent → `order_received`, 45 old → `completed`).
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

- **Silent RLS failure on leads UPDATE** — fixed in `status-change.tsx`, `inline-edit-actions.ts`, `bulkChangeLeadStatus`, and `renameLead` to call `.select('id')` and treat a zero-length response as "Update blocked". Without this, Supabase returns success on RLS-blocked UPDATEs and the UI shows a misleading "Saved" toast. Apply this pattern to any new code that updates a lead.
- **Editing the lead name** — corrected via the pencil button beside the `<h1>` in `leads/[id]/layout.tsx`, which opens `lead-name-edit-dialog.tsx` → `renameLead(leadId, newName)` in `leads-actions.ts` (trims, rejects empty, caps 150 chars, zero-rows guard, revalidates detail + breadcrumb + both list tables). Deliberately **not** inline-editable in the leads table: `customer_name` is the table's `linkField` (`leads-table-wrapper.tsx`), so clicking it navigates to the detail page — the `editable: true` flag on that column in `column-config.ts` is dead config, overridden by the link branch in `data-table.tsx`. Don't "fix" that flag expecting inline name edit; rename lives on the detail page by design.
- **Middleware** (`apps/erp/src/middleware.ts`) 307-redirects `/leads` + `/leads/*` → `/sales` + `/sales/*` and `/proposals` → `/sales`. `/proposals/[id]` still serves historical detail pages. Don't add new routes under `/leads`.
- **Single source of truth for stages:** always import `STAGE_LABELS` from `leads-helpers.ts`. Never hardcode stage strings in badges, filter dropdowns, or column configs.
- **Column config drift:** `LEAD_COLUMNS.status.options` in `column-config.ts` must match `STAGE_ORDER` in `lead-stage-nav.tsx`. This drifted once (missing the 4 new revamp stages) and broke inline edit on /sales — fixed in migration 056. Keep them in sync.
- **`budgetary-quote.ts`** accepts an optional `preferredBrands: { panel, inverter }` steering hook — use it when the customer has a specific brand preference.
- **`budgetary-quote.ts` vocabulary** — the generator reasons in *logical* category names (`panel`, `inverter`, `structure`, `dc_cable`, `ac_cable`, `earthing`, `installation_labour`, `net_meter`, `civil_work`) but the `price_book` table imports use different names (`solar_panels`, `mms`, `dc_accessories`, `ac_accessories`, `earthing_accessories`, `ic`, `generation_meter`, `transport_civil`). A `PRICE_BOOK_CATEGORY` map at the top of the file bridges them. If you add a new logical bucket, also add its DB-category list to that map — otherwise the row won't be found at runtime. (May 20 2026 fix — bug had been live since day one, producing ₹0 Quick Quotes for every lead.)
- **`base_price > 0` filter** — `findItem` always drops zero-priced rows. The dev price_book has ~48 placeholder inverter rows at ₹0 that would otherwise win the "cheapest" pick. When seeding new categories, make sure prices are populated; an unpriced row is treated as not-present.
- **Segment-aware selection** — labour (`ic`) and net-metering (`generation_meter`) categories have Residential and Commercial variants distinguished by item_description. `preferSegment(segment)` matches by description keyword. Industrial leads fall through to the Commercial row (Shiroi convention).
- **Inverter capacity matching** — `preferInverterCapacity(sizeKwp)` reads the kW figure from the inverter's item_description (e.g. "150 KW / Three Phase On grid Inverter") and picks one within 0.8×–1.5× the system size. Avoids the old footgun where a 150 kWp system got the 1.5 kW residential Deye because it was the cheapest.
- **Panel unit handling** — Shiroi's master prices panels per-Wp (`unit='Wp'`, e.g. ₹14/Wp). When `unit==='Wp'`, the generator emits `quantity = systemSizeKwp × 1000` (total Watts) and keeps the unit_price unchanged. If you add panels with `unit='Nos'`, the code falls back to the panel-count math and pulls wattage from spec/description/model.
- **Pipeline summary** comes from the `get_pipeline_summary()` RPC (migration 048), wrapped in `getCachedPipelineSummary` with 300s TTL. Never `.reduce()` over proposals in JS for dashboard numbers — rule #12.
- **`price_book_id` on BOM lines** is enforced for detailed proposals by `finalizeDetailedProposal` (validates every line has it). Legacy BOM lines can be free-text; `BomPicker` shows an amber chip for them.
- **FK on `lead_status_history.changed_by`** points to `employees.id`, not `auth.users.id`. Migration 055 fixed the trigger — look up via `profile_id = auth.uid()` with NULL fallback.

## /sales filtering, bulk actions, and dashboard widgets (mig 109)

- **Multi-status filter** — `?status=new,contacted,negotiation` (comma-separated URL param). `getLeads` accepts `LeadStatus | LeadStatus[]`. UI: `FilterMultiSelect` popover with checkboxes, label "All Statuses (N)". Source for options is `STAGE_LABELS` minus terminal/legacy entries (`converted`, `proposal_sent`, `disqualified`).
- **kWp range filter** — `?kwpMin=5&kwpMax=15`. `FilterRange` component (dual-mode: `type='number'` here, `type='date'` for closure-date range). Indexed by `idx_leads_estimated_size_kwp` (mig 109).
- **Closure date range filter** — `?closeFrom=2026-05-20&closeTo=2026-06-30`. On **/leads** this is the custom `DateRangeFilter` (`date-range-filter.tsx` + pure `date-range-utils.ts`): a **dd/mm/yyyy** single-month calendar popover that commits BOTH bounds in one navigation. /sales still uses `FilterRange type='date'`. **Both** `FilterRange` inputs now commit min+max together from refs — the old per-input `onBlur` rebuilt the URL from a stale `searchParams` snapshot and silently dropped one bound (this was the "June 1–30 still shows July leads" bug: only `closeFrom` reached `getLeads`, so the upper bound was never applied). Date *display* (table cells) is unchanged — still "08 Jun 2026".
- **Referrer filter** — **/leads** uses 3 buckets: `?referrer=` (All Referrers, no filter) · `none` · `mgmt` · `customer`, resolved server-side off `channel_partners.is_internal` by the pure `resolveReferrerFilter()` helper (`leads-helpers.ts`) into `{ referrerIds | noReferrer }` on `getLeads`. `noReferrer` → `channel_partner_id IS NULL` (search path uses `p_no_referrer`, **mig 171** on `search_leads_by_query`). /sales still uses the per-partner dropdown + the legacy `?referrer=<id>` / `internal_all` path (both retained in `getLeads`). `is_internal` (mig 109) seed: "Vivek Sridhar (Founder)" + "Management Referral".
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

## Phase F additions (May 2026)

### F4 — Channel-partner payouts (`/referrals`)
**Migration 131** introduced full referral payout management. `referral_payouts` table tracks per-deal commission with status (`pending`/`approved`/`paid`/`rejected`). `channel_partners` gained: `default_commission_pct` (defaults to 1%), `bank_account_number` + `bank_ifsc` (sensitive — masked in UI via `SensitiveField`), `portal_token`, `lifetime_referrals`, `lifetime_commission`.

**Trigger:** `fn_auto_create_referral_payout` fires on `leads` UPDATE when `status` transitions to `'won'` and `channel_partner_id` is set. **Important** — mig 134 (2026-05-24 review fixes) repaired this trigger after the original mig 131 shipped doubly broken: it referenced `NEW.stage` (no such column — leads has `status`) and `partner_type = 'internal'` (no such enum value — the canonical flag is `is_internal BOOLEAN` from mig 109). Both fixes landed in mig 134; the trigger now skips internal partners (Vivek seed + Management Referral seed) correctly.

**Server actions** (`apps/erp/src/lib/referral-actions.ts`): `approveReferralPayout` (CAS on status='pending'), `rejectReferralPayout` (with reason), `markReferralPaid` (records `payment_reference`, then calls `increment_partner_commission` RPC added in mig 134 to atomically bump `lifetime_commission`).

**Pages:** `/referrals` (founder + finance + marketing_manager) — KPI strip (pending count + this-month commission + lifetime) + 3-tab table (Pending / Approved / Paid) + per-row Approve/Reject/Pay dialogs. `/referrals/partners/[id]` — per-partner detail with full payout history, bank account masked via `SensitiveField` (founder/HR can click eye icon to reveal & copy for NEFT).

### F7 — Customer proposal portal (`/p/[token]`)
**Migration 133** introduced `proposal_share_tokens` (id, proposal_id FK, token TEXT UNIQUE, expires_at, viewed_count, last_viewed_at, last_viewed_ip, created_by). RLS added in mig 134 (the original shipped without).

**Public page** at `apps/erp/src/app/(public)/p/[token]/page.tsx` uses the admin client (no auth) to validate the 256-bit hex token, gates on `expires_at > NOW()`, and increments `viewed_count` + logs IP best-effort. The page renders a customer-facing proposal summary (number, system size, total, expiry) — no internal pricing, no employee names.

**Server actions** (`apps/erp/src/lib/proposal-share-actions.ts`): `createProposalShareToken(proposalId, days)` returns a magic link `${NEXT_PUBLIC_ERP_URL}/p/<token>`; `acceptProposalFromPortal(token)` validates the token, CAS-updates `proposals.status='accepted'`, and emits `proposal.accepted_by_customer` so the lead owner can be paged.

**PDF download** at `/p/[token]/pdf` route signs `proposal-files/<current_pdf_storage_path>` for 15 minutes and 302-redirects the browser.

**Customer portal env vars (optional):**
- `NEXT_PUBLIC_SHIROI_WHATSAPP` — if set, the "Ask a question" button + footer phone shows the real WhatsApp number. Defaults to empty (button hidden) rather than the previous placeholder `+919876543210`.

## Past Decisions & Specs

- `docs/superpowers/specs/2026-04-04-pm-leads-proposals-design.md` — initial leads/proposals redesign
- `docs/superpowers/plans/2026-04-06-marketing-redesign.md` — stage-based pipeline
- `docs/superpowers/plans/` — marketing + design revamp plan (April 15)
- **Migrations 051–053** — marketing + design revamp (enum additions, schema + triggers + RLS, seed)
- **Migration 055** — FK fix on `log_lead_status_change` + won→proposal→project cascade trigger + `employees.is_active` fix
- **Migration 056** — FK fix on `log_proposal_status_change` (dormant bug surfaced by 055's new trigger); column-config status options reconciled
- **Migration 088** — `leads_update` RLS expanded to include `sales_engineer` (aligns with `leads_insert` / `leads_read` and documented role access). Closes silent-RLS-failure footgun where unassigned leads appeared to update successfully but did not.
- **Proposal PDF revamp** (May 20): rebuilt the May-19 placeholder PDFs to match Shiroi's actual 3-year customer-facing format. Analysis of 24 `.docx` files from `Drive/Proposals YYYY/*` (2022–2025/26 via service-account) surfaced two canonical templates — Class A (Detailed, 7 pages) and Class B (Quick, 4 pages) — that are now compiled from 11 shared/mode-specific page components under `apps/erp/src/lib/pdf/proposal/`. Cover, 14-row Technical Specification BOM table, and brand footer are shared. Detailed adds Executed Project (4-sector past-client grid, hardcoded in `quote-constants.ts`), System Sizing & Production, Scope of Work, Terms & Conditions, Documents Needed. Quick adds Pricing (Supply + Services split), Note, Account Details (bank + GSTIN). Fixed long-standing legal-name regression: cover now correctly reads "SHIROI ENERGY LLP" instead of "Private Limited". Spec: `2026-05-20-proposal-format-revamp-design.md`. Sample analysis: `scripts/data/proposal-samples/docx/_summary.md` (gitignored).
- **Migration 111** — `system_settings` singleton + org-wide proposal-gate toggle (May 20): scope-correction follow-up to mig 109. The per-lead `leads.proposal_gate_bypassed` from mig 109 is kept as a finer-grained tool; the new singleton `system_settings.proposal_gate_enabled` is the org-wide kill switch that founder flips in `/settings → System` during historical-cleanup phases. `fn_block_lead_won_without_proposal` checks both: per-lead bypass first, then org-wide flag, then proposal existence. Amber site-wide banner (`<ProposalGateBanner />`, server component) renders on dashboard + /sales + lead detail layout while the gate is OFF, so the disabled state is impossible to forget.
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
