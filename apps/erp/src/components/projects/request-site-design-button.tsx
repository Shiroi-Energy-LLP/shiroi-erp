'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Badge,
} from '@repo/ui';
import { Ruler } from 'lucide-react';
import {
  requestSiteDesign,
  markSiteDesignComplete,
} from '@/lib/projects-design-request-actions';

// ── Types ─────────────────────────────────────────────────────────────────────

const REQUEST_ROLES = new Set(['project_manager', 'founder', 'marketing_manager']);
const COMPLETE_ROLES = new Set(['designer', 'founder', 'project_manager']);

interface RequestSiteDesignButtonProps {
  projectId: string;
  /** Current flag value — TRUE means a request is already pending. */
  needsSiteDesign: boolean;
  /** Caller's role, resolved server-side and passed as a prop. */
  viewerRole: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RequestSiteDesignButton({
  projectId,
  needsSiteDesign,
  viewerRole,
}: RequestSiteDesignButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canRequest = viewerRole && REQUEST_ROLES.has(viewerRole);
  const canComplete = viewerRole && COMPLETE_ROLES.has(viewerRole);

  // ── Case 1: already requested — show badge + (optional) complete button ──
  if (needsSiteDesign) {
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="bg-[#EDE9FE] text-[#5B21B6] border-[#C4B5FD] font-medium text-xs"
        >
          <Ruler className="h-3 w-3 mr-1" />
          Site design requested
        </Badge>

        {canComplete && (
          <MarkCompleteButton
            projectId={projectId}
            onDone={() => router.refresh()}
          />
        )}
      </div>
    );
  }

  // ── Case 2: not requested — show request button (role-gated) ──
  if (!canRequest) return null;

  async function handleRequest() {
    setBusy(true);
    setError(null);
    const result = await requestSiteDesign(projectId, note);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setOpen(false);
    setNote('');
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setError(null);
          setNote('');
          setOpen(true);
        }}
        className="border-[#5B21B6] text-[#5B21B6] hover:bg-[#EDE9FE]"
      >
        <Ruler className="h-3.5 w-3.5 mr-1.5" />
        Request site design
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request at-site design</DialogTitle>
            <DialogDescription>
              Flags this project for the design team to produce an at-site layout
              (e.g. unusual roof geometry, post-survey changes). Add a note to
              give the designer context.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium text-n-800">
              Note <span className="text-n-400 font-normal">(optional)</span>
            </label>
            <textarea
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="e.g. Complex L-shaped roof — please produce panel layout before purchase order"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              disabled={busy}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={handleRequest} disabled={busy}>
              {busy ? 'Requesting...' : 'Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── MarkCompleteButton (inline, extracted to keep JSX readable) ───────────────

function MarkCompleteButton({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handle() {
    setBusy(true);
    setError(null);
    const result = await markSiteDesignComplete(projectId);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        onClick={handle}
        disabled={busy}
        className="text-xs text-n-500 hover:text-n-800"
      >
        {busy ? 'Saving...' : 'Mark complete'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
