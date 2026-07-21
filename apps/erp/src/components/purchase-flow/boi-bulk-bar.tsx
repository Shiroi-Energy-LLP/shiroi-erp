'use client';

// =============================================================================
// BOI bulk action bar (spec §5.5) — appears above the table when ≥1 row is
// selected: "N selected" · status dropdown + Change Status · 📄 Create PO
// (opens the create-po-modal, spec §6) · 🗑 Delete Selected · Clear Selection.
// Confirm dialogs live in the workspace handlers. All mutating buttons are
// disabled for non-write roles (finance is price-visible but cannot write).
// =============================================================================

import * as React from 'react';
import { FileText, Trash2, X } from 'lucide-react';
import { Button, Select } from '@repo/ui';
import {
  BOI_STATUSES,
  BOI_STATUS_LABELS,
  isBoiStatus,
  type BoiStatus,
} from '@/lib/purchase-flow-constants';

interface BoiBulkBarProps {
  count: number;
  busy: boolean;
  /** Write-capable role (PURCHASE_WRITE_ROLES) — finance sees the bar but all
   *  mutating buttons (incl. Create PO) stay disabled. */
  canWrite: boolean;
  onChangeStatus: (status: BoiStatus) => void;
  onCreatePo: () => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
}

export function BoiBulkBar({
  count,
  busy,
  canWrite,
  onChangeStatus,
  onCreatePo,
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
        onChange={(e) => {
          // Runtime guard, not a blind cast — invalid values are ignored.
          const v = e.target.value;
          if (isBoiStatus(v)) setStatus(v);
        }}
        disabled={busy || !canWrite}
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
        disabled={busy || !canWrite}
        onClick={() => onChangeStatus(status)}
        className="h-7 text-xs"
      >
        Change Status
      </Button>

      <span className="mx-1 h-4 w-px bg-amber-200" />

      <Button
        size="sm"
        disabled={busy || !canWrite}
        title={canWrite ? 'Create a PO from the selected items' : 'Your role cannot create POs'}
        onClick={onCreatePo}
        className="h-7 gap-1 text-xs"
      >
        <FileText className="h-3.5 w-3.5" /> Create PO
      </Button>

      <Button
        size="sm"
        variant="outline"
        disabled={busy || !canWrite}
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
