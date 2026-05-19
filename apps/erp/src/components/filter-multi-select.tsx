'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@repo/ui';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterMultiSelectProps {
  /** URL param name */
  paramName: string;
  /** Label shown when nothing is selected, e.g. "Status" */
  label: string;
  options: FilterOption[];
  className?: string;
}

/**
 * Popover multi-select that syncs selected values as a comma-separated URL param.
 * Label: "All {label}" when nothing selected, "{label} (N)" when N items selected.
 * Has an X clear button when N > 0.
 */
export function FilterMultiSelect({
  paramName,
  label,
  options,
  className,
}: FilterMultiSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get(paramName) ?? '';
  const selected = raw ? raw.split(',').filter(Boolean) : [];

  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  function navigate(next: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) {
      params.set(paramName, next.join(','));
    } else {
      params.delete(paramName);
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    navigate(next);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    navigate([]);
  }

  const btnLabel =
    selected.length === 0 ? `All ${label}` : `${label} (${selected.length})`;

  return (
    <div className={`relative ${className ?? ''}`} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm border rounded-md bg-white hover:bg-n-50 transition-colors ${
          selected.length > 0
            ? 'border-shiroi-green text-shiroi-green font-medium'
            : 'border-n-200 text-n-700'
        }`}
      >
        <span>{btnLabel}</span>
        {selected.length > 0 && (
          <span
            role="button"
            aria-label="Clear filter"
            onClick={clear}
            className="ml-0.5 flex items-center justify-center w-4 h-4 rounded-full hover:bg-shiroi-green/10 text-shiroi-green"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className="opacity-50 ml-0.5"
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-n-200 rounded-md shadow-lg py-1 min-w-[200px] max-h-72 overflow-y-auto">
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-n-50 select-none"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  className="h-3.5 w-3.5 rounded border-n-300 accent-shiroi-green"
                />
                <span className={checked ? 'text-n-900 font-medium' : 'text-n-700'}>
                  {opt.label}
                </span>
              </label>
            );
          })}
          {selected.length > 0 && (
            <>
              <div className="my-1 border-t border-n-100" />
              <button
                type="button"
                onClick={() => { navigate([]); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-n-500 hover:text-n-900 hover:bg-n-50"
              >
                Clear all
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
