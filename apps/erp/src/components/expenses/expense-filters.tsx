'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Input, Select, Button } from '@repo/ui';
import { ProjectCombobox } from '@/components/forms/project-combobox';
import { EXPENSE_STATUSES } from '@/lib/expenses-constants';

interface ProjectOpt {
  id: string;
  project_number: string | null;
  project_name: string | null;
  customer_name: string | null;
}

const FILTER_KEYS = ['search', 'scope', 'status', 'category', 'submitter', 'project'] as const;

export function ExpenseFilters({
  categories,
  submitters,
  projects,
}: {
  categories: { id: string; label: string }[];
  submitters: { id: string; full_name: string }[];
  projects: ProjectOpt[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  /** Apply one or more filter changes; a null value clears that key. */
  function update(changes: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) p.set(key, value); else p.delete(key);
    }
    p.delete('page');
    const qs = p.toString();
    router.push(qs ? `/expenses?${qs}` : '/expenses');
  }

  const hasFilters = FILTER_KEYS.some((k) => sp.get(k));

  // ProjectCombobox needs a non-null customer_name — fall back to the number/id.
  const comboboxProjects = projects.map((p) => ({
    id: p.id,
    project_number: p.project_number,
    project_name: p.project_name,
    customer_name: p.customer_name ?? p.project_number ?? p.id.slice(0, 8),
  }));

  return (
    <div className="flex flex-wrap gap-3 mb-4 items-end">
      <Field label="Search">
        <Input
          placeholder="Voucher no. or description…"
          className="h-9 w-52"
          defaultValue={sp.get('search') ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') update({ search: (e.target as HTMLInputElement).value });
          }}
        />
      </Field>

      <Field label="Project name">
        <ProjectCombobox
          projects={comboboxProjects}
          value={sp.get('project') ?? ''}
          // Picking a project contradicts the General scope chip — clear it.
          onChange={(id) => update({ project: id || null, scope: id ? null : sp.get('scope') })}
          placeholder="Type to search projects…"
          className="w-64"
        />
      </Field>

      <Field label="Scope">
        <div className="flex gap-1">
          {(['all', 'project', 'general'] as const).map((s) => {
            const active = (sp.get('scope') ?? 'all') === s;
            return (
              <Button
                key={s}
                size="sm"
                variant={active ? 'default' : 'outline'}
                // A specific project can't coexist with the General chip.
                onClick={() => update({
                  scope: s === 'all' ? null : s,
                  project: s === 'general' ? null : sp.get('project'),
                })}
              >
                {s === 'all' ? 'All' : s === 'project' ? 'Project' : 'General'}
              </Button>
            );
          })}
        </div>
      </Field>

      <Field label="Status">
        <Select
          className="h-9 w-36"
          value={sp.get('status') ?? ''}
          onChange={(e) => update({ status: e.target.value || null })}
        >
          <option value="">All statuses</option>
          {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>

      <Field label="Category">
        <Select
          className="h-9 w-40"
          value={sp.get('category') ?? ''}
          onChange={(e) => update({ category: e.target.value || null })}
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </Field>

      <Field label="Engineer / submitter">
        <Select
          className="h-9 w-44"
          value={sp.get('submitter') ?? ''}
          onChange={(e) => update({ submitter: e.target.value || null })}
        >
          <option value="">All submitters</option>
          {submitters.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </Select>
      </Field>

      {hasFilters && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
