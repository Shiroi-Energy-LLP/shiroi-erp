'use client';

import { useState, useTransition } from 'react';
import { Flag, Check, Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Label,
  Input,
  Badge,
} from '@repo/ui';
import { createDataFlag, resolveDataFlag, type FlagType, type FlagEntityType, type DataFlag } from '@/lib/data-flag-actions';

const FLAG_TYPE_OPTIONS: { value: FlagType; label: string }[] = [
  { value: 'wrong_data', label: 'Wrong Data' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'wrong_file', label: 'Wrong File' },
  { value: 'wrong_category', label: 'Wrong Category' },
  { value: 'wrong_amount', label: 'Wrong Amount' },
  { value: 'wrong_status', label: 'Wrong Status' },
  { value: 'other', label: 'Other' },
];

interface DataFlagButtonProps {
  entityType: FlagEntityType;
  entityId: string;
  fieldName?: string;
  /** Number of existing unresolved flags */
  flagCount?: number;
  /** Existing flags for this entity (for resolve mode) */
  existingFlags?: DataFlag[];
  /** Can this user resolve flags? (founder/hr/finance) */
  canResolve?: boolean;
  /** Compact mode — just icon, no text */
  compact?: boolean;
}

export function DataFlagButton({
  entityType,
  entityId,
  fieldName,
  flagCount = 0,
  existingFlags,
  canResolve = false,
  compact = false,
}: DataFlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'view'>('create');
  const [flagType, setFlagType] = useState<FlagType>('wrong_data');
  const [fieldInput, setFieldInput] = useState(fieldName ?? '');
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');

  const handleSubmitFlag = () => {
    startTransition(async () => {
      const result = await createDataFlag({
        entityType,
        entityId,
        flagType,
        fieldName: fieldInput || undefined,
        notes: notes || undefined,
      });
      if (result.success) {
        setOpen(false);
        setNotes('');
        setFieldInput(fieldName ?? '');
        setFlagType('wrong_data');
      }
    });
  };

  const handleResolve = (flagId: string) => {
    startTransition(async () => {
      const result = await resolveDataFlag({
        flagId,
        resolutionNotes: resolveNotes || undefined,
      });
      if (result.success) {
        setResolveId(null);
        setResolveNotes('');
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMode(flagCount > 0 && existingFlags ? 'view' : 'create');
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-orange-50 transition-colors"
        title={flagCount > 0 ? `${flagCount} flag(s)` : 'Flag data issue'}
      >
        <Flag className={`h-3.5 w-3.5 ${flagCount > 0 ? 'text-orange-500 fill-orange-500' : 'text-gray-400'}`} />
        {flagCount > 0 && (
          <span className="text-orange-600 font-medium">{flagCount}</span>
        )}
        {!compact && flagCount === 0 && (
          <span className="text-gray-400">Flag</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          {mode === 'create' ? (
            <>
              <DialogHeader>
                <DialogTitle>Flag Data Issue</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {/* Flag type */}
                <div>
                  <Label htmlFor="flag-type">Issue Type</Label>
                  <select
                    id="flag-type"
                    value={flagType}
                    onChange={(e) => setFlagType(e.target.value as FlagType)}
                    className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
                  >
                    {FLAG_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Field name */}
                <div>
                  <Label htmlFor="field-name">Which field? (optional)</Label>
                  <Input
                    id="field-name"
                    value={fieldInput}
                    onChange={(e) => setFieldInput(e.target.value)}
                    placeholder="e.g. phone, category, amount"
                    className="mt-1"
                  />
                </div>

                {/* Notes */}
                <div>
                  <Label htmlFor="flag-notes">Notes (optional)</Label>
                  <textarea
                    id="flag-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What's wrong with this data?"
                    rows={3}
                    className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050] resize-none"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button onClick={handleSubmitFlag} disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Flag className="h-4 w-4 mr-1" />}
                  Submit Flag
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  Flags ({existingFlags?.filter((f) => !f.resolved_at).length ?? flagCount} unresolved)
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 py-2 max-h-[400px] overflow-y-auto">
                {existingFlags?.filter((f) => !f.resolved_at).map((flag) => (
                  <div key={flag.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-orange-600 border-orange-300">
                        {flag.flag_type.replace(/_/g, ' ')}
                      </Badge>
                      {flag.field_name && (
                        <span className="text-xs text-gray-500">Field: {flag.field_name}</span>
                      )}
                    </div>
                    {flag.notes && (
                      <p className="text-sm text-gray-600">{flag.notes}</p>
                    )}
                    <p className="text-xs text-gray-400">
                      {new Date(flag.flagged_at).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </p>

                    {canResolve && (
                      resolveId === flag.id ? (
                        <div className="space-y-2 pt-1">
                          <textarea
                            value={resolveNotes}
                            onChange={(e) => setResolveNotes(e.target.value)}
                            placeholder="Resolution notes (optional)"
                            rows={2}
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleResolve(flag.id)} disabled={isPending}>
                              {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                              Resolve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setResolveId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setResolveId(flag.id)}>
                          Resolve
                        </Button>
                      )
                    )}
                  </div>
                ))}

                {(!existingFlags || existingFlags.filter((f) => !f.resolved_at).length === 0) && (
                  <p className="text-sm text-gray-400 text-center py-4">No unresolved flags</p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setMode('create')}>
                  <Flag className="h-4 w-4 mr-1" />
                  Add New Flag
                </Button>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
