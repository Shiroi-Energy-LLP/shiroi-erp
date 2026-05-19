'use client';

import * as React from 'react';
import { Button, Badge, Select, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, useToast } from '@repo/ui';
import { X, Trash2, GitMerge } from 'lucide-react';
import { bulkAssignLeads, bulkChangeLeadStatus, bulkDeleteLeads } from '@/lib/leads-actions';
import { MergeLeadsModal } from './merge-leads-modal';
import { STAGE_LABELS } from '@/lib/leads-helpers';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

interface Employee {
  id: string;
  full_name: string;
}

interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  status: string;
}

interface BulkActionBarProps {
  selectedIds: string[];
  selectedLeads: Lead[];
  employees: Employee[];
  onClear: () => void;
  onActionComplete: () => void;
}

// Active pipeline stages only — no legacy (proposal_sent) or terminal (won/lost/disqualified/converted)
const BULK_STATUS_KEYS: LeadStatus[] = [
  'new',
  'contacted',
  'quick_quote_sent',
  'site_survey_scheduled',
  'site_survey_done',
  'design_in_progress',
  'design_confirmed',
  'detailed_proposal_sent',
  'negotiation',
  'closure_soon',
  'on_hold',
];

const BULK_STATUSES = BULK_STATUS_KEYS.map((value) => ({
  value,
  label: STAGE_LABELS[value],
}));

export function BulkActionBar({
  selectedIds,
  selectedLeads,
  employees,
  onClear,
  onActionComplete,
}: BulkActionBarProps) {
  const [loading, setLoading] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showMerge, setShowMerge] = React.useState(false);
  const { addToast } = useToast();

  async function handleAssign(assignedTo: string) {
    if (!assignedTo) return;
    setLoading(true);
    const result = await bulkAssignLeads(selectedIds, assignedTo);
    setLoading(false);
    if (result.success) {
      onActionComplete();
    } else if (result.error) {
      addToast({ variant: 'destructive', title: 'Assign failed', description: result.error });
    }
  }

  async function handleStatusChange(status: string) {
    if (!status) return;
    setLoading(true);
    const result = await bulkChangeLeadStatus(selectedIds, status as LeadStatus);
    setLoading(false);
    if (result.success) {
      // Surface partial-update warning (success=true but error message means some rows were skipped)
      if (result.error) {
        addToast({ variant: 'destructive', title: 'Partial update', description: result.error });
      }
      onActionComplete();
    } else if (result.error) {
      addToast({ variant: 'destructive', title: 'Status change failed', description: result.error });
    }
  }

  async function handleDelete() {
    setLoading(true);
    const result = await bulkDeleteLeads(selectedIds);
    setLoading(false);
    setShowDeleteConfirm(false);
    if (result.success) onActionComplete();
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border border-shiroi-green bg-status-success-bg px-4 py-2.5">
        <Badge variant="success" className="text-xs font-bold">
          {selectedIds.length} selected
        </Badge>

        <Select
          className="w-40 h-8 text-xs"
          defaultValue=""
          onChange={(e) => handleAssign(e.target.value)}
          disabled={loading}
        >
          <option value="" disabled>Assign to...</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.full_name}</option>
          ))}
        </Select>

        <Select
          className="w-40 h-8 text-xs"
          defaultValue=""
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={loading}
        >
          <option value="" disabled>Change status...</option>
          {BULK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>

        {selectedIds.length === 2 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMerge(true)}
            disabled={loading}
            className="h-8 text-xs gap-1"
          >
            <GitMerge className="h-3.5 w-3.5" />
            Merge
          </Button>
        )}

        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={loading}
          className="h-8 text-xs gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={loading}
          className="h-8 text-xs gap-1 ml-auto"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.length} lead{selectedIds.length > 1 ? 's' : ''}?</DialogTitle>
            <DialogDescription>
              This will soft-delete the selected leads. They can be restored later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showMerge && selectedLeads.length === 2 && selectedLeads[0] && selectedLeads[1] && (
        <MergeLeadsModal
          leadA={selectedLeads[0]}
          leadB={selectedLeads[1]}
          open={showMerge}
          onOpenChange={setShowMerge}
          onMergeComplete={onActionComplete}
        />
      )}
    </>
  );
}
