'use client';

/**
 * VendorSearchCombobox (Tab 2).
 *
 * Typeahead search for vendors — replaces the 200-row checkbox list.
 * Triggers at 2+ characters, shows up to 10 matches, "+ Add new vendor" CTA
 * at the bottom. Selected vendors rendered as chips above the input.
 */

import * as React from 'react';
import { X, UserPlus } from 'lucide-react';
import { searchVendors } from '@/lib/procurement-actions';
import type { VendorSearchResult } from '@/lib/procurement-queries';
import { CreateVendorAdHocDialog } from './create-vendor-ad-hoc-dialog';

interface VendorSearchComboboxProps {
  projectId: string;
  selected: VendorSearchResult[];
  onChange: (vendors: VendorSearchResult[]) => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function VendorSearchCombobox({
  projectId,
  selected,
  onChange,
}: VendorSearchComboboxProps) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<VendorSearchResult[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [showAddDialog, setShowAddDialog] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 250);

  // Search on debounced query change
  React.useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchVendors(debouncedQuery, 10).then((data) => {
      if (!cancelled) {
        setResults(data);
        setOpen(true);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // Close on click-outside
  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedIds = new Set(selected.map((v) => v.id));

  function selectVendor(vendor: VendorSearchResult) {
    if (selectedIds.has(vendor.id)) return;
    onChange([...selected, vendor]);
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeVendor(id: string) {
    onChange(selected.filter((v) => v.id !== id));
  }

  function handleVendorCreated(vendorId: string, vendor: VendorSearchResult) {
    setShowAddDialog(false);
    if (!selectedIds.has(vendorId)) {
      onChange([...selected, vendor]);
    }
  }

  return (
    <div>
      {/* Selected vendor chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-1 bg-p-100 text-p-800 rounded px-2 py-0.5 text-[10px] font-medium"
            >
              {v.company_name}
              <button
                type="button"
                onClick={() => removeVendor(v.id)}
                className="text-p-600 hover:text-p-900 ml-0.5"
                title={`Remove ${v.company_name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          placeholder="Type company name or contact person (min 2 chars)…"
          className="w-full h-8 text-[11px] border border-n-200 rounded px-2 placeholder:text-n-400"
        />
        {loading && (
          <div className="absolute right-2 top-2 text-[10px] text-n-400">Searching…</div>
        )}

        {/* Dropdown */}
        {open && (
          <div
            ref={dropdownRef}
            className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-n-200 rounded shadow-lg max-h-52 overflow-y-auto"
          >
            {results.length === 0 && !loading && (
              <div className="px-3 py-2 text-[11px] text-n-500">No vendors found.</div>
            )}
            {results.map((v) => (
              <button
                key={v.id}
                type="button"
                className={[
                  'w-full text-left px-3 py-2 text-[11px] hover:bg-n-50 flex items-center justify-between gap-2',
                  selectedIds.has(v.id) ? 'opacity-50 cursor-default' : '',
                ].join(' ')}
                onClick={() => selectVendor(v)}
                disabled={selectedIds.has(v.id)}
              >
                <div>
                  <div className="font-medium text-n-800">{v.company_name}</div>
                  {(v.contact_person || v.phone) && (
                    <div className="text-[10px] text-n-500">
                      {[v.contact_person, v.phone].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                {selectedIds.has(v.id) && (
                  <span className="text-[10px] text-green-700">Added</span>
                )}
              </button>
            ))}

            {/* Add new vendor CTA — always shown when query ≥ 2 chars */}
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-[11px] border-t border-n-100 text-p-600 hover:bg-p-50 flex items-center gap-1.5"
              onClick={() => { setOpen(false); setShowAddDialog(true); }}
            >
              <UserPlus className="h-3 w-3" />
              + Add new vendor &ldquo;{query}&rdquo;
            </button>
          </div>
        )}
      </div>

      {/* Add vendor dialog */}
      {showAddDialog && (
        <CreateVendorAdHocDialog
          projectId={projectId}
          onClose={() => setShowAddDialog(false)}
          onCreated={(vendorId) => {
            // We need to surface company_name back — fetch a minimal shape
            handleVendorCreated(vendorId, {
              id: vendorId,
              company_name: query || 'New vendor',
              contact_person: null,
              phone: null,
              email: null,
            });
          }}
        />
      )}
    </div>
  );
}
