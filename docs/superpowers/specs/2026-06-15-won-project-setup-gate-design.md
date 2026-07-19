# Won Project Setup Gate — Design

> **Date:** 2026-06-15
> **Author:** Vivek + Claude (brainstormed)
> **Modules:** sales, projects
> **Status:** design approved, pending spec review → implementation plan
> **Related:** `docs/modules/sales.md` (won cascade), `docs/modules/projects.md` (Details tab boxes, project spawn), `docs/superpowers/plans/2026-06-08-team-tasks-won-handoff-morning-digest.md` (the won→Manivel handoff workstream this complements)

---

## 1. Problem

When a lead is marked Won, a project spawns automatically (DB cascade: `trg_mark_proposal_accepted_on_lead_won` → `create_project_from_accepted_proposal`). The project's "first page" — the Details-tab boxes **System Configuration**, **Customer Information**, **Financial** — is then filled in by the PM (Manivel) *after the fact*, piecemeal, often chasing Marketing for missing data.

The result: projects start life with incomplete data, and the PM spends time reconstructing what Marketing already knew at closing time.

**Goal:** force **Prem (marketing_manager)** to hand over complete first-page data immediately after a deal is won, so every project reaches the PM ready to move forward.

---

## 2. Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| **Who fills it** | Prem (`marketing_manager`) — he has the closing context. |
| **When** | *After* the project spawns (not a pre-conversion gate). The won cascade is untouched; the new project is flagged `setup_completed = false`. |
| **Enforcement** | **Hard block on Prem's ERP access.** While any project is awaiting setup, the next ERP page Prem loads shows a full-screen blocking wizard and nothing else. He cannot use the ERP until every pending project is completed. |
| **Required field set** | The "Proposed set" — see §6. |
| **Form layout** | **3-step wizard**: System config → Customer → Financial. |
| **Who is blocked** | Only `marketing_manager` (Prem). Founder and everyone else are never hard-blocked. |
| **Multiple pending** | Cleared oldest-first; all must be done before the ERP unlocks. |
| **Escape hatch** | Founder can complete a setup on Prem's behalf, and can mark one "not needed" (audited) for legacy/edge cases. |
| **After completion** | Data lives in the project's existing columns. The PM's Details tab is unchanged — it just opens pre-populated, fully editable. The gate only guarantees *starting* data. |

---

## 3. Architecture overview

```
Lead → Won  (any path: green-band button, status dropdown, bulk,
             skip-margin, founder amber-approval, auto-stub-no-proposal)
   │
   ▼  (unchanged DB cascade)
create_project_from_accepted_proposal  ──►  projects row inserted
   │                                          setup_completed = FALSE   ← NEW
   ▼
Project lands in "pending setup" queue
   │
   ▼  next time Prem (marketing_manager) loads ANY /(erp) page
(erp) layout server component:
   • role == marketing_manager?
   • any project with setup_completed = false (not deleted)?
   → YES: render <ProjectSetupGate> FULL-SCREEN, do NOT render the app shell
   → NO:  render the normal app shell + children
   │
   ▼  Prem completes the 3-step wizard for each pending project
completeProjectSetup(projectId, fields) server action:
   • re-validates ALL required fields server-side
   • writes fields to the project's existing columns
   • sets setup_completed = true, setup_completed_at, setup_completed_by
   • revalidates → layout re-renders → next pending project, or the ERP unlocks
```

**Why the layout, not middleware:** the existing `middleware.ts` only does legacy URL redirects, and edge middleware is a poor place to run a per-request DB query and render a rich wizard. The authenticated `(erp)` layout (`apps/erp/src/app/(erp)/layout.tsx`) already resolves the session/role and wraps every ERP route — a single conditional there blocks all routes uniformly with no redirect loops, and the gate's own server-action submit still works because actions aren't gated by the layout render.

---

## 4. Data model

### 4.1 Migration — new columns on `projects`

```sql
ALTER TABLE projects
  ADD COLUMN setup_completed     BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN setup_completed_at  TIMESTAMPTZ NULL,
  ADD COLUMN setup_completed_by  UUID        NULL REFERENCES employees(id),
  ADD COLUMN setup_skipped       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN setup_skip_reason   TEXT        NULL;

-- Partial index: the layout queries "are there any pending?" on every Prem request.
CREATE INDEX idx_projects_setup_pending
  ON projects (setup_completed)
  WHERE setup_completed = FALSE AND deleted_at IS NULL;
```

**Default is `TRUE`, deliberately.** Adding the column with `DEFAULT TRUE` **grandfathers every existing project** (including the 57 backfilled won leads and the 12 recent `order_received` ones) — Prem is not blocked on day one by historical data. Imports (Zoho/HubSpot/Drive direct-INSERTs) also default to `TRUE`, so they never trip the gate.

