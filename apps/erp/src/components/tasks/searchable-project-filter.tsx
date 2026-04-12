'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Project {
  id: string;
  project_number: string;
  customer_name: string;
}

/**
 * A type-to-search project filter dropdown for the tasks page.
 * Replaces the basic <select> with a searchable list.
 */
export function SearchableProjectFilter({
  projects,
  basePath = '/tasks',
}: {
  projects: Project[];
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentProjectId = searchParams.get('project') ?? '';
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const filtered = search
    ? projects.filter(
        (p) =>
          p.project_number.toLowerCase().includes(search.toLowerCase()) ||
          p.customer_name.toLowerCase().includes(search.toLowerCase()),
      )
    : projects;

  const selectedProject = projects.find((p) => p.id === currentProjectId);

  function selectProject(id: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (id) {
      p.set('project', id);
    } else {
      p.delete('project');
    }
    p.delete('page');
    router.push(`${basePath}?${p.toString()}`);
    setOpen(false);
    setSearch('');
  }

  // Close dropdown on click outside
  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-48 h-8 text-xs border border-n-200 rounded px-2 py-1 bg-white text-left truncate flex items-center justify-between hover:border-n-300 focus:ring-1 focus:ring-p-300 focus:outline-none"
      >
        <span className={selectedProject ? 'text-n-900' : 'text-n-500'}>
          {selectedProject
            ? `${selectedProject.project_number} — ${selectedProject.customer_name}`
            : 'All Projects'}
        </span>
        <svg className="h-3 w-3 text-n-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-white border border-n-200 rounded-md shadow-lg">
          <div className="p-1.5 border-b border-n-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search project..."
              className="w-full text-xs border border-n-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-p-400"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            <button
              onClick={() => selectProject('')}
              className="w-full text-left px-3 py-1.5 text-xs text-n-500 hover:bg-n-50"
            >
              All Projects
            </button>
            {filtered.slice(0, 30).map((p) => (
              <button
                key={p.id}
                onClick={() => selectProject(p.id)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-n-50 ${
                  p.id === currentProjectId ? 'bg-p-50 text-p-700 font-medium' : 'text-n-900'
                }`}
              >
                {p.project_number} — {p.customer_name}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-n-400 text-center">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
