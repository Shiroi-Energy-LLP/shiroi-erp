'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Loader2 } from 'lucide-react';
import { searchProjectsLite, type ProjectSearchHit } from '@/lib/project-detail-actions';

/**
 * Projects list search: keeps the ?search= URL-filter behavior (debounced,
 * like SearchInput) AND shows typeahead suggestions "Customer – Project Name"
 * that navigate straight to the project (spec 2026-06-11 #3).
 */
export function ProjectsSearchBox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(searchParams.get('search') ?? '');
  const [hits, setHits] = React.useState<ProjectSearchHit[]>([]);
  const [open, setOpen] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const urlTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rpcTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushUrl(next: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (next) sp.set('search', next); else sp.delete('search');
    sp.delete('page');
    router.replace(sp.toString() ? `/projects?${sp.toString()}` : '/projects');
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    setHighlighted(-1);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => pushUrl(next), 350);
    if (rpcTimer.current) clearTimeout(rpcTimer.current);
    if (next.trim().length >= 2) {
      setSearching(true);
      setOpen(true);
      rpcTimer.current = setTimeout(async () => {
        try {
          const results = await searchProjectsLite(next);
          setHits(results);
        } finally {
          setSearching(false);
          setOpen(true);
        }
      }, 250);
    } else {
      setHits([]);
      setSearching(false);
      setOpen(false);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && highlighted >= 0) {
      const selected = hits[highlighted];
      if (!selected) return;
      e.preventDefault();
      setOpen(false);
      router.push(`/projects/${selected.id}`);
    } else if (e.key === 'Escape') { setOpen(false); setHighlighted(-1); }
  }

  return (
    <div ref={containerRef} className="relative w-64">
      {searching ? (
        <Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-400 animate-spin pointer-events-none" />
      ) : (
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-400 pointer-events-none" />
      )}
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (hits.length > 0) setOpen(true); }}
        placeholder="Search customer, project name or number…"
        autoComplete="off"
        className="w-full h-9 pl-8 pr-3 border border-n-300 rounded-md bg-white text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-gold"
      />
      {open && (searching || hits.length > 0) && (
        <div className="absolute z-50 mt-1 w-[22rem] rounded-md border border-n-200 bg-white shadow-md max-h-72 overflow-y-auto">
          {searching && hits.length === 0 && (
            <div className="px-3 py-2 text-sm text-n-400">Searching…</div>
          )}
          <ul role="listbox">
            {hits.map((h, i) => (
              <li key={h.id} role="option" aria-selected={i === highlighted}
                onMouseDown={(e) => { e.preventDefault(); setOpen(false); router.push(`/projects/${h.id}`); }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer select-none ${
                  i === highlighted ? 'bg-n-100 text-n-900' : 'text-n-700'
                }`}>
                <span className="truncate text-sm">
                  {h.customer_name ?? '—'}{h.project_name ? ` – ${h.project_name}` : ''}
                </span>
                {h.project_number && (
                  <span className="ml-2 text-[10px] text-n-400 flex-shrink-0 font-mono">{h.project_number}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
