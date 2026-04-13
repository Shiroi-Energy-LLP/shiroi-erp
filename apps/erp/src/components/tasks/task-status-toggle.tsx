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
 * Open = Red badge, Closed = Green badge.
 * Auto-fills Done By (logged-in user) + Completed Date on close, clears on re-open.
 */
export function TaskStatusToggle({ taskId, isCompleted }: TaskStatusToggleProps) {
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

  return (
    <button onClick={handleClick} disabled={saving} className="cursor-pointer" title="Click to toggle status">
      <Badge
        variant={isCompleted ? 'success' : 'error'}
        className="text-[10px] px-1.5 py-0 hover:opacity-80 transition-opacity"
      >
        {saving ? '...' : isCompleted ? 'Closed' : 'Open'}
      </Badge>
    </button>
  );
}
