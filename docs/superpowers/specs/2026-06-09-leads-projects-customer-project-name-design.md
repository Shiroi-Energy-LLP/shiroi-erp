# Customer + Project Name on Leads & Projects — Design

> Date: 2026-06-09
> Status: Approved (design) — pending spec review
> Module: sales (leads) + projects
> Related: `docs/modules/sales.md`, `docs/modules/projects.md`

## Problem

A single customer can run many solar projects — e.g. **Lancor Holdings** is one
company with several sites/towers. Today a lead carries only a free-text
`customer_name`, with no notion of "which company" or "which project". On the
`/leads` and `/sales` lists you can't tell two Lancor leads apart, and when a
lead is Won the resulting project inherits the same ambiguity.

We want:

1. A lead (and its eventual project) to optionally belong to a **company**
   record and carry a **project name**.
2. The lists to show a combined **"Customer — Project"** label by default,
   with standalone Company / Project Name / Customer Name available as
   toggleable columns.
3. The same label to follow a deal into the **Projects** module when it is Won.
4. (Phase 2, later) Existing leads + projects backfilled into this shape so
   there's no ambiguity going forward.

## Decisions (locked during brainstorming)

- **Data model — link to company records** (not a flat text field). Leads point
  at the existing `companies` table via the already-present `leads.company_id`
  FK. This enables real per-company grouping/rollups later.
- **Company is the customer.** When a company is linked, the list's customer
  label shows the **company name**; when none is linked it falls back to the
  lead's typed `customer_name` (e.g. residential individuals). The existing
  `customer_name` field stays as the on-site / contact-person name and remains
  required, so nothing existing breaks.

## What already exists (no work needed)

- `leads.company_id` — nullable FK → `companies`, **already indexed** (mig 016
  `idx_leads_company`). Added long ago, cleared in mig 017, unused since.
- `projects.company_id` — nullable FK → `companies` (mig 017 era).
- `companies` table + `createCompany` / `updateCompany` actions
  (`contacts-actions.ts`) + `getCompanies` / `getCompany` queries
  (`contacts-queries.ts`) + a `/companies` page.
- `DataTable` renders the link cell as `row[linkField]` (data-table.tsx:432),
  so a **computed** `customer_project` field on each row works as the default
  link column with no special renderer required.
- Inline editing is generic: `updateCellValue` writes any non-blocked field, so
  `project_name` is inline-editable with **zero** allow-list changes.
- The Won→project trigger already `SELECT … INTO v_lead FROM leads` then
  `INSERT INTO projects (…)` (mig 094) — carrying two more columns is the same
  surgical edit it used for `map_link`.

## Data model changes

One migration (`172_2026-06-09-leads-projects-project-name.sql`):

```sql
ALTER TABLE leads    ADD COLUMN project_name TEXT;
ALTER TABLE projects ADD COLUMN project_name TEXT;
-- ensure projects.company_id is indexed (add if mig 017 didn't); leads already is
CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);
```

- **No backfill** in this phase. Existing rows keep `company_id`/`project_name`
  NULL and render via the `customer_name` fallback exactly as today.
