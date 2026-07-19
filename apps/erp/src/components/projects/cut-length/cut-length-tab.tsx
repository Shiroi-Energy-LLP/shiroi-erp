'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@repo/ui';
import { Plus, Trash2, Cable, Zap, Layers, Minus } from 'lucide-react';
import { formatDate } from '@repo/ui/formatters';
import { recordCutLength, deleteCutRecord } from '@/lib/inventory-actions';
import type { CutRecordWithCutter, CableSummaryRow } from '@/lib/inventory-queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MaterialType = 'dc_cable' | 'ac_cable' | 'earthing_wire' | 'conduit_pvc' | 'conduit_gi' | 'other';

const MATERIAL_LABELS: Record<MaterialType, string> = {
  dc_cable: 'DC Cable',
  ac_cable: 'AC Cable',
  earthing_wire: 'Earthing Wire',
  conduit_pvc: 'Conduit (PVC)',
  conduit_gi: 'Conduit (GI)',
  other: 'Other',
};

const STAGE_OPTIONS = [
  { value: 'dc_wiring',       label: 'DC Wiring' },
  { value: 'ac_wiring',       label: 'AC Wiring' },
  { value: 'earthing',        label: 'Earthing' },
  { value: 'conduit_laying',  label: 'Conduit Laying' },
  { value: 'other',           label: 'Other' },
];

