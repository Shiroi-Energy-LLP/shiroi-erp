'use client';

import { useTransition } from 'react';
import { completeLeadTask } from '@/lib/leads-task-actions';

interface CompleteTaskButtonProps {
  taskId: string;
  leadId: string;
}

export function CompleteTaskButton({ taskId, leadId }: CompleteTaskButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await completeLeadTask(taskId, leadId);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="text-xs text-n-500 hover:text-shiroi-green border border-n-200 rounded px-2 py-1 disabled:opacity-50"
    >
      {isPending ? '...' : 'Done'}
    </button>
  );
}
