# Team Tasks fixes · Won→Manivel hand-off · Morning-message additions

**Date:** 2026-06-08
**Status:** Draft — pending Vivek review
**Modules:** sales, projects, n8n
**Related:** `docs/modules/sales.md`, `docs/modules/projects.md`, `2026-05-21-morning-digest-redesign-design.md`, migrations 104/107/109/111

---

## Context

Six issues raised by Prem + Vivek, grouped into three workstreams:

1. **Team Tasks** — (a) a task date entered on a lead shows one day earlier in the Team Tasks list; (b) the task "Type" column is always blank for manually-added tasks.
2. **Won → Manivel** — marking a deal Won produces **no project at all**, so it never reaches Manivel.
3. **Morning messages** — add three things to the daily Vivek+Prem message: overdue follow-ups/closures, today's follow-up tasks, and month-to-date won value.

### Won→Manivel — confirmed root cause (diagnosed 2026-06-08 on dev)

The proposal-gate is **intentionally disabled** (`system_settings.proposal_gate_enabled = false`, set 2026-05-20). `fn_block_lead_won_without_proposal` reads this correctly and **allows** Won without a proposal — working as intended. The bug is downstream: a project is **only** ever created when a proposal flips to `accepted` (`create_project_from_accepted_proposal`). On Won, `fn_mark_proposal_accepted_on_lead_won` looks for an in-play proposal; finding none it logs a NOTICE and returns — **nothing creates a project**. `projects.proposal_id` is NOT NULL, so the manual fallback can't help either.

**Evidence (dev):** of 378 won leads, the 320 **with** a proposal all have a project (320/320); the 58 **without** a proposal have **none** (0/58). A perfect correlation — the proposal is the exact on/off switch. The gate feature (migs 107/109/111) shipped without a no-proposal project-creation path.

## Goals

- Task dates display correctly (IST) everywhere, including server-rendered tables.
- Manually-added lead tasks carry a visible, selectable Type.
- Every Won deal yields a project assigned to Manivel — with or without a proposal.
- Backfill the 58 stranded won leads into projects (recent = live, old = completed).
- The Vivek+Prem morning message surfaces overdue deals, today's follow-ups, and MTD won value.

## Non-goals

- Re-enabling the proposal gate (Vivek keeps it off for cleanup; the fix works regardless of gate state).
- Restoring/refactoring the paused **prod** Supabase project (separate ops task).
- Instant WhatsApp-to-Manivel on win (explicitly deferred — easy to add later via the event bus).
- Reworking the AI briefing narrative itself (we append a deterministic block, leave the prose alone).

---

## Workstream 1 — Team Tasks

### 1a. Date off-by-one (display bug)

**Root cause:** `formatDate` (`packages/ui/src/formatters.ts:28`) builds the IST-midnight instant `new Date(dateString + 'T00:00:00+05:30')` but calls `toLocaleDateString('en-IN', …)` **without** `timeZone: 'Asia/Kolkata'`, so it renders in the runtime's zone. On Vercel (UTC) a date-only value like `2026-06-10` becomes `2026-06-09T18:30Z` → renders **Jun 9**. The Team Tasks page is a server component, so it hits this. Storage is correct (DATE column).

**Fix:** add `timeZone: 'Asia/Kolkata'` to the `toLocaleDateString` options in `formatDate`. Strict correctness fix — client renders already IST (unchanged); every server-rendered date-only field gets corrected. Add a formatter unit test asserting `formatDate('2026-06-10')` is stable under `TZ=UTC` and `TZ=Asia/Kolkata`.

**Secondary:** the "tomorrow" default in `quick-add-task.tsx` (`new Date()…toISOString()`) computes in UTC and can pre-fill the wrong day late at night IST. Recompute in IST.

### 1b. Task "Type" picker

**Root cause:** `createLeadTask` (`apps/erp/src/lib/leads-task-actions.ts:43`) inserts no `category`, and `quick-add-task.tsx` has no type field → the list's Type column (`getCategoryLabel(null)`) renders `—`.

**Fix:**
- Add a **Type** `<Select>` to `quick-add-task.tsx`. Proposed options → stored `category`:
  - Call → `call`, Site visit → `site_visit`, Follow-up → `lead_followup`, Document → `document`, Payment → `payment_followup`, Other → `general`.
- Persist the chosen `category` in `createLeadTask` (new optional `category` arg, default `general`).
- Extend `getCategoryLabel` in `sales/tasks/page.tsx` for `call`/`site_visit`/`document`.
- **Migration:** extend `tasks_category_check` to allow `call`, `site_visit`, `document` (current set lacks them). Same migration regenerates no types beyond the constraint.

> Type list is a proposal — trim/rename in review.

---

## Workstream 2 — Won → Manivel

### 2a. Going-forward fix (Approach A — auto-stub accepted proposal)

Modify `fn_mark_proposal_accepted_on_lead_won`: when no in-play proposal exists for a just-won lead, instead of the NOTICE-and-return dead-end, **INSERT a minimal `accepted` budgetary proposal** built from the lead (`lead_id`, `is_budgetary=true`, `status='accepted'`, `system_size_kwp` from `estimated_size_kwp`, `total_after_discount` from `base_quote_price` or 0, `proposal_number` via `generate_doc_number('PROP')`, sensible system-type default). That INSERT fires the existing `create_project_from_accepted_proposal` cascade → project (`order_received`) → mig-104 BEFORE-INSERT trigger assigns Manivel.

