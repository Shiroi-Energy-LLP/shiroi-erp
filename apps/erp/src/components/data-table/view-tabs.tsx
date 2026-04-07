'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { saveView, deleteView, setViewAsDefault } from '@/lib/views-actions';
import { Button, Input } from '@repo/ui';
import { Plus, X, Save, MoreHorizontal, Trash2, Star } from 'lucide-react';

interface ViewConfig {
  id: string;
  name: string;
  is_default: boolean;
  visibility: string;
  columns: string[];
  filters: Record<string, unknown>;
  sort_column: string | null;
  sort_direction: string;
  owner_id: string;
}

interface ViewTabsProps {
  entityType: string;
  views: ViewConfig[];
  activeViewId: string | null;
  onViewChange: (view: ViewConfig | null) => void;
  currentColumns: string[];
  currentFilters: Record<string, unknown>;
  currentSort?: { column: string; direction: string };
}

export function ViewTabs({
  entityType,
  views,
  activeViewId,
  onViewChange,
  currentColumns,
  currentFilters,
  currentSort,
}: ViewTabsProps) {
  const router = useRouter();
  const [showNewForm, setShowNewForm] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [menuViewId, setMenuViewId] = React.useState<string | null>(null);

  async function handleSaveNew() {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await saveView({
      entityType,
      name: newName.trim(),
      columns: currentColumns,
      filters: currentFilters,
      sortColumn: currentSort?.column,
      sortDirection: currentSort?.direction,
      visibility: 'private',
    });
    setSaving(false);
    if (res.success) {
      setShowNewForm(false);
      setNewName('');
      router.refresh();
    }
  }

  async function handleUpdateView(view: ViewConfig) {
    setSaving(true);
    await saveView({
      id: view.id,
      entityType,
      name: view.name,
      columns: currentColumns,
      filters: currentFilters,
      sortColumn: currentSort?.column,
      sortDirection: currentSort?.direction,
      visibility: view.visibility,
    });
    setSaving(false);
    router.refresh();
  }

  async function handleToggleDefault(view: ViewConfig) {
    setSaving(true);
    await setViewAsDefault({
      viewId: view.id,
      entityType,
      isDefault: !view.is_default,
    });
    setSaving(false);
    setMenuViewId(null);
    router.refresh();
  }

  async function handleDeleteView(viewId: string) {
    await deleteView(viewId);
    if (activeViewId === viewId) onViewChange(null);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1 border-b border-n-200 overflow-x-auto">
      {/* "All" default tab */}
      <button
        onClick={() => onViewChange(null)}
        className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
          !activeViewId
            ? 'border-shiroi-green text-shiroi-green'
            : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-200'
        }`}
      >
        All {entityType}
      </button>

      {/* Saved view tabs */}
      {views.map((view) => (
        <div key={view.id} className="relative flex items-center group">
          <button
            onClick={() => onViewChange(view)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeViewId === view.id
                ? 'border-shiroi-green text-shiroi-green'
                : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-200'
            }`}
          >
            {view.is_default && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
            {view.name}
            {view.visibility === 'everyone' && (
              <span className="text-[9px] text-n-400 ml-1">(shared)</span>
            )}
          </button>

          {/* View actions menu */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuViewId(menuViewId === view.id ? null : view.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-n-400 hover:text-n-900 transition-opacity"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            {menuViewId === view.id && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-n-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                <button
                  onClick={() => { handleUpdateView(view); setMenuViewId(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-n-900 hover:bg-[#F5F6F8]"
                >
                  <Save className="h-3.5 w-3.5" /> Save changes
                </button>
                <button
                  onClick={() => handleToggleDefault(view)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-n-900 hover:bg-[#F5F6F8]"
                >
                  <Star className={`h-3.5 w-3.5 ${view.is_default ? 'text-amber-500 fill-amber-500' : ''}`} />
                  {view.is_default ? 'Remove default' : 'Set as default'}
                </button>
                <button
                  onClick={() => { handleDeleteView(view.id); setMenuViewId(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-status-error-text hover:bg-status-error-bg"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* New view */}
      {showNewForm ? (
        <div className="flex items-center gap-2 px-2 py-1">
          <Input
            value={newName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
            placeholder="View name..."
            className="h-7 w-36 text-xs"
            autoFocus
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSaveNew(); if (e.key === 'Escape') setShowNewForm(false); }}
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleSaveNew} disabled={saving}>
            Save
          </Button>
          <button onClick={() => setShowNewForm(false)} className="text-n-400 hover:text-n-900">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-1 px-3 py-2.5 text-sm text-n-500 hover:text-shiroi-green transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Save view
        </button>
      )}
    </div>
  );
}
