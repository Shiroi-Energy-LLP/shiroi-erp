'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { getActiveProjects } from '@/lib/tasks-actions';

type ProjectOption = {
  id: string;
  project_number: string;
  customer_name: string;
  project_name?: string | null;
};

/**
 * Searchable project dropdown — filters by customer name or project number,
 * displays customer_name. Extracted from create-task-dialog so the My Tasks
 * quick-add bar can reuse the exact same picker. `placeholder` lets callers
 * signal an optional field (e.g. "Project (optional)").
 *
 * G5 lazy-load (2026-07-19 perf work): when `projects` is omitted the picker
 * fetches the list itself via the `getActiveProjects` server action on first
 * open, so pages no longer eager-load ~480 projects on every render.
 * `selectedLabel` shows a display name for a pre-selected `value` before the
 * options have loaded (edit dialogs pass the row's project name).
 */
export function SearchableProjectSelect({
  projects,
  value,
  onChange,
  placeholder = '— Select Project —',
  selectedLabel,
}: {
  projects?: ProjectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  selectedLabel?: string | null;
}) {
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [fetched, setFetched] = React.useState<ProjectOption[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const selfFetch = projects === undefined;
  const options = projects ?? fetched ?? [];

  const ensureLoaded = React.useCallback(() => {
    if (!selfFetch || fetched !== null || loading) return;
    setLoading(true);
    getActiveProjects()
      .then(setFetched)
      .finally(() => setLoading(false));
  }, [selfFetch, fetched, loading]);

  const filtered = search
    ? options.filter(
        (p) =>
          p.customer_name.toLowerCase().includes(search.toLowerCase()) ||
          p.project_number.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  const selectedProject = options.find((p) => p.id === value);
  const displayLabel = selectedProject?.customer_name ?? (value ? (selectedLabel ?? '…') : placeholder);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        className="flex items-center gap-1 w-full rounded-md border border-n-200 px-2 h-9 text-xs cursor-pointer hover:border-n-300"
        onClick={() => { setOpen(!open); ensureLoaded(); }}
      >
        <Search className="h-3 w-3 text-n-400 flex-shrink-0" />
        {open ? (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="flex-1 outline-none text-xs bg-transparent"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={`flex-1 truncate ${selectedProject || value ? 'text-n-900' : 'text-n-400'}`}>
            {displayLabel}
          </span>
        )}
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-n-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
          {loading ? (
            <div className="px-2 py-2 text-[10px] text-n-400 text-center">Loading projects…</div>
          ) : (
            <>
              <button
                type="button"
                className="w-full text-left px-2 py-1.5 text-xs text-n-400 hover:bg-n-50"
                onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              >
                — None —
              </button>
              {filtered.slice(0, 50).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`w-full text-left px-2 py-1.5 text-xs hover:bg-n-50 ${p.id === value ? 'bg-p-50 text-p-700 font-medium' : 'text-n-700'}`}
                  onClick={() => { onChange(p.id); setOpen(false); setSearch(''); }}
                >
                  {p.customer_name}
                </button>
              ))}
              {filtered.length > 50 && (
                <div className="px-2 py-1 text-[10px] text-n-400">+{filtered.length - 50} more — refine search</div>
              )}
              {filtered.length === 0 && (
                <div className="px-2 py-2 text-[10px] text-n-400 text-center">No projects found</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
