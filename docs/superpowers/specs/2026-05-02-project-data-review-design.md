# Project Data Review Triage — Design

> Spec date: 2026-05-02
> Owner: Vivek (founder) → Prem (marketing_manager) + Manivel (project_manager) for execution
> Status: Spec — pending implementation
> Related: `2026-05-01-zoho-orphan-triage-design.md` (sibling triage UI for Zoho orphan invoices)

## Why

After today's HubSpot incremental import (May 2 export), the ERP has 362 projects and 798 proposals — but a meaningful slice carry data-quality flags:

- **199 proposals** carry `financials_invalidated=TRUE` (TPV is missing or implausible per the ₹5L/kWp ceiling). Their `total_after_discount`/`total_before_discount`/`shiroi_revenue` are stored as 0 with a banner on `/proposals/[id]` and `/leads/[id]/proposal`.
- **41 of those** also carry `system_size_uncertain=TRUE` (kWp was missing from the source, defaulted to 5).
- **24 of the 46 newly-imported HubSpot projects** carry a `[Likely-Duplicate-Reconcile]` tag in `notes` — these have legacy PV refs (`/23`, `/24`, `/24-25`) and almost-certainly correspond to existing Drive/Zoho-imported projects whose names diverged enough to evade exact-match dedup.

The shape of the data quality problem is uniform: for each project, *somebody who knows the customer* needs to **confirm system size and total order value**, and either (a) save the corrected numbers, or (b) mark it a duplicate of another project.

This is a one-time sweep across the entire project table — once it's done, the team's daily workflow doesn't need this UI again.

## Goals

1. Surface every project as a row in a single review queue, sorted so the most-suspicious rows come first.
2. Let Prem + Manivel + Vivek each pick a chunk and clear it. Inline-edit `system_size_kwp` and `contracted_value`, then `[Save & Confirm]` to clear the proposal banners site-wide.
3. Persist every decision to an audit log, so a project that's been confirmed doesn't re-appear in the queue.
4. Show a banner on `/dashboard` with the remaining count, so the work is visible until it's done.

## Non-goals

- **Not** a permanent data-quality dashboard. After this sweep, the page can sit dormant; new projects created in normal flow won't enter the queue (they're already validated at creation).
- **Not** triaging the 39 HubSpot Payments-pipeline deals that have no matching ERP project — those are a separate "create-from-HubSpot" task that's out of scope here.
- **Not** raising invoices for the 13 Bucket-B projects (HubSpot expects payment, ERP shows no invoice) — that's a finance-team task done in `/finance` directly.

## Surface

### URL + role gating

- **Page:** `/data-review/projects`
- **Section:** new top-level "Data Review" area for any future review queues. Today this is the only entry under it.
- **Roles:** `founder`, `marketing_manager`, `project_manager`. Other roles redirect to `/dashboard?notice=data-review-forbidden`.
- **RLS:** the new audit table grants the same three roles read+insert; the existing `projects` UPDATE RLS already covers founder + project_manager; an additional grant is required for marketing_manager (see Schema below).

### Layout

```
┌─ Tabs ───────────────────────────────────────────────────────────────────┐
│ [Needs Review · N]  [All · 362]  [Confirmed · 0]  [Duplicates · 0]  [Audit]│
│ (no Defer tab — defer action removed per Vivek 2026-05-02)                 │
├──────────────────────────────────────────────────────────────────────────┤
│ KPI strip:  Pending: N · Confirmed today: 0 · Marked duplicate: 0          │
├──────────────────────────────────────────────────────────────────────────┤
│ Filter bar:  [Source ▼] [Flag ▼] [Search by customer/PV ref]               │
├──────────────────────────────────────────────────────────────────────────┤
│ Proj#       Customer                  kWp    ₹ Order Value     Flags      │
│ ─────────────────────────────────────────────────────────────────────────  │
│ 2026-27/14  Ramaniyam-Ratnagiri      [4.4 ] [        0]      HS · LikelyDup│
│             ├ PV: PV147/23 (legacy)                                        │
│             ├ HubSpot deal: 160241054423 — created 2025-09-13              │
│             ├ Drive: ↗   ·  Created: 2025-09-13                            │
│             └ [Save & Confirm]  [Confirm — no change]  [Mark Duplicate]    │
└──────────────────────────────────────────────────────────────────────────┘
```

Rows expand-on-click into the inline edit form (kWp + ₹ inputs + four buttons + a notes textarea for [Mark Duplicate] / [Defer] cases). Click again to collapse.

