# Liaison TNEB Stages Redesign — May 23, 2026

## What we're building

Rebuild the liaison module around the official TNEB net-metering stage vocabulary, add an "awaiting client details" blocking flag, move CEIG scope ownership to Manivel (project setup), and replace the two-page dashboard → table navigation with a single unified `/liaison` page combining summary cards + table.

---

## DB Changes — Migration 114

### 1. Rename `discom_status` CHECK values

Drop and recreate the CHECK constraint on `net_metering_applications.discom_status`. UPDATE all existing rows to the new values:

| Old value | New value | TNEB label |
|---|---|---|
| `pending` | `pending` | (not yet applied) |
| `applied` | `applied` | Applied |
| `under_review` | `tneb_verified` | Verified |
| `site_inspection_scheduled` | `tneb_inspected` | Inspected |
| `approved` | `tneb_estimated` | Estimated (demand note) |
| `net_meter_installed` | `installation_completed` | Installation Completed |
| *(missing)* | `service_effected` | Service Effected |
| `rejected` | `rejected` | Rejected |
| `objection_raised` | `objection_raised` | Objection Raised |

The `enforce_ceig_block` trigger is unaffected — it only checks `discom_status != 'pending'`, and `pending` is unchanged.

Fix the latent bug: `service_effected` was checked in `step-liaison.tsx` as `activated` but never existed in the DB constraint. Rows with `activated` do not exist (constraint would have blocked them) — no data migration needed for this value.

### 2. Add "awaiting client details" columns

```sql
awaiting_client_details  BOOLEAN      NOT NULL DEFAULT FALSE,
awaiting_client_since    TIMESTAMPTZ  NULL,
awaiting_client_note     TEXT         NULL
```

This is orthogonal to the TNEB stage — a project at `tneb_inspected` can simultaneously have `awaiting_client_details = TRUE`. The note captures what specifically is needed from the client.

### 3. Move `ceig_scope` to `projects` table

`ceig_scope` is currently on `net_metering_applications`. It belongs at the project level because Manivel (project_manager) sets it at order receipt — before the liaison workflow even starts.

```sql
-- on projects table:
ALTER TABLE projects
  ADD COLUMN ceig_scope TEXT NOT NULL DEFAULT 'shiroi'
    CHECK (ceig_scope IN ('shiroi', 'client'));
```

Backfill: copy `ceig_scope` from each project's existing NMA row into `projects.ceig_scope`. Then drop `ceig_scope` from `net_metering_applications`.

Manivel sets this during project creation/edit (project stepper or project form). The NMA creation action reads `project.ceig_scope` at creation time and sets `ceig_required` accordingly.

### 4. CEIG auto-set rule

No DB trigger. In `createNetMeteringApplication`, after fetching the project:

```
if project.system_size_kwp >= 10
   AND project.system_type != 'off_grid'
   AND project.ceig_scope = 'shiroi'
→ INSERT with ceig_required = TRUE
```

If `ceig_scope = 'client'`, ceig_required stays FALSE and the CEIG panel is suppressed.

---

## Page Structure

### `/liaison` — unified page (full rewrite)

Replaces the old 4-card dashboard. Single page: 5 summary cards at the top, full table below. No separate `/liaison/net-metering` list page (redirect or remove).

**Summary cards** (each clickable — appends `?filter=<key>` to URL, table re-renders filtered):

| Card | Filter logic |
|---|---|
| Total Applications | all rows (clears filter) |
| Awaiting Client | `awaiting_client_details = TRUE` |
| CEIG Pending | `ceig_required = TRUE AND ceig_status = 'pending'` |
| CEIG In Process | `ceig_required = TRUE AND ceig_status IN ('applied', 'inspection_scheduled')` |
| TNEB Active | `discom_status IN ('applied', 'tneb_verified', 'tneb_inspected', 'tneb_estimated', 'installation_completed')` |

