# Marketing Feedback Batch — Implementation Plan (May 19, 2026)

> Companion to `docs/superpowers/specs/2026-05-19-marketing-feedback-batch-design.md`.
> Built for overnight execution by Sonnet subagents working in parallel.

## Phasing

```
                 ┌── Phase A (bugs) ──┐
Phase 0 (mig 109)│                    │── Phase D (UX) ── Phase E (PDF) ── Phase F (ship)
                 └── Phase B (rule)  ─┴── Phase C (filters) ──┘
```

Phase 0 (the SQL migration) and Phases A + B can dispatch in parallel.
Phase C depends on Phase 0 (consumes new RPC + columns).
Phase D depends on nothing structural; safest to run after C to avoid merge churn in `column-config.ts`.
Phase E is independent of A–D but pulled last to keep failures isolated.
Phase F runs after everything else lands.

## Phase 0 — Migration 109

**File:** `supabase/migrations/109_marketing_feedback_batch.sql`

```sql
BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- 1. leads.proposal_gate_bypassed — historical cleanup escape hatch
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS proposal_gate_bypassed BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN leads.proposal_gate_bypassed IS
  'When TRUE, fn_block_lead_won_without_proposal allows Won without a proposal. For historical cleanup only.';

-- ───────────────────────────────────────────────────────────────────
-- 2. leads.margin_skipped_at + margin_skipped_by — closure-band audit
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS margin_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS margin_skipped_by UUID REFERENCES employees(id) ON DELETE SET NULL;

-- ───────────────────────────────────────────────────────────────────
-- 3. fn_block_lead_won_without_proposal — honour the bypass flag
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_block_lead_won_without_proposal()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE v_has_proposal BOOLEAN;
BEGIN
  IF NEW.status != 'won' OR OLD.status = 'won' THEN RETURN NEW; END IF;
  IF NEW.proposal_gate_bypassed IS TRUE THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM proposals WHERE lead_id = NEW.id) INTO v_has_proposal;
  IF NOT v_has_proposal THEN
    RAISE EXCEPTION
      'Cannot mark lead as Won without a proposal. Create a Quick Quote (Path A) or a detailed proposal (Path B) first, or set proposal_gate_bypassed=TRUE for historical cleanup.'
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $func$;

-- ───────────────────────────────────────────────────────────────────
-- 4. Widen get_expected_orders status filter
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_expected_orders(window_days INT)
RETURNS TABLE (
  lead_id UUID,
  customer_name TEXT,
  status lead_status,
  estimated_size_kwp NUMERIC(10,2),
  base_quote_price NUMERIC(14,2),
  derived_value NUMERIC(14,2),
  expected_close_date DATE,
  close_probability INT,
  days_until INT
)
LANGUAGE sql STABLE AS $$
  SELECT
    l.id,
    l.customer_name,
    l.status,
    l.estimated_size_kwp,
    l.base_quote_price,
    COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000)::NUMERIC(14,2) AS derived_value,
    l.expected_close_date,
    l.close_probability,
    GREATEST(0, l.expected_close_date - CURRENT_DATE)::int AS days_until
  FROM leads l
  WHERE l.status IN ('quick_quote_sent','detailed_proposal_sent','design_confirmed','negotiation','closure_soon')
    AND l.deleted_at IS NULL
    AND l.is_archived = FALSE
    AND l.expected_close_date IS NOT NULL
    AND l.expected_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + window_days
  ORDER BY l.expected_close_date ASC NULLS LAST,
           COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000) DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION get_expected_orders(INT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 5. get_pipeline_close_window — clickable-card aggregate
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_pipeline_close_window(start_date DATE, end_date DATE)
RETURNS TABLE(lead_count INT, total_kwp NUMERIC(12,2), total_value NUMERIC(14,2))
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::INT,
    COALESCE(SUM(estimated_size_kwp), 0)::NUMERIC(12,2),
    COALESCE(SUM(COALESCE(base_quote_price, estimated_size_kwp * 60000)), 0)::NUMERIC(14,2)
  FROM leads
  WHERE status NOT IN ('won','lost','disqualified','converted')
    AND deleted_at IS NULL
    AND is_archived = FALSE
    AND expected_close_date BETWEEN start_date AND end_date;
$$;
GRANT EXECUTE ON FUNCTION get_pipeline_close_window(DATE, DATE) TO authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 6. Index for kWp range filter
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_estimated_size_kwp
  ON leads(estimated_size_kwp)
  WHERE deleted_at IS NULL AND is_archived = FALSE;

-- ───────────────────────────────────────────────────────────────────
-- 7. channel_partners.is_internal — Vivek/Management referrer flag
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN channel_partners.is_internal IS
  'TRUE for in-house referrers (Vivek, Management). Used by the /sales referrer filter.';

-- Seed Vivek + Management referral rows if not present (idempotent)
INSERT INTO channel_partners (id, name, partner_type, is_internal, commission_pct, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(), 'Vivek Sridhar (Founder)', 'referral', TRUE, 0, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM channel_partners WHERE is_internal=TRUE AND name ILIKE '%vivek%'
);

INSERT INTO channel_partners (id, name, partner_type, is_internal, commission_pct, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(), 'Management Referral', 'referral', TRUE, 0, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM channel_partners WHERE is_internal=TRUE AND name = 'Management Referral'
);

COMMIT;
```

