# Morning digest redesign — coordinator-led model

**Date:** 2026-05-21
**Status:** Approved
**Module:** n8n
**Related:** Replaces the Tier 2 head-per-role digest set established April 2026

---

## Context

Until today, n8n's "morning digest" set was eight role-keyed workflows (#20–#27), each sending to the respective department head. Half of those role slots were aliased to Vivek's number (Finance / O&M / HR all = `+91 94444 14087`) because the heads aren't hired yet, and #26 Liaison was a placeholder because the underlying SQL views don't exist.

The model was wrong for how the team actually works. Vivek is the coordinator — he routes work, follows up, and asks the right person the right question. The digests Vivek needs are **manager-level rollups**, not per-role escalations the heads don't have time to read. Once Shiroi hires actual heads (HR, Finance, O&M), they can absorb their own digests, but until then most "head" workflows are duplicate noise to Vivek's phone.

## Goals

1. Daily WhatsApp digests Vivek can use to coordinate Prem, Shravan, Manivel within the first 30 minutes of the workday.
2. Each direct report gets exactly one role-specific digest; Vivek gets a copy of every direct-report digest so he can ask "did you see #3?" without screenshots.
3. Predictable, low volume — no recipient gets more than 4 messages/day.
4. Replace, not extend — deactivate the old role-keyed set so the WhatsApp tier limit isn't burned on cross-cc'd duplicates.

## Non-goals

