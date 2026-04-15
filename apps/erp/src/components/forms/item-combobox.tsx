'use client';

import * as React from 'react';
import { Plus, Package } from 'lucide-react';
import { Input } from '@repo/ui';
import type { ItemCategory } from '@/lib/boi-constants';
import { getCategoryLabel } from '@/lib/boi-constants';

export interface ItemSuggestion {
  description: string;
  category: ItemCategory;
  unit: string;
  base_price: number;
  source: 'price_book' | 'boq';
}

export interface ItemComboboxProps {
  /** Current description value (controlled) */
  value: string;
  /** Called on every keystroke. `picked` is set when user selects a suggestion. */
  onChange: (description: string, picked?: ItemSuggestion) => void;
  /** Full suggestion corpus loaded once by the parent. */
  suggestions: ItemSuggestion[];
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Extra classes for the underlying Input (e.g. `text-xs h-8`). */
  className?: string;
}

/**
 * Ranks suggestions against a query.
 *
 * Exact prefix > substring > Jaccard token overlap.
 * Price Book rows get a +5 bonus so curated entries win ties.
 */
export function filterAndRank(
  query: string,
  suggestions: ItemSuggestion[],
  limit = 8,
): ItemSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return suggestions.slice(0, limit);

  const scored = suggestions.map((s) => {
    const desc = s.description.toLowerCase();
    let score = 0;
    if (desc.startsWith(q)) {
      score = 100;
    } else if (desc.includes(q)) {
      score = 50;
    } else {
      const qTokens = new Set(q.split(/\s+/).filter(Boolean));
      const dTokens = new Set(desc.split(/\s+/).filter(Boolean));
      const intersection = [...qTokens].filter((t) => dTokens.has(t)).length;
      const union = new Set([...qTokens, ...dTokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      score = jaccard * 30;
    }
    if (s.source === 'price_book') score += 5;
    return { s, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

export function ItemCombobox({
  value,
  onChange,
  suggestions,
  placeholder = 'Type to search items…',
  disabled = false,
  autoFocus = false,
  className = 'text-xs h-8',
}: ItemComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<number>(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(
    () => filterAndRank(value, suggestions, 8),
    [value, suggestions],
  );

  // Show "Create new" row unless query exactly matches an existing suggestion.
  const exactMatch = React.useMemo(
    () => filtered.some((s) => s.description.toLowerCase() === value.trim().toLowerCase()),
    [filtered, value],
  );
  const showCreateNew = value.trim().length > 0 && !exactMatch;

  const totalRows = filtered.length + (showCreateNew ? 1 : 0);

  // Close on outside click
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function pickSuggestion(s: ItemSuggestion) {
    onChange(s.description, s);
    setOpen(false);
    setHighlighted(-1);
  }

  function pickCreateNew() {
    // Keep current value; no `picked` arg means "new item"
    onChange(value);
    setOpen(false);
    setHighlighted(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        setHighlighted(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      setHighlighted((h) => Math.min(h + 1, totalRows - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlighted((h) => Math.max(h - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (highlighted < 0) return;
      if (highlighted < filtered.length) {
        const row = filtered[highlighted];
        if (row) pickSuggestion(row);
      } else if (showCreateNew) {
        pickCreateNew();
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlighted(-1);
      e.preventDefault();
    } else if (e.key === 'Tab') {
      if (highlighted >= 0 && highlighted < filtered.length) {
        const row = filtered[highlighted];
        if (row) pickSuggestion(row);
      }
      // fall through — don't preventDefault, let Tab move focus
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className={className}
        autoComplete="off"
      />

      {open && totalRows > 0 && (
        <div
          className="absolute left-0 top-full mt-1 z-50 w-[420px] max-w-[92vw] bg-white border border-n-200 rounded shadow-lg overflow-hidden"
          role="listbox"
        >
          {filtered.map((s, i) => {
            const isHighlighted = i === highlighted;
            return (
              <button
                key={`${s.source}-${s.description}-${s.category}-${i}`}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                onMouseDown={(e) => {
                  // onMouseDown (not onClick) so the Input doesn't lose focus first
                  e.preventDefault();
                  pickSuggestion(s);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`w-full text-left px-3 py-2 text-xs border-b border-n-100 last:border-b-0 ${
                  isHighlighted ? 'bg-p-50' : 'bg-white hover:bg-n-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <Package className="h-3.5 w-3.5 text-n-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-n-800 truncate">{s.description}</div>
                    <div className="text-[11px] text-n-500 flex items-center gap-1.5 mt-0.5">
                      <span>{getCategoryLabel(s.category)}</span>
                      <span className="text-n-300">·</span>
                      <span>{s.unit}</span>
                      <span className="text-n-300">·</span>
                      {s.base_price > 0 ? (
                        <span className="font-mono">₹{s.base_price.toLocaleString('en-IN')}</span>
                      ) : (
                        <span className="text-amber-600 font-medium">Rate pending</span>
                      )}
                    </div>
                  </div>
                  {s.source === 'price_book' && (
                    <span className="text-[10px] text-p-600 bg-p-50 px-1.5 py-0.5 rounded border border-p-200 flex-shrink-0">
                      Price Book
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {showCreateNew && (
            <button
              type="button"
              role="option"
              aria-selected={highlighted === filtered.length}
              onMouseDown={(e) => {
                e.preventDefault();
                pickCreateNew();
              }}
              onMouseEnter={() => setHighlighted(filtered.length)}
              className={`w-full text-left px-3 py-2 text-xs border-t border-n-200 ${
                highlighted === filtered.length ? 'bg-p-50' : 'bg-white hover:bg-n-50'
              }`}
            >
              <div className="flex items-center gap-2 text-n-600">
                <Plus className="h-3.5 w-3.5" />
                <span>
                  Create new: <span className="font-medium text-n-800">&ldquo;{value}&rdquo;</span>
                </span>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