### Default sort (Needs Review tab)

1. Projects whose proposal carries `[Likely-Duplicate-Reconcile]` in notes — top (24 rows, the most-suspicious).
2. Projects whose proposal has `financials_invalidated=TRUE` AND `system_size_uncertain=TRUE` — next (~38 rows).
3. Projects whose proposal has `financials_invalidated=TRUE` only — next (~158 rows).
4. Projects whose proposal has `system_size_uncertain=TRUE` only — next (~3 rows).
5. Everything else in the "All" tab is sorted by `created_at DESC`. The "Needs Review" tab excludes anything where neither flag is set unless `review_status='pending'`.

### Per-row actions

- **`[Save & Confirm]`** — UPDATEs `projects.system_size_kwp` + `projects.contracted_value` AND the linked `proposals.system_size_kwp` + `total_before_discount` + `total_after_discount` + `shiroi_revenue`. Clears `financials_invalidated` + `system_size_uncertain` on the proposal. Sets `projects.review_status='confirmed'`. Inserts an audit row.
- **`[Confirm — no change]`** — same flag-clear + `review_status='confirmed'` + audit row, but no field updates. For when the existing values are correct.
- **`[Mark Duplicate]`** — opens a typeahead to pick the canonical project this duplicates. Once both are selected, the page **scores both projects on data-richness** (count of attached `invoices` + `customer_payments` + `purchase_orders` + `vendor_bills` + `project_expenses` + `bom_items`) and shows a side-by-side comparison panel. The richer project is auto-suggested as the canonical (tie-break: older `created_at` wins). User confirms; server applies — the **lower-scored project is soft-deleted** (`deleted_at=NOW()`, `review_status='duplicate'`), the canonical project's `review_status` flips to `'confirmed'` (it didn't need a review either since the duplicate validates that the canonical is the source of truth). Audit row stores both project IDs + scores + the user's notes. Lead + proposal of the deleted project stay intact (so HubSpot link is preserved).
- **`[Undo]`** (Audit tab only) — reverses the last decision for a project: pops the most-recent audit row, restores `review_status='pending'`, and if it was a duplicate, restores `deleted_at=NULL`. Inserts an `undo` audit row. Available only to founder + marketing_manager.

### Cascade on `[Save & Confirm]` with edits

When the user changes `system_size_kwp` or `contracted_value`:
- The new `system_size_kwp` writes to BOTH `projects.system_size_kwp` AND `proposals.system_size_kwp` (single source of truth — they should match).
- The new `contracted_value` writes to `projects.contracted_value` AND mirrors to `proposals.total_before_discount`, `total_after_discount`, `shiroi_revenue` (matches the existing pattern when proposals are accepted).
- Re-evaluates the ₹5L/kWp sanity check — if the new values still violate, the action errors with `code='still_implausible'` and the user must either lower the ₹ or raise the kWp.
- Clears `financials_invalidated=FALSE`, `system_size_uncertain=FALSE` on the proposal regardless of whether values changed (the user has actively confirmed them).

### Banner on `/dashboard`

Same pattern as `/cash`'s orphan-triage banner. Shows pending count from `get_project_review_counts()` (cached 60s, auto-hides at 0). Visible to founder + marketing_manager + project_manager.

```
⚠ 199 projects need a quick data review · system size + order value verification → /data-review/projects
```

## Schema

One new migration: **`102_project_review_triage.sql`**.

