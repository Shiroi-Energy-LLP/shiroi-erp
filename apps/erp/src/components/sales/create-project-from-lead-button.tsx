'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { createProjectFromLead } from '@/lib/create-project-from-lead-actions';

/**
 * Manual fallback: spawn a project from a 'won' lead.
 *
 * Layout shows this only when the lead is 'won' and no project exists yet
 * (covers the case where the won → accepted → project cascade didn't fire,
 * e.g. bulk-imported wons or wons without an in-play proposal).
 *
 * The DB trigger trg_default_project_manager_on_insert (mig 102) fills
 * project_manager_id with the latest active PM (Manivel today).
 */
export function CreateProjectFromLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    if (
      !window.confirm(
        'Create a project for this lead? It will be assigned to the current default PM (Manivel).',
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await createProjectFromLead(leadId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push(`/projects/${result.data.projectId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={isPending} variant="outline">
        {isPending ? 'Creating…' : 'Create project'}
      </Button>
      {error && <p className="text-xs text-red-600 max-w-xs">{error}</p>}
    </div>
  );
}
