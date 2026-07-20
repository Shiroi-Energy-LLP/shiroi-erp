'use client';

// =============================================================================
// Site-engineer intake client (spec §11) — mobile-first single-column screen:
// 1. Greeting "Hi, <first name> · Add Bill of Items"
// 2. Project combobox (existing projects only — quick-create disabled here)
// 3. Price Book search (server round-trip via searchPriceBookAction; the
//    action strips prices for site_supervisor and this UI never renders price
//    fields FOR ANYONE — spec §1) + checkbox list (50 cap, "+N more — refine")
// 4. Selected panel with qty inputs (default 1, min 0.01) + remove ✕
// 5. Submit → submitIntakeItems → "✓ N item(s) submitted for <project>",
//    selection clears, project stays.
// Big touch targets throughout (h-11/h-12 controls).
// =============================================================================

import * as React from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button, Checkbox, Input, cn } from '@repo/ui';
import { searchPriceBookAction, submitIntakeItems } from '@/lib/purchase-flow-actions';
import type { PriceBookSearchItem, ProjectOption } from '@/lib/purchase-flow-constants';
import { ProjectCombobox } from './project-combobox';

interface IntakeClientProps {
  firstName: string;
  projects: ProjectOption[];
}

interface SelectedItem {
  item: PriceBookSearchItem;
  qty: number;
}

