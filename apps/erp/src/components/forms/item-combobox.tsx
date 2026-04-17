'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Plus, Package } from 'lucide-react';
import { Input } from '@repo/ui';
import type { ItemCategory } from '@/lib/boi-constants';
import { getCategoryLabel } from '@/lib/boi-constants';
import { filterAndRank, type ItemSuggestion } from './item-combobox-filter';

// Re-export so downstream forms can import the type from the canonical
// component path (`@/components/forms/item-combobox`), matching the plan.
// The type is owned by `./item-combobox-filter` so the scoring logic stays
// testable in isolation from React.
export type { ItemSuggestion } from './item-combobox-filter';

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
  type RectState =
    | { placement: 'below'; top: number; left: number; width: number }
    | { placement: 'above'; bottom: number; left: number; width: number };
  const [rect, setRect] = React.useState<RectState | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

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

  // Update rect when open so the portal dropdown tracks the input position
  React.useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    function updateRect() {
      if (!inputRef.current) return;
      const r = inputRef.current.getBoundingClientRect();
      const GAP = 4;
      const spaceBelow = window.innerHeight - r.bottom - GAP;
      const spaceAbove = r.top - GAP;
      // Flip up when there's not enough room below (240px is a reasonable "can show ~4 rows" threshold)
      // and more room above than below
      const shouldPlaceAbove = spaceBelow < 240 && spaceAbove > spaceBelow;

      if (shouldPlaceAbove) {
        setRect({
          placement: 'above',
          bottom: window.innerHeight - r.top + GAP,
          left: r.left,
          width: r.width,
        });
      } else {
        setRect({
          placement: 'below',
          top: r.bottom + GAP,
          left: r.left,
          width: r.width,
        });
      }
    }
    updateRect();
    window.addEventListener('scroll', updateRect, true); // capture to catch ancestor scrolls
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  // Close on outside click — checks both the input wrapper and the portal dropdown
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
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

      {open && totalRows > 0 && rect && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              left: rect.left,
              width: Math.min(Math.max(rect.width, 420), window.innerWidth - 16),
              zIndex: 100,
              ...(rect.placement === 'below'
                ? { top: rect.top }
                : { bottom: rect.bottom }),
            }}
            className="bg-white border border-n-200 rounded shadow-lg overflow-hidden max-h-[60vh] overflow-y-auto"
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
          </div>,
          document.body,
        )}
    </div>
  );
}
