# Marketing Hotfix — May 20, 2026

> Two bugs Prem hit on May 19 while exercising the marketing feedback batch (commit `1260c19`). Both fixable in a single small patch.

## Symptoms

**Bug 1 — Quick Quote stuck on "Generating..."**
Modal shows the spinner button forever after submit. Prem reported "quick quote could not generate" for an industrial 150 kWp lead with Liaison + Civil enabled.

**Bug 2 — "Failed to add activity: new row violates row-level security policy for table 'lead_activities'"**
Three identical toast errors on the Activities tab of `/sales/<id>` while logging a Site Visit. UI even renders the error inline on the form.

## Phase 1 — Root cause investigation

### Bug 1: Quick Quote stuck

- The screenshot shows the button in "Generating..." state, meaning `QuickQuoteModal.handleSubmit` was awaiting `createBudgetaryQuoteAction` and the local `submitting` flag is still `true`.
- Direct DB check: Prem (`marketing_manager`) **successfully created** `SHIROI/PROP/2026-27/0292` (50 kWp Ramaniyam) on 2026-05-19 13:54 and `SHIROI/PROP/2026-27/0297` (Test 150 kWp) on 2026-05-20 02:54. So the action ran end-to-end and the proposal exists. The user perceived failure because the modal didn't close.
- Reading `quick-quote-modal.tsx`:
  ```tsx
  if (result.error) {
    setError(result.error);
    setSubmitting(false);
  } else if (result.proposalId) {
    router.push(`/sales/${leadId}/proposal`);
    router.refresh();
  }
  ```
  The success branch never resets `submitting` and never calls `onClose()`. Combined with the fact that the modal is rendered by `QuickQuoteButton` inside `apps/erp/src/app/(erp)/leads/[id]/layout.tsx` (a layout segment that persists across navigation to the `proposal` tab), the modal stays mounted forever with `submitting=true`. The button label stays "Generating..." even though the proposal is already created.

**Root cause:** Modal never closes on success.

### Bug 2: lead_activities RLS

- The Postgres error message names the exact table: `lead_activities`.
- Live DB policy check via Supabase MCP:
  ```
  lead_activities_read   USING (role IN ('founder','hr_manager','finance') OR performed_by = me OR role = 'sales_engineer')
  lead_activities_write  USING (role IN ('founder','sales_engineer','project_manager'))
  ```
  Neither mentions `marketing_manager`. The mig 052 "marketing + design revamp" pass added `marketing_manager` to `proposals`, `proposal_bom_lines`, `proposal_payment_schedule`, `channel_partners`, `net_metering_applications`, `lead_closure_approvals`, `consultant_commission_payouts`, `leads_read/insert/update`, and `tasks_read/write` — but **missed `lead_activities`**.
- Other lead-adjacent tables I cross-checked are fine (`activities`/`activity_associations` use `auth.uid() IS NOT NULL`, `lead_status_history` uses `role != customer`, `leads`/`tasks` already include marketing_manager).

**Root cause #2a:** mig 052 missed `lead_activities` in its marketing sweep.

### Hidden tier-2 bug: activity_type CHECK mismatch

While reading the form code I noticed `add-activity-form.tsx` sends `activity_type='phone_call'` for the "Phone Call" option, but `lead_activities_activity_type_check` accepts only `'call'`. RLS fires first (before INSERT executes), so Prem only saw the RLS error. **Fixing RLS without fixing this would surface a second error.**

**Root cause #2b:** UI uses `phone_call`; DB enum uses `call`. Misalignment never surfaced because RLS was already blocking.

### Secondary cleanup: NEVER-DO #15 violation

`add-activity-form.tsx` is a client component that calls `createClient` from `@repo/supabase/client` and INSERTs directly into the DB. This violates NEVER-DO rule #15 ("Never make an inline Supabase call from a `page.tsx` or a component"). It works (the auth user → employee lookup is server-side enforced via RLS) but it's the pre-2026 pattern. The right shape is a server action that returns `ActionResult<T>`.

While fixing #2a/#2b, refactor to a server action — this also ratchets the forbidden-patterns baseline down by 1.

## Phase 2 — Pattern alignment

- **RLS template:** mig 052's `proposals_insert` policy is the canonical pattern: `get_my_role() = ANY (ARRAY['founder', 'sales_engineer', 'project_manager', 'designer', 'marketing_manager'])`. Apply the same shape to `lead_activities_read` (add `marketing_manager` + restore `project_manager` who's also missing from read) and `lead_activities_write`.
- **Modal close-on-success:** existing pattern in `apps/erp/src/components/sales/closure-approval-actions.tsx` and similar — call `onClose()` then `router.refresh()`.
- **Server-action insert:** the canonical shape is in `apps/erp/src/lib/leads-task-actions.ts` `upsertLeadFollowupTask` shipped yesterday — exactly what we want for `addLeadActivity`.