- Per-customer activity (different surface — that's the CRM proper, not WhatsApp).
- Hot alerts on individual events (those are Tier 1 event-bus workflows #02–#18, untouched).
- Reporting for absent roles — once Finance / O&M / HR heads are hired, they'll get their own workflows added on top of this baseline.

## Design

### Time semantics

| Phrase | Window |
|--------|--------|
| "Last day" / "yesterday" | rolling **last 24 hours** from fire time (matches existing `v_digest_leads_new_24h`) |
| "This week" | rolling **next 7 days** from fire time (today + 6 days forward) |
| All trigger times | **Asia/Kolkata** |

Rolling beats calendar because (a) digests fire daily, so the difference is visually negligible; (b) calendar-Monday means Friday sees a 2-day forward window for "this week", which is misleading; (c) all existing digest views already use rolling windows.

### Workflow A — Vivek's daily personal (07:00 IST)

**File:** `infrastructure/n8n/workflows/19-vivek-daily-7am.json` (rewrite of existing)
**Workflow id (existing):** `eDxwDJb96e8szPI2`
**Recipients:** Vivek (`+91 94444 14087`)

**Content blocks** (composed in a single message):
1. **New leads (last 24h)** — from `v_digest_leads_new_24h`
2. **Tasks completed (last 24h)** — `SELECT * FROM tasks WHERE is_completed = true AND completed_at >= now() - interval '24 hours' AND deleted_at IS NULL`
3. **Lead activities logged (last 24h)** — `SELECT * FROM lead_activities WHERE created_at >= now() - interval '24 hours'`

**Sample output:**
```
🌅 Vivek's morning — Thu, 22 May 2026

New leads (24h): 5
• Acme Solar Ltd · Chennai · 50kWp · Prem
• Sunshine Industries · Bengaluru · 100kWp · unassigned
• …

Tasks done (24h): 3
• Site survey @ ABC Industries — Manivel
• Send revised quote @ Sunshine — Prem
• Follow up on PO — Prem

Activities logged (24h): 4
• Call — ABC Industries (Prem)
• Meeting — XYZ Foods (Vivek)
• Email — Roof Power (Prem)
• Site visit — Acme Solar (Manivel)

Open: https://erp.shiroienergy.com
```

If any block is empty, render it with a short success line (`✅ no tasks closed yesterday`).

### Workflow B — Orders + Payments this week (08:00 IST)

**File:** `infrastructure/n8n/workflows/20-orders-payments-this-week.json` (rewrite of existing 20-sales-head-daily-8am.json, renamed for clarity)
**Workflow id (existing):** `8TRoulZcxG0zgTFw`
**Recipients:** Vivek + Prem (`+91 94440 60787`)

**Content blocks:**
1. **Orders likely to close (next 7d)** — call existing `get_expected_orders()` RPC, filter rows where `expected_close_date` falls within today..today+7d.
2. **Payments expected (next 7d)** — call existing `get_expected_payments()` RPC, filter rows where `due_date` falls within today..today+7d.

**Sample output:**
```
📈 This week's pipeline — Thu, 22 May 2026

Orders closing (next 7d): 4 · ₹2.1Cr total
1. Acme Industries · 200kWp · ₹85L · 80% · 24 May
2. Sunshine Mills · 150kWp · ₹62L · 60% · 26 May
3. Roof Power · 50kWp · ₹22L · 70% · 27 May
4. Watt Inc · 75kWp · ₹40L · 50% · 28 May

Payments expected (next 7d): 6 · ₹47L total
1. ABC Industries · Inv 24-001 · ₹15L · 23 May
2. XYZ Foods · Inv 24-008 · ₹12L · 24 May
3. …

Open: https://erp.shiroienergy.com
```

Each item line capped at ~80 chars; full digest body capped at 900 chars per Meta template constraint.

### Workflow C — In-design queue (08:00 IST)

**File:** `infrastructure/n8n/workflows/21-in-design-queue.json` (rewrite of existing 21-design-head-daily-8am.json)
**Workflow id (existing):** `jyiz9c8UbDdxYKp8`
**Recipients:** Vivek + Shravan (`+91 97045 14879`)

**Content:** existing `v_digest_proposals_design_backlog` view (already returns proposals stuck in draft >24h with prepared_by_name and hours-in-draft).

**Sample output:**
```
🎨 In-design queue — Thu, 22 May 2026

Proposals in design (>24h old): 3
1. SHIROI/PROP/2026-27/0301 · ABC Industries · 50kWp · 36h · Shravan
2. SHIROI/PROP/2026-27/0302 · XYZ Foods · 100kWp · 60h · Shravan
3. SHIROI/PROP/2026-27/0303 · Sunshine · 75kWp · 18h · Shravan

Open: https://erp.shiroienergy.com/design
```

### Workflow D — Active project queue (08:00 IST)

**File:** `infrastructure/n8n/workflows/22-active-project-queue.json` (rewrite of existing 22-projects-head-daily-8am.json)
**Workflow id (existing):** `OkA5wYRnpUB6oR99`
**Recipients:** Vivek + Manivel (`+91 94868 01859`)

**Content:** projects with `status IN ('yet_to_start', 'in_progress', 'holding_shiroi')` — full active-project dashboard for the projects manager. Excludes `holding_client` (he can't unblock those), `waiting_net_metering` (separate liaison concern), `order_received` (still in handoff), and obviously `completed`.

**SQL approach:** Add a new digest view `v_digest_projects_active_for_pm` in a small migration so the n8n HTTP node can query it like the other views. Shape:
- project_number, project_name, customer_name, status, system_size_kwp, project_manager_name, expected_completion_date, days_since_status_change, current_milestone_name
- Order by: status (yet_to_start first, then in_progress, then holding_shiroi), then by days_since_status_change desc within group

**Sample output:**
```
🏗️ Active projects — Thu, 22 May 2026 (Manivel)

Yet to start (3):
1. SHIROI/PROJ/2026-27/0142 · Acme · 200kWp · 12d since order
2. SHIROI/PROJ/2026-27/0143 · Sunshine · 150kWp · 4d since order
3. SHIROI/PROJ/2026-27/0144 · Watt · 75kWp · 2d since order

In progress (8):
1. SHIROI/PROJ/2025-26/0117 · Rakshas · 100kWp · MMS install · 24d in stage
2. …

Holding (Shiroi) (2):
1. SHIROI/PROJ/2025-26/0098 · GreenCo · 80kWp · awaiting design rev · 8d
2. SHIROI/PROJ/2025-26/0099 · BlueCo · 60kWp · material short · 3d

Open: https://erp.shiroienergy.com/projects
```

### Unchanged workflows

- **#56 Droplet heartbeat** — daily 09:00 IST infra ping to Vivek + Vinodh. Stays as-is.
- **#57 Meta delivery webhook receiver** — continuous, captures every send's `sent / delivered / read / failed` from Meta. Stays as-is.

### Deactivated workflows

`POST /api/v1/workflows/{id}/deactivate` against:
- **#25** O&M head daily 8AM (`28EV2RHYs8gau9ay`) — O&M head not hired
- **#26** Liaison head daily 8AM (`PvE4cRvigxlLlGxO`) — underlying views don't exist; deferred to task #23

JSON files remain in `infrastructure/n8n/workflows/` for future reactivation. CHANGELOG line records the deactivation reason.

### Daily volume table

| Recipient | 07:00 | 08:00 | 09:00 | Total |
|---|---|---|---|---|
| Vivek (`+91 94444 14087`) | 1 (A) | 3 (B, C, D) | 1 (#56) | **5** |
| Vinodh (`+91 94440 65787`) | — | — | 1 (#56) | **1** |
| Prem (`+91 94440 60787`) | — | 1 (B) | — | **1** |
| Shravan (`+91 97045 14879`) | — | 1 (C) | — | **1** |
| Manivel (`+91 94868 01859`) | — | 1 (D) | — | **1** |
| **Daily total messages** | 1 | 6 | 2 | **9** |

Well under Meta's 2K-conversations/24h tier limit. Recipient count = 5 unique numbers, well under any per-recipient rate ceiling.

## Implementation strategy

1. **New SQL view first** — migration adds `v_digest_projects_active_for_pm` to dev (mig number TBD by implementation plan); same pattern as existing `v_digest_milestones_overdue`.
2. **Rewrite four workflow JSONs** in `infrastructure/n8n/workflows/` — keeping existing workflow IDs (so re-push via `scripts/push-n8n-workflows.ts` updates in place; no UI re-activation needed since they're already active).
3. **For Workflow A** — two HTTP fetches (tasks + activities) plus existing leads view → merge in a Code node → single Compose Set node → single Send WhatsApp with `executeOnce: true`.
4. **For Workflow B** — two HTTP fetches (`get_expected_orders` + `get_expected_payments` RPCs called via `POST /rest/v1/rpc/<name>`) → merge in Code node → Compose Set → two parallel Send WhatsApp (Vivek + Prem) with `executeOnce: true`.
5. **For Workflow C** — same shape as the old #21 (one fetch from existing view → Compose → Send) but with two parallel sends (Vivek + Shravan) and `executeOnce: true`.
6. **For Workflow D** — one fetch from new view → Compose → two parallel sends (Vivek + Manivel).
7. **Deactivate #25 and #26** via REST API.
8. **Push** with `pnpm tsx scripts/push-n8n-workflows.ts 19 20 21 22` (script preserves active state, so #19/#20/#21/#22 stay active through the rewrite).
9. **Smoke test** — trigger each workflow manually via webhook (insert a temporary webhook trigger parallel to the cron) or via n8n UI "Execute workflow" button.
10. **Commit** — single PR with mig + 4 workflow rewrites + CHANGELOG + audit doc update.

## Risks

- **n8n's `executeOnce` semantics** — the May 17–20 incident root cause. Every new Send WhatsApp node must have `executeOnce: true` explicitly. Verify in the implementation step.
- **`get_expected_orders` / `get_expected_payments` shape may not match digest needs** — they were authored for the dashboard cards, not WhatsApp formatting. If column names differ from spec, the Compose node's template strings need adjustment. The implementation should verify shape first via a one-off SQL probe.
- **`v_digest_projects_active_for_pm` doesn't exist yet** — needs to be authored. Use the migration step.
- **Daily 9-msg total** = manageable but if any workflow has a per-item bug, that count could explode. The `executeOnce: true` discipline is the guardrail.

## Open questions for implementation phase

- Should Workflow D's "in_progress" section show ALL in-progress projects, or just those with no movement in N days? Defaulting to ALL for v1; revisit if list gets unwieldy after a week of use.
- Should Workflow A's "tasks done" section filter to founder-owned tasks only, or org-wide? Defaulting to org-wide so Vivek sees what Prem/Manivel knocked off, not just his own.

## Success criteria

- Tomorrow morning 2026-05-22 07:00 IST: Vivek receives one digest with the three content blocks.
- 08:00 IST: Vivek receives three more digests (B, C, D); Prem, Shravan, Manivel each receive their respective single digest.
- 09:00 IST: heartbeat as before.
- Total messages out: 9 (vs ~10 today).
- All recipients confirm delivery within the day.
- Workflow execution logs show zero errors, zero `failed` Meta webhook events for any of the sends.
