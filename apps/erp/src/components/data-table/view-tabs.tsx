'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { saveView, deleteView, setViewAsDefault } from '@/lib/views-actions';
import {
  Button,
  Input,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui';
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
            ? 'border-shiroi-gold text-shiroi-gold-dark'
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
                ? 'border-shiroi-gold text-shiroi-gold-dark'
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-n-400 hover:text-n-900 transition-opacity"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={() => handleUpdateView(view)}
                className="gap-2 text-sm"
              >
                <Save className="h-3.5 w-3.5" /> Save changes
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleToggleDefault(view)}
                className="gap-2 text-sm"
              >
                <Star className={`h-3.5 w-3.5 ${view.is_default ? 'text-amber-500 fill-amber-500' : ''}`} />
                {view.is_default ? 'Remove default' : 'Set as default'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleDeleteView(view.id)}
                className="gap-2 text-sm text-status-error-text focus:text-status-error-text focus:bg-status-error-bg"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          className="flex items-center gap-1 px-3 py-2.5 text-sm text-n-500 hover:text-shiroi-gold-dark transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Save view
        </button>
      )}
    </div>
  );
}
