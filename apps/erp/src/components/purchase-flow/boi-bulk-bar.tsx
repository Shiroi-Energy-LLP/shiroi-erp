'use client';

// =============================================================================
// BOI bulk action bar (spec §5.5) — appears above the table when ≥1 row is
// selected: "N selected" · status dropdown + Change Status · 📄 Create PO
// (Task 4 wires it — rendered disabled for now) · 🗑 Delete Selected · Clear
// Selection. Confirm dialogs live in the workspace handlers.
// =============================================================================

import * as React from 'react';
import { FileText, Trash2, X } from 'lucide-react';
import { Button, Select } from '@repo/ui';
import {
  BOI_STATUSES,
  BOI_STATUS_LABELS,
  type BoiStatus,
} from '@/lib/purchase-flow-constants';

interface BoiBulkBarProps {
  count: number;
  busy: boolean;
  onChangeStatus: (status: BoiStatus) => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
}

export function BoiBulkBar({
  count,
  busy,
  onChangeStatus,
  onDeleteSelected,
  onClearSelection,
}: BoiBulkBarProps) {
  const [status, setStatus] = React.useState<BoiStatus>('yet_to_place');

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <span className="text-xs font-semibold text-n-800">{count} selected</span>

      <span className="mx-1 h-4 w-px bg-amber-200" />

      <Select
        value={status}
        onChange={(e) => setStatus(e.target.value as BoiStatus)}
        disabled={busy}
        className="h-7 w-40 text-xs"
        aria-label="Bulk status"
      >
        {BOI_STATUSES.map((s) => (
          <option key={s} value={s}>
            {BOI_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onChangeStatus(status)}
        className="h-7 text-xs"
      >
        Change Status
      </Button>

      <span className="mx-1 h-4 w-px bg-amber-200" />

      {/* Task 4 wires the Create-PO modal — stub kept visible so the muscle-
          memory layout is already in place. */}
      <Button
        size="sm"
        disabled
        title="Create PO — wired in next step"
        className="h-7 gap-1 text-xs"
      >
        <FileText className="h-3.5 w-3.5" /> Create PO
      </Button>

      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={onDeleteSelected}
        className="h-7 gap-1 text-xs text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete Selected
      </Button>

      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={onClearSelection}
        className="h-7 gap-1 text-xs"
      >
        <X className="h-3.5 w-3.5" /> Clear Selection
      </Button>
    </div>
  );
}
