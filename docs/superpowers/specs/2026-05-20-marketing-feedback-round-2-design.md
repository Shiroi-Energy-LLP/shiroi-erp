# Marketing Feedback Round 2 — May 20, 2026

> Five streams from Vivek's evening review. Quote-format work explicitly deferred to a separate pass.

## Source feedback (paraphrased)

1. "Closure Soon shows 1 but there are no projects there."
2. "Design queue should show **In Design** leads, not Survey Done. Stages should match the labels (In Design, Design Done)."
3. "Design queue needs a second section: **Final At-Site Design** that Manivel pushes to design team for specific won projects."
4. "Stage bubble (status badge) looks ugly. Whole leads table looks drab."
5. "VIP-track referrals (Vivek / Management) — we have the flag (`channel_partners.is_internal` from mig 109) but no column in the leads list."
6. "Add a **Referred by Clients** view for Prem to see external customer referrals."
7. "Lead-edit UI to add/change referrer (Management/Vivek/Customer/Builder) on existing leads."
8. "Click 'Closing This Month' card on Prem's dashboard → see the list of those leads."
9. "Detailed quote — confirm it's shipped." → **Confirmed shipped** (Quote tab on lead detail + `FinalizeDetailedProposalButton`). No design work in this spec.

## Architecture overview

Five independent streams. Each is a focused commit; they can ship in series or in parallel.

```
A. Bugs                  (closure-soon cache + design queue filter rename + label alignment)
B. Design queue restructure   (split into In-Design Leads + At-Site Design Projects)
C. Referrer system            (column + filter chip + edit UI)
D. Dashboard drill-down       (Closing This Month → /sales filtered list)
E. UX polish                  (status badges + table polish)
```

---

## Stream A — Bugs

### A1. Stale "Closure Soon: 1" in stage nav

**Diagnosis:** `getCachedLeadStageCounts()` wraps `get_lead_stage_counts()` in `unstable_cache` with TTL 300s. When a lead leaves `closure_soon` (e.g., flipped to Won or Lost), the cache keeps the count for up to 5 minutes. The DB confirms zero `closure_soon` leads right now — the "1" Vivek sees is from a moment when one existed.

**Fix:**
1. Drop the TTL on `getCachedLeadStageCounts` from 300s → 30s. Stage counts are cheap (one GROUP BY query) and the user expects them fresh.
2. Add a tag-based revalidate: whenever a lead's status changes (via `status-change.tsx`, `bulkChangeLeadStatus`, `attemptWon`, `markWonSkipMargin`, `inline-edit-actions.updateCellValue` for `status`), call `revalidateTag('lead-stage-counts')`. The cache function already keys on a tag — add the tag if missing, then revalidate from each writer.

### A2. `/design` queue filter rename

Currently `apps/erp/src/app/(erp)/design/page.tsx:53` queries:
```ts
.in('status', ['site_survey_done', 'design_confirmed'])
```

**Fix:** change to `['design_in_progress', 'design_confirmed']`. Survey-done leads aren't in design yet — they're waiting for design to start, which is a separate "design intake" state we handle via Tasks, not the queue.

Also rename the UI count chip from "Survey Done" → "In Design". Page title stays "Design Queue".

### A3. Stage label alignment

`STAGE_LABELS` in `leads-helpers.ts` and `STAGE_ORDER` in `lead-stage-nav.tsx` are already aligned ("In Design" / "Design Done"). No change needed beyond confirming. The label drift Vivek noticed was probably between the Design Queue heading ("Survey Done") and the nav ("In Design") — fixed by A2.

---

## Stream B — Design queue restructure

The `/design` page becomes two sections:

### Section 1: **In Design — Leads**
Same as current queue minus the survey-done state — leads whose status is `design_in_progress` or `design_confirmed`. Existing UI mostly intact; the table component just gets the new filter.

### Section 2: **At-Site Design — Projects** (new)

Trigger: per Vivek (Q1=b), this only shows projects where Manivel **explicitly flags** them as needing design help. So we add:

