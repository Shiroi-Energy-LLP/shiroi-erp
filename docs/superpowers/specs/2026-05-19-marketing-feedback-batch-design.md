# Marketing Feedback Batch — Design (May 19, 2026)

> Vivek surfaced 10 issues across the /sales pipeline page, Prem's dashboard, follow-up tasks, the quote-gate rule, and the Quick Quote PDF. Bundled into one batch so we can ship them overnight on a single migration.
>
> Companion plan: `docs/superpowers/plans/2026-05-19-marketing-feedback-batch.md`.

## Goal

Clear the marketing-side rough edges before Prem and the team are turned loose on `/sales` for live cleanup of historical leads. Mix of bug fixes (silent failures), one rule change (proposal gate becomes a flag, not a hard block), several new filters/widgets, a status-badge UX overhaul, and a Quick Quote PDF that matches the detailed proposal's brand format.

## Scope (the 10 issues, restated)

| # | Issue | Type |
|---|-------|------|
| 1 | Bulk select can change ONE lead status, not many | Bug |
| 2 | Want to bypass "must have proposal to mark Won" so historical cleanup is unblocked | Rule toggle |
| 3 | Some leads with a detailed quote still can't go to Won — closure-band red blocks them | Investigative bug |
| 4 | Expected order date doesn't reflect leads closing this week on Prem's dashboard | Bug (RPC scope) |
| 5 | Next-follow-up date doesn't auto-create a task; team tasks assigned to Prem don't appear on his My Tasks | Bug × 2 |
| 6 | Need multi-status filter, kWp-range filter, and closure-date filter on `/sales` | Feature |
| 7 | Status badges + leads-page UX are mediocre — colours, font, overflow | UX overhaul |
| 8 | "Closing this week / this month" KPIs should be clickable, show total kWp + total ₹ | Feature |
| 9 | Need filter for "referred by Vivek / Management" | Feature |
| 10 | Quick Quote PDF should look like the current (detailed) proposal | Feature |

## Approach (high-level)

One spec, one plan, one migration (109), one branch off `main` → land in `main` after CI is green. Group work into 6 phases run partially in parallel (Phases A and B can run in parallel; C, D, E run sequentially after A so they can build on each other).

### Phase A — Quick bugs (parallel-safe)

**A1: Wire the existing `BulkActionBar`** — `LeadsTableWrapper` currently renders only a count span. Replace with the real `BulkActionBar`, pipe `selectedLeads` + `employees` through from `/sales/page.tsx`. Also fix `revalidatePath('/leads')` → `/sales` in `leads-actions.ts` (bulk action paths return to a route that 307-redirects, defeating the revalidate). `bulkChangeLeadStatus` already has `.select('id')` + 0-row detection from the May 1 RLS fix — keep it; surface the partial-update warning toast through `onActionComplete`.

**A2: Auto-create a follow-up task on status change** — `status-change.tsx` writes `next_followup_date` to the lead but never inserts into `tasks`. Add a server-action call (`createLeadTask`) right after the lead update succeeds: title = "Follow up with {customer_name}", `entity_type='lead'`, `entity_id=leadId`, `assigned_to=lead.assigned_to ?? caller`, `due_date=nextFollowupDate`, `category='lead_followup'`, `priority='medium'`. Same auto-create from the inline-edit cell when `next_followup_date` is changed there.

Idempotency: don't create a duplicate `lead_followup` task for the same `(lead_id, due_date)` pair — if one exists open, just update its `due_date` instead.

**A3: `getMyTasks` filter completed tasks out** — currently it orders by `is_completed ASC` but doesn't `.eq('is_completed', false)`. Result: an employee with 100+ completed tasks pushes their open tasks past the LIMIT 100 cap and "My Tasks" looks empty. Add the filter. The dedicated `/sales/tasks` view of completed tasks already exists via `?show=all`.

**A4: `get_expected_orders` widen status filter** — current RPC: `WHERE l.status IN ('negotiation','closure_soon')`. Vivek's complaint is "expected order date is not reflecting in orders closing this week". Root cause is one of two:
- Most active leads sit in `quick_quote_sent` / `detailed_proposal_sent` / `design_confirmed` and never get the chance to populate the card unless they advance to negotiation first.
- `expected_close_date` is not in the lead-creation form — Prem has to set it manually on the table, which he hasn't been doing.

