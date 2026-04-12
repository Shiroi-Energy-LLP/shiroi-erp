'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@repo/ui';
import { toggleTaskStatus } from '@/lib/tasks-actions';

interface TaskStatusToggleProps {
  taskId: string;
  isCompleted: boolean;
  isOverdue: boolean;
}

/**
 * Inline clickable badge to toggle task Open/Closed status.
 */
export function TaskStatusToggle({ taskId, isCompleted, isOverdue }: TaskStatusToggleProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleClick() {
    setSaving(true);
    const result = await toggleTaskStatus(taskId, !isCompleted);
    setSaving(false);
    if (result.success) {
      router.refresh();
    }
  }

  const variant = isCompleted ? 'success' : isOverdue ? 'error' : 'outline';
  const label = saving ? '...' : isCompleted ? 'Closed' : isOverdue ? 'Overdue' : 'Open';

  return (
    <button onClick={handleClick} disabled={saving} className="cursor-pointer" title="Click to toggle status">
      <Badge
        variant={variant}
        className="text-[10px] px-1.5 py-0 hover:opacity-80 transition-opacity"
      >
        {label}
      </Badge>
    </button>
  );
}