**Why A over B (nullable `proposal_id` + direct insert):** keeps the NOT-NULL invariant the whole app assumes, reuses the battle-tested cascade + every AFTER-INSERT project trigger, one function changed. Safe under any gate state (when the gate is ON, won-without-proposal can't happen, so the branch is dormant; when re-enabled post-cleanup it stays dormant).

### 2b. Backfill the 58 stranded leads (one-time migration)

For every stranded lead (`status='won'`, no proposal, no live project, `deleted_at IS NULL`):
1. **DRA dedup first:** soft-delete `DRA - Infinique` (`f5fd49cb…`, 36 kWp) — keep `DRA Infinique` (`419bea2c…`, 18 kWp, more data). *Pending Vivek confirm: differing phone/size suggest possibly two real deals.*
2. Insert a stub accepted budgetary proposal (same shape as 2a) → cascade creates project + assigns Manivel.
3. **Status by age:**
   - **Recent** (lead created **≥ 2026-01-01**): leave project `order_received` (live → Manivel). Dev: 12 after DRA kill.
   - **Old** (created **< 2026-01-01**): `UPDATE … SET status='completed'`. Dev: 45. Leads stay `won`; this populates the historical completed-project ledger.

Backfill is **criteria-based**, not hardcoded IDs, so the identical rule applies to prod when restored. Review artifact: `scripts/data/won-backfill-review-2026-06-08.md`.

**Trigger side-effects to suppress during backfill** (wrap in a txn that disables them, then re-enables):
- `projects_sync_enqueue` — would push all 57 historical/completed projects to Zoho. Disable for the backfill inserts.
- `trg_payment_followup` (fires on the status→completed UPDATE) — ensure no spurious payment-followup tasks for completed projects.

### Schema/data summary (WS2)
- Edited function: `fn_mark_proposal_accepted_on_lead_won`.
- One migration: function replace + backfill block (txn-guarded) + DRA soft-delete.
- No new tables/columns. `database.ts` regen only if the function change affects types (it doesn't) — none expected.

---

## Workstream 3 — Morning messages (Vivek + Prem, 8 AM)

Live channel: `20b-prem-daily-8am-ai.json` → `POST /api/briefing/run {recipient_role:'marketing_manager'}` → `gatherBriefingKpis` → `narrateBriefing` → WhatsApp. The AI `whatsapp_short` is ~500 chars and **compresses** — wrong for actionable lists. So:

**Surfacing:** `/api/briefing/run` returns a new deterministic **`action_block`** (exact lines, names, dates, links) that the n8n Compose node appends below the narrative. 4c also enters the KPI bundle so the AI may reference it.

### New SQL (deterministic, IST, money in SQL — never JS reduce)
- **4a — Overdue deals:** open leads (status NOT IN won/lost/on_hold/disqualified/converted) where `next_followup_date < CURRENT_DATE` **or** `expected_close_date < CURRENT_DATE` (IST). Columns: customer, owner, which date slipped + days overdue, value. All owners.
- **4b — Today's follow-ups:** open sales-domain tasks (same scope as `getSalesTeamTasks`) with `due_date = CURRENT_DATE` (IST), grouped by assignee.
- **4c — Won MTD:** `SUM(COALESCE(accepted-proposal total_after_discount, base_quote_price, 0))` over leads whose status→`won` (`lead_status_history.to_status='won'`) is within the current calendar month-to-date (IST).

New RPCs/views (e.g. `v_digest_leads_overdue`, `get_followup_tasks_today`, `get_won_value_mtd`) in one migration, mirroring existing digest-view patterns.

### n8n constraints (from prior incidents)
- `executeOnce: true` on every Send node.
- Serial-chain composition, **not** parallel fan-in (avoids the fastest-parent-wins race).
- Meta body params reject `\n`/`\t`/4+ spaces (error 132018) — sanitize at the Send node.
- Match workflows by **exact name** to dodge stale paused duplicates.
- Recipients: Vivek (`+91 94444 14087`) + Prem (`+91 94440 60787`).

---

## Sequencing

1. **WS1** — pure app + one tiny CHECK migration. Ship first (lowest risk, immediate Prem relief).
2. **WS2** — function fix + backfill migration; **dev → verify → prod** (prod pending restore).
3. **WS3** — SQL migration + `/api/briefing/run` change + n8n workflow edit; verify a real morning send.

All four CI gates green locally before each push (`check-types`, `lint`, `check-forbidden-patterns.sh`, `build`).

## Risks

- **Backfill Zoho spam** — suppress `projects_sync_enqueue` during the 57 inserts (above).
- **Prod paused** — dev counts (12/45) are illustrative; real counts surface at prod apply. Don't auto-restore prod.
- **DRA may be two real deals** — confirm before soft-delete.
- **`formatDate` blast radius** — global, but strictly corrective; covered by the new test.
- **Stub proposal NOT-NULL columns** — implementation must enumerate `proposals` NOT-NULL set and fill safe defaults (verify in plan).

## Open questions / confirmations

1. **DRA kill** — confirm `DRA - Infinique` (36 kWp) is truly a duplicate to soft-delete (differing phone/size).
2. **Task type list** — accept Call/Site visit/Follow-up/Document/Payment/Other, or adjust?
3. **Old-list promotions** — any of the 45 you'd rather mark live (`order_received`) instead of `completed`? (Default: all 45 completed.)

## Success criteria

- A task dated Jun 10 shows "10 Jun 2026" in Team Tasks (server-rendered) — no off-by-one.
- A new lead task shows its chosen Type in the list.
- Marking any lead Won (no proposal) creates a project assigned to Manivel.
- After backfill: 0 stranded won leads; 12 live + 45 completed projects on dev; the 45 visible as completed in the ledger.
- Tomorrow 08:00 IST: Vivek + Prem receive a message containing overdue deals, today's follow-ups, and MTD won value.
