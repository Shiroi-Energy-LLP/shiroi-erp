'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { RefreshCw, Save, Plus, X, Trash2, Check, Send } from 'lucide-react';
import { seedBoqFromBom, updateCostVariance, updateBoqItemStatus, updateBoqItem, addBoqItem, deleteBoqItem, completeBoq, updateProjectCostManual, sendBoqToPurchase, applyPriceBookRates, updateEstimatedSiteExpenses } from '@/lib/project-step-actions';
import { BOI_CATEGORIES } from '@/lib/boi-constants';
import { ItemCombobox, type ItemSuggestion } from '@/components/forms/item-combobox';

interface BoqActionsProps {
  projectId: string;
  hasBomLines: boolean;
  hasVariances: boolean;
}

export function BoqSeedButton({ projectId, hasBomLines, hasVariances }: BoqActionsProps) {
  const router = useRouter();
  const [seeding, setSeeding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (hasVariances || !hasBomLines) return null;

  async function handleSeed() {
    setSeeding(true);
    setError(null);
    const result = await seedBoqFromBom({ projectId });
    setSeeding(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to seed BOQ from BOM');
    }
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <Button size="sm" onClick={handleSeed} disabled={seeding}>
        <RefreshCw className={`h-4 w-4 mr-1.5 ${seeding ? 'animate-spin' : ''}`} />
        {seeding ? 'Generating...' : 'Generate BOQ from BOM'}
      </Button>
      <span className="text-xs text-n-500">
        Auto-creates cost entries from BOM categories. You only need to fill in actual costs.
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// BOQ item status dropdown — used in step-boq.tsx
const BOQ_STATUS_OPTIONS = [
  { value: 'yet_to_finalize', label: 'Yet to Finalize' },
  { value: 'yet_to_place', label: 'Yet to Place' },
  { value: 'order_placed', label: 'Order Placed' },
  { value: 'received', label: 'Received' },
  { value: 'ready_to_dispatch', label: 'Ready to Dispatch' },
  { value: 'delivered', label: 'Delivered' },
];

const STATUS_DOT_COLORS: Record<string, string> = {
  yet_to_finalize: '#7C818E',
  yet_to_place: '#B45309',
  order_placed: '#2563EB',
  received: '#059669',
  ready_to_dispatch: '#7C3AED',
  delivered: '#00B050',
};

interface BoqItemStatusSelectProps {
  projectId: string;
  itemId: string;
  currentStatus: string;
}

export function BoqItemStatusSelect({ projectId, itemId, currentStatus }: BoqItemStatusSelectProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    if (newStatus === currentStatus) return;
    setSaving(true);
    const result = await updateBoqItemStatus({ projectId, itemId, status: newStatus });
    setSaving(false);
    if (result.success) {
      router.refresh();
    }
  }

  const dotColor = STATUS_DOT_COLORS[currentStatus] ?? '#7C818E';

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      <select
        value={currentStatus}
        onChange={handleChange}
        disabled={saving}
        className="text-xs bg-transparent border-0 cursor-pointer focus:ring-1 focus:ring-p-300 rounded px-1 py-0.5 -ml-1 appearance-none pr-4"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237C818E' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 2px center',
        }}
      >
        {BOQ_STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {saving && <span className="text-[10px] text-n-400">…</span>}
    </div>
  );
}

// ── BOQ Inline Rate/Cost Editor ──

interface BoqInlineEditProps {
  projectId: string;
  itemId: string;
  field: 'unit_price' | 'gst_rate' | 'quantity';
  currentValue: number;
}

export function BoqInlineEdit({ projectId, itemId, field, currentValue }: BoqInlineEditProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(currentValue.toString());
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue === currentValue) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await updateBoqItem({
      projectId,
      itemId,
      data: { [field]: numValue },
    });
    setSaving(false);
    if (result.success) {
      setEditing(false);
      router.refresh();
    }
  }

  if (!editing) {
    return (
      <span
        className="font-mono cursor-pointer hover:bg-p-50 rounded px-1 -mx-1 transition-colors"
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit"
      >
        {field === 'unit_price' ? formatINR(currentValue) : field === 'quantity' ? String(currentValue) : `${currentValue}%`}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type="number"
        step={field === 'gst_rate' ? '1' : field === 'quantity' ? '1' : '0.01'}
        className="text-xs h-7 w-[80px] text-right font-mono"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') { setEditing(false); setValue(currentValue.toString()); }
        }}
      />
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600" onClick={handleSave} disabled={saving}>
        <Save className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ── BOQ Add Item Row ──

const UNITS = ['nos', 'set', 'meter', 'kg', 'lot', 'sqft', 'pair'];
const GST_RATES = ['0', '5', '12', '18', '28'];

