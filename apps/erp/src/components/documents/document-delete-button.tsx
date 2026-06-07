'use client';

/**
 * Small per-row "Delete" button for an indexed document. Wraps the
 * `softDeleteDocument` server action (documents-actions.ts).
 *
 * Role gating happens at the call site — the parent decides whether to render
 * this button. Confirms with a native browser dialog (matches the pattern
 * used by `delete-expense-button.tsx` and `project-files` row delete).
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { softDeleteDocument } from '@/lib/documents-actions';

interface DocumentDeleteButtonProps {
  documentId: string;
  documentName: string;
}

export function DocumentDeleteButton({ documentId, documentName }: DocumentDeleteButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function handle() {
    if (busy) return;
    if (!confirm(`Delete "${documentName}"? It will be hidden from the list but kept in storage.`)) return;
    setBusy(true);
    const r = await softDeleteDocument(documentId);
    setBusy(false);
    if (!r.success) {
      alert(`Delete failed: ${r.error}`);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-50 shrink-0"
      title="Delete document"
    >
      <Trash2 className="h-3 w-3" />
      {busy ? 'Deleting…' : 'Delete'}
    </button>
  );
}