Card counts are computed in a single RPC `get_liaison_summary()` returning all 5 counts in one query (NEVER-DO #12 — no JS aggregation).

### Table columns

| Column | Detail |
|---|---|
| Project | `project_number — customer_name`, links to `/liaison/net-metering/[projectId]` |
| kWp | right-aligned, monospace, tabular-nums |
| CEIG Status | Badge rendered only when `ceig_required = TRUE`; uses CEIG-specific colour set |
| TNEB Stage | Colour-coded badge (see palette below) |
| Awaiting Client | Warm-amber badge rendered only when `awaiting_client_details = TRUE`; displayed inline after the TNEB Stage badge in the same cell |
| Application Date | Formatted date or `—` |
| Next Follow-up | Formatted date; highlighted red when past due |
| Actions | `⋯` dropdown: Open detail, Mark Awaiting Client, Clear Awaiting |

### Table UX

Matches the leads table polish from the May 20 spec:
- Row height `h-10`
- Sticky header `bg-n-50`, `border-b-2 border-n-200`
- Even-row stripe `even:bg-n-50/30`
- Hover `hover:bg-shiroi-green/[0.04]`
- Cell padding `px-3 py-2`
- Customer name: `font-medium text-n-900`; other cells: `text-n-600`
- kWp / dates: `font-mono tabular-nums`

---

## Status Badge Palette

Pill style: `rounded-full h-5 px-2 text-[10px] font-semibold uppercase tracking-wider`

### TNEB stage badges

| Value | Background | Text | Label |
|---|---|---|---|
| `pending` | `#F1F3F5` | `#3F424D` | Pending |
| `applied` | `#EFF6FF` | `#1E40AF` | Applied |
| `tneb_verified` | `#E0E7FF` | `#3730A3` | Verified |
| `tneb_inspected` | `#EDE9FE` | `#5B21B6` | Inspected |
| `tneb_estimated` | `#FEF3C7` | `#92400E` | Estimated |
| `installation_completed` | `#CCFBF1` | `#0F766E` | Installation Done |
| `service_effected` | `#DCFCE7` | `#166534` | Service Effected |
| `rejected` | `#FEE2E2` | `#991B1B` | Rejected |
| `objection_raised` | `#FFEDD5` | `#9A3412` | Objection Raised |

### Awaiting client flag badge

`#FFF7ED` / `#9A3412` — label: "Awaiting Client"

### CEIG status badges

| Value | Variant |
|---|---|
| `pending` | outline (neutral) |
| `applied` | blue |
| `inspection_scheduled` | purple |
| `approved` | green |
| `rejected` | red |
| `reapplied` | amber |
| `not_applicable` | muted |

---

## Workflow: Awaiting Client Details

New action `setAwaitingClientDetails(applicationId, awaiting: boolean, note?: string)`:
- Sets `awaiting_client_details`, `awaiting_client_since` (now() when marking true, null when clearing), `awaiting_client_note`
- Accessible to `marketing_manager` + `founder`
- Triggered from the table `⋯` actions or from the per-project detail panel

No separate DB table — it's a flag on the application row. If audit history of blocking events is needed later, a `liaison_events` table can be added in a follow-up.

---

## CEIG Scope UI (project level)

`CeigScopeToggle` is **removed** from the liaison panel (`liaison-form.tsx`).

A new "CEIG handled by" field (radio: Shiroi / Client) is added to the project creation/edit form accessible to `project_manager` + `founder`. It writes `projects.ceig_scope`. Default is `'shiroi'`.

When Manivel sets `ceig_scope = 'client'`, the CEIG panel in the liaison step collapses to a read-only "CEIG managed by Client" note (existing behaviour — just now driven by `projects.ceig_scope` instead of a toggle Prem can flip).

---

## Step-Liaison Workflow Bar

`deriveWorkflowStages` updated to use new stage values and labels:

1. **Application Created** — always done
2. **CEIG Clearance** — shown when `showCeig = (project.ceig_scope = 'shiroi' && sizeKwp >= 10 && systemType != 'off_grid')`
3. **Applied** — `discom_status != 'pending'`
4. **Verified** — `discom_status IN ('tneb_verified', 'tneb_inspected', 'tneb_estimated', 'installation_completed', 'service_effected')`
5. **Inspected** — same pattern upward
6. **Estimated** — `discom_status IN ('tneb_estimated', 'installation_completed', 'service_effected')`
7. **Installation Completed** — `discom_status IN ('installation_completed', 'service_effected')`
8. **Service Effected** — `discom_status = 'service_effected'`

The CEIG stage (if shown) sits between "Application Created" and "Applied", same as before.

---

## Routing

| Route | Change |
|---|---|
| `/liaison` | Full rewrite — unified cards + table |
| `/liaison/net-metering` | Redirect to `/liaison` (keep file as a one-line redirect page) |
| `/liaison/net-metering/[projectId]` | Unchanged — per-project detail |

---

## Files

**New:**
- `supabase/migrations/114_liaison_tneb_stages.sql`
- `apps/erp/src/components/liaison/liaison-status-badge.tsx`
- `apps/erp/src/components/liaison/awaiting-client-toggle.tsx`
- `apps/erp/src/lib/liaison-summary-queries.ts` (RPC `get_liaison_summary()` + card count helpers)

**Modified:**
- `apps/erp/src/app/(erp)/liaison/page.tsx` — full rewrite
- `apps/erp/src/app/(erp)/liaison/net-metering/page.tsx` — redirect or delete
- `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx` — new stage names + remove CeigScopeToggle
- `apps/erp/src/components/projects/forms/liaison-form.tsx` — update DiscomStatusForm options, add AwaitingClientToggle, remove CeigScopeToggle
- `apps/erp/src/lib/liaison-actions.ts` — rename status values, add `setAwaitingClientDetails`, update `createNetMeteringApplication`
- `apps/erp/src/lib/liaison-queries.ts` — update table query with new `discom_status` values + `awaiting_client_details` filter; add `?filter=` param support
- `apps/erp/src/app/(erp)/projects/[id]/page.tsx` — add `ceig_scope` field for Manivel
- `packages/types/database.ts` — regenerate after migration

---

## Out of scope

- Objection tracking UI improvements (separate pass)
- Document upload audit trail
- TNEB application number / demand note PDF upload in the new table (detail page handles this)
- n8n notification on `awaiting_client_details` set (Phase 2 — wire `emitErpEvent` after the UI ships)
