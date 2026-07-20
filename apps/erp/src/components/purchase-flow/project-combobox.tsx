'use client';

// =============================================================================
// Project combobox (spec §2 shared primitive, locked to REAL projects)
// =============================================================================
// Text input + live-filtered dropdown over ProjectOption[]. Keyboard:
// ArrowUp/ArrowDown/Enter/Escape. When `allowCreate` and the typed text
// matches no existing project name, offers `+ Create "<typed>"` which calls
// quickCreateProject (idempotent server-side) and selects the result.
// Used by: BOI filter bar (allowCreate=false), add/edit modal, bulk-add modal.
// =============================================================================

import * as React from 'react';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { cn, useToast } from '@repo/ui';
import { quickCreateProject } from '@/lib/purchase-flow-actions';
import type { ProjectOption } from '@/lib/purchase-flow-constants';

const MAX_SHOWN = 50;

interface ProjectComboboxProps {
  projects: ProjectOption[];
  /** Selected project id (or null). */
  value: string | null;
  onSelect: (project: ProjectOption | null) => void;
  /** Fires BEFORE onSelect when quick-create mints a new project. */
  onProjectCreated?: (project: ProjectOption) => void;
  allowCreate?: boolean;
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function ProjectCombobox({
  projects,
  value,
  onSelect,
  onProjectCreated,
  allowCreate = false,
  clearable = false,
  placeholder = 'Select project…',
  disabled = false,
  className,
  id,
}: ProjectComboboxProps) {
  const { addToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);
  const [creating, setCreating] = React.useState(false);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selected = value ? projects.find((p) => p.id === value) ?? null : null;

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    const matches = q
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.project_number.toLowerCase().includes(q),
        )
      : projects;
    return matches.slice(0, MAX_SHOWN);
  }, [projects, q]);

  const showCreate =
    allowCreate &&
    q.length > 0 &&
    !projects.some((p) => p.name.toLowerCase() === q);
  const optionCount = filtered.length + (showCreate ? 1 : 0);

  React.useEffect(() => {
    if (highlight >= optionCount) setHighlight(Math.max(0, optionCount - 1));
  }, [optionCount, highlight]);

  // Keep the highlighted option scrolled into view.
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function close() {
    setOpen(false);
    setQuery('');
    setHighlight(0);
  }

  function pick(p: ProjectOption) {
    onSelect(p);
    close();
  }

  async function create() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    const result = await quickCreateProject(name);
    setCreating(false);
    if (result.success) {
      onProjectCreated?.(result.data);
      onSelect(result.data);
      close();
    } else {
      addToast({
        variant: 'destructive',
        title: 'Could not create project',
        description: result.error,
      });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, optionCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight < filtered.length && filtered[highlight]) {
        pick(filtered[highlight]);
      } else if (showCreate) {
        void create();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          value={open ? query : selected?.name ?? ''}
          placeholder={selected && !open ? selected.name : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => close()}
          onKeyDown={handleKeyDown}
          className="flex h-8 w-full rounded-md border-[1.5px] border-n-200 bg-white pl-2.5 pr-12 text-xs text-n-900 transition-all duration-150 placeholder:text-n-400 focus-visible:outline-none focus-visible:border-shiroi-gold disabled:cursor-not-allowed disabled:bg-n-050"
        />
        <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {clearable && selected && !open && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Clear project"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(null);
              }}
              className="rounded p-0.5 text-n-400 hover:text-n-700"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-n-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-n-400" />
          )}
        </span>
      </div>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          // preventDefault on mousedown so the input's blur doesn't close the
          // list before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 mt-1 max-h-60 w-full min-w-[220px] overflow-auto rounded-md border border-n-200 bg-white py-1 text-xs shadow-lg"
        >
          {filtered.length === 0 && !showCreate && (
            <li className="px-2.5 py-1.5 text-n-400">No projects match</li>
          )}
          {filtered.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={p.id === value}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(p)}
              className={cn(
                'cursor-pointer px-2.5 py-1.5',
                i === highlight ? 'bg-n-100' : '',
                p.id === value ? 'font-semibold text-n-900' : 'text-n-700',
              )}
            >
              <span className="block truncate">{p.name}</span>
              <span className="block truncate text-[10px] text-n-400">
                {p.project_number}
              </span>
            </li>
          ))}
          {showCreate && (
            <li
              role="option"
              aria-selected={false}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={() => void create()}
              className={cn(
                'cursor-pointer border-t border-n-100 px-2.5 py-1.5 font-medium text-shiroi-gold',
                highlight === filtered.length ? 'bg-n-100' : '',
              )}
            >
              {creating ? 'Creating…' : `+ Create "${query.trim()}"`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
