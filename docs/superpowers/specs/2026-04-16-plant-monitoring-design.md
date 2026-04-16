# Plant Monitoring Module — Design Spec

**Date:** 2026-04-16
**Author:** Claude (with Vivek)
**Requester:** Manivel (Project Manager)
**Status:** Approved, ready for implementation planning

---

## 1. Purpose

Centralise online monitoring portal credentials (username, password, portal URL) for every Shiroi solar plant in one searchable table under the O&M section. Auto-populate from the commissioning report workflow so engineers never re-enter data. Give Manivel and the founder the ability to edit/delete records when clients change their portal credentials post-handover.

## 2. User Stories

- **As Manivel (project_manager),** when I get a client message "my portal password changed", I want to open Plant Monitoring, filter to that project, click edit, update the password, and have the new value live instantly — without hunting through commissioning reports.
- **As an O&M technician,** when I'm responding to a service ticket and need to log into a plant's monitoring portal, I want to search by project name, click the portal link, and have it open in a new tab with the username/password visible so I can authenticate.
- **As Vivek (founder),** when a new plant is commissioned, I want its monitoring credentials to automatically appear in the Plant Monitoring table without any manual step — commissioning is already the source of truth.
- **As Manivel,** if I accidentally delete a credential, I want the option to recover it rather than lose the data forever.

## 3. Scope

### In scope
- New `plant_monitoring_credentials` DB table with multi-entry-per-project support.
- Postgres trigger that auto-inserts/updates a row when a commissioning report transitions to `submitted` or `finalized` status.
- Inverter brand auto-detection from URL pattern (sungrow, growatt, sma, huawei, fronius, solis).
- New route `/om/plant-monitoring` — list page with search, filters, pagination.
- Per-row password reveal toggle with 30-second auto-re-mask.
- Add / Edit / Delete (soft delete) actions for founder and project_manager roles.
- Read-only access for om_technician.
- Sidebar link under O&M for founder, project_manager, om_technician.
- Unique constraint preventing duplicate (project, portal_url) pairs.
- RLS policies consistent with migration 054 (uses `get_my_role()` helper).

### Out of scope
- Backfill of existing historical credentials (Vivek confirmed this will come from a separate data-scrape script later, not from this migration).
- Password strength validation.
- Password encryption at rest via Supabase Vault (stays plain text for consistency with `commissioning_reports.monitoring_password`; RLS + sidebar role gate protect access).
- Brand-specific live connectivity test.
- Full edit-history diff table (only `updated_at` + `updated_by` are tracked).
- Bulk import from CSV.
- Mobile-specific UX (uses standard responsive patterns only).

## 4. Data Model

### 4.1 New table: `plant_monitoring_credentials`

```sql
CREATE TABLE plant_monitoring_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commissioning_report_id UUID REFERENCES commissioning_reports(id) ON DELETE SET NULL,

  inverter_brand TEXT CHECK (inverter_brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis', 'other'
  )),

  portal_url TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES employees(id) ON DELETE SET NULL
);

-- Unique: one active credential per (project, portal_url) combo
CREATE UNIQUE INDEX plant_monitoring_credentials_unique_active
  ON plant_monitoring_credentials (project_id, portal_url)
  WHERE deleted_at IS NULL;

-- Query-path indexes
CREATE INDEX plant_monitoring_credentials_project_idx
  ON plant_monitoring_credentials (project_id) WHERE deleted_at IS NULL;
CREATE INDEX plant_monitoring_credentials_created_at_idx
  ON plant_monitoring_credentials (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX plant_monitoring_credentials_brand_idx
  ON plant_monitoring_credentials (inverter_brand) WHERE deleted_at IS NULL;
```

### 4.2 Fields — detail

| Field | Notes |
|-------|-------|
| `project_id` | Required. Every credential belongs to a project. `ON DELETE CASCADE` because credentials are meaningless without their project. |
| `commissioning_report_id` | Nullable. Populated by trigger when created from commissioning flow. NULL when manually added via the Add dialog. |
| `inverter_brand` | Populated by the URL-detection CASE in the trigger (or by `applyBrand()` helper on manual insert). `other` is the fallback bucket. |
| `portal_url` | Required. Stored as-is (no normalisation beyond trim). |
| `username`, `password` | Required. Plain text — same storage approach as `commissioning_reports.monitoring_password`. |
| `notes` | Optional free-form (e.g., "Client's account", "Installer backup account"). |
| `deleted_at` | Soft delete — per CLAUDE.md / existing codebase convention. |

