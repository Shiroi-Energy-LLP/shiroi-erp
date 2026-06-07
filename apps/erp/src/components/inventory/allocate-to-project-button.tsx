'use client';

/**
 * AllocateToProjectButton — per-row "Allocate" control on /inventory.
 *
 * Opens a project picker dialog and assigns the stock piece to the chosen
 * project via allocateToProject() server action. Stock piece allocation is
 * piece-level (not quantity-based) — each row in stock_pieces represents one
 * physical item, so the action only takes { stockPieceId, projectId }.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Select,
} from '@repo/ui';
import { Truck } from 'lucide-react';
import { allocateToProject } from '@/lib/inventory-actions';

interface ProjectOption {
  id: string;
  project_number: string;
  customer_name: string;
}

interface AllocateToProjectButtonProps {
  stockPieceId: string;
  itemDescription: string;
  currentProjectId: string | null;
  projects: ProjectOption[];
}

export function AllocateToProjectButton({
  stockPieceId,
  itemDescription,
  currentProjectId,
  projects,
}: AllocateToProjectButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [projectId, setProjectId] = React.useState<string>(currentProjectId ?? '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    if (!projectId) {
      setError('Select a project');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await allocateToProject({ stockPieceId, projectId });
    setSaving(false);

    if (!result.success) {
      setError(result.error ?? 'Failed to allocate');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 h-6 px-2 text-[10px] rounded border border-n-200 text-n-700 hover:bg-n-50"
        title="Allocate to project"
      >
        <Truck className="h-3 w-3" />
        Allocate
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Allocate to project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-n-700">
              Assign <strong>{itemDescription}</strong> to a project. The piece&apos;s location
              will be set to <code className="text-xs bg-n-100 px-1 rounded">on_site</code>.
            </p>
            <div>
              <Label htmlFor="projectId" className="text-xs">
                Project <span className="text-red-500">*</span>
              </Label>
              <Select
                id="projectId"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setError(null);
                }}
              >
                <option value="">— Select project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_number} — {p.customer_name}
                  </option>
                ))}
              </Select>
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={saving || !projectId}>
              {saving ? 'Allocating…' : 'Allocate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