**Only the won cascade sets it `FALSE`** (§4.2), so the gate fires exclusively for genuine, going-forward won→project conversions.

> `setup_completed_by` references `employees(id)` (the `*_by` employee-FK convention — never `profile_id`/`auth.uid()`; see `project_employee_id_vs_profile_id` memory + projects.md gotcha #10).

### 4.2 Trigger change — `create_project_from_accepted_proposal`

The function that inserts the project row (migs 031/063/064/094) gains one line: set `setup_completed = FALSE` on the inserted project. This is the single chokepoint that all real won paths flow through — the green-band `attemptWon`, the status dropdown, bulk change, `markWonSkipMargin`, `approveClosure`, **and** the mig-169 auto-stub (no-proposal) path, because they all end in an `accepted` proposal that fires this trigger.

```sql
-- inside create_project_from_accepted_proposal's INSERT INTO projects (...)
-- add column + value:
--   setup_completed
--   FALSE
```

Schema change ⇒ regenerate `packages/types/database.ts` in the same commit (NEVER-DO #20).

---

## 5. The gate (block mechanism)

### 5.1 `(erp)` layout conditional

In `apps/erp/src/app/(erp)/layout.tsx` (server component), after resolving the current user's role:

```
if (role === 'marketing_manager') {
  const pending = await getPendingSetupProjects();   // ordered by created_at ASC
  if (pending.length > 0) {
    return <ProjectSetupGate projects={pending} />;   // full screen, no app shell
  }
}
return <AppShell>{children}</AppShell>;               // normal
```

- **Full-screen, no shell** — the sidebar/nav are not rendered, so Prem cannot navigate away. The gate includes a **Log out** link (the only way out without completing).
- Founder and all other roles skip the check entirely.

### 5.2 Queries / actions (new file `apps/erp/src/lib/project-setup-queries.ts` + `project-setup-actions.ts`)

- `getPendingSetupProjects()` — queries projects where `setup_completed = false AND deleted_at IS NULL`, oldest-first, returning each project's current first-page field values (most pre-filled from the proposal/lead) so the wizard opens populated. Reads only.
- `completeProjectSetup(projectId, fields)` — `'use server'` mutation. Re-validates **all** required fields server-side (never trust the client), writes them to the project columns, sets `setup_completed = true`, `setup_completed_at = now()`, `setup_completed_by = <employee id via getCurrentEmployeeId()>`. Returns `ActionResult`. Role gate: `marketing_manager` or `founder`.
- `skipProjectSetup(projectId, reason)` — `'use server'`, **founder-only**. Sets `setup_completed = true`, `setup_skipped = true`, `setup_skip_reason = reason`, plus the `_at`/`_by` audit. The escape hatch for legacy/edge cases.

All follow the silent-RLS-failure guard (`.select('id')`, treat zero rows as blocked — sales.md gotcha) and `ActionResult<T>` (NEVER-DO #19).

### 5.3 `<ProjectSetupGate>` component (`apps/erp/src/components/projects/setup/`)

- Full-screen blocking client component. Renders the **3-step wizard** (System config → Customer → Financial), one section per step with Next/Back and a progress bar; submit on the final step.
- Header shows "Project N of M awaiting your handover" + the project identity (customer — project name, project number) and a note that fields are prefilled from the proposal.
- Per-step **Next** is disabled until that step's required fields are valid; final **Complete & continue** calls `completeProjectSetup`. On success, advances to the next pending project, or the ERP unlocks.
- Keep each step file < 500 LOC (NEVER-DO #14). Shared field constants in a `-constants.ts` with no server imports (NEVER-DO #21 / client-server boundary memory).
- Reuse existing field option lists where possible (system-type / structure / scope option arrays from `system-config-box.tsx`), extracted to the constants file so both the box and the wizard share one source.

---

## 6. Required field set ("Proposed set")

A handover counts as complete only when **all** of these are non-empty. Fields already carried from the proposal/lead open pre-filled but remain confirmable; the teeth are the gaps the proposal does not carry (marked ★).

**System configuration**
- System size (kWp)
- System type (`on_grid` / `off_grid` / `hybrid`)
- ★ Mounting structure
- Panel make
- Inverter make
- ★ Scope of LA · ★ Scope of Civil · ★ Scope of Meter · ★ CEIG handled by

**Customer information**
- ★ Primary contact (linked `primary_contact_id`)
- Phone
- ★ Site address line 1
- City
- ★ Pincode

**Financial**
- Order value (`contracted_value`)

**Not required (shown, optional):** panel model, panel count, panel wattage, cable make/model, battery (only when `system_type != on_grid`), billing address (defaults to site), Google Maps link. Projected margin is computed/read-only.

> Validation lives in one pure helper (e.g. `isSetupComplete(project)`), unit-tested, used by **both** the wizard (enable/disable Next) and `completeProjectSetup` (server enforcement) so client and server never drift.

---

## 7. Role access (RLS)

`marketing_manager` is currently **read-only on projects**. The gate needs Prem to write the first-page columns on setup-incomplete projects.

- Add/adjust the `projects` UPDATE RLS policy so `marketing_manager` may UPDATE a project **while `setup_completed = false`** (i.e., the policy's `USING`/`WITH CHECK` permits marketing_manager only for rows still pending setup). After completion the row flips to `true` and marketing_manager loses write access again — keeping the existing "read-only on projects" posture intact for normal operation.
- Founder write access is unchanged (already full).
- This is scoped narrowly: it does not grant marketing_manager broad project write, only the completion window.

---

## 8. Edge cases & decisions

- **Who triggered the won is irrelevant.** Whether Prem, the founder, a bulk action, or the auto-stub path created the project, it lands in Prem's queue (he owns handover). The founder is never blocked but can complete or skip via the same actions.
- **Grandfathering:** existing projects (incl. mig-169 backfill) are `setup_completed = true` by the column default — no retroactive block.
- **Imports** (direct project INSERTs) default to `true` — never gated.
- **Off-grid / hybrid:** battery fields stay optional (not in the required set); the wizard shows them conditionally as the Details box does, but they don't block.
- **Project deleted while pending:** `deleted_at IS NOT NULL` is excluded from the pending query, so a soft-deleted project never blocks.
- **Concurrent completion** (founder + Prem): `completeProjectSetup` is idempotent — completing an already-complete project is a no-op success.
- **No pending projects:** zero overhead beyond one indexed `EXISTS`-style query per Prem page load (covered by `idx_projects_setup_pending`).

---

## 9. Testing

- **Pure validation helper** `isSetupComplete` — unit tests (vitest): each required field missing → incomplete; full set → complete; optional fields absent → still complete; off-grid battery absent → still complete.
- **Trigger** — synthetic won (rolled back) confirms the spawned project has `setup_completed = false`; an import-style direct INSERT has `setup_completed = true` (default).
- **Action** `completeProjectSetup` — rejects when a required field is blank (server enforcement), succeeds and stamps audit columns when complete, RLS-blocked write surfaces as failure (zero-row guard).
- **Gate render** — manual preview: as Prem with a pending project, every route shows the wizard and nothing else; after completion the ERP unlocks; as founder, never blocked.
- **CI gates** (all four, read stdout): `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`.

---

## 10. Out of scope

- Changing the won cascade itself, the closure-band logic, or any pre-conversion behavior.
- The customer **handover pack** (project-completion PDF) — unrelated, despite the similar word.
- Re-opening / re-gating already-completed or historical projects (founder can do this manually as a DB op if ever needed).
- Surfacing pending-setup counts in the morning WhatsApp digest — possible follow-up, not part of this spec.
- Blocking the PM or the project status — explicitly rejected in favor of blocking Prem.

---

## 11. Files (anticipated)

| Path | Change |
|------|--------|
| `supabase/migrations/180_2026-06-15-won-project-setup-gate.sql` | create — columns, index, trigger edit, RLS policy |
| `packages/types/database.ts` | regen (same commit) |
| `apps/erp/src/app/(erp)/layout.tsx` | modify — gate conditional |
| `apps/erp/src/lib/project-setup-queries.ts` | create — `getPendingSetupProjects` |
| `apps/erp/src/lib/project-setup-actions.ts` | create — `completeProjectSetup`, `skipProjectSetup` |
| `apps/erp/src/lib/project-setup-validation.ts` (+ `.test.ts`) | create — pure `isSetupComplete` |
| `apps/erp/src/components/projects/setup/project-setup-gate.tsx` + step components + `-constants.ts` | create — the 3-step wizard |
| `apps/erp/src/components/projects/detail/system-config-box.tsx` | modify — extract option arrays to shared constants |
| `docs/CHANGELOG.md`, `docs/modules/sales.md`, `docs/modules/projects.md` | docs after green CI |

*(Migration number 180 is indicative — use the next free number at implementation time; latest in tree is 179.)*

---

## 12. Open risks

- **`(erp)` layout shape** — assumes the authenticated layout resolves role and wraps all ERP routes. Implementation must confirm the exact layout file and how role is read (likely an existing `getUserProfile`/session helper) before wiring the conditional.
- **RLS time-window policy** — "writable only while `setup_completed = false`" must be expressed carefully so a marketing_manager can't flip the flag back to keep writing; `completeProjectSetup` runs server-side and is the only writer of the flag, which mitigates this.
- **Trigger coverage** — relies on every won path funnelling through `create_project_from_accepted_proposal`. This is documented as true (projects.md gotcha #4), but the plan should add the synthetic-won test as the guard.