## Phase 3 — Fix plan

### Migration 110 — `lead_activities` RLS realignment

```sql
BEGIN;

DROP POLICY IF EXISTS lead_activities_read ON lead_activities;
CREATE POLICY lead_activities_read ON lead_activities FOR SELECT
USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'finance'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role,
    'designer'::app_role
  ])
  OR performed_by = get_my_employee_id()
);

DROP POLICY IF EXISTS lead_activities_write ON lead_activities;
CREATE POLICY lead_activities_write ON lead_activities FOR ALL
USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role
  ])
)
WITH CHECK (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'sales_engineer'::app_role,
    'project_manager'::app_role,
    'marketing_manager'::app_role
  ])
);

COMMIT;
```

Note: `lead_activities_write` is `FOR ALL` (covers I/U/D). Previously it had USING but no WITH CHECK — Postgres falls back to USING for inserts/updates, which is correct, but being explicit avoids future confusion. `designer` is intentionally excluded from write (they read the lead funnel, not log activities).

No CHECK constraint change needed if we fix the UI (preferred — keeps the enum clean).

### `quick-quote-modal.tsx` close-on-success

```tsx
if (result.error) {
  setError(result.error);
  setSubmitting(false);
} else if (result.proposalId) {
  onClose();                                 // dismiss modal
  router.push(`/sales/${leadId}/proposal`);
  router.refresh();
}
```

Also wrap the entire `handleSubmit` body in `try/finally` so `submitting` is reset if `createBudgetaryQuoteAction` throws synchronously (e.g. dynamic import fails). Defensive but cheap.

### `add-activity-form.tsx` — rename + refactor

1. UI option: change `'phone_call'` → `'call'` in the `ACTIVITY_TYPES` tuple; label stays `'Phone Call'`. Drop the `proposal_sent` mismatch by leaving it out of UI (the rest of the enum has `proposal_sent`, but the UI doesn't need to offer it — that's an internal status, not a user-loggable activity).
2. New server action `addLeadActivity(input): Promise<ActionResult<{ activityId: string }>>` in `apps/erp/src/lib/leads-activity-actions.ts`:
   - Resolve caller → employee.
   - INSERT into `lead_activities` with `crypto.randomUUID()` for id.
   - Also UPDATE `leads.last_contacted_at` + `leads.next_followup_date` in the same action (same as the current client code).
   - Revalidate `/sales/${leadId}/activities` + `/sales/${leadId}` + `/dashboard`.
3. Component changes:
   - Drop `createClient` import (browser-side Supabase gone).
   - Replace the inline INSERT block with a call to `addLeadActivity({...})`.
   - Surface `result.error` via the existing `useToast` + inline error banner.

This drops one forbidden-pattern violation (baseline 64 → 63).

## Phase 4 — Verification

- `pnpm check-types` clean
- `pnpm lint` clean
- `scripts/ci/check-forbidden-patterns.sh` — baseline 64 → 63
- Mig 110 applied on dev via MCP
- Manual smoke test scripted in the plan: as `marketing_manager`, INSERT into `lead_activities` directly via SQL with `activity_type='call'` succeeds (proves RLS); as `founder`, `SELECT ... FROM lead_activities WHERE performed_by = <prem_employee_id>` returns rows (proves read).
- UI smoke documented for Vivek to repro post-deploy: open any lead → Activities tab → log Site Visit → toast says "Activity added"; create a Quick Quote → modal closes immediately, lands on Quote tab.

## Out of scope

- Refactoring all browser-Supabase inserts across the lead-detail screens (lead-files, add-task etc.). Just this one. The rest can ratchet down over time.
- `lead_status_history` RLS — already permissive enough (`role != customer`).
- New tests — the smoke test is enough for a hotfix; we don't have Playwright wired into CI yet.

## Files touched

- `supabase/migrations/110_lead_activities_marketing_manager_rls.sql` (new)
- `apps/erp/src/components/proposals/quick-quote-modal.tsx`
- `apps/erp/src/components/leads/add-activity-form.tsx`
- `apps/erp/src/lib/leads-activity-actions.ts` (new)
- `docs/CHANGELOG.md`, `docs/CURRENT_STATUS.md`, `docs/modules/sales.md`
- `CLAUDE.md` (typegen instructions — separate task)