### 4.3 Brand auto-detection

Stored as a shared SQL function `plant_monitoring_detect_brand(url TEXT)` so the trigger and the server-side `updateCredential` action produce identical output:

| URL contains (lowercased) | Brand |
|--------------------------|-------|
| `isolarcloud` | sungrow |
| `growatt` | growatt |
| `sma` OR `sunnyportal` | sma |
| `fusionsolar` OR `huawei` | huawei |
| `fronius` OR `solarweb` | fronius |
| `solis` OR `soliscloud` | solis |
| (no match) | `other` |

## 5. Auto-Sync Trigger

**Trigger name:** `trg_sync_plant_monitoring_from_commissioning`
**Event:** `AFTER UPDATE ON commissioning_reports`
**Fires when:** `NEW.status IN ('submitted', 'finalized') AND NEW.status IS DISTINCT FROM OLD.status`

**Logic:**

```sql
IF NEW.monitoring_portal_link IS NOT NULL
   AND NEW.monitoring_login IS NOT NULL
   AND NEW.monitoring_password IS NOT NULL
THEN
  INSERT INTO plant_monitoring_credentials (
    project_id, commissioning_report_id,
    portal_url, username, password,
    inverter_brand, created_by
  )
  VALUES (
    NEW.project_id, NEW.id,
    NEW.monitoring_portal_link, NEW.monitoring_login, NEW.monitoring_password,
    plant_monitoring_detect_brand(NEW.monitoring_portal_link),
    (SELECT id FROM employees WHERE profile_id = auth.uid())
  )
  ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL
  DO UPDATE SET
    username = EXCLUDED.username,
    password = EXCLUDED.password,
    commissioning_report_id = EXCLUDED.commissioning_report_id,
    inverter_brand = EXCLUDED.inverter_brand,
    updated_at = NOW(),
    updated_by = EXCLUDED.created_by;
END IF;
```

**Idempotency:** The partial-unique index + `ON CONFLICT DO UPDATE` means re-submissions of the same commissioning report don't create duplicates — they refresh the existing row.

**Employee lookup:** Uses the same `profile_id = auth.uid()` pattern as migration 055's `log_lead_status_change` fix, with NULL fallback if no employee row exists (covers system / migration contexts).

## 6. Row-Level Security

```sql
ALTER TABLE plant_monitoring_credentials ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY plant_monitoring_select ON plant_monitoring_credentials
  FOR SELECT USING (
    public.get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician'])
  );

-- INSERT
CREATE POLICY plant_monitoring_insert ON plant_monitoring_credentials
  FOR INSERT WITH CHECK (
    public.get_my_role() = ANY (ARRAY['founder', 'project_manager'])
  );

-- UPDATE
CREATE POLICY plant_monitoring_update ON plant_monitoring_credentials
  FOR UPDATE USING (
    public.get_my_role() = ANY (ARRAY['founder', 'project_manager'])
  );

-- DELETE — intentionally blocked (we soft-delete via UPDATE)
-- No DELETE policy = no physical deletes allowed.
```

Uses `public.get_my_role()` (STABLE SECURITY DEFINER, defined in migration 008a) for per-statement caching per migration 054's performance fix.

## 7. File Layout

Follows CLAUDE.md rule #15 (no inline Supabase in pages/components).

```
apps/erp/src/
├── app/(erp)/om/plant-monitoring/
│   ├── page.tsx                            # Server component, renders list
│   └── loading.tsx                         # Skeleton
├── lib/
│   ├── plant-monitoring-queries.ts         # listCredentials, getProjectsWithCredentials
│   └── plant-monitoring-actions.ts         # create, update, softDelete, restore
└── components/om/
    ├── plant-monitoring-table.tsx          # Client, wraps data-table shell
    ├── plant-monitoring-password-cell.tsx  # Per-row show/hide + 30s timer + copy
    ├── create-plant-monitoring-dialog.tsx
    ├── edit-plant-monitoring-dialog.tsx
    └── delete-plant-monitoring-button.tsx  # AlertDialog confirm

supabase/migrations/
└── 058_plant_monitoring.sql                # Table + trigger + brand helper + RLS

packages/types/
└── database.ts                             # Regenerated post-migration
```

