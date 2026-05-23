'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { setAwaitingClientDetails } from '@/lib/liaison-actions';

interface AwaitingClientToggleProps {
  projectId: string;
  isAwaiting: boolean;
  currentNote?: string | null;
}

export function AwaitingClientToggle({ projectId, isAwaiting, currentNote }: AwaitingClientToggleProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [showNoteInput, setShowNoteInput] = React.useState(false);
  const [note, setNote] = React.useState(currentNote ?? '');

  async function handleMark() {
    if (!isAwaiting) {
      setShowNoteInput(true);
      return;
    }
    setSaving(true);
    await setAwaitingClientDetails({ projectId, awaiting: false });
    setSaving(false);
    router.refresh();
  }

  async function handleConfirmNote() {
    setSaving(true);
    await setAwaitingClientDetails({ projectId, awaiting: true, note: note.trim() || undefined });
    setSaving(false);
    setShowNoteInput(false);
    router.refresh();
  }

  if (showNoteInput) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What is needed from the client? (optional)"
          className="text-xs border border-n-200 rounded px-2 py-1 w-56 focus:ring-1 focus:ring-p-300"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmNote()}
        />
        <Button size="sm" onClick={handleConfirmNote} disabled={saving} className="h-7 text-xs">
          {saving ? '...' : 'Confirm'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowNoteInput(false)} className="h-7 text-xs">
          Cancel
        </Button>
      </div>
    );
  }

  if (isAwaiting) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleMark}
        disabled={saving}
        className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
      >
        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
        {saving ? '...' : 'Mark Resolved'}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleMark}
      disabled={saving}
      className="h-7 text-xs text-n-600 hover:text-amber-700"
    >
      <AlertCircle className="h-3.5 w-3.5 mr-1" />
      Awaiting Client
    </Button>
  );
}