export function BoqAddItemRow({
  projectId,
  suggestions,
}: {
  projectId: string;
  suggestions: ItemSuggestion[];
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [row, setRow] = React.useState({
    item_category: '', item_description: '', brand: '', model: '',
    quantity: '', unit: 'nos', unit_price: '', gst_rate: '18',
  });

  async function handleSave() {
    if (!row.item_category || !row.item_description || !row.quantity || !row.unit_price) {
      setError('Category, Description, Qty, and Rate are required');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await addBoqItem({
      projectId,
      data: {
        item_category: row.item_category,
        item_description: row.item_description,
        brand: row.brand || null,
        model: row.model || null,
        quantity: parseFloat(row.quantity),
        unit: row.unit,
        unit_price: parseFloat(row.unit_price),
        gst_rate: parseFloat(row.gst_rate),
      },
    });
    setSaving(false);
    if (result.success) {
      setRow({ item_category: '', item_description: '', brand: '', model: '', quantity: '', unit: 'nos', unit_price: '', gst_rate: '18' });
      setAdding(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add item');
    }
  }

  if (!adding) {
    return (
      <tr>
        <td colSpan={10} className="px-4 py-2">
          <Button size="sm" variant="ghost" className="text-p-600 hover:text-p-700" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="bg-p-50 border-t border-p-200">
        <td className="px-3 py-1.5 font-mono text-n-400">—</td>
        <td className="px-3 py-1.5">
          <Select
            value={row.item_category}
            onChange={(e) => setRow({ ...row, item_category: e.target.value })}
            className="text-xs h-8 w-[140px]"
          >
            <option value="">Category...</option>
            {BOI_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </td>
        <td className="px-3 py-1.5">
          <ItemCombobox
            value={row.item_description}
            onChange={(description, picked) => {
              if (picked) {
                setRow({
                  ...row,
                  item_description: description,
                  item_category: picked.category,
                  unit: picked.unit,
                  unit_price: picked.base_price > 0 ? String(picked.base_price) : row.unit_price,
                });
              } else {
                setRow({ ...row, item_description: description });
              }
            }}
            suggestions={suggestions}
            placeholder="Description"
            className="text-xs h-8"
          />
        </td>
        <td className="px-3 py-1.5">
          <Input
            value={row.brand}
            onChange={(e) => setRow({ ...row, brand: e.target.value })}
            placeholder="Brand"
            className="text-xs h-8 w-[80px]"
          />
        </td>
        <td className="px-3 py-1.5">
          <div className="flex gap-1">
            <Input
              value={row.quantity}
              onChange={(e) => setRow({ ...row, quantity: e.target.value })}
              type="number" step="0.01" placeholder="Qty"
              className="text-xs h-8 w-[60px] text-right"
            />
            <Select
              value={row.unit}
              onChange={(e) => setRow({ ...row, unit: e.target.value })}
              className="text-xs h-8 w-[60px]"
            >
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </td>
        <td className="px-3 py-1.5">
          <Input
            value={row.unit_price}
            onChange={(e) => setRow({ ...row, unit_price: e.target.value })}
            type="number" step="0.01" placeholder="Rate"
            className="text-xs h-8 w-[80px] text-right"
          />
        </td>
        <td className="px-3 py-1.5">
          <Select
            value={row.gst_rate}
            onChange={(e) => setRow({ ...row, gst_rate: e.target.value })}
            className="text-xs h-8 w-[55px]"
          >
            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
          </Select>
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-xs text-n-500">
          {row.quantity && row.unit_price
            ? formatINR(parseFloat(row.quantity) * parseFloat(row.unit_price) * (1 + parseFloat(row.gst_rate) / 100))
            : '—'}
        </td>
        <td className="px-3 py-1.5"></td>
        <td className="px-3 py-1.5">
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600" onClick={handleSave} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-n-400" onClick={() => { setAdding(false); setError(null); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {error && (
        <tr><td colSpan={10} className="px-4 py-1"><span className="text-xs text-red-600">{error}</span></td></tr>
      )}
    </>
  );
}

// ── BOQ Delete Button ──

export function BoqDeleteButton({ projectId, itemId, label }: { projectId: string; itemId: string; label: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${label}"?`)) return;
    setDeleting(true);
    const result = await deleteBoqItem({ projectId, itemId });
    setDeleting(false);
    if (result.success) router.refresh();
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 w-7 p-0 text-n-300 hover:text-red-500"
      onClick={handleDelete}
      disabled={deleting}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

// ── BOQ Complete Checkbox ──

export function BoqCompleteButton({ projectId, isCompleted }: { projectId: string; isCompleted: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  async function handleComplete() {
    if (isCompleted) return;
    if (!confirm('Mark BOQ Budget Analysis as completed?')) return;
    setLoading(true);
    const result = await completeBoq({ projectId });
    setLoading(false);
    if (result.success) router.refresh();
  }

  if (isCompleted) {
    return (
      <div className="flex items-center gap-2 text-green-700">
        <Check className="h-4 w-4" />
        <span className="text-sm font-medium">BOQ Budget Analysis Completed</span>
      </div>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={handleComplete} disabled={loading}>
      <Check className="h-3.5 w-3.5 mr-1.5" />
      {loading ? 'Saving...' : 'Mark BOQ Complete'}
    </Button>
  );
}

// ── BOQ Final Summary with margin calculation (includes site expenses) ──

export function BoqFinalSummary({
  projectId,
  contractedValue,
  projectCostManual,
  boqTotal,
  siteExpensesApproved,
  estimatedSiteExpensesBudget,
  isCompleted,
}: {
  projectId: string;
  contractedValue: number;
  projectCostManual: number | null;
  boqTotal: number;
  siteExpensesApproved: number;
  estimatedSiteExpensesBudget: number;
  isCompleted: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [costValue, setCostValue] = React.useState((projectCostManual ?? contractedValue).toString());
  const [saving, setSaving] = React.useState(false);
  const [editingBudget, setEditingBudget] = React.useState(false);
  const [budgetValue, setBudgetValue] = React.useState(estimatedSiteExpensesBudget.toString());
  const [savingBudget, setSavingBudget] = React.useState(false);

  const projectCost = projectCostManual ?? contractedValue;
  const siteExpenses = siteExpensesApproved > 0 ? siteExpensesApproved : estimatedSiteExpensesBudget;
  const actualBudget = boqTotal + siteExpenses;
  const margin = projectCost > 0 ? ((projectCost - actualBudget) / projectCost) * 100 : 0;
  const marginColor = margin >= 15 ? 'text-green-700' : margin >= 5 ? 'text-amber-700' : 'text-red-700';
  const marginBg = margin >= 15 ? 'bg-green-50 border-green-200' : margin >= 5 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  async function handleSaveCost() {
    const numValue = parseFloat(costValue);
    if (isNaN(numValue)) return;
    setSaving(true);
    const result = await updateProjectCostManual({ projectId, projectCost: numValue });
    setSaving(false);
    if (result.success) {
      setEditing(false);
      router.refresh();
    }
  }

  async function handleSaveBudget() {
    const numValue = parseFloat(budgetValue);
    if (isNaN(numValue)) return;
    setSavingBudget(true);
    const result = await updateEstimatedSiteExpenses({ projectId, budget: numValue });
    setSavingBudget(false);
    if (result.success) {
      setEditingBudget(false);
      router.refresh();
    }
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {/* Project Cost */}
      <div className="px-4 py-3 bg-white border border-n-200 rounded-lg">
        <div className="text-[10px] text-n-500 mb-1 uppercase tracking-wide">Project Cost</div>
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              value={costValue}
              onChange={(e) => setCostValue(e.target.value)}
              type="number"
              step="0.01"
              className="text-sm h-8 w-[120px] font-mono"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveCost();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600" onClick={handleSaveCost} disabled={saving}>
              <Save className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div
            className="text-lg font-bold font-mono text-n-900 cursor-pointer hover:text-p-600"
            onDoubleClick={() => setEditing(true)}
            title="Double-click to edit"
          >
            {formatINR(projectCost)}
          </div>
        )}
        <div className="text-[10px] text-n-400 mt-0.5">
          {projectCostManual ? 'Manual entry' : 'From contracted value'}
        </div>
      </div>

      {/* BOQ Material Budget */}
      <div className="px-4 py-3 bg-white border border-n-200 rounded-lg">
        <div className="text-[10px] text-n-500 mb-1 uppercase tracking-wide">Material Budget</div>
        <div className="text-lg font-bold font-mono text-n-900">{formatINR(boqTotal)}</div>
        <div className="text-[10px] text-n-400 mt-0.5">Sum of BOQ items</div>
      </div>

      {/* Site Expenses */}
      <div className="px-4 py-3 bg-white border border-n-200 rounded-lg">
        <div className="text-[10px] text-n-500 mb-1 uppercase tracking-wide">Site Expenses</div>
        {editingBudget ? (
          <div className="flex items-center gap-1">
            <Input
              value={budgetValue}
              onChange={(e) => setBudgetValue(e.target.value)}
              type="number"
              step="0.01"
              className="text-sm h-8 w-[120px] font-mono"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveBudget();
                if (e.key === 'Escape') setEditingBudget(false);
              }}
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600" onClick={handleSaveBudget} disabled={savingBudget}>
              <Save className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div
            className="text-lg font-bold font-mono text-n-900 cursor-pointer hover:text-p-600"
            onDoubleClick={() => setEditingBudget(true)}
            title="Double-click to edit budget"
          >
            {formatINR(siteExpenses)}
          </div>
        )}
        <div className="text-[10px] text-n-400 mt-0.5">
          {siteExpensesApproved > 0 ? `Approved: ${formatINR(siteExpensesApproved)}` : 'Estimated budget'}
        </div>
      </div>

      {/* Total Outflow */}
      <div className="px-4 py-3 bg-white border border-n-200 rounded-lg">
        <div className="text-[10px] text-n-500 mb-1 uppercase tracking-wide">Total Outflow</div>
        <div className="text-lg font-bold font-mono text-n-900">{formatINR(actualBudget)}</div>
        <div className="text-[10px] text-n-400 mt-0.5">Material + Site Expenses</div>
      </div>

      {/* Expected Margin */}
      <div className={`px-4 py-3 border rounded-lg ${marginBg}`}>
        <div className="text-[10px] text-n-500 mb-1 uppercase tracking-wide">Final Margin</div>
        <div className={`text-lg font-bold font-mono ${marginColor}`}>
          {margin.toFixed(1)}%
        </div>
        <div className="text-[10px] text-n-400 mt-0.5">
          {formatINR(projectCost - actualBudget)} profit
        </div>
      </div>
    </div>
  );
}

// ── Send to Purchase Team Button ──

export function SendToPurchaseButton({ projectId, yetToFinalizeCount }: { projectId: string; yetToFinalizeCount: number }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<{ count: number } | null>(null);

  if (yetToFinalizeCount === 0) return null;

  async function handleSend() {
    if (!confirm(`Send ${yetToFinalizeCount} item(s) to purchase team? Their status will change to "Yet to Place".`)) return;
    setLoading(true);
    const res = await sendBoqToPurchase({ projectId });
    setLoading(false);
    if (res.success) {
      setResult({ count: res.count ?? 0 });
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={handleSend} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
        <Send className="h-3.5 w-3.5 mr-1.5" />
        {loading ? 'Sending...' : `Send to Purchase (${yetToFinalizeCount})`}
      </Button>
      {result && <span className="text-xs text-green-600">{result.count} items sent</span>}
    </div>
  );
}

// ── Apply Price Book Rates Button ──

export function ApplyPriceBookButton({ projectId, zeroPriceCount }: { projectId: string; zeroPriceCount: number }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);

  if (zeroPriceCount === 0) return null;

  async function handleApply() {
    if (!confirm(`Apply Price Book rates to ${zeroPriceCount} item(s) without pricing?`)) return;
    setLoading(true);
    const res = await applyPriceBookRates({ projectId });
    setLoading(false);
    if (res.success) {
      setResult(`${res.updatedCount ?? 0} items updated`);
      router.refresh();
    } else {
      setResult(res.error ?? 'Failed');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleApply} disabled={loading}>
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Applying...' : `Auto-Price (${zeroPriceCount})`}
      </Button>
      {result && <span className="text-xs text-green-600">{result}</span>}
    </div>
  );
}

// Legacy: Inline actual cost editor for each row (legacy cost variance view)
interface BoqInlineEditLegacyProps {
  projectId: string;
  varianceId: string;
  currentActual: number;
  currentNotes: string | null;
}

export function BoqActualCostEdit({ projectId, varianceId, currentActual, currentNotes }: BoqInlineEditLegacyProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [actualCost, setActualCost] = React.useState(currentActual.toString());
  const [notes, setNotes] = React.useState(currentNotes ?? '');
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    const result = await updateCostVariance({
      projectId,
      varianceId,
      actual_cost: parseFloat(actualCost) || 0,
      notes: notes || null,
    });
    setSaving(false);
    if (result.success) {
      setEditing(false);
      router.refresh();
    }
  }

  if (!editing) {
    return (
      <span
        className="font-mono cursor-pointer hover:bg-p-50 rounded px-1 -mx-1 transition-colors"
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit"
      >
        {formatINR(currentActual)}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        value={actualCost}
        onChange={(e) => setActualCost(e.target.value)}
        type="number"
        step="0.01"
        className="text-xs h-7 w-[100px] text-right font-mono"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600" onClick={handleSave} disabled={saving}>
        <Save className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ── BOQ Category Filter ──

export function BoqCategoryFilter({
  currentCategory,
  onChange,
  categories,
}: {
  currentCategory: string;
  onChange: (cat: string) => void;
  categories: string[];
}) {
  return (
    <Select
      value={currentCategory}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs h-8 w-[180px]"
    >
      <option value="">All Categories</option>
      {categories.map((cat) => {
        const label = BOI_CATEGORIES.find((c) => c.value === cat)?.label ?? cat.replace(/_/g, ' ');
        return <option key={cat} value={cat}>{label}</option>;
      })}
    </Select>
  );
}