**Verification after apply:**
- `SELECT proposal_gate_bypassed FROM leads LIMIT 1` → returns FALSE
- `SELECT * FROM get_expected_orders(7) LIMIT 5` → returns rows
- `SELECT * FROM get_pipeline_close_window(CURRENT_DATE, CURRENT_DATE + 30)` → 1 row
- `SELECT name, is_internal FROM channel_partners WHERE is_internal=TRUE` → 2 rows (Vivek + Management)

After applying mig 109 via Supabase MCP, regenerate types via `pnpm typegen` (or wait for the dispatched subagent to handle it).

## Phase A — Quick bugs

### A1 — Wire BulkActionBar

**File:** `apps/erp/src/components/leads/leads-table-wrapper.tsx`

Current state: renders only a `<span>{selectedIds.length} selected</span>` in `bulkActions`. Replace with full `BulkActionBar`. Page needs to pass `employees` list down — easiest: have `LeadsTableWrapper` accept `employees` prop, page already calls `getSalesEngineers()` (used elsewhere on the page, just plumb it through).

Steps:
1. `apps/erp/src/app/(erp)/sales/page.tsx` — call `getSalesEngineers()` in the parallel `Promise.all`, pass `employees` to `<LeadsTableWrapper>`.
2. `apps/erp/src/components/leads/leads-table-wrapper.tsx` — accept `employees` prop. Compute `selectedLeads` (filter `data` by `selectedIds`). Render `<BulkActionBar>` when `selectedIds.length > 0`, passing `selectedIds`, `selectedLeads`, `employees`, `onClear={() => setSelectedIds([])}`, `onActionComplete={() => { setSelectedIds([]); router.refresh(); }}`.
3. `apps/erp/src/lib/leads-actions.ts` — change `revalidatePath('/leads')` to `revalidatePath('/sales')` in `bulkAssignLeads`, `bulkChangeLeadStatus`, `bulkDeleteLeads`. Keep `/leads` revalidate too if needed; better: revalidate both.
4. In `BulkActionBar`, surface partial-update toasts: if `result.error` is set BUT `result.success` is true (partial update), show a warning toast — currently swallowed.

### A2 — Auto-create follow-up task on status change

**Files:** `apps/erp/src/lib/leads-task-actions.ts` (new function), `apps/erp/src/components/leads/status-change.tsx`, `apps/erp/src/lib/inline-edit-actions.ts`.

