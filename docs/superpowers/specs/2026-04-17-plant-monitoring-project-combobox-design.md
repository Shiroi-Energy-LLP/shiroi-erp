# Plant Monitoring — Searchable Project Combobox
**Date:** 2026-04-17
**Module:** O&M → Plant Monitoring
**Scope:** UI-only enhancement — no DB changes, no migration, no type regeneration

---

## Problem

The "Add Credential" dialog uses a plain `<select>` for project selection — no search capability, hard to use with 500+ projects. The main list page's project filter dropdown has the same limitation. There is also no escape hatch when a project doesn't exist yet.

---

## Solution

Replace both plain `<select>` elements with a searchable combobox backed by client-side filtering. When no match is found, show a "Create a new project →" link that opens `/projects/new` in a new tab.

---

## Architecture

### New components

**`apps/erp/src/components/forms/project-combobox.tsx`** — pure controlled client component.

Props:
```ts
interface ProjectComboboxProps {
  projects: { id: string; customer_name: string; project_number: string | null }[];
  value: string;           // selected project UUID (empty string = none)
  onChange: (id: string) => void;
  name?: string;           // if provided, renders a hidden <input> for FormData
  placeholder?: string;
  className?: string;
}
```

Behaviour:
- Text input + absolute-positioned dropdown below
- Client-side substring filter (case-insensitive) on `customer_name` and `project_number`, up to 50 matches shown
- Each row: `customer_name` as primary text, `project_number` as muted secondary text on the right
- When a project is selected: input shows `customer_name`, `×` clear button appears, hidden input (if `name` prop provided) holds the UUID
- When query returns no matches: dropdown shows "No projects found." + "Create a new project →" link that opens `/projects/new` in `_blank`
- Keyboard: `↑`/`↓` navigate highlight, `Enter` selects, `Escape` closes
- Click-outside closes dropdown via `mousedown` listener on `document`
- No `createPortal` needed — the Radix `DialogContent` already portals to `<body>`; a standard absolute-positioned dropdown inside it won't clip

**`apps/erp/src/components/om/project-filter-combobox.tsx`** — thin URL-aware wrapper (~25 lines).

- Reads `project` param from `useSearchParams()`
- On `onChange`, calls `router.push` updating `?project=<id>` and clearing `page`
- Clearing selection removes `project` from URL entirely
- Receives `projects` as a prop (already fetched server-side by `page.tsx`)

---

## Files Changed

| File | Change |
|------|--------|
| `apps/erp/src/components/forms/project-combobox.tsx` | **New** |
| `apps/erp/src/components/om/project-filter-combobox.tsx` | **New** |
| `apps/erp/src/components/om/create-plant-monitoring-dialog.tsx` | Replace `<select>` with `<ProjectCombobox name="project_id">` + add `useState<string>` for selected id |
| `apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx` | Replace `<FilterSelect paramName="project">` with `<ProjectFilterCombobox projects={filterProjects} />` |

---

## Data Flow

### Dialog (form mode)

```
page.tsx (server)
  → fetches allProjects (getAllActiveProjects, up to 1000)
  → passes to <CreatePlantMonitoringDialog projects={allProjects}>

CreatePlantMonitoringDialog (client)
  → useState<string>('') for selectedProjectId
  → <ProjectCombobox name="project_id" value={selectedProjectId} onChange={setSelectedProjectId}>
      → renders <input type="hidden" name="project_id" value={selectedProjectId} />
  → handleSubmit reads form.get('project_id') — unchanged

createPlantMonitoringCredential action — unchanged
```

### Filter bar (URL mode)

```
page.tsx (server)
  → fetches filterProjects (getProjectsWithCredentials)
  → renders <ProjectFilterCombobox projects={filterProjects} />

ProjectFilterCombobox (client)
  → reads useSearchParams().get('project')
  → onChange → router.push with updated ?project= param
  → delegates rendering to <ProjectCombobox value={...} onChange={...} />
```

---

## UX Details

- **Idle:** input shows placeholder ("Search projects…"), dropdown hidden
- **Typing:** dropdown opens immediately, list filtered on each keystroke
- **Selected:** input shows customer name, `×` button clears, hidden input holds UUID
- **No matches:** "No projects found." + "Create a new project →" (`target="_blank"`, `rel="noopener noreferrer"`)
- **Max results shown:** 50 (user should type more to narrow down)
- **Styling:** matches existing `Input` component sizing (`h-9 text-sm` in dialog, `h-8 text-xs` in filter bar); dropdown uses `border border-n-200 rounded-md shadow-sm bg-white z-50`

---

## What Does NOT Change

- `plant-monitoring-queries.ts` — no changes
- `plant-monitoring-actions.ts` — no changes
- DB schema / migrations — none
- `packages/types/database.ts` — not touched
- `edit-plant-monitoring-dialog.tsx` — project is not editable after creation; no change needed

---

## Out of Scope

- Creating a project record inline (requires lead + proposal chain — not feasible)
- Server-side search (client-side filtering of ≤1000 rows is sufficient)
- Applying the combobox to other modules (separate task if needed)