**Migration 113** —
```sql
ALTER TABLE projects
  ADD COLUMN needs_site_design BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN needs_site_design_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN needs_site_design_requested_by UUID NULL REFERENCES employees(id),
  ADD COLUMN needs_site_design_note TEXT NULL;

COMMENT ON COLUMN projects.needs_site_design IS
  'Flagged TRUE by project_manager when a won project needs the design team to produce an at-site layout (e.g. unusual roof geometry or post-survey changes). Surfaces in /design Section 2.';
```

**UI on `/projects/[id]`:** new "Request site design" button visible to `project_manager` + `founder`. Sets the flag + records who/when + lets PM add a free-text note. Once design is done, designer clicks "Mark complete" to clear the flag.

**`/design` Section 2 renders:** project_number / customer_name / system_size_kwp / request_date / requested_by_name / note (truncated) — plus an "Open" link to the project detail page. Sortable by request date (oldest first — first-in-first-out).

**Why a project-level flag rather than a separate table:** the design request is a transient state of the project, not an entity in its own right. One project ever needs one outstanding request. If we later want history/audit, we add a `project_design_requests` table; v1 keeps it as a single boolean + audit timestamp.

---

## Stream C — Referrer system

Three pieces, all share the existing `channel_partners` table (with `is_internal` column from mig 109) + `leads.channel_partner_id` FK.

### C1. New "Referrer" column on the leads table

New column in `apps/erp/src/components/data-table/column-config.ts` for the `leads` entity:
- Key: `referrer`
- Label: `Referrer`
- Default-visible: yes
- Renders: badge showing partner name; **green "VIP" pill** prepended when `is_internal=TRUE`; em-dash when no `channel_partner_id` set
- Sortable: by partner name

`getLeads()` already pulls `channel_partner_id` — extend the select to embed partner name + `is_internal`:
```ts
channel_partners!leads_channel_partner_id_fkey(name, is_internal)
```

Flatten to `referrer_name` and `referrer_is_internal` on each row for DataTable.

### C2. "Referred by Clients" filter chip

New chip in the existing FilterBar on `/sales`:
- Label: "Referred by Clients"
- Behavior per Q2=a: applies `source='referral'` AND `channel_partner_id` is set AND that partner has `is_internal=FALSE`.
- URL param: `referredBy=clients`. Server query: small RPC `get_external_channel_partner_ids()` returning the IDs of `is_internal=FALSE` partners → `leads.channel_partner_id IN (...)`.

Implementation: extend `getLeads` filters with `referredBy?: 'clients' | 'internal' | 'any'`. The existing `referrer` + `referrerIds` filter machinery already supports a list of IDs — we just compute the right list.

### C3. Lead-edit referrer UI

Two surfaces:

**New lead form (`lead-form.tsx`):**
Add a `Referrer` field next to `Source`. Combobox listing all `channel_partners` (internal ones at the top with the VIP badge). Optional — empty means no referrer.

**Existing lead detail page (`/sales/[id]`):**
Add a "Referrer" row in the header info section with a small "Change" button → opens a dialog with the same combobox. New server action `setLeadReferrer(leadId, channelPartnerId|null)` does the write (founder + marketing_manager + sales_engineer can call).

Both surfaces share a new client component `<ReferrerPicker>` that fetches the partners list once and renders the combobox.

---

## Stream D — Closing This Month drill-down

Today the card is non-interactive. Change to:

