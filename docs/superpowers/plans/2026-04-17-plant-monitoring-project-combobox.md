# Plant Monitoring — Searchable Project Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `<select>` project picker in the Add Credential dialog and the project filter dropdown on the Plant Monitoring list page with a searchable combobox that supports client-side filtering and a "Create new project" escape hatch.

**Architecture:** A pure controlled `ProjectCombobox` client component handles search/select UI; a thin `ProjectFilterCombobox` wrapper reads/writes URL params for the filter bar. The dialog bridges the combobox to the existing `FormData`-based submit handler via a hidden `<input name="project_id">` — no action or query changes needed.

**Tech Stack:** Next.js 14 App Router, React client components, `useSearchParams` / `useRouter` for URL state, Tailwind CSS, lucide-react (`Search`, `X` icons).

---

## File Map

| File | Action |
|------|--------|
| `apps/erp/src/components/forms/project-combobox.tsx` | **Create** — pure controlled combobox |
| `apps/erp/src/components/om/project-filter-combobox.tsx` | **Create** — URL-aware wrapper for the filter bar |
| `apps/erp/src/components/om/create-plant-monitoring-dialog.tsx` | **Modify** — swap `<select>` → `<ProjectCombobox>` |
| `apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx` | **Modify** — swap `<FilterSelect paramName="project">` → `<ProjectFilterCombobox>` |

No DB changes. No migration. No type regeneration.

---

### Task 1: Create `ProjectCombobox` — pure controlled combobox