```sql
-- Add review_status to projects
ALTER TABLE projects
  ADD COLUMN review_status TEXT
    NOT NULL
    DEFAULT 'pending'
    CHECK (review_status IN ('pending','confirmed','duplicate'));

-- Index for the "Needs Review" tab (most common query)
CREATE INDEX projects_review_status_idx
  ON projects(review_status)
  WHERE deleted_at IS NULL;

-- Audit log
CREATE TABLE project_review_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('confirmed','duplicate','undo')),
  prev_size_kwp NUMERIC(10,2),
  new_size_kwp NUMERIC(10,2),
  prev_contracted_value NUMERIC(14,2),
  new_contracted_value NUMERIC(14,2),
  duplicate_of_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  -- For duplicate decisions: data-richness scores at decision time
  losing_score INTEGER,
  winning_score INTEGER,
  notes TEXT,
  made_by UUID NOT NULL REFERENCES profiles(id),
  made_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX project_review_audit_project_id_idx ON project_review_audit(project_id);
CREATE INDEX project_review_audit_made_at_idx ON project_review_audit(made_at DESC);

-- RLS: founder + marketing_manager + project_manager
ALTER TABLE project_review_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_review_audit_read
  ON project_review_audit FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('founder','marketing_manager','project_manager')
  ));

CREATE POLICY project_review_audit_insert
  ON project_review_audit FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('founder','marketing_manager','project_manager')
  ));

-- Add marketing_manager to projects UPDATE RLS (founder + project_manager already there)
-- The existing UPDATE policy on projects must be amended to include marketing_manager.
-- See plan for exact rewrite.

-- Helper functions (called by server actions, return TABLE so JS can map ActionResult)

-- get_project_review_counts: powers the banner + tab counts (cached 60s on the page)
CREATE OR REPLACE FUNCTION get_project_review_counts()
  RETURNS TABLE(needs_review BIGINT, all_projects BIGINT, confirmed BIGINT, duplicate BIGINT)
  LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*) FILTER (
      WHERE p.review_status = 'pending'
        AND p.deleted_at IS NULL
        AND (
          pr.financials_invalidated
          OR pr.system_size_uncertain
          OR pr.notes ILIKE '%[Likely-Duplicate-Reconcile]%'
        )
    ) AS needs_review,
    COUNT(*) FILTER (WHERE p.deleted_at IS NULL) AS all_projects,
    COUNT(*) FILTER (WHERE p.review_status = 'confirmed') AS confirmed,
    COUNT(*) FILTER (WHERE p.review_status = 'duplicate') AS duplicate
  FROM projects p
  LEFT JOIN proposals pr ON pr.id = p.proposal_id;
$$;

-- confirm_project_review: atomic save + flag clear + audit
CREATE OR REPLACE FUNCTION confirm_project_review(
  p_project_id UUID,
  p_new_size_kwp NUMERIC,
  p_new_contracted_value NUMERIC,
  p_made_by UUID
) RETURNS TABLE(success BOOLEAN, code TEXT)
  LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_project projects%ROWTYPE;
  v_proposal_id UUID;
  v_per_kwp NUMERIC;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'not_found'::TEXT; RETURN; END IF;
  IF v_project.review_status <> 'pending' THEN RETURN QUERY SELECT FALSE, 'already_triaged'::TEXT; RETURN; END IF;

  -- Sanity check
  IF p_new_size_kwp <= 0 THEN RETURN QUERY SELECT FALSE, 'size_must_be_positive'::TEXT; RETURN; END IF;
  IF p_new_contracted_value < 0 THEN RETURN QUERY SELECT FALSE, 'value_must_be_non_negative'::TEXT; RETURN; END IF;
  IF p_new_contracted_value > 0 THEN
    v_per_kwp := p_new_contracted_value / p_new_size_kwp;
    IF v_per_kwp > 500000 THEN RETURN QUERY SELECT FALSE, 'still_implausible'::TEXT; RETURN; END IF;
  END IF;

  v_proposal_id := v_project.proposal_id;

  -- Audit row first (so it survives even if the UPDATE chain hits a constraint)
  INSERT INTO project_review_audit(project_id, decision, prev_size_kwp, new_size_kwp, prev_contracted_value, new_contracted_value, made_by)
  VALUES (p_project_id, 'confirmed', v_project.system_size_kwp, p_new_size_kwp, v_project.contracted_value, p_new_contracted_value, p_made_by);

  UPDATE projects SET
    system_size_kwp = p_new_size_kwp,
    contracted_value = p_new_contracted_value,
    review_status = 'confirmed'
  WHERE id = p_project_id;

  IF v_proposal_id IS NOT NULL THEN
    UPDATE proposals SET
      system_size_kwp = p_new_size_kwp,
      total_before_discount = p_new_contracted_value,
      total_after_discount = p_new_contracted_value,
      shiroi_revenue = p_new_contracted_value,
      financials_invalidated = FALSE,
      system_size_uncertain = FALSE
    WHERE id = v_proposal_id;
  END IF;

  RETURN QUERY SELECT TRUE, 'ok'::TEXT;
END;
$$;

-- score_project_data_richness: counts attached transactions, used by mark_project_duplicate
-- to auto-pick the canonical (richer) row.
CREATE OR REPLACE FUNCTION score_project_data_richness(p_project_id UUID)
  RETURNS INTEGER LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COALESCE((SELECT COUNT(*) FROM invoices WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM customer_payments WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM purchase_orders WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM vendor_bills WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM expenses WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM bom_items WHERE project_id = p_project_id), 0);
$$;

-- mark_project_duplicate: scores both projects, soft-deletes the lower-scored, audits both.
-- p_project_a_id and p_project_b_id are the two projects the user has paired up. The function
-- decides which is canonical based on score (tie-break: older created_at wins).
CREATE OR REPLACE FUNCTION mark_project_duplicate(
  p_project_a_id UUID,
  p_project_b_id UUID,
  p_notes TEXT,
  p_made_by UUID
) RETURNS TABLE(success BOOLEAN, code TEXT, kept_project_id UUID, deleted_project_id UUID, kept_score INTEGER, deleted_score INTEGER)
  LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_a projects%ROWTYPE;
  v_b projects%ROWTYPE;
  v_score_a INTEGER;
  v_score_b INTEGER;
  v_kept_id UUID;
  v_deleted_id UUID;
  v_kept_score INTEGER;
  v_deleted_score INTEGER;
BEGIN
  IF p_project_a_id = p_project_b_id THEN RETURN QUERY SELECT FALSE, 'self_reference'::TEXT, NULL::UUID, NULL::UUID, 0, 0; RETURN; END IF;
  IF p_notes IS NULL OR length(trim(p_notes)) = 0 THEN RETURN QUERY SELECT FALSE, 'notes_required'::TEXT, NULL::UUID, NULL::UUID, 0, 0; RETURN; END IF;

  SELECT * INTO v_a FROM projects WHERE id = p_project_a_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'a_not_found'::TEXT, NULL::UUID, NULL::UUID, 0, 0; RETURN; END IF;
  SELECT * INTO v_b FROM projects WHERE id = p_project_b_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'b_not_found'::TEXT, NULL::UUID, NULL::UUID, 0, 0; RETURN; END IF;

  v_score_a := score_project_data_richness(p_project_a_id);
  v_score_b := score_project_data_richness(p_project_b_id);

  -- Pick canonical: higher score wins; tie → older created_at wins
  IF v_score_a > v_score_b OR (v_score_a = v_score_b AND v_a.created_at <= v_b.created_at) THEN
    v_kept_id := p_project_a_id; v_deleted_id := p_project_b_id;
    v_kept_score := v_score_a; v_deleted_score := v_score_b;
  ELSE
    v_kept_id := p_project_b_id; v_deleted_id := p_project_a_id;
    v_kept_score := v_score_b; v_deleted_score := v_score_a;
  END IF;

  -- Audit both rows so the kept project's history shows the merge too
  INSERT INTO project_review_audit(project_id, decision, duplicate_of_project_id, losing_score, winning_score, notes, made_by)
  VALUES (v_deleted_id, 'duplicate', v_kept_id, v_deleted_score, v_kept_score, p_notes, p_made_by);

  UPDATE projects SET review_status = 'duplicate', deleted_at = NOW() WHERE id = v_deleted_id;
  -- The kept project flips from pending to confirmed — the duplicate-merge counts as a review
  UPDATE projects SET review_status = 'confirmed' WHERE id = v_kept_id AND review_status = 'pending';

  RETURN QUERY SELECT TRUE, 'ok'::TEXT, v_kept_id, v_deleted_id, v_kept_score, v_deleted_score;
END;
$$;

-- undo_project_review: reverses the most-recent decision for a project
-- (details in implementation plan)
```

