'use client';

// =============================================================================
// Add / Edit Item modal (spec §5.3) — one form for both flows.
// Field order: Project · Item (PB autocomplete, max 8, "Item — Make (₹Rate)")
// · Category · Make · Qty · Units · Status · Rate · Gst% · Vendor.
// Picking a PB match auto-fills category/make/units/rate/gst/vendor (and the
// hidden model + price_book_id) — everything stays editable afterwards.
// Validation: Project + Item required (the rest is validated server-side).
// =============================================================================

import * as React from 'react';
import {
  Button,
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
  addBoiLine,
  searchPriceBookAction,
  updateBoiLine,
} from '@/lib/purchase-flow-actions';
import {
  BOI_STATUSES,
  BOI_STATUS_LABELS,
  GST_OPTIONS,
  displayBoiStatus,
  isBoiStatus,
  type BoiLineInput,
  type BoiLineRow,
  type BoiStatus,
  type PriceBookSearchItem,
  type ProjectOption,
} from '@/lib/purchase-flow-constants';
import { ProjectCombobox } from './project-combobox';

const MAX_SUGGESTIONS = 8;

interface BoiAddItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the modal edits this row (prefilled); otherwise it adds. */
  editRow: BoiLineRow | null;
  projects: ProjectOption[];
  onProjectCreated: (project: ProjectOption) => void;
  categories: { value: string; label: string }[];
  defaultProjectId: string | null;
  onSaved: (fresh: BoiLineRow, isEdit: boolean) => void;
}

