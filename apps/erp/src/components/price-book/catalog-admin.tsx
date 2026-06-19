'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '@repo/ui';
import {
  addItemCategory, addItemUnit,
  toggleItemCategoryActive, toggleItemUnitActive,
} from '@/lib/item-catalog-actions';
import type { ItemCategoryOpt, ItemUnitOpt } from '@/lib/item-catalog-queries';

interface CatalogAdminProps {
  categories: ItemCategoryOpt[];
  units: ItemUnitOpt[];
}

export function CatalogAdmin({ categories, units }: CatalogAdminProps) {
  const router = useRouter();

  // ── Category state ──
  const [catLabel, setCatLabel] = React.useState('');
  const [savingCat, setSavingCat] = React.useState(false);
  const [catError, setCatError] = React.useState<string | null>(null);
  const [togglingCat, setTogglingCat] = React.useState<string | null>(null);

  // ── Unit state ──
  const [unitValue, setUnitValue] = React.useState('');
  const [savingUnit, setSavingUnit] = React.useState(false);
  const [unitError, setUnitError] = React.useState<string | null>(null);
  const [togglingUnit, setTogglingUnit] = React.useState<string | null>(null);

  async function handleAddCategory() {
    if (!catLabel.trim()) return;
    setSavingCat(true);
    setCatError(null);
    const result = await addItemCategory({ label: catLabel.trim() });
    setSavingCat(false);
    if (result.success) {
      setCatLabel('');
      router.refresh();
    } else {
      setCatError(result.error ?? 'Failed to add category');
    }
  }

  async function handleToggleCategory(value: string, isActive: boolean) {
    setTogglingCat(value);
    await toggleItemCategoryActive({ value, isActive });
    setTogglingCat(null);
    router.refresh();
  }

  async function handleAddUnit() {
    if (!unitValue.trim()) return;
    setSavingUnit(true);
    setUnitError(null);
    const result = await addItemUnit({ value: unitValue.trim() });
    setSavingUnit(false);
    if (result.success) {
      setUnitValue('');
      router.refresh();
    } else {
      setUnitError(result.error ?? 'Failed to add unit');
    }
  }

  async function handleToggleUnit(value: string, isActive: boolean) {
    setTogglingUnit(value);
    await toggleItemUnitActive({ value, isActive });
    setTogglingUnit(null);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Categories card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Categories ({categories.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm [&_td]:align-top">
            <thead className="bg-n-50 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-left font-mono">Value</th>
                <th className="px-3 py-2 text-left">Active</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.value} className="border-t border-n-100">
                  <td className="px-3 py-2 text-n-900">{c.label}</td>
                  <td className="px-3 py-2 font-mono text-n-500 whitespace-nowrap">{c.value}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleToggleCategory(c.value, !c.is_active)}
                      disabled={togglingCat === c.value}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.is_active ? 'bg-green-500' : 'bg-n-300'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${c.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Add row */}
          <div className="px-3 py-2 border-t border-n-200 flex items-center gap-2">
            <Input
              value={catLabel}
              onChange={(e) => setCatLabel(e.target.value)}
              placeholder="New category label"
              className="h-7 text-xs flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
            />
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleAddCategory}
              disabled={savingCat || !catLabel.trim()}
            >
              {savingCat ? '…' : 'Add'}
            </Button>
          </div>
          {catError && <p className="px-3 pb-2 text-xs text-red-600">{catError}</p>}
        </CardContent>
      </Card>

      {/* Units card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Units ({units.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm [&_td]:align-top">
            <thead className="bg-n-50 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-mono">Value</th>
                <th className="px-3 py-2 text-left">Active</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.value} className="border-t border-n-100">
                  <td className="px-3 py-2 font-mono text-n-900 whitespace-nowrap">{u.value}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleToggleUnit(u.value, !u.is_active)}
                      disabled={togglingUnit === u.value}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${u.is_active ? 'bg-green-500' : 'bg-n-300'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${u.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Add row */}
          <div className="px-3 py-2 border-t border-n-200 flex items-center gap-2">
            <Input
              value={unitValue}
              onChange={(e) => setUnitValue(e.target.value)}
              placeholder="New unit (e.g. Roll)"
              className="h-7 text-xs flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddUnit(); }}
            />
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleAddUnit}
              disabled={savingUnit || !unitValue.trim()}
            >
              {savingUnit ? '…' : 'Add'}
            </Button>
          </div>
          {unitError && <p className="px-3 pb-2 text-xs text-red-600">{unitError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
