'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@repo/ui';
import { saveDesignNotes, submitDesignConfirmation } from '@/lib/design-actions';

/**
 * DesignNotesEditor — client wrapper for the design-notes textarea + "Mark
 * Design Confirmed" submit button.
 *
 * Persists notes on blur (not on every keystroke — the server action reads
 * the whole value each time). On submit, calls submitDesignConfirmation()
 * which validates BOM has lines, every line has price_book_id, notes are
 * non-empty — then flips the lead to design_confirmed and the marketing team
 * takes over.
 */
interface DesignNotesEditorProps {
  leadId: string;
  initialNotes: string | null;
  currentStatus: string;
  bomLineCount: number;
  bomUnmatchedCount: number;
}

export function DesignNotesEditor({
  leadId,
  initialNotes,
  currentStatus,
  bomLineCount,
  bomUnmatchedCount,
}: DesignNotesEditorProps) {
  const router = useRouter();
  const [notes, setNotes] = React.useState(initialNotes ?? '');
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  async function handleBlur() {
    if (notes === (initialNotes ?? '')) return;
    setSaving(true);
    const result = await saveDesignNotes(leadId, notes);
    setSaving(false);
    if (result.success) {
      setSavedAt(new Date());
    } else {
      console.error('[DesignNotesEditor] Save failed:', result.error);
    }
  }

  async function handleConfirm() {
    setError(null);
    // Save notes first so the server-side validation sees the latest value
    if (notes !== (initialNotes ?? '')) {
      const saveResult = await saveDesignNotes(leadId, notes);
      if (!saveResult.success) {
        setError(`Save failed before confirmation: ${saveResult.error}`);
        return;
      }
    }

    startTransition(async () => {
      const result = await submitDesignConfirmation(leadId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const canConfirm =
    currentStatus === 'design_in_progress' &&
    bomLineCount > 0 &&
    bomUnmatchedCount === 0 &&
    notes.trim() !== '';

  const blockerReasons: string[] = [];
  if (currentStatus !== 'design_in_progress') {
    blockerReasons.push(`Lead is in '${currentStatus}' - move to design_in_progress first`);
  }
  if (bomLineCount === 0) blockerReasons.push('BOM has no lines');
  if (bomUnmatchedCount > 0)
    blockerReasons.push(`${bomUnmatchedCount} BOM line(s) missing price book entry`);
  if (notes.trim() === '') blockerReasons.push('Design notes are empty');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Design Notes</CardTitle>
          <div className="flex items-center gap-2 text-xs text-n-500">
            {saving && <span>Saving...</span>}
            {!saving && savedAt && <span>Saved {savedAt.toLocaleTimeString('en-IN')}</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleBlur}
          placeholder="Notes for the sales team — design rationale, assumptions, special requirements, site constraints, etc. Must be non-empty before Mark Design Confirmed."
          className="w-full min-h-[160px] text-sm p-3 rounded border border-n-200 focus:outline-none focus:ring-2 focus:ring-shiroi-green/40 focus:border-shiroi-green"
        />

        <div className="flex items-start justify-between gap-4 pt-2 border-t border-n-100">
          <div className="flex-1 min-w-0 space-y-1">
            {canConfirm ? (
              <p className="text-xs text-green-700">
                All checks pass. Clicking confirm will transition the lead to Design Confirmed
                and notify the marketing team.
              </p>
            ) : (
              <>
                <p className="text-xs text-amber-700 font-medium">Cannot confirm yet:</p>
                <ul className="text-xs text-amber-700 list-disc list-inside">
                  {blockerReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <Button onClick={handleConfirm} disabled={!canConfirm || isPending}>
            {isPending ? 'Confirming...' : 'Mark Design Confirmed →'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