**Files:**
- Create: `apps/erp/src/components/forms/project-combobox.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';

interface ProjectOpt {
  id: string;
  customer_name: string;
  project_number: string | null;
}

export interface ProjectComboboxProps {
  projects: ProjectOpt[];
  /** Selected project UUID. Empty string = nothing selected. */
  value: string;
  onChange: (id: string) => void;
  /** If provided, renders a hidden <input name={name}> for FormData. */
  name?: string;
  placeholder?: string;
  /** Tailwind classes for the outer wrapper div — controls width. */
  className?: string;
  /** Tailwind classes for the visible input — controls height + text size.
   *  Default: 'h-9 text-sm' (dialog size). Pass 'h-8 text-xs' for filter bar. */
  inputClassName?: string;
}

export function ProjectCombobox({
  projects,
  value,
  onChange,
  name,
  placeholder = 'Search projects…',
  className,
  inputClassName = 'h-9 text-sm',
}: ProjectComboboxProps) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedProject = React.useMemo(
    () => projects.find((p) => p.id === value) ?? null,
    [projects, value],
  );

  const filtered = React.useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return projects.slice(0, 50);
    return projects
      .filter(
        (p) =>
          p.customer_name.toLowerCase().includes(lower) ||
          (p.project_number?.toLowerCase().includes(lower) ?? false),
      )
      .slice(0, 50);
  }, [query, projects]);

  // Close dropdown on click outside
  React.useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setOpen(true);
    setHighlighted(-1);
    // Clear any existing selection when user starts typing
    if (value) onChange('');
  }

  function handleSelect(project: ProjectOpt) {
    onChange(project.id);
    setQuery('');
    setOpen(false);
    setHighlighted(-1);
  }

  function handleClear() {
    onChange('');
    setQuery('');
    setHighlighted(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) handleSelect(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // Show selected project name in input; otherwise show live query
  const displayValue = selectedProject ? selectedProject.customer_name : query;

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      {/* Hidden input feeds FormData when used inside a <form> */}
      {name && <input type="hidden" name={name} value={value} />}

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full pl-8 pr-8 border border-n-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-shiroi-green ${inputClassName}`}
        />
        {(value || query) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-n-400 hover:text-n-700"
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-n-200 bg-white shadow-md max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-xs text-n-500">No projects found.</p>
              <a
                href="/projects/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#00B050] hover:underline mt-1 inline-block"
              >
                Create a new project →
              </a>
            </div>
          ) : (
            <ul role="listbox">
              {filtered.map((project, i) => (
                <li
                  key={project.id}
                  role="option"
                  aria-selected={project.id === value}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent input blur before select fires
                    handleSelect(project);
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer select-none ${
                    i === highlighted || project.id === value
                      ? 'bg-n-100 text-n-900'
                      : 'text-n-700 hover:bg-n-50'
                  }`}
                >
                  <span className="truncate text-sm">{project.customer_name}</span>
                  {project.project_number && (
                    <span className="ml-2 text-[10px] text-n-400 flex-shrink-0 font-mono">
                      {project.project_number}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/erp && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors from `project-combobox.tsx`. Fix any type errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/forms/project-combobox.tsx
git commit -m "feat(plant-monitoring): add ProjectCombobox searchable project picker

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create `ProjectFilterCombobox` — URL-aware wrapper

**Files:**
- Create: `apps/erp/src/components/om/project-filter-combobox.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProjectCombobox } from '@/components/forms/project-combobox';

interface ProjectOpt {
  id: string;
  customer_name: string;
  project_number: string | null;
}

interface ProjectFilterComboboxProps {
  projects: ProjectOpt[];
}

export function ProjectFilterCombobox({ projects }: ProjectFilterComboboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const value = searchParams.get('project') ?? '';

  function handleChange(id: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (id) {
      p.set('project', id);
    } else {
      p.delete('project');
    }
    p.delete('page'); // reset pagination on filter change
    router.push(`/om/plant-monitoring?${p.toString()}`);
  }

  return (
    <ProjectCombobox
      projects={projects}
      value={value}
      onChange={handleChange}
      placeholder="Filter by project…"
      className="w-48"
      inputClassName="h-8 text-xs"
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/erp && npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/om/project-filter-combobox.tsx
git commit -m "feat(plant-monitoring): add ProjectFilterCombobox URL-aware wrapper

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Update `CreatePlantMonitoringDialog` — swap `<select>` for `<ProjectCombobox>`

**Files:**
- Modify: `apps/erp/src/components/om/create-plant-monitoring-dialog.tsx`

Changes:
1. Import `ProjectCombobox`
2. Add `projectId` state
3. Replace `<select>` with `<ProjectCombobox name="project_id">`
4. Add `handleOpenChange` to reset `projectId` and `error` on close
5. Disable Save button when no project selected (extra guard — server action also validates)

- [ ] **Step 1: Overwrite the file**

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createPlantMonitoringCredential } from '@/lib/plant-monitoring-actions';
import { ProjectCombobox } from '@/components/forms/project-combobox';

interface ProjectOpt {
  id: string;
  customer_name: string;
  project_number: string | null;
}

interface CreatePlantMonitoringDialogProps {
  projects: ProjectOpt[];
}

export function CreatePlantMonitoringDialog({ projects }: CreatePlantMonitoringDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [projectId, setProjectId] = React.useState('');

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) {
      // Reset dialog-local state when closing so next open is clean
      setProjectId('');
      setError(null);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await createPlantMonitoringCredential({
      project_id: String(form.get('project_id') ?? ''),
      portal_url: String(form.get('portal_url') ?? ''),
      username: String(form.get('username') ?? ''),
      password: String(form.get('password') ?? ''),
      notes: String(form.get('notes') ?? '') || null,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    handleOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Credential
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Monitoring Credential</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label>Project *</Label>
            <ProjectCombobox
              projects={projects}
              value={projectId}
              onChange={setProjectId}
              name="project_id"
              placeholder="Search by customer name or project number…"
              className="w-full"
            />
            {!projectId && (
              <p className="text-[10px] text-n-400 mt-0.5">
                Can&apos;t find the project?{' '}
                <a
                  href="/projects/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00B050] hover:underline"
                >
                  Create it first →
                </a>
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="portal_url">Portal URL *</Label>
            <Input
              id="portal_url"
              name="portal_url"
              type="url"
              required
              placeholder="https://isolarcloud.com/..."
              className="h-9 text-sm"
            />
          </div>

          <div>
            <Label htmlFor="username">Username *</Label>
            <Input id="username" name="username" required className="h-9 text-sm" />
          </div>

          <div>
            <Label htmlFor="password">Password *</Label>
            <div className="flex gap-1">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                className="h-9 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              className="w-full rounded-md border border-n-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !projectId}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/erp && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/om/create-plant-monitoring-dialog.tsx
git commit -m "feat(plant-monitoring): replace project <select> with searchable combobox in Add dialog

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Update `page.tsx` — replace project `<FilterSelect>` with `<ProjectFilterCombobox>`

**Files:**
- Modify: `apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx`

The `FilterSelect` import stays — it is still used for the brand filter. Only the project filter block changes.

- [ ] **Step 1: Add import**

In the imports section of `page.tsx`, add:
```tsx
import { ProjectFilterCombobox } from '@/components/om/project-filter-combobox';
```

- [ ] **Step 2: Replace the project FilterSelect**

Find and replace this block:
```tsx
<FilterSelect paramName="project" className="w-48 text-xs h-8">
  <option value="">All Projects</option>
  {filterProjects.map((p) => (
    <option key={p.id} value={p.id}>{p.customer_name}</option>
  ))}
</FilterSelect>
```

With:
```tsx
<ProjectFilterCombobox projects={filterProjects} />
```

- [ ] **Step 3: TypeScript check**

```bash
cd apps/erp && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 4: Next.js build check**

```bash
cd apps/erp && npx next build 2>&1 | tail -25
```

If you see: `useSearchParams() should be wrapped in a suspense boundary` — wrap the component in `page.tsx`:
```tsx
import * as React from 'react';
// ...
<React.Suspense fallback={
  <div className="w-48 h-8 rounded-md border border-n-300 bg-n-50 animate-pulse" />
}>
  <ProjectFilterCombobox projects={filterProjects} />
</React.Suspense>
```

Otherwise (build succeeds without the warning), no Suspense wrapper needed.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx
git commit -m "feat(plant-monitoring): replace project filter dropdown with searchable combobox

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Manual verification + push

- [ ] **Step 1: Start dev server**

```bash
cd apps/erp && pnpm dev
```

- [ ] **Step 2: Verify Add Credential dialog**

Navigate to `http://localhost:3000/om/plant-monitoring` and click "Add Credential":

| Check | Expected |
|-------|----------|
| Type a customer name | Dropdown opens, list filters |
| Type a non-existent name | "No projects found. Create a new project →" appears |
| Click "Create a new project →" | `/projects/new` opens in a **new tab** |
| Select a project | Input shows customer name; project number visible in row |
| Click `×` | Selection clears, input resets |
| Press `↓` `↑` | Highlights move through list |
| Press `Enter` on highlighted item | Item selected |
| Press `Escape` | Dropdown closes |
| Cancel dialog, reopen | Project field is **blank** (state was reset) |
| Submit with project selected | Credential saved, dialog closes |
| Submit with **no** project | Save button is disabled — cannot submit |

- [ ] **Step 3: Verify filter bar**

| Check | Expected |
|-------|----------|
| Type in project filter | Dropdown opens, filters projects |
| Select a project | URL gains `?project=<uuid>`, list narrows |
| Click `×` | `project` param removed from URL, full list shown |
| Combine with brand filter | Both params present in URL simultaneously |

- [ ] **Step 4: Run Playwright smoke test**

```bash
cd apps/erp && npx playwright test e2e/smoke.spec.ts --reporter=line
```
Expected: all 6 tests pass.

- [ ] **Step 5: Push**

```bash
git push origin main
```