export function IntakeClient({ firstName, projects }: IntakeClientProps) {
  // --- project -------------------------------------------------------------
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const projectName = projectId
    ? projects.find((p) => p.id === projectId)?.name ?? null
    : null;

  // --- price book search (server round-trip, debounced) --------------------
  const [term, setTerm] = React.useState('');
  const [results, setResults] = React.useState<PriceBookSearchItem[]>([]);
  const [resultTotal, setResultTotal] = React.useState(0);
  const [searching, setSearching] = React.useState(false);
  const searchSeq = React.useRef(0);

  React.useEffect(() => {
    const trimmed = term.trim();
    if (!trimmed) {
      setResults([]);
      setResultTotal(0);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      const result = await searchPriceBookAction(trimmed);
      if (seq !== searchSeq.current) return; // stale response
      setSearching(false);
      if (result.success) {
        setResults(result.data.rows);
        setResultTotal(result.data.total);
      } else {
        setResults([]);
        setResultTotal(0);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [term]);

  // --- selection (insertion order) -----------------------------------------
  const [selected, setSelected] = React.useState<SelectedItem[]>([]);
  const selectedIds = React.useMemo(
    () => new Set(selected.map((s) => s.item.id)),
    [selected],
  );

  function toggleItem(item: PriceBookSearchItem) {
    setSelected((prev) => {
      if (prev.some((s) => s.item.id === item.id)) {
        return prev.filter((s) => s.item.id !== item.id);
      }
      return [...prev, { item, qty: item.default_qty && item.default_qty > 0 ? item.default_qty : 1 }];
    });
  }

  function removeItem(id: string) {
    setSelected((prev) => prev.filter((s) => s.item.id !== id));
  }

  function setQty(id: string, qty: number) {
    setSelected((prev) => prev.map((s) => (s.item.id === id ? { ...s, qty } : s)));
  }

  // --- submit --------------------------------------------------------------
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  async function handleSubmit() {
    if (submitting) return;
    setSuccess(null);
    if (!projectId) {
      setError('Pick a project first');
      return;
    }
    if (selected.length === 0) {
      setError('Select at least one item');
      return;
    }
    for (const s of selected) {
      if (!Number.isFinite(s.qty) || s.qty <= 0) {
        setError(`"${s.item.item_description}" needs a quantity greater than 0`);
        return;
      }
    }
    setError(null);
    setSubmitting(true);

    const result = await submitIntakeItems(
      projectId,
      selected.map((s) => ({ priceBookId: s.item.id, quantity: s.qty })),
    );
    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    // Success: clear the selection + search, keep the project (spec §11).
    setSuccess(
      `✓ ${result.data.inserted} item(s) submitted for ${projectName ?? 'the project'}.`,
    );
    setSelected([]);
    setTerm('');
    setResults([]);
    setResultTotal(0);
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-24">
      {/* Greeting */}
      <div>
        <h1 className="text-xl font-heading font-bold text-n-900">Hi, {firstName}</h1>
        <p className="text-sm text-n-500">Add Bill of Items</p>
      </div>

      {success && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm font-medium text-green-800">
          {success}
        </p>
      )}

      {/* 1. Project */}
      <div className="space-y-1.5">
        <label htmlFor="intake-project" className="text-sm font-medium text-n-800">
          Project
        </label>
        <ProjectCombobox
          id="intake-project"
          projects={projects}
          value={projectId}
          onSelect={(p) => {
            setProjectId(p?.id ?? null);
            setSuccess(null);
          }}
          clearable
          placeholder="Select your project…"
        />
      </div>

      {/* 2. Price Book search */}
      <div className="space-y-1.5">
        <label htmlFor="intake-search" className="text-sm font-medium text-n-800">
          Search Price Book
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-n-400" />
          <Input
            id="intake-search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. panel, inverter, cable…"
            className="h-11 pl-9 text-sm"
            inputMode="search"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-n-400" />
          )}
        </div>

        {term.trim() && !searching && results.length === 0 && (
          <p className="px-1 py-2 text-sm text-n-500">No items match your search.</p>
        )}

        {results.length > 0 && (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-n-200 bg-white">
            {results.map((item) => {
              const checked = selectedIds.has(item.id);
              return (
                <label
                  key={item.id}
                  className={cn(
                    'flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-n-100 px-3 py-2.5 last:border-b-0',
                    checked ? 'bg-amber-50/70' : 'hover:bg-n-50',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleItem(item)}
                    aria-label={`Select ${item.item_description}`}
                    className="h-5 w-5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-n-900">
                      {item.item_description}
                    </span>
                    <span className="block truncate text-xs text-n-500">
                      {[item.item_category, item.brand, item.unit]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </label>
              );
            })}
            {resultTotal > results.length && (
              <p className="bg-n-50 px-3 py-2 text-xs text-n-500">
                +{resultTotal - results.length} more — refine your search
              </p>
            )}
          </div>
        )}
      </div>

      {/* 3. Selected items */}
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-n-800">
          Selected Items ({selected.length})
        </p>
        {selected.length === 0 ? (
          <p className="rounded-lg border border-dashed border-n-200 px-3 py-4 text-center text-sm text-n-400">
            Search the price book and tick the items you need.
          </p>
        ) : (
          <div className="space-y-2">
            {selected.map((s) => (
              <div
                key={s.item.id}
                className="flex items-center gap-2 rounded-lg border border-n-200 bg-white px-3 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-n-900">
                    {s.item.item_description}
                  </span>
                  <span className="block truncate text-xs text-n-500">
                    {[s.item.brand, s.item.unit].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Input
                  type="number"
                  min={0.01}
                  step="any"
                  value={Number.isFinite(s.qty) ? s.qty : ''}
                  onChange={(e) => setQty(s.item.id, Number(e.target.value))}
                  aria-label={`Quantity for ${s.item.item_description}`}
                  className="h-11 w-20 shrink-0 text-center text-sm"
                  inputMode="decimal"
                />
                <button
                  type="button"
                  title="Remove item"
                  onClick={() => removeItem(s.item.id)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-n-400 hover:bg-red-50 hover:text-red-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>
      )}

      {/* 4. Submit */}
      <Button
        type="button"
        disabled={submitting || selected.length === 0 || !projectId}
        onClick={() => void handleSubmit()}
        className="h-12 w-full text-sm font-semibold"
      >
        {submitting
          ? 'Submitting…'
          : `Submit ${selected.length > 0 ? `${selected.length} ` : ''}Item(s)`}
      </Button>
    </div>
  );
}
