'use client';

// =============================================================================
// "Add Multiple from Price Book" modal (spec §5.4) — bulk BOM assembly.
// 1. Project combobox (one project for the batch)  2. Default Status select
// 3. PB search + checkbox list (50 cap; "+N more — refine your search")
// 4. "Selected Items (n)" panel with per-item Qty / Rate ₹ / GST % mini-fields
// Save → addBoiLinesFromPriceBook (catalog fields re-read server-side).
// =============================================================================

import * as React from 'react';
import { X } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  formatINR,
  useToast,
} from '@repo/ui';
import {
  addBoiLinesFromPriceBook,
  searchPriceBookAction,
} from '@/lib/purchase-flow-actions';
import {
  BOI_STATUSES,
  BOI_STATUS_LABELS,
  GST_OPTIONS,
  isBoiStatus,
  type BoiStatus,
  type PriceBookSearchItem,
  type ProjectOption,
} from '@/lib/purchase-flow-constants';
import { ProjectCombobox } from './project-combobox';

interface SelectedEntry {
  item: PriceBookSearchItem;
  qty: string;
  rate: string;
  gst: string;
}

interface BoiBulkAddModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectOption[];
  onProjectCreated: (project: ProjectOption) => void;
  defaultProjectId: string | null;
  /** Called after a successful batch insert (workspace refreshes the list). */
  onSaved: (insertedCount: number) => void;
}

