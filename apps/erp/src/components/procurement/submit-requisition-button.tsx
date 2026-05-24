'use client';

/**
 * Submit Material Requisition button + dialog.
 *
 * Opens a modal where a site supervisor or PM can submit a quick material
 * request. Items are free-text (description + qty + unit). The form keeps
 * a dynamic list of lines — add/remove buttons, max 20 items.
 *
 * Max 500 LOC (NEVER-DO rule #14). This file: ~175 LOC.
 */

import { useState, useTransition } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Select, useToast,
} from '@repo/ui';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { submitMaterialRequisition } from '@/lib/material-requisition-actions';
import { useRouter } from 'next/navigation';

interface LineItem {
  description: string;
  quantity: string;
  unit: string;
  notes: string;
}

const EMPTY_LINE: LineItem = { description: '', quantity: '1', unit: 'nos', notes: '' };

const COMMON_UNITS = ['nos', 'kg', 'mtrs', 'sqft', 'rolls', 'bags', 'ltrs', 'sets', 'pairs'];

interface SubmitRequisitionButtonProps {
  projectId?: string; // If provided, pre-selects the project
}

export function SubmitRequisitionButton({ projectId }: SubmitRequisitionButtonProps) {
  const [open, setOpen] = useState(false);
  const [urgency, setUrgency] = useState<'normal' | 'urgent' | 'critical'>('normal');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { addToast } = useToast();

  const addLine = () => {
    if (lines.length >= 20) return;
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof LineItem, value: string) => {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const handleSubmit = () => {
    const validLines = lines.filter((l) => l.description.trim());
    if (!validLines.length) {
      addToast({ title: 'Add at least one item with a description', variant: 'destructive' });
      return;
    }
    if (!projectId) {
      addToast({ title: 'Project is required — open this from a project workspace', variant: 'destructive' });
      return;
    }

    startTransition(async () => {
      const result = await submitMaterialRequisition({
        projectId,
        urgency,
        notes: notes.trim() || undefined,
        items: validLines.map((l) => ({
          description: l.description.trim(),
          quantity: parseFloat(l.quantity) || 1,
          unit: l.unit,
          notes: l.notes.trim() || undefined,
        })),
      });

      if (!result.success) {
        addToast({ title: result.error, variant: 'destructive' });
        return;
      }

      addToast({ title: 'Material request submitted — the PM will review it shortly', variant: 'success' });
      setOpen(false);
      setLines([{ ...EMPTY_LINE }]);
      setNotes('');
      setUrgency('normal');
      router.refresh();
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Request Materials
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Request Materials
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Urgency */}
            <div>
              <Label className="text-xs font-semibold mb-1 block">Urgency</Label>
              <Select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as typeof urgency)}
                className="h-8 text-sm"
              >
                <option value="normal">Normal — can wait for standard PO flow</option>
                <option value="urgent">Urgent — needed within the week</option>
                <option value="critical">Critical — site is blocked</option>
              </Select>
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-semibold">Items</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addLine}
                  disabled={lines.length >= 20}
                  className="h-6 px-2 text-[11px] gap-1"
                >
                  <Plus className="h-3 w-3" /> Add item
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-start">
                    <input
                      type="text"
                      placeholder="Item description *"
                      value={line.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-full"
                    />
                    <input
                      type="number"
                      placeholder="Qty"
                      value={line.quantity}
                      min="0.01"
                      step="0.01"
                      onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                      className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <select
                      value={line.unit}
                      onChange={(e) => updateLine(idx, 'unit', e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {COMMON_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    {lines.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(idx)}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <div className="h-8 w-8" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs font-semibold mb-1 block">Notes (optional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any context for the PM — brand preference, site issue, etc."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring h-20 resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? 'Submitting…' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