function materialIcon(type: MaterialType) {
  switch (type) {
    case 'dc_cable': return <Zap className="h-3.5 w-3.5 text-amber-500" />;
    case 'ac_cable': return <Cable className="h-3.5 w-3.5 text-blue-500" />;
    case 'earthing_wire': return <Zap className="h-3.5 w-3.5 text-green-600" />;
    case 'conduit_pvc': case 'conduit_gi': return <Layers className="h-3.5 w-3.5 text-n-500" />;
    default: return <Minus className="h-3.5 w-3.5 text-n-400" />;
  }
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function CableSummaryStrip({ summary }: { summary: CableSummaryRow[] }) {
  const summaryMap = Object.fromEntries(summary.map((s) => [s.material_type, s.total_meters]));

  const keys: MaterialType[] = ['dc_cable', 'ac_cable', 'earthing_wire', 'conduit_pvc', 'conduit_gi'];
  const visible = keys.filter((k) => summaryMap[k] !== undefined);

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-n-200 bg-n-50 px-4 py-3 text-sm text-n-500 text-center">
        No materials recorded yet
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {visible.map((key) => (
        <div key={key} className="flex items-center gap-2 rounded-lg border border-n-200 bg-n-50 px-3 py-2 text-sm">
          {materialIcon(key)}
          <span className="font-medium text-n-700">{(summaryMap[key] ?? 0).toFixed(1)} m</span>
          <span className="text-n-500 text-xs">{MATERIAL_LABELS[key]}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record dialog
// ---------------------------------------------------------------------------

interface RecordDialogProps {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}

function RecordDialog({ projectId, onClose, onSaved }: RecordDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [materialType, setMaterialType] = React.useState<MaterialType>('dc_cable');
  const [specification, setSpecification] = React.useState('');
  const [lengthMeters, setLengthMeters] = React.useState('');
  const [quantityRolls, setQuantityRolls] = React.useState('');
  const [cutDate, setCutDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [projectStage, setProjectStage] = React.useState('');
  const [notes, setNotes] = React.useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const len = parseFloat(lengthMeters);
    if (isNaN(len) || len <= 0) { setError('Length must be a positive number'); return; }
    if (!specification.trim()) { setError('Specification is required'); return; }

    setBusy(true);
    setError(null);

    const res = await recordCutLength({
      projectId,
      materialType,
      specification,
      lengthMeters: len,
      quantityRolls: quantityRolls ? parseInt(quantityRolls, 10) : undefined,
      cutDate,
      projectStage: projectStage || undefined,
      notes: notes || undefined,
    });

    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Cut Length</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-n-600 mb-1">Material Type</label>
              <select
                value={materialType}
                onChange={(e) => setMaterialType(e.target.value as MaterialType)}
                className="w-full h-9 rounded-md border border-n-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30"
              >
                {(Object.keys(MATERIAL_LABELS) as MaterialType[]).map((k) => (
                  <option key={k} value={k}>{MATERIAL_LABELS[k]}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-n-600 mb-1">Specification <span className="text-red-500">*</span></label>
              <input
                type="text"
                placeholder="e.g. 6mm², Black or 25mm PVC"
                value={specification}
                onChange={(e) => setSpecification(e.target.value)}
                className="w-full h-9 rounded-md border border-n-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-n-600 mb-1">Length (metres) <span className="text-red-500">*</span></label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={lengthMeters}
                onChange={(e) => setLengthMeters(e.target.value)}
                className="w-full h-9 rounded-md border border-n-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-n-600 mb-1">Rolls consumed</label>
              <input
                type="number"
                step="1"
                min="1"
                placeholder="—"
                value={quantityRolls}
                onChange={(e) => setQuantityRolls(e.target.value)}
                className="w-full h-9 rounded-md border border-n-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-n-600 mb-1">Cut Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={cutDate}
                onChange={(e) => setCutDate(e.target.value)}
                className="w-full h-9 rounded-md border border-n-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-n-600 mb-1">Project Stage</label>
              <select
                value={projectStage}
                onChange={(e) => setProjectStage(e.target.value)}
                className="w-full h-9 rounded-md border border-n-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30"
              >
                <option value="">— select —</option>
                {STAGE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-n-600 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes"
                className="w-full rounded-md border border-n-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30 resize-none"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <DialogFooter className="pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

interface ConfirmDeleteDialogProps {
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDeleteDialog({ open, busy, onConfirm, onCancel }: ConfirmDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete this cut record?</DialogTitle>
          <DialogDescription>
            This permanently removes the cut entry and adjusts the cable-summary total.
            Only the founder or the project manager who logged it can delete.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

interface CutLengthTabProps {
  projectId: string;
  records: CutRecordWithCutter[];
  summary: CableSummaryRow[];
  canDelete: boolean;
}

export function CutLengthTab({ projectId, records, summary, canDelete }: CutLengthTabProps) {
  const router = useRouter();
  const [showDialog, setShowDialog] = React.useState(false);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  async function performDelete() {
    if (!pendingDeleteId) return;
    setDeletingId(pendingDeleteId);
    setDeleteError(null);
    const res = await deleteCutRecord(pendingDeleteId);
    setDeletingId(null);
    setPendingDeleteId(null);
    if (!res.success) { setDeleteError(res.error); return; }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-n-900">Materials Cut-Length Log</h3>
          <p className="text-xs text-n-500 mt-0.5">Cable and conduit consumed on site for this project</p>
        </div>
        <Button size="sm" onClick={() => setShowDialog(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Record Cut Length
        </Button>
      </div>

      {/* Summary strip */}
      <CableSummaryStrip summary={summary} />

      {/* Records table */}
      {records.length === 0 ? (
        <div className="rounded-lg border border-dashed border-n-300 py-10 text-center text-sm text-n-400">
          No cut records yet. Click &ldquo;Record Cut Length&rdquo; to add one.
        </div>
      ) : (
        <div className="rounded-lg border border-n-200 overflow-hidden">
          <table className="w-full text-sm [&_td]:align-top">
            <thead>
              <tr className="bg-n-50 border-b border-n-200">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-n-500 uppercase tracking-wide">Material</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-n-500 uppercase tracking-wide">Specification</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-n-500 uppercase tracking-wide">Length (m)</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-n-500 uppercase tracking-wide">Stage</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-n-500 uppercase tracking-wide">Date</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-n-500 uppercase tracking-wide">Cut By</th>
                {canDelete && <th className="px-3 py-2.5 w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-n-100">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-n-50 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {materialIcon(r.material_type as MaterialType)}
                      <span className="font-medium text-n-700">{MATERIAL_LABELS[r.material_type as MaterialType] ?? r.material_type}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-n-600">{r.specification}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-medium text-n-800 whitespace-nowrap">{Number(r.length_meters).toFixed(2)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.project_stage ? (
                      <Badge variant="outline" className="text-[10px]">
                        {STAGE_OPTIONS.find((s) => s.value === r.project_stage)?.label ?? r.project_stage}
                      </Badge>
                    ) : (
                      <span className="text-n-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-n-600 whitespace-nowrap">{formatDate(r.cut_date)}</td>
                  <td className="px-3 py-2.5 text-n-500">
                    {r.profiles?.full_name ?? '—'}
                  </td>
                  {canDelete && (
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setPendingDeleteId(r.id)}
                        disabled={deletingId === r.id}
                        className="text-n-400 hover:text-red-500 transition-colors disabled:opacity-40"
                        title="Delete record"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}

      {/* Dialogs */}
      {showDialog && (
        <RecordDialog
          projectId={projectId}
          onClose={() => setShowDialog(false)}
          onSaved={() => router.refresh()}
        />
      )}
      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        busy={deletingId !== null}
        onConfirm={performDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
