'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { toggleTaskCompletion } from '@/lib/project-step-actions';

interface TaskCompletionToggleProps {
  taskId: string;
  isCompleted: boolean;
  projectId?: string;
}

export function TaskCompletionToggle({ taskId, isCompleted, projectId }: TaskCompletionToggleProps) {
  const router = useRouter();
  const [toggling, setToggling] = React.useState(false);
  const [currentState, setCurrentState] = React.useState(isCompleted);

  async function handleToggle() {
    setToggling(true);
    const newState = !currentState;
    setCurrentState(newState); // optimistic update

    const result = await toggleTaskCompletion({
      taskId,
      isCompleted: newState,
      projectId,
    });

    setToggling(false);
    if (result.success) {
      router.refresh();
    } else {
      setCurrentState(!newState); // revert on error
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={toggling}
      className="flex items-center justify-center cursor-pointer disabled:opacity-50"
      title={currentState ? 'Mark as pending' : 'Mark as completed'}
      type="button"
    >
      {currentState ? (
        <CheckCircle2 className="h-4 w-4 text-green-500" />
      ) : (
        <div className="w-4 h-4 rounded-full border-2 border-n-300 hover:border-green-400 transition-colors" />
      )}
    </button>
  );
}