All server actions return `ActionResult<T>` per CLAUDE.md rule #19.
All queries use typed rows (`Database['public']['Tables'][...]['Row']`) per rule #11.
No `any`, no `count: 'exact'` on the list query (rule #13).

## 8. UI

### 8.1 Route

`/om/plant-monitoring` — rendered under the `(erp)` layout group so it inherits the sidebar and topbar.

### 8.2 Page structure

- **Header row:** `Eyebrow` "O&M" + h1 "Plant Monitoring" + right-aligned "Add Credential" button (hidden for om_technician).
- **Sticky filter bar** (`sticky top-0 z-20 shadow-sm` Card, per convention):
  - `SearchInput` (200ms debounce; searches projects.customer_name + username).
  - `FilterSelect` — project. Populated via `getProjectsWithCredentials()` — returns only the subset of projects that actually have credentials (avoids listing 500+ unrelated projects).
  - `FilterSelect` — inverter brand (static list: all / sungrow / growatt / sma / huawei / fronius / solis / other).
- **Summary cards** (3 small):
  - Total plants monitored.
  - Brands breakdown (top 3 brands + count).
  - Missing credentials alert (count of projects that have at least one `commissioning_reports` row with `status IN ('submitted', 'finalized')` but zero live `plant_monitoring_credentials` rows — surfaces plants where the engineer submitted commissioning but skipped the monitoring fields).
- **Table** — see §8.3.
- **Pagination** — 50 per page, standard `PaginationControls` component, `count: 'estimated'`.

### 8.3 Table columns

| # | Column | Width | Content | Interaction |
|---|--------|-------|---------|-------------|
| 1 | Project Name | flex, min 200px | `projects.customer_name` | Click → navigates to `/projects/[id]` (green link) |
| 2 | Brand | 100px | Badge with brand name (colour per brand) | — |
| 3 | Username | 180px | Plain text | Selectable (allows copy) |
| 4 | Password | 160px | `PlantMonitoringPasswordCell` | Eye icon toggle per row |
| 5 | Monitoring Link | flex, min 200px | Truncated URL with external-link icon | `<a href target="_blank" rel="noopener noreferrer">` — opens in new tab |
| 6 | Created Date | 120px | `dd MMM yyyy` format | — |
| 7 | Actions | 100px | Edit pencil + Delete trash | Dialogs — hidden for om_technician |

### 8.4 Password cell behaviour

Client component — `plant-monitoring-password-cell.tsx`:

1. `useState<boolean>` `revealed` — default `false`.
2. Rendering:
   - `revealed === false` → render `••••••••` + `<Eye>` icon.
   - `revealed === true` → render actual password + `<EyeOff>` icon + `<Copy>` icon.
3. On eye click: toggle `revealed`, start 30-second `setTimeout` that forces `revealed = false`. Clear timer when toggled off manually.
4. On copy icon click: `navigator.clipboard.writeText(password)`, toast "Password copied".
5. Cleanup timer on unmount.

### 8.5 Add / Edit dialogs

Both use Radix Dialog from `@repo/ui`. Same form shape:

- **Fields:** Project (Add only; searchable select — disabled on Edit), Portal URL (required), Username (required), Password (required, input type=password with show-plain toggle), Notes (optional textarea).
- **Submit:** calls server action, shows `ActionResult`-driven toast, closes dialog on success, `router.refresh()`.
- **Brand:** not a field — always computed server-side via `plant_monitoring_detect_brand(portal_url)`.

### 8.6 Delete confirmation

`AlertDialog`: "Delete credentials for *{customer_name}*? The record will be soft-deleted and can be recovered by a founder from the database if needed."

Buttons: Cancel (grey) / Delete (red). Soft delete only — calls `softDeleteCredential(id)`.

## 9. Server Actions (`plant-monitoring-actions.ts`)

All return `ActionResult<T>`. All follow the `const op = '[actionName]'` error-logging pattern.

| Action | Signature | Notes |
|--------|-----------|-------|
| `createPlantMonitoringCredential` | `(input: {project_id, portal_url, username, password, notes?}) => ActionResult<Credential>` | Server recomputes `inverter_brand` via SQL helper. |
| `updatePlantMonitoringCredential` | `(id, patch: {portal_url?, username?, password?, notes?}) => ActionResult<Credential>` | Re-runs brand detection if `portal_url` present in patch. Updates `updated_at`/`updated_by`. |
| `softDeletePlantMonitoringCredential` | `(id) => ActionResult<{id}>` | Sets `deleted_at = NOW()`, `deleted_by = current_user`. |
| `restorePlantMonitoringCredential` | `(id) => ActionResult<{id}>` | Founder-only. Resets `deleted_at = NULL`. Not exposed in UI yet (DB operation only). |

## 10. Queries (`plant-monitoring-queries.ts`)

| Query | Signature | Notes |
|-------|-----------|-------|
| `listPlantMonitoringCredentials` | `(filters: {project_id?, brand?, search?, page, per_page}) => Promise<{items, total}>` | Paginated. Joins `projects` for customer_name. `count: 'estimated'`. |
| `getProjectsWithCredentials` | `() => Promise<Array<{id, customer_name}>>` | For the filter dropdown. Distinct project_ids that have live credentials. |
| `getPlantMonitoringSummary` | `() => Promise<{total, by_brand, missing_count}>` | For summary cards. Single RPC `get_plant_monitoring_summary()` returning all three values — avoids JS aggregation per rule #12. |

## 11. Sidebar

Add `plant_monitoring` to `ITEMS` in `roles.ts`:

```ts
ITEMS.plant_monitoring = {
  label: 'Plant Monitoring',
  href: '/om/plant-monitoring',
  icon: 'Activity',
};
```

Wire into `SECTIONS_BY_ROLE` under the O&M section for:
- `founder`
- `project_manager`
- `om_technician`

Register `Activity` in the sidebar ICON_MAP if not already.

## 12. Error Handling & Logging

Every server action uses the `const op = '[actionName]'` pattern. Errors returned as `err(message, code)`. Never throws. On the UI side, failed ActionResult → `toast.error(result.error)`.

## 13. Testing

- **Playwright smoke test** added to `apps/erp/e2e/smoke.spec.ts`: `/om/plant-monitoring` renders, no Next.js dev error overlay. Skips when login credentials env vars are unset (matches existing 5 smoke tests).
- **Manual verification checklist** (for Vivek before merge):
  - Submit a commissioning report with monitoring credentials → new row appears in `/om/plant-monitoring`.
  - Re-submit same commissioning report with changed password → existing row updates (no duplicate).
  - Add a credential manually → shows up in table.
  - Edit password → reflects immediately after `router.refresh`.
  - Delete → row disappears from list; row still exists in DB with `deleted_at` set.
  - As om_technician, sidebar link shows but Add/Edit/Delete buttons are absent.
  - Password reveal → shows plaintext, auto-hides after 30s.
  - Copy password → writes correct value to clipboard.
  - Filter by project, filter by brand, search — all produce correct results.

## 14. Migration Plan

1. Write `supabase/migrations/058_plant_monitoring.sql`.
2. Apply to dev via Supabase SQL Editor.
3. Regenerate types: `npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts`.
4. Commit migration + regenerated types together (rule #20).
5. Build the code (queries → actions → components → page → sidebar).
6. Manual verify per §13.
7. Production: apply migration 058 to prod Supabase after employee testing week.

## 15. Non-Goals / Explicit Deferrals

- **Historical backfill.** Vivek will scrape the existing credentials from wherever they live (WhatsApp, spreadsheets, Drive) via a separate script; this migration produces an empty `plant_monitoring_credentials` table. New commissioning submissions will populate it going forward.
- **Vault-based password encryption.** Keeps plain text for consistency with the rest of the system. RLS + role gating is the current security layer.
- **Brand-specific portal integration.** That belongs in the separate inverter-adapters work (migration 050 + `packages/inverter-adapters`), not here. This module is strictly a credential book.
- **Full edit history diff table.** Only `updated_at` + `updated_by` tracked — sufficient for accountability.

---

*End of spec.*
