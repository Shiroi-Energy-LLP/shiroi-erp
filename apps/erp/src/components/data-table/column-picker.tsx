'use client';

import * as React from 'react';
import { Button, Checkbox, Input, Label } from '@repo/ui';
import { GripVertical, X, Search, Columns3 } from 'lucide-react';
import type { ColumnDef } from './column-config';

interface ColumnPickerProps {
  allColumns: ColumnDef[];
  visibleColumns: string[];
  onColumnsChange: (columns: string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ColumnPicker({ allColumns, visibleColumns, onColumnsChange, open, onOpenChange }: ColumnPickerProps) {
  const [search, setSearch] = React.useState('');
  const [localColumns, setLocalColumns] = React.useState<string[]>(visibleColumns);
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);
  const [dropIdx, setDropIdx] = React.useState<number | null>(null);

  React.useEffect(() => {
    setLocalColumns(visibleColumns);
  }, [visibleColumns]);

  if (!open) return null;

  const filteredColumns = allColumns.filter((col) =>
    col.label.toLowerCase().includes(search.toLowerCase())
  );

  const selectedColumnDefs = localColumns
    .map((key) => allColumns.find((c) => c.key === key))
    .filter(Boolean) as ColumnDef[];

  function toggleColumn(key: string) {
    setLocalColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function handleDragStart(e: React.DragEvent, index: number) {
    e.dataTransfer.effectAllowed = 'move';
    setDragIdx(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDropIdx(index);
  }

  function handleDragLeave(e: React.DragEvent) {
    const container = e.currentTarget.parentElement;
    if (container && !container.contains(e.relatedTarget as Node)) {
      setDropIdx(null);
    }
  }

  function handleDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIdx === null) return;
    const reordered = [...localColumns];
    const [dragged] = reordered.splice(dragIdx, 1);
    reordered.splice(index, 0, dragged!);
    setLocalColumns(reordered);
    setDragIdx(null);
    setDropIdx(null);
  }

  function handleDragEnd() {
    setDragIdx(null);
    setDropIdx(null);
  }

  function handleApply() {
    onColumnsChange(localColumns);
    onOpenChange(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={() => onOpenChange(false)} />

      {/* Panel */}
      <div className="relative w-[420px] bg-white shadow-xl border-l border-[#DFE2E8] flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#DFE2E8]">
          <h3 className="text-base font-semibold text-[#1A1D24] flex items-center gap-2">
            <Columns3 className="h-4 w-4" />
            Edit Columns
          </h3>
          <button onClick={() => onOpenChange(false)} className="text-[#7C818E] hover:text-[#1A1D24]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Available columns */}
          <div className="w-1/2 border-r border-[#DFE2E8] flex flex-col">
            <div className="px-3 py-3 border-b border-[#DFE2E8]">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#9CA0AB]" />
                <Input
                  value={search}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                  placeholder="Search columns..."
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {filteredColumns.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 cursor-pointer hover:bg-[#F5F6F8] transition-colors"
                >
                  <Checkbox
                    checked={localColumns.includes(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                  />
                  <span className="text-[13px] text-[#1A1D24]">{col.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Right: Selected columns (reorderable) */}
          <div className="w-1/2 flex flex-col">
            <div className="px-3 py-3 border-b border-[#DFE2E8]">
              <p className="text-xs font-medium text-[#7C818E]">
                {localColumns.length} columns selected
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {selectedColumnDefs.map((col, index) => (
                <div
                  key={col.key}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 bg-white border border-[#DFE2E8] cursor-grab active:cursor-grabbing hover:border-[#00B050] transition-all duration-150 group ${
                    dragIdx === index ? 'opacity-50' : ''
                  } ${
                    dropIdx === index && dragIdx !== index ? 'border-t-2 border-t-[#00B050]' : ''
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5 text-n-400 shrink-0 cursor-grab" />
                  <span className="text-[13px] text-[#1A1D24] flex-1 truncate">{col.label}</span>
                  <button
                    onClick={() => toggleColumn(col.key)}
                    className="text-[#9CA0AB] hover:text-[#991B1B] opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[#DFE2E8]">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleApply}>Apply</Button>
        </div>
      </div>
    </div>
  );
}