Fix both: (a) RPC widens to `status IN ('quick_quote_sent','detailed_proposal_sent','design_confirmed','negotiation','closure_soon')` — the "expected to close" interpretation now matches the user's intuition; (b) add an `expected_close_date` input to `/sales/new` form and to the lead-detail Contact Info section, with sane defaults (e.g. when status moves to `negotiation`, default to +14d if NULL).

Both fixes ship in migration 109.

### Phase B — Rule changes (one migration)

**B1: Proposal gate becomes bypass-able** — Mig 107's `fn_block_lead_won_without_proposal` is the right rule for new business but blocks Prem's planned cleanup of historical Won leads that don't have a proposal in ERP. Add `leads.proposal_gate_bypassed BOOLEAN NOT NULL DEFAULT FALSE` and skip the check when it's TRUE. UI: add a small "Skip proposal gate" toggle in the lead-detail header (visible only to `founder` + `marketing_manager`), with a clear warning that this is for data cleanup only. The trigger logic becomes:

```sql
IF NOT v_has_proposal AND NEW.proposal_gate_bypassed IS NOT TRUE THEN
  RAISE EXCEPTION ...
END IF;
```

**B2: Detailed-quote → Won path** — Investigation: `attemptWon()` requires the lead to be in `closure_soon` or `negotiation`, then calls `computeMargin()`. If the lead has a detailed proposal but no `base_quote_price` on the lead and the proposal's BOM lines have NULL `raw_estimated_cost` (common for AI-extracted / imported proposals), `computeMargin` returns `bomCost=0`, `basePrice=0`, and `computeSnapshotFromValues(0, 0, 0)` returns a margin of either NaN/0 → band='red' → blocked. Vivek surfaced this as "what's the rule for having a quote in the detailed quote thing?" — the rule is hidden in the helpers and effectively excludes proposals lacking BOM cost data.

Fix in two parts:
- **Closure-band fallback**: when `bomCost=0` (no usable BOM cost data) AND `basePrice > 0`, return `band='green'` (no way to know real margin, treat as healthy and let the founder eyeball it). Add a banner on the `closure-band-badge` that says "BOM cost not captured — margin not computed". This is honest about data quality without blocking the won transition.
- **Skip-margin path**: founder + marketing_manager can click "Mark Won (skip margin)" on any lead in `negotiation`/`closure_soon`, which writes `leads.margin_skipped_at` + bypasses `attemptWon` entirely (direct status UPDATE; the DB trigger still runs for proposal acceptance). Audit-logged.

### Phase C — Filters + clickable closing metric (sales page)

**C1: Multi-status filter** — `getLeads(filters.status)` currently accepts a single `LeadStatus`. Make it accept `LeadStatus[]` (or comma-separated string in the URL). FilterSelect → FilterMultiSelect for the status param. STAGE_LABELS already exists as the single source of truth.