New action `upsertLeadFollowupTask(leadId, dueDate)`:
- Look up lead → grab `assigned_to`, `customer_name`.
- Look up caller's employee record (for `created_by` if `assigned_to` is NULL).
- Check for existing open task: `tasks WHERE entity_type='lead' AND entity_id=leadId AND category='lead_followup' AND is_completed=FALSE AND deleted_at IS NULL`.
- If found, UPDATE the `due_date` (don't create a duplicate).
- Else INSERT new task with category='lead_followup', priority='medium', title='Follow up with {customer_name}'.
- Revalidate `/sales/tasks` + `/dashboard` + `/sales/[id]/tasks`.

Call site 1: `status-change.tsx` after the `select('id')` confirms the update landed, before `router.refresh()`. Only call when `nextFollowupDate` is set.

Call site 2: `inline-edit-actions.ts` `updateCellValue` — when `field === 'next_followup_date'` and `value` is a non-empty date, call `upsertLeadFollowupTask`.

### A3 — `getMyTasks` filter completed

**File:** `apps/erp/src/lib/tasks-queries.ts`

Add `.eq('is_completed', false)` to the `getMyTasks` query. The dedicated /sales/tasks?show=all view still shows completed.

### A4 — Lead form `expected_close_date` input + status-change default

**File:** `apps/erp/src/components/leads/lead-form.tsx`

Add an optional `expected_close_date` field (date input) to the form, default empty. Pass through to the insert.

**File:** `apps/erp/src/components/leads/status-change.tsx`

When the user moves a lead to `negotiation` or `closure_soon` AND `expected_close_date` is currently NULL, set it to `today + 14d` by default (computed client-side). The user can override.

**Verification:**
- Type-check passes.
- Manual: bulk-select 3 leads, change status to `on_hold` → all 3 reflect immediately.
- Manual: change a lead to `contacted`, set follow-up 3 days out → task appears in `/sales/tasks`.
- Manual: complete every other open task for Prem → 100+ done tasks → his My Tasks still shows open ones.

## Phase B — Rule change (closure band + gate bypass UI)

### B1 — Gate bypass UI

**File:** `apps/erp/src/app/(erp)/sales/[id]/layout.tsx`

Add a small "Skip proposal gate" toggle in the lead header, visible only to founder + marketing_manager. When toggled, calls a new server action `toggleProposalGateBypass(leadId, value)` which writes `leads.proposal_gate_bypassed`. Show a small amber warning chip next to the toggle when on: "Data cleanup mode — proposal not required for Won."

The toggle lives in the existing amber "no proposal" banner (already conditionally rendered) — add a "Skip this gate" button to that banner.

### B2 — Closure-band fallback for empty BOM

**Files:** `apps/erp/src/lib/closure-actions.ts`, `apps/erp/src/lib/closure-helpers.ts`, `apps/erp/src/components/sales/closure-band-badge.tsx`

In `computeMargin`, when `bomCost === 0` AND `basePrice > 0` (we have a price but no cost data), return a `MarginSnapshot` with `band='green'`, `grossMargin=null`, and a new `dataQuality: 'no_bom_cost'` field. Update the type.

`closure-band-badge.tsx` reads `dataQuality` and shows a small "ⓘ BOM cost not captured" subnote in italic when `'no_bom_cost'`.

`attemptWon` honours `band='green'` as before — no change to that flow.

### B3 — Mark Won (skip margin) button

**File:** `apps/erp/src/components/sales/attempt-won-button.tsx` (or a sibling)

Founder + marketing_manager only. Visible alongside the existing AttemptWon button. Calls a new server action `markWonSkipMargin(leadId)`:
- Verify role
- UPDATE lead SET status='won', margin_skipped_at=now(), margin_skipped_by=caller
- Audit-log via existing `lead_status_history` trigger chain
- Returns OK

Banner copy on the button: "Bypass margin check (cleanup)".

**Verification:**
- Open a lead in `negotiation` with no proposal → toggle "Skip proposal gate" → mark Won → succeeds, project still spawns if proposal cascade can find one (else lead just goes Won).
- Open a lead with a detailed proposal but no BOM cost data → closure-band badge shows "BOM cost not captured" subnote → green band → AttemptWon succeeds.

## Phase C — Filters + clickable closing metric

### C1 — Multi-status filter

**Files:** `apps/erp/src/app/(erp)/sales/page.tsx`, `apps/erp/src/lib/leads-queries.ts`, new `apps/erp/src/components/filter-multi-select.tsx`

URL contract: `?status=new,contacted,negotiation` (comma-separated). `getLeads` accepts `status?: LeadStatus | LeadStatus[]`. New `FilterMultiSelect` component — a popover with checkboxes, label "All Statuses (3)", clears via X.

### C2 — kWp range filter

URL contract: `?kwpMin=5&kwpMax=15`. New `FilterRange` component with two number inputs and a label.

`getLeads` applies `.gte` / `.lte`.

### C3 — Closure-date range filter

URL contract: `?closeFrom=2026-05-20&closeTo=2026-06-30`. Two date inputs.

### C4 — Referrer filter (Vivek/Management)

New query `getInternalReferrers()` → returns `channel_partners WHERE is_internal=TRUE`.

Filter dropdown options:
- "All Sources"
- "Vivek (Founder)"
- "Management"
- "External partners" (further drill)

URL contract: `?referrer=<channel_partner_id>` or `?referrer=internal_all`.

`getLeads` applies the FK filter.

### C5 — Clickable Closing-This-Week + breakdown

**File:** `apps/erp/src/components/leads/pipeline-summary.tsx`

Replace plain text with a `<Link>` to `/sales?closeFrom={weekStart}&closeTo={weekEnd}&status=quick_quote_sent,detailed_proposal_sent,design_confirmed,negotiation,closure_soon`. Add a similar "This Month" card.

Card body shows the count, the total kWp, the total ₹ — all from a new `get_pipeline_close_window` call.

`/sales/page.tsx` calls `get_pipeline_close_window(weekStart, weekEnd)` + same for month, passes both to `PipelineSummary`.

**Verification:**
- URL `?status=new,contacted` → both statuses checked, results filtered.
- URL `?kwpMin=5&kwpMax=15` → only mid-size leads.
- Click "Closing This Week" KPI → land on `/sales` pre-filtered.

## Phase D — Status badge + leads-page UX

### D1 — New status colour palette

**File:** `apps/erp/src/components/leads/lead-status-badge.tsx`

Drop `Badge` import; build directly with Tailwind classes for full per-status control. Type-safe `STATUS_CLASSES` map keyed by `LeadStatus`.

```tsx
const STATUS_CLASSES: Record<LeadStatus, { bg: string; text: string; ring?: string }> = {
  new:                     { bg: 'bg-slate-100',   text: 'text-slate-700'  },
  contacted:               { bg: 'bg-blue-100',    text: 'text-blue-700'   },
  quick_quote_sent:        { bg: 'bg-cyan-100',    text: 'text-cyan-800'   },
  site_survey_scheduled:   { bg: 'bg-amber-50',    text: 'text-amber-700'  },
  site_survey_done:        { bg: 'bg-amber-100',   text: 'text-amber-800'  },
  design_in_progress:      { bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  design_confirmed:        { bg: 'bg-indigo-200',  text: 'text-indigo-900' },
  detailed_proposal_sent:  { bg: 'bg-violet-100',  text: 'text-violet-800' },
  proposal_sent:           { bg: 'bg-violet-50',   text: 'text-violet-600' },
  negotiation:             { bg: 'bg-orange-100',  text: 'text-orange-800' },
  closure_soon:            { bg: 'bg-emerald-50',  text: 'text-emerald-800', ring: 'ring-1 ring-emerald-300' },
  won:                     { bg: 'bg-emerald-200', text: 'text-emerald-900' },
  lost:                    { bg: 'bg-rose-100',    text: 'text-rose-700'   },
  on_hold:                 { bg: 'bg-zinc-200',    text: 'text-zinc-700'   },
  disqualified:            { bg: 'bg-rose-50',     text: 'text-rose-900'   },
  converted:               { bg: 'bg-zinc-100',    text: 'text-zinc-600'   },
};
```

Render: `<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums max-w-[140px] truncate {bg} {text} {ring}">{label}</span>`.

### D2 — Short labels

**File:** `apps/erp/src/lib/leads-helpers.ts`

Add `STAGE_LABELS_SHORT: Record<LeadStatus, string>` next to `STAGE_LABELS`. Long labels in dropdowns, short in badges.

### D3 — Table polish

**File:** `apps/erp/src/components/data-table/data-table.tsx`

Minimal touch-ups (do NOT rewrite the table):
- Sticky header: `<thead className="sticky top-0 z-10 bg-white">`
- Row padding: tighten cells from `py-3` → `py-2`
- Customer name column class gets `font-medium`
- Phone column class gets `tabular-nums`
- kWp + ₹ columns get `text-right tabular-nums`
- Row hover: `hover:bg-n-50/60`
- Selection checkbox column gets `w-8 border-r border-n-100`

If any of these classes are already in the column config, no-op.

**Verification:**
- `pnpm dev` → manual look at /sales → 12 statuses visible side-by-side with distinct colours
- No badge overflow (max-w-140px truncation kicks in for the longest)
- Table scrolls with sticky header

## Phase E — Quick Quote PDF matches detailed proposal

**Files:** `apps/erp/src/lib/pdf/budgetary-quote-pdf.tsx` (rewrite), new `apps/erp/src/lib/pdf/shared-pages.tsx`, light refactor in `apps/erp/src/lib/pdf/detailed-proposal-pdf.tsx`.

### E1 — Extract shared pages

Pull these page components out of `detailed-proposal-pdf.tsx` into a new `shared-pages.tsx`:
- `AboutShiroiPage`
- `WhyShiroiPage`
- `WarrantyAndTermsPage`
- (Cover and Footer stay per-file because of subtitle differences)

Each accepts `{ data: ProposalPDFData }`. `DetailedProposalPDF` imports + uses them as before — no visible change to detailed output.

### E2 — Rewrite BudgetaryQuotePDF

Replace the current 1-2 page output with this multi-page structure:

```tsx
<Document>
  <CoverPage data={data} subtitle="Budgetary Estimate" disclaimer="Subject to site survey" />
  <AboutShiroiPage data={data} />
  <SystemOverviewPage data={data} />
  <SavingsPage data={data} />      // reuse existing component
  <InvestmentSummaryPage data={data} />
  <PaymentScheduleStubPage data={data} />
  <WarrantyAndTermsPage data={data} />
  <WhyShiroiPage data={data} />
</Document>
```

`InvestmentSummaryPage` is new and budgetary-specific — high-level cost groups:
- Solar Panels (subtotal)
- Inverter (subtotal)
- Balance of System (cables, ACDB/DCDB, structure subtotal)
- Installation + Commissioning
- Optional: Liaison / Net Metering
- Optional: Civil Works
- ──────
- **Total Budgetary Estimate**

Pulls cost groups from `proposal_bom_lines` aggregated by category. No per-line detail (that's what the detailed proposal is for).

`PaymentScheduleStubPage` renders the standard Shiroi tranches (30% on order, 40% on material dispatch, 20% on installation, 10% on commissioning) WITHOUT specific dates — the detailed proposal page renders these with real dates.

### E3 — Smoke test

Hit `POST /api/proposals/{quick_quote_id}/generate-pdf` → PDF should be 8 pages, branded, with budgetary disclaimer on the cover.

## Phase F — CI + docs + push

1. `pnpm check-types` — 0 errors
2. `pnpm lint --max-warnings 0`
3. `bash scripts/ci/check-forbidden-patterns.sh` — baseline 66
4. `pnpm typegen` if not already run after mig 109 — verify `database.ts` has `proposal_gate_bypassed`, `is_internal`, `get_pipeline_close_window`
5. Update `docs/CHANGELOG.md` — one line summarising the batch
6. Update `docs/CURRENT_STATUS.md` — mark in-flight row complete, append note about migration 109
7. Update `docs/modules/sales.md` — note proposal-gate bypass, new filters, short status labels, multi-page quick quote
8. `git add` (specific files, never `-A`) → commit with co-author footer → `git push origin main`

## Subagent dispatch script

Five parallel Sonnet subagents — A, B, C, D, E. Each gets:
- A self-contained prompt (the relevant phase block above)
- A handoff note saying "edit only the files listed under your phase; coordinate via git if you hit conflicts"
- A pre-flight check: re-read the spec and the current state of any file before editing

A + B can run in parallel from a clean main checkout.
C + D + E run sequentially after A + B land (touch overlapping component files).

Main session handles F.
