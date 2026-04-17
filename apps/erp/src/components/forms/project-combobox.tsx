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