## Server side

- **Queries** in `apps/erp/src/lib/data-review-queries.ts` — read functions (paginated `listProjectsForReview`, `getProjectReviewAudit`, `searchProjectsByCustomerOrPv`, `getProjectReviewCounts`).
- **Actions** in `apps/erp/src/lib/data-review-actions.ts` (`'use server'`) — mutation functions (`confirmProject`, `markDuplicate`, `undoLastDecision`). All return `ActionResult<T>` per NEVER-DO #19. They wrap the SQL helpers above.
- **Page** at `apps/erp/src/app/(erp)/data-review/projects/page.tsx` — server-rendered with role guard, hands off to a client `<DataReviewShell>`.

## Components

```
apps/erp/src/app/(erp)/data-review/
├── layout.tsx                    ← role guard
└── projects/
    ├── page.tsx                   ← server-side fetch + role guard
    └── _components/
        ├── data-review-shell.tsx  ← tabs + KPI strip + filter bar
        ├── projects-table.tsx     ← row list + expand-on-click
        ├── project-edit-row.tsx   ← inline edit form (kWp, ₹, buttons, notes)
        ├── duplicate-search.tsx   ← typeahead for "duplicate of" lookup
        ├── audit-log-tab.tsx      ← decisions log with [Undo]
        └── _client-fetchers.ts    ← thin wrappers around the query lib
```