**C2: kWp range filter** — Two new URL params: `kwpMin` + `kwpMax`. Two `Input type="number"` controls in the filter bar. `getLeads` applies `.gte('estimated_size_kwp', kwpMin)` + `.lte('estimated_size_kwp', kwpMax)`. Add an index on `leads.estimated_size_kwp` (NEVER-DO #17).

**C3: Closure date filter** — Two URL params: `closeFrom` + `closeTo`. Range inputs (date pickers). Apply `.gte('expected_close_date', closeFrom)` + `.lte('expected_close_date', closeTo)`. Existing index from mig 020 covers it.

**C4: Referred-by-Vivek/Management filter** — Background: `channel_partners.partner_type` includes `referral` (mig 052). Vivek + senior staff who refer leads should exist as `channel_partners` rows of type `referral`. Add a new URL param `referrer` accepting a `channel_partner_id` or the sentinel `vivek_mgmt`. If `vivek_mgmt`, the query filters to `channel_partner_id IN (SELECT id FROM channel_partners WHERE partner_type='referral' AND name ILIKE '%vivek%' OR is_internal=TRUE)`.

To keep it clean, mig 109 adds `channel_partners.is_internal BOOLEAN NOT NULL DEFAULT FALSE` and seeds:
- "Vivek Sridhar (Founder)" as `partner_type='referral'`, `is_internal=TRUE`
- "Management Referral" as `partner_type='referral'`, `is_internal=TRUE` (catch-all)

The filter dropdown becomes: "All Sources / Vivek / Management / [list of external referrers]". Sales source filter (`?source=referral`) stays as-is; this is the second narrower filter.

**C5: Clickable Closing-This-Week + Closing-This-Month** — `PipelineSummary` currently shows `closingThisWeekCount` as plain text. Make both KPI cards clickable links to `/sales?closeFrom=...&closeTo=...&kwpMin=&status=(not closed)`. Also add a 4th card pair showing `total_kwp` + `total_value`. RPC `get_pipeline_close_window(start, end)` returns `(count, total_kwp, total_value)` in one round-trip — computed in SQL (NEVER-DO #12). Show the breakdown inline on the card; clicking opens the filtered table.

### Phase D — Leads page UX overhaul

The current `LeadStatusBadge` uses generic UI variants (`info`, `pending`, `warning`, `success`, `error`, `neutral`) — there are 12 lead statuses but only 6 variants, so multiple statuses share a colour and the visual scanning collapses. Long labels like "Detailed Proposal Sent" overflow the badge.

**D1: Dedicated status colour palette** — replace `STATUS_VARIANT` with 12 distinct tokens defined in the badge component:
- `new` → slate-100 / slate-700
- `contacted` → blue-100 / blue-700
- `quick_quote_sent` → cyan-100 / cyan-800
- `site_survey_scheduled` → amber-50 / amber-700
- `site_survey_done` → amber-100 / amber-800
- `design_in_progress` → indigo-100 / indigo-700
- `design_confirmed` → indigo-200 / indigo-900
- `detailed_proposal_sent` → violet-100 / violet-800
- `negotiation` → orange-100 / orange-800
- `closure_soon` → emerald-50 / emerald-800 with a left dot indicator
- `won` → emerald-200 / emerald-900 (kept distinct from closure_soon)
- `lost` → rose-100 / rose-700
- `on_hold` → zinc-200 / zinc-700
- `disqualified` → rose-50 / rose-900 (rare, dim)

These are direct Tailwind classes (already in tree). Type-safe map keyed by `LeadStatus`.

**D2: Short labels for badges** — `STAGE_LABELS` keeps the long readable form for dropdowns. Add `STAGE_LABELS_SHORT` for badge use:
- "Detailed Proposal Sent" → "Detailed Sent"
- "Quick Quote Sent" → "Quick Sent"
- "Survey Scheduled" → "Survey Sched"
- "Design In Progress" → "Design WIP"
- etc.

Badges use `font-medium` 11px tabular, `px-2 py-0.5`, max-width clamp with `truncate`. No more overflow.

**D3: Leads table polish** — minor moves only (don't rebuild what's working):
- Sticky header on scroll
- Tighter row padding (currently 12px → 8px)
- Customer name in `font-medium` (was regular)
- Phone in `tabular-nums` so column lines up
- Right-align the kWp + ₹ columns
- Hover-row affordance (`bg-n-50/60`)
- Selection checkbox column gets `w-8` and a faint left border to separate from data

Out of scope: column reordering, drag-to-resize, virtualization, theme switcher.

### Phase E — Quick Quote PDF matches detailed proposal

Today: `BudgetaryQuotePDF` is a short single-page output (~50 lines of components); `DetailedProposalPDF` is a 10-page branded document (Cover, About, System, Savings, BOM summary, Scope, Payment, Warranty, T&C, References).

Vivek's request: "Make the quick quote as close to our current proposal." The current proposal in this context = the detailed proposal — that's what customers receive today.

**E1: Multi-page BudgetaryQuotePDF** — rewrite to share pages with DetailedProposalPDF:
- **Page 1 (Cover)**: identical brand bar, SHIROI logotype, proposal number, date, customer
- **Page 2 (About Shiroi)**: same About content used by detailed
- **Page 3 (System Overview)**: kWp, system type, structure type, expected generation (PVWatts call already exists for detailed — reuse), short description
- **Page 4 (Savings)**: reuse `SavingsPage` component
- **Page 5 (Investment Summary)**: high-level cost breakdown (panels, inverter, balance-of-system, installation, optional liaison, optional civil) — NOT the line-item BOM that detailed has (Quick Quote stays "budgetary")
- **Page 6 (Payment Schedule)**: standard 30/40/20/10 Shiroi schedule with placeholder dates (detailed has real dates from `proposal_payment_schedule`)
- **Page 7 (Warranty + T&C)**: same content
- **Page 8 (Why Shiroi)**: same references / about-the-team page

The "budgetary" framing stays — visible disclaimer on Page 1 ("Budgetary estimate — subject to site survey") and on Page 5 ("Final pricing confirmed post-survey"). All shared sub-components extracted to `apps/erp/src/lib/pdf/shared-pages.tsx` to keep both PDFs in sync going forward.

E1 is the biggest single piece in the batch — about half the line-change budget. Worth doing in its own subagent.

### Phase F — Discipline gates + docs + push

Sequence: `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh` → update CHANGELOG / CURRENT_STATUS / docs/modules/sales.md → commit → `git push origin main`.

## Data model changes (migration 109)

```sql
-- 1. proposal gate bypass
ALTER TABLE leads ADD COLUMN proposal_gate_bypassed BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN leads.proposal_gate_bypassed IS
  'When TRUE, fn_block_lead_won_without_proposal allows Won without a proposal. For historical cleanup only — toggle in lead header (founder/marketing_manager).';

-- 2. margin-skip audit (closure band)
ALTER TABLE leads
  ADD COLUMN margin_skipped_at TIMESTAMPTZ,
  ADD COLUMN margin_skipped_by UUID REFERENCES employees(id);

-- 3. Update gate trigger
CREATE OR REPLACE FUNCTION fn_block_lead_won_without_proposal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_has_proposal BOOLEAN;
BEGIN
  IF NEW.status != 'won' OR OLD.status = 'won' THEN RETURN NEW; END IF;
  IF NEW.proposal_gate_bypassed IS TRUE THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM proposals WHERE lead_id = NEW.id) INTO v_has_proposal;
  IF NOT v_has_proposal THEN
    RAISE EXCEPTION 'Cannot mark lead as Won without a proposal. ...';
  END IF;
  RETURN NEW;
END $$;

-- 4. Widen get_expected_orders status filter
CREATE OR REPLACE FUNCTION get_expected_orders(window_days INT)
RETURNS TABLE(...) LANGUAGE sql STABLE AS $$
  SELECT ...
  FROM leads l
  WHERE l.status IN ('quick_quote_sent','detailed_proposal_sent','design_confirmed','negotiation','closure_soon')
    AND l.deleted_at IS NULL
    AND l.expected_close_date IS NOT NULL
    AND l.expected_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + window_days
  ORDER BY l.expected_close_date ASC NULLS LAST,
           COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000) DESC NULLS LAST;
$$;

-- 5. Pipeline close-window aggregate RPC (for clickable card breakdown)
CREATE OR REPLACE FUNCTION get_pipeline_close_window(start_date DATE, end_date DATE)
RETURNS TABLE(lead_count INT, total_kwp NUMERIC(12,2), total_value NUMERIC(14,2))
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::INT AS lead_count,
    COALESCE(SUM(estimated_size_kwp), 0)::NUMERIC(12,2) AS total_kwp,
    COALESCE(SUM(COALESCE(base_quote_price, estimated_size_kwp * 60000)), 0)::NUMERIC(14,2) AS total_value
  FROM leads
  WHERE status NOT IN ('won','lost','disqualified','converted')
    AND deleted_at IS NULL
    AND is_archived = FALSE
    AND expected_close_date BETWEEN start_date AND end_date;
$$;

-- 6. Index for kWp range filter
CREATE INDEX IF NOT EXISTS idx_leads_estimated_size_kwp
  ON leads(estimated_size_kwp)
  WHERE deleted_at IS NULL AND is_archived = FALSE;

-- 7. is_internal flag on channel_partners + seeds
ALTER TABLE channel_partners ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO channel_partners(name, partner_type, is_internal, ...) VALUES
  ('Vivek Sridhar (Founder)', 'referral', TRUE, ...),
  ('Management Referral',     'referral', TRUE, ...)
ON CONFLICT DO NOTHING;
```

## File ownership (which subagent does what)

| Files | Phase | Agent |
|------|-------|------|
| `apps/erp/src/components/leads/leads-table-wrapper.tsx`, `apps/erp/src/lib/leads-actions.ts`, `apps/erp/src/lib/leads-task-actions.ts`, `apps/erp/src/components/leads/status-change.tsx`, `apps/erp/src/lib/inline-edit-actions.ts`, `apps/erp/src/lib/tasks-queries.ts` | A | Sonnet subagent 1 |
| `supabase/migrations/109_marketing_feedback_batch.sql`, `apps/erp/src/lib/closure-actions.ts`, `apps/erp/src/lib/closure-helpers.ts`, `apps/erp/src/components/sales/closure-band-badge.tsx`, `apps/erp/src/app/(erp)/sales/[id]/layout.tsx` (gate-bypass toggle) | B | Sonnet subagent 2 |
| `apps/erp/src/app/(erp)/sales/page.tsx`, `apps/erp/src/lib/leads-queries.ts`, `apps/erp/src/components/data-table/column-config.ts`, `apps/erp/src/components/leads/pipeline-summary.tsx`, `apps/erp/src/components/leads/lead-form.tsx`, new `apps/erp/src/components/filter-multi-select.tsx`, new `apps/erp/src/components/filter-range.tsx` | C | Sonnet subagent 3 |
| `apps/erp/src/components/leads/lead-status-badge.tsx`, `apps/erp/src/lib/leads-helpers.ts` (add STAGE_LABELS_SHORT), `apps/erp/src/components/data-table/data-table.tsx` (row polish) | D | Sonnet subagent 4 |
| `apps/erp/src/lib/pdf/budgetary-quote-pdf.tsx`, new `apps/erp/src/lib/pdf/shared-pages.tsx`, light refactor in `apps/erp/src/lib/pdf/detailed-proposal-pdf.tsx` to consume shared pages | E | Sonnet subagent 5 |
| `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh`, `docs/CHANGELOG.md`, `docs/CURRENT_STATUS.md`, `docs/modules/sales.md`, git commit + push | F | Main session (Vivek-reviewed) |

A and B can run in parallel; C/D/E sequentially after them (they touch overlapping files in `components/leads/`).

## Verification

- `pnpm check-types` → 0 errors
- `pnpm lint` → 0 warnings
- `scripts/ci/check-forbidden-patterns.sh` → baseline ≤ 66
- Mig 109 applies clean on dev (via Supabase MCP)
- Manual smoke: select 5 leads → bulk change status to `on_hold` → all 5 update
- Manual smoke: change one lead to `contacted` + set follow-up = +3d → task auto-appears in /sales/tasks AND in Prem's My Tasks
- Manual smoke: gate-bypass toggle → mark Won without a proposal → succeeds
- Manual smoke: filter by status=[negotiation, closure_soon], kWp 5-15 → URL preserves all params
- Manual smoke: click "Closing This Week" card → land on filtered /sales view
- Manual smoke: PDF for a quick quote = 8 pages, matches detailed proposal format

## Out of scope

- Mobile-responsive lead list (deferred — desktop is the primary)
- Lead-card kanban view (different conversation)
- Refactor `LeadsTableWrapper` to use `ActionResult<T>` (separate sweep)
- Real-time pipeline updates (no `useRealtimeChannel` setup yet)
- Touching the proposal-acceptance trigger chain (mig 055/094 — orthogonal)

## Risks

- **Status filter widening on `get_expected_orders`** may flood the card with leads that aren't truly close. Mitigation: the existing `ORDER BY expected_close_date ASC` + the 7/30 day window keeps the visible set small. If Vivek reports noise, narrow back.
- **Closure-band fallback going to `green` when BOM is empty** could let unprofitable historical leads close without scrutiny. Mitigation: explicit banner on the badge ("BOM cost not captured — margin not computed"), and the founder approval flow still exists for amber band when data IS present.
- **Bulk status change** can fire RLS-blocked updates silently if any selected lead is outside the user's row scope. Mitigation: `bulkChangeLeadStatus` already does `.select('id')` and reports partial-update count — surface this through the toast (today it's swallowed).
- **Multi-page Quick Quote PDF** is heavier to render — adds ~500ms per call. Acceptable for an explicit user action; not on hot path.

## Past decisions referenced

- Mig 055 — won-cascade trigger
- Mig 094 — `get_expected_orders` RPC
- Mig 107 — proposal-gate trigger (now bypass-able)
- Mig 052 — closure-band system
- Sales module doc — STAGE_LABELS single source of truth
