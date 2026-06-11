'use client';

import * as React from 'react';

/**
 * Tasks | Activities toggle inside the Execution tab. Both views arrive
 * server-rendered; toggling is pure CSS visibility (no refetch, no routing).
 */
export function ExecutionSubTabs({
  tasksView,
  activitiesView,
}: {
  tasksView: React.ReactNode;
  activitiesView: React.ReactNode;
}) {
  const [active, setActive] = React.useState<'tasks' | 'activities'>('tasks');

  const tabClass = (tab: 'tasks' | 'activities') =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      active === tab ? 'bg-white text-n-900 shadow-sm' : 'text-n-500 hover:text-n-700'
    }`;

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-1 bg-n-100 rounded-lg p-1">
        <button type="button" className={tabClass('tasks')} onClick={() => setActive('tasks')}>
          Tasks &amp; Milestones
        </button>
        <button type="button" className={tabClass('activities')} onClick={() => setActive('activities')}>
          Activities
        </button>
      </div>
      <div className={active === 'tasks' ? '' : 'hidden'}>{tasksView}</div>
      <div className={active === 'activities' ? '' : 'hidden'}>{activitiesView}</div>
    </div>
  );
}