- Wrap the card body in a `<Link href="/sales?closing=this_month">`.
- New URL param `closing` = `this_week` | `this_month`. Server-side `getLeads()` adds an `expected_close_date BETWEEN ...` filter when set.
- Same for "Closing This Week" card (consistency — wasn't clickable before either).

`/sales` page adds a chip pill at the top of the table when the filter is active: "Closing this month · clear ×".

---

## Stream E — UX polish

### Status badge restyle

Today: `LeadStatusBadge` uses 12 hardcoded Tailwind colour pairs (the May 19 batch — `STATUS_VARIANT` mapped to `info` / `warning` etc.). Result: muddy, low contrast, inconsistent saturation.

New design:
- One pill style across the board: rounded-full, h-5, px-2, text-[10px], font-semibold, uppercase tracking-wider
- Colour pairs picked from `docs/design/design-system.md` V2 tokens (not raw Tailwind)
- Specific palette (background / text):
  - `new` — `#EFF6FF` / `#1E40AF` (blue)
  - `contacted` — `#F1F3F5` / `#3F424D` (neutral)
  - `quick_quote_sent` — `#FFF7ED` / `#9A3412` (amber)
  - `site_survey_scheduled` — `#FEF3C7` / `#92400E`
  - `site_survey_done` — `#FEF9C3` / `#854D0E`
  - `design_in_progress` — `#EDE9FE` / `#5B21B6` (violet)
  - `design_confirmed` — `#E0E7FF` / `#3730A3` (indigo)
  - `detailed_proposal_sent` — `#FCE7F3` / `#9D174D` (pink)
  - `negotiation` — `#FFE4E6` / `#9F1239`
  - `closure_soon` — `#FFEDD5` / `#9A3412` (warm amber, suggests urgency)
  - `won` — `#DCFCE7` / `#166534` (Shiroi green)
  - `lost` — `#FEE2E2` / `#991B1B`
  - `on_hold` — `#F1F3F5` / `#6B7280` (muted neutral)
  - `disqualified` / `converted` — same as on_hold

All in `STATUS_LABELS_SHORT` from May 19 — labels stay terse ("Quick Quote", "Survey Sched", etc.).

### Table polish

Apply to the lead table specifically (don't ripple to other tables in this pass):
- Tighter row height: from `h-12` → `h-10`
- Header row: `bg-n-50`, `border-b-2 border-n-200`, sticky
- Subtle row stripe: `even:bg-n-50/30`
- Hover: `hover:bg-shiroi-green/[0.04]` (very faint green tint instead of grey)
- Cell padding: `px-3 py-2`
- Customer name column: `font-medium text-n-900`; other cells `text-n-600`
- Font for numeric columns (kWp, weighted value, expected close date): `font-mono tabular-nums text-right`
- Action ellipsis column gets a fixed `w-8`

## Out of scope

- Quote/PDF format work (per Vivek "we'll go into the entire quick quote after this") — separate pass.
- Other tables (projects, vendors, etc.) — the polish here is leads-table-only.
- Drive-folder integration for at-site design uploads — phase 2; v1 is just the request flag.
- Partner type taxonomy (customer vs builder vs management) beyond `is_internal` — already enough for "Referred by Clients" filter.

## Migration plan

Single migration this pass: **113 — projects.needs_site_design** (Stream B).

## Files touched

Created:
- `supabase/migrations/113_projects_needs_site_design.sql`
- `apps/erp/src/lib/projects-design-request-actions.ts` (request/clear flag)
- `apps/erp/src/components/projects/request-site-design-button.tsx`
- `apps/erp/src/components/leads/referrer-picker.tsx`
- `apps/erp/src/lib/lead-referrer-actions.ts`

Modified:
- `apps/erp/src/app/(erp)/design/page.tsx` — filter rename + Section 2 At-Site Design Projects
- `apps/erp/src/lib/cached-dashboard-queries.ts` — drop TTL 300s → 30s + add tag for revalidation
- `apps/erp/src/lib/leads-actions.ts` + `closure-actions.ts` + `inline-edit-actions.ts` — revalidateTag on status writes
- `apps/erp/src/lib/leads-queries.ts` — referrer embed + `referredBy` filter + `closing` filter
- `apps/erp/src/components/data-table/column-config.ts` — Referrer column + STATUS_VARIANT/STATUS_LABELS export shape
- `apps/erp/src/components/leads/lead-status-badge.tsx` — new palette
- `apps/erp/src/components/leads/lead-form.tsx` — Referrer field
- `apps/erp/src/app/(erp)/leads/[id]/page.tsx` — Referrer row + Change button
- `apps/erp/src/components/data-table/data-table.tsx` — polish (height/stripe/hover/typography) scoped via prop
- `apps/erp/src/components/leads/pipeline-summary.tsx` — clickable cards
- `apps/erp/src/components/dashboard/expected-orders-card.tsx` — clickable rows (if not already)
- `apps/erp/src/components/filter-bar.tsx` or new `referred-by-filter.tsx` — "Referred by Clients" chip

Documentation:
- `docs/CHANGELOG.md`, `docs/CURRENT_STATUS.md`, `docs/modules/sales.md`