export function BoiBulkAddModal({
  open,
  onOpenChange,
  projects,
  onProjectCreated,
  defaultProjectId,
  onSaved,
}: BoiBulkAddModalProps) {
  const { addToast } = useToast();

  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<BoiStatus>('yet_to_finalize');
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<PriceBookSearchItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [searching, setSearching] = React.useState(false);
  const [selected, setSelected] = React.useState<Map<string, SelectedEntry>>(new Map());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const searchSeq = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    setProjectId(defaultProjectId);
    setStatus('yet_to_finalize');
    setQuery('');
    setResults([]);
    setTotal(0);
    setSelected(new Map());
    setError(null);
  }, [open, defaultProjectId]);

  // Debounced PB search (server round-trip; 50-row cap comes from the query).
  React.useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setTotal(0);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const result = await searchPriceBookAction(term);
      if (seq !== searchSeq.current) return; // stale
      setSearching(false);
      if (result.success) {
        setResults(result.data.rows);
        setTotal(result.data.total);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  function toggle(pb: PriceBookSearchItem) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(pb.id)) {
        next.delete(pb.id);
      } else {
        next.set(pb.id, {
          item: pb,
          qty: String(pb.default_qty ?? 1),
          rate: pb.base_price !== undefined ? String(pb.base_price) : '',
          gst: pb.gst_rate !== undefined ? String(pb.gst_rate) : '',
        });
      }
      return next;
    });
  }

  function patchEntry(id: string, patch: Partial<Omit<SelectedEntry, 'item'>>) {
    setSelected((prev) => {
      const entry = prev.get(id);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(id, { ...entry, ...patch });
      return next;
    });
  }

  async function handleSave() {
    if (!projectId) {
      setError('Project is required');
      return;
    }
    if (selected.size === 0) {
      setError('Select at least one item');
      return;
    }
    setError(null);
    setSaving(true);

    const result = await addBoiLinesFromPriceBook({
      projectId,
      status,
      items: [...selected.values()].map((e) => ({
        priceBookId: e.item.id,
        quantity: Number(e.qty),
        unitPrice: e.rate.trim() === '' ? undefined : Number(e.rate),
        gstRate: e.gst.trim() === '' ? undefined : Number(e.gst),
      })),
    });
    setSaving(false);

    if (result.success) {
      addToast({
        variant: 'success',
        title: `${result.data.inserted} item(s) added ✓`,
        description: `Status: ${BOI_STATUS_LABELS[status]}`,
      });
      onSaved(result.data.inserted);
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  }

  const moreCount = Math.max(0, total - results.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Multiple from Price Book</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bulk-project" className="text-xs">Project Name *</Label>
              <ProjectCombobox
                id="bulk-project"
                projects={projects}
                value={projectId}
                onSelect={(p) => setProjectId(p?.id ?? null)}
                onProjectCreated={onProjectCreated}
                allowCreate
                placeholder="Search existing or type a new one…"
                className="mt-0.5"
              />
            </div>
            <div>
              <Label htmlFor="bulk-status" className="text-xs">Default Status</Label>
              <Select
                id="bulk-status"
                value={status}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isBoiStatus(v)) setStatus(v);
                }}
                className="h-8 text-xs"
              >
                {BOI_STATUSES.map((s) => (
                  <option key={s} value={s}>{BOI_STATUS_LABELS[s]}</option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="bulk-search" className="text-xs">Search Price Book</Label>
            <Input
              id="bulk-search"
              value={query}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type at least 2 characters — item, make, category or vendor"
              className="h-9 text-xs"
            />
          </div>

          {/* Results checkbox list */}
          {query.trim().length >= 2 && (
            <div className="max-h-52 overflow-auto rounded-md border border-n-200">
              {searching && results.length === 0 ? (
                <p className="px-3 py-2 text-xs text-n-400">Searching…</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-2 text-xs text-n-400">No price book items match.</p>
              ) : (
                <ul className="divide-y divide-n-100">
                  {results.map((pb) => (
                    <li key={pb.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-n-50">
                        <Checkbox
                          checked={selected.has(pb.id)}
                          onCheckedChange={() => toggle(pb)}
                          aria-label={`Select ${pb.item_description}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-n-900">{pb.item_description}</span>
                          <span className="text-n-500">
                            {' '}— {pb.brand ?? '—'} · {pb.item_category} · {pb.unit}
                          </span>
                        </span>
                        {pb.base_price !== undefined && (
                          <span className="shrink-0 font-mono text-n-600">
                            {formatINR(pb.base_price)}
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {moreCount > 0 && (
                <p className="border-t border-n-100 bg-n-50 px-3 py-1.5 text-[11px] text-n-500">
                  +{moreCount} more — refine your search
                </p>
              )}
            </div>
          )}

          {/* Selected items panel */}
          <div>
            <p className="mb-1 text-xs font-semibold text-n-700">
              Selected Items ({selected.size})
            </p>
            {selected.size === 0 ? (
              <p className="rounded-md border border-dashed border-n-200 px-3 py-3 text-center text-xs text-n-400">
                Nothing selected yet — tick items in the search results above.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1.5 overflow-auto pr-1">
                {[...selected.values()].map((entry) => (
                  <li
                    key={entry.item.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-n-200 bg-n-50/60 px-2.5 py-1.5"
                  >
                    <span className="min-w-[180px] flex-1 text-xs">
                      <span className="font-medium text-n-900">{entry.item.item_description}</span>
                      <span className="block text-[10px] text-n-500">
                        {entry.item.brand ?? '—'} · {entry.item.item_category} · {entry.item.unit}
                      </span>
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-n-500">
                      Qty
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={entry.qty}
                        onChange={(e) => patchEntry(entry.item.id, { qty: e.target.value })}
                        className="h-7 w-16 text-right font-mono text-xs"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-n-500">
                      Rate ₹
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={entry.rate}
                        onChange={(e) => patchEntry(entry.item.id, { rate: e.target.value })}
                        className="h-7 w-24 text-right font-mono text-xs"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-n-500">
                      GST
                      <Select
                        value={entry.gst}
                        onChange={(e) => patchEntry(entry.item.id, { gst: e.target.value })}
                        className="h-7 w-[70px] text-xs"
                      >
                        {entry.gst !== '' &&
                          !(GST_OPTIONS as readonly number[]).includes(Number(entry.gst)) && (
                            <option value={entry.gst}>{entry.gst}%</option>
                          )}
                        {GST_OPTIONS.map((g) => (
                          <option key={g} value={String(g)}>{g}%</option>
                        ))}
                      </Select>
                    </label>
                    <button
                      type="button"
                      aria-label={`Remove ${entry.item.item_description}`}
                      onClick={() => toggle(entry.item)}
                      className="rounded p-1 text-n-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || selected.size === 0 || !projectId}
              onClick={() => void handleSave()}
              className="text-xs"
            >
              {saving ? 'Adding…' : `Add ${selected.size} Item(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