- Regenerate `packages/types/database.ts` in the **same commit** (NEVER-DO #20).

## Display semantics (computed per row, in the query layer)

```
displayCustomer = company?.name ?? customer_name
customer_project = project_name
  ? `${displayCustomer} — ${project_name}`   // em dash
  : displayCustomer
company_name     = company?.name ?? null     // standalone column
```

| Row | `customer_project` renders as |
|-----|-------------------------------|
| Company *Lancor Holdings* + project *Anna Nagar Tower* | **Lancor Holdings — Anna Nagar Tower** |
| Residential, no company, no project | **Rajesh Kumar** |
| Individual + project, no company | **Rajesh Kumar — Farmhouse** |

Rendered as the existing single-line green link. Applies identically to leads
and projects.

## Leads

### Columns (`LEAD_COLUMNS` in `data-table/column-config.ts`)
- **NEW `customer_project`** — label "Customer — Project". `defaultVisible: true`,
  `frozen: true`, acts as the link column, `sortKey: 'customer_name'`.
- **NEW `company_name`** — label "Company". `defaultVisible: false` (toggle).
- **NEW `project_name`** — label "Project Name". `defaultVisible: false`,
  `editable: true`, `fieldType: 'text'`.
- **`customer_name`** — keep as a toggle option; flip `defaultVisible: false`
  and `frozen: false`.
- In `leads-table-wrapper.tsx`, change `linkField="customer_name"` →
  `linkField="customer_project"`.

### Queries (`leads-queries.ts`)
- `getLeads` (PostgREST path): add `project_name` to the select and embed
  `companies!leads_company_id_fkey(name)`; in the existing `.map`, compute
  `company_name` + `customer_project` onto each row (alongside `assigned_to_name`
  etc.).
- `getLeadsViaSearchRpc` (search path): the RPC must return `company_id`,
  company name, and `project_name`; compute `customer_project` in its `.map` the
  same way, so the columns don't blank out under search.

### Search RPC (`search_leads_by_query`, recreate in mig 172)
- Add `company_id`, company `name`, and `project_name` to the `RETURNS TABLE`
  and the `SELECT`.
- Extend the text match so typing "Lancor" (company name) or a project name
  finds the lead, in addition to the current customer_name/phone/etc. matching.

### Setting company + project
- **NEW `CompanyPicker`** client component (modeled on `ReferrerPicker`):
  searches existing companies via `getCompanies`, with inline "create new
  company" via `createCompany`. Returns the chosen `company_id` (or null).
- **Create form** (`lead-form.tsx`): add optional Company picker + Project Name
  input. Insert `company_id` + `project_name`.
- **Lead detail page** (`leads/[id]/layout.tsx` + a small edit affordance):
  allow editing Company (via `CompanyPicker`) and Project Name, next to the
  existing name rename.
- **Table**: `project_name` is inline-editable out of the box. Inline
  company-edit from the table is **out of scope** (set via form/detail) — the
  combined column is the link, and a full searchable picker doesn't fit the
  inline-select pattern.

## Projects

The Projects list (`/projects`) uses the same `DataTable`.

### Columns (`PROJECT_COLUMNS`)
- **NEW `customer_project`** — "Customer — Project", `defaultVisible: true`,
  `sortKey: 'customer_name'`. Display column (the project **row link** stays
  `project_number`, matching today's behavior).
- **NEW `company_name`** — "Company", `defaultVisible: false`.
- **NEW `project_name`** — "Project Name", `defaultVisible: false`,
  `editable: true`.
- `customer_name` stays a toggle option (flip `defaultVisible: false`).

### Queries (projects list query)
- Embed `companies!projects_company_id_fkey(name)` + select `project_name`;
  compute `company_name` + `customer_project` in the row mapping.

### Carry-through on Won (mig 172, recreate `create_project_from_accepted_proposal`)
- Add `company_id, project_name` to the `SELECT … INTO v_lead FROM leads`.
- Add `company_id, project_name` to the `INSERT INTO projects (…)` column +
  value lists.
- All other logic preserved verbatim (same surgical style as mig 094's
  `map_link` change). New won deals then show the combined label automatically.

### Editing on a project
- Add Company (`CompanyPicker`) + Project Name editing on the project detail
  page, and make `project_name` inline-editable in the projects table. This is
  also the manual tool the Phase-2 backfill leans on for corrections.

## Files to touch

- `supabase/migrations/172_2026-06-09-leads-projects-project-name.sql` (new)
- `packages/types/database.ts` (regenerate)
- `apps/erp/src/components/data-table/column-config.ts`
- `apps/erp/src/components/leads/leads-table-wrapper.tsx`
- `apps/erp/src/lib/leads-queries.ts`
- `apps/erp/src/components/leads/lead-form.tsx`
- `apps/erp/src/components/leads/company-picker.tsx` (new)
- Lead detail: `apps/erp/src/app/(erp)/sales/[id]/layout.tsx` (+ edit dialog/fields)
- `apps/erp/src/lib/projects-queries.ts`
- `apps/erp/src/components/projects/projects-table-wrapper.tsx`
- `apps/erp/src/app/(erp)/projects/[id]/page.tsx` (company + project_name editing)
- `CompanyPicker` reused on both lead + project detail

## Out of scope — Phase 2 (separate spec, after this ships)

Backfill of existing leads + projects into companies + project names. This is
judgment-heavy: deciding which rows cluster into one company, creating deduped
company records, and naming each project can't be a blind script. It gets its
own brainstorm → spec → plan once Phase 1 is live. Phase 1 deliberately ships
the manual tools (pickers, inline edit, detail editing) the backfill will use.

Also deferred: a company filter / group-by on the lists; per-company rollup
views.

## Testing / verification

- `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`
  all green (read actual stdout — CI gate discipline).
- Manual: create a lead with a new company + project → list shows
  "Company — Project"; residential lead with neither shows just the name;
  toggle Company / Project Name / Customer Name columns; inline-edit a project
  name; search by company name finds the lead.
- Win a lead that has a company + project → the spawned project shows the same
  combined label on `/projects`.

## Risks & gotchas

- **Search RPC parity** — every filter the PostgREST path applies must still
  work through the recreated RPC, and the new columns must be returned, or they
  vanish whenever a search term is present. (Existing pattern in
  `getLeadsViaSearchRpc`.)
- **Silent RLS on lead/project UPDATE** — any new update path must `.select('id')`
  and treat zero rows as "blocked" (sales module known gotcha).
- **Single source of truth** — `customer_name` is referenced in
  `leads-table.tsx` (legacy simple table) and cell-styling in `data-table.tsx`
  (`col.key === 'customer_name'`); extend styling hooks to `customer_project`.
- **Won cascade has a bulk-import bypass** — direct-INSERT projects (imports)
  won't get the new fields here; that's covered by the Phase-2 backfill.
