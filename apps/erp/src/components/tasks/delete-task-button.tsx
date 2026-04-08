'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { deleteTask } from '@/lib/tasks-actions';

export function DeleteTaskButton({ taskId, title }: { taskId: string; title: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm(`Delete task "${title}"?`)) return;
    setDeleting(true);
    const result = await deleteTask(taskId);
    setDeleting(false);
    if (result.success) {
      router.refresh();
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 w-7 p-0 text-n-300 hover:text-red-500"
      onClick={handleDelete}
      disabled={deleting}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