export function BoiAddItemModal({
  open,
  onOpenChange,
  editRow,
  projects,
  onProjectCreated,
  categories,
  defaultProjectId,
  onSaved,
}: BoiAddItemModalProps) {
  const { addToast } = useToast();
  const isEdit = editRow !== null;

  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [item, setItem] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [make, setMake] = React.useState('');
  const [qty, setQty] = React.useState('1');
  const [units, setUnits] = React.useState('Nos');
  const [status, setStatus] = React.useState<BoiStatus>('yet_to_finalize');
  const [rate, setRate] = React.useState('0');
  const [gst, setGst] = React.useState('18');
  const [vendor, setVendor] = React.useState('');
  // Hidden pass-throughs (not fields in the sheet's modal, but must survive):
  const [model, setModel] = React.useState<string | null>(null);
  const [priceBookId, setPriceBookId] = React.useState<string | null>(null);

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // --- PB autocomplete -----------------------------------------------------
  const [suggestions, setSuggestions] = React.useState<PriceBookSearchItem[]>([]);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const typedRef = React.useRef(false); // only search on user typing, not on pick/prefill
  const searchSeq = React.useRef(0);

  // Reset the form whenever the modal opens.
  React.useEffect(() => {
    if (!open) return;
    typedRef.current = false;
    setSuggestions([]);
    setSuggestOpen(false);
    setError(null);
    if (editRow) {
      setProjectId(editRow.project_id);
      setItem(editRow.item_description);
      setCategory(editRow.item_category);
      setMake(editRow.brand ?? '');
      setQty(String(editRow.quantity));
      setUnits(editRow.unit);
      setStatus(displayBoiStatus(editRow.procurement_status));
      setRate(String(editRow.unit_price));
      setGst(String(editRow.gst_rate));
      setVendor(editRow.vendor_name ?? '');
      setModel(editRow.model);
      setPriceBookId(editRow.price_book_id);
    } else {
      setProjectId(defaultProjectId);
      setItem('');
      setCategory(categories[0]?.value ?? '');
      setMake('');
      setQty('1');
      setUnits('Nos');
      setStatus('yet_to_finalize');
      setRate('0');
      setGst('18');
      setVendor('');
      setModel(null);
      setPriceBookId(null);
    }
  }, [open, editRow, defaultProjectId, categories]);

  React.useEffect(() => {
    if (!open || !typedRef.current) return;
    const term = item.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      const result = await searchPriceBookAction(term);
      if (seq !== searchSeq.current) return; // stale
      if (result.success) {
        setSuggestions(result.data.rows.slice(0, MAX_SUGGESTIONS));
        setSuggestOpen(result.data.rows.length > 0);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [item, open]);

  function pickSuggestion(pb: PriceBookSearchItem) {
    typedRef.current = false;
    setItem(pb.item_description);
    // Category maps to the master list; unknown values fall through as-is
    // (the select grows a fallback option below).
    setCategory(pb.item_category);
    setMake(pb.brand ?? '');
    setUnits(pb.unit);
    if (pb.base_price !== undefined) setRate(String(pb.base_price));
    if (pb.gst_rate !== undefined) setGst(String(pb.gst_rate));
    setVendor(pb.vendor_name ?? '');
    setModel(pb.model);
    setPriceBookId(pb.id);
    setSuggestOpen(false);
  }

  // --- Save ----------------------------------------------------------------
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!projectId) {
      setError('Project is required');
      return;
    }
    if (!item.trim()) {
      setError('Item is required');
      return;
    }
    setError(null);
    setSaving(true);

    const input: BoiLineInput = {
      projectId,
      itemCategory: category,
      itemDescription: item.trim(),
      brand: make.trim() || null,
      model,
      quantity: Number(qty),
      unit: units.trim() || 'Nos',
      procurementStatus: isBoiStatus(status) ? status : 'yet_to_finalize',
      unitPrice: Number(rate),
      gstRate: Number(gst),
      vendorName: vendor.trim() || null,
      priceBookId,
    };

    const result = isEdit && editRow
      ? await updateBoiLine(editRow.id, input)
      : await addBoiLine(input);
    setSaving(false);

    if (result.success) {
      addToast({
        variant: 'success',
        title: isEdit ? 'Item updated' : 'Item added',
        description: result.data.item_description,
      });
      onSaved(result.data, isEdit);
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  }

  const categoryKnown = categories.some((c) => c.value === category);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{isEdit ? 'Edit Item' : 'Add Item'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="boi-project" className="text-xs">Project Name *</Label>
            <ProjectCombobox
              id="boi-project"
              projects={projects}
              value={projectId}
              onSelect={(p) => setProjectId(p?.id ?? null)}
              onProjectCreated={onProjectCreated}
              allowCreate
              placeholder="Search existing or type a new one…"
              className="mt-0.5"
            />
          </div>

          <div className="relative">
            <Label htmlFor="boi-item" className="text-xs">Item (search Price Book) *</Label>
            <Input
              id="boi-item"
              value={item}
              autoComplete="off"
              onChange={(e) => {
                typedRef.current = true;
                setItem(e.target.value);
                if (priceBookId) setPriceBookId(null); // edited away from the PB row
              }}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              placeholder="Type to search the Price Book, or enter a free-form item"
              required
              className="h-9 text-xs"
            />
            {suggestOpen && suggestions.length > 0 && (
              <ul
                className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-n-200 bg-white py-1 text-xs shadow-lg"
                onMouseDown={(e) => e.preventDefault()}
              >
                {suggestions.map((pb) => (
                  <li
                    key={pb.id}
                    onClick={() => pickSuggestion(pb)}
                    className="cursor-pointer px-2.5 py-1.5 hover:bg-n-100"
                  >
                    <span className="font-semibold text-n-900">{pb.item_description}</span>
                    <span className="text-n-500">
                      {' '}— {pb.brand ?? '—'}
                      {pb.base_price !== undefined && ` (${formatINR(pb.base_price)})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="boi-category" className="text-xs">Category</Label>
              <Select
                id="boi-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 text-xs"
              >
                {!categoryKnown && category && (
                  <option value={category}>{category}</option>
                )}
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="boi-make" className="text-xs">Make</Label>
              <Input
                id="boi-make"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="e.g. Waaree"
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="boi-qty" className="text-xs">Qty</Label>
              <Input
                id="boi-qty"
                type="number"
                step="any"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-9 text-right font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="boi-units" className="text-xs">Units</Label>
              <Input
                id="boi-units"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                placeholder="Nos"
                className="h-9 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="boi-status" className="text-xs">Status</Label>
              <Select
                id="boi-status"
                value={status}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isBoiStatus(v)) setStatus(v);
                }}
                className="h-9 text-xs"
              >
                {BOI_STATUSES.map((s) => (
                  <option key={s} value={s}>{BOI_STATUS_LABELS[s]}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="boi-rate" className="text-xs">Rate (₹)</Label>
              <Input
                id="boi-rate"
                type="number"
                step="any"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="h-9 text-right font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="boi-gst" className="text-xs">Gst %</Label>
              <Select
                id="boi-gst"
                value={gst}
                onChange={(e) => setGst(e.target.value)}
                className="h-9 text-xs"
              >
                {GST_OPTIONS.map((g) => (
                  <option key={g} value={String(g)}>{g}%</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="boi-vendor" className="text-xs">Vendor</Label>
              <Input
                id="boi-vendor"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="Vendor name"
                className="h-9 text-xs"
              />
            </div>
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
            <Button type="submit" size="sm" disabled={saving} className="text-xs">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Item'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
