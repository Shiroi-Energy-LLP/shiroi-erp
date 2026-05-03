'use client';

import { useState } from 'react';
import { Button, useToast } from '@repo/ui';
import { FolderPlus, ExternalLink } from 'lucide-react';
import { requestDriveFolderForLead } from '@/lib/documents-actions';

interface DriveFolderButtonProps {
  leadId: string;
  driveFolderUrl: string | null;
  /** Roles that can trigger creation (UI guard; server enforces RLS). */
  canCreate: boolean;
}

export function DriveFolderButton({
  leadId,
  driveFolderUrl,
  canCreate,
}: DriveFolderButtonProps) {
  const [submitting, setSubmitting] = useState(false);
  const { addToast } = useToast();

  // Already exists — show "Open" link
  if (driveFolderUrl) {
    return (
      <a
        href={driveFolderUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-p-600 hover:underline font-medium"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open Drive folder
      </a>
    );
  }

  if (!canCreate) {
    return (
      <span className="text-xs text-n-500 italic">
        No Drive folder yet. Ask Marketing or Design to create one.
      </span>
    );
  }

  async function handleClick() {
    setSubmitting(true);
    const result = await requestDriveFolderForLead(leadId);
    setSubmitting(false);

    if (!result.success) {
      addToast({
        variant: 'destructive',
        title: 'Failed to request Drive folder',
        description: result.error,
      });
      return;
    }
    if (result.data.alreadyExists) {
      addToast({
        variant: 'success',
        title: 'Drive folder already exists',
        description: 'Refreshing to show the link.',
      });
    } else {
      addToast({
        variant: 'success',
        title: 'Drive folder requested',
        description:
          'Folder is being created in the background. Refresh in 30s to see the Open link.',
      });
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={submitting}
    >
      <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
      {submitting ? 'Requesting…' : 'Create Drive folder'}
    </Button>
  );
}