Aiming for ≤500 LOC per component (NEVER-DO #14).

## Banner integration

Add a `DataReviewBanner` component to `apps/erp/src/app/(erp)/dashboard/page.tsx` (and only there for now — not on `/cash`, since that already has the orphan-triage banner). Same caching pattern as `OrphanTriageBanner`:

```tsx
const counts = unstable_cache(
  () => supabase.rpc('get_project_review_counts').single(),
  ['data-review-counts'],
  { revalidate: 60 },
);
```

Auto-hides when `needs_review === 0`.

## Edge cases + error handling

- **Concurrent edit:** two users open the same project → both click [Save & Confirm]. The second hits `code='already_triaged'` from the SQL helper; the UI shows a toast and refetches the row.
- **Project has no proposal:** historical / Drive-imported projects without a `proposal_id` exist. `[Save & Confirm]` skips the proposal cascade; the kWp + ₹ live only on the project row. Banner clearing is a no-op there (no proposal to clear).
- **Project has no flags but is `pending`:** these end up in "All" but not "Needs Review". A `[Confirm — no change]` is still allowed, moving them to "Confirmed".
- **`[Mark Duplicate]` when the canonical project has different financials:** the SQL helper picks based on data-richness score, so the project with more attached transactions wins. We don't try to merge the audit/financial trails — the lower-scored project gets soft-deleted; its lead/proposal/customer_payments retain their FK pointers (lead.id stays, proposal.id stays, payments still tag the old project_id but that project is `deleted_at IS NOT NULL`). Cash-position trigger already filters by `deleted_at IS NULL`. If the user pairs two projects that genuinely shouldn't be merged (false-positive duplicate), [Undo] from the audit tab restores both.
- **Both projects have score 0 (no transactions attached):** ties resolved by older `created_at`. This handles the `[Likely-Duplicate-Reconcile]` cases — the older Drive-imported project will typically have transactions; if it doesn't, age decides.

## Testing

- Vitest for the helper SQL: spin up `confirm_project_review` against a seeded fixture, assert it clears the proposal flags + writes audit + handles `still_implausible`.
- Playwright smoke: founder logs in → /data-review/projects loads → row expands → [Save & Confirm] with new size+₹ → row vanishes from "Needs Review" → appears in "Confirmed" tab → audit log has the entry.
- Manual UAT cycle: Vivek does 5–10 rows on dev across the four decision types, then Prem + Manivel each clear ~25 rows in the first sweep, then call done.

## Out of scope

- Editing customer name, address, or other fields — the cleanup focuses on size + value only. Other corrections happen in `/projects/[id]`.
- Bulk-confirm. Each project gets a click. (Adding bulk-confirm later is trivial; deliberately skipped to force eyeballs on each row.)
- Surfacing payment / invoice mismatches (Bucket B). Those are fixed in `/finance` directly.
- Auto-merging duplicates. `[Mark Duplicate]` only soft-deletes; merging cash trails is too risky for an automated path.

## Files to create / change

- `supabase/migrations/102_project_review_triage.sql` — schema + RPCs.
- `packages/types/database.ts` — regenerate.
- `apps/erp/src/lib/data-review-queries.ts` — read functions.
- `apps/erp/src/lib/data-review-actions.ts` — mutations (returning `ActionResult<T>`).
- `apps/erp/src/app/(erp)/data-review/layout.tsx` — role guard.
- `apps/erp/src/app/(erp)/data-review/projects/page.tsx` — server-rendered shell.
- `apps/erp/src/app/(erp)/data-review/projects/_components/*` — client components.
- `apps/erp/src/components/dashboard/data-review-banner.tsx` — dashboard banner.
- `apps/erp/src/app/(erp)/dashboard/page.tsx` — wire banner in.
- `e2e/data-review.spec.ts` — Playwright smoke (3 scenarios).
- `apps/erp/src/lib/__tests__/data-review-helpers.test.ts` — Vitest for SQL helpers via test DB.
- `docs/CHANGELOG.md` + `docs/CURRENT_STATUS.md` — entry on ship.

## To unblock

1. Spec approval.
2. Implementation plan (writing-plans next).
3. Apply migration to dev → regenerate types → ship UI → 1-shot dogfood by Vivek → hand off to Prem + Manivel for the sweep.
