'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, RotateCcw, RefreshCw } from 'lucide-react';
import { Badge } from '@repo/ui';
import {
  markComponentComplete,
  markComponentIncomplete,
  initProjectCompletionItems,
} from '@/lib/project-completion-actions';
import {
  COMPONENT_LABELS,
  COMPONENT_WEIGHTS,
  COMPONENT_ORDER,
  type CompletionItemWithProfile,
} from '@/lib/project-completion-queries';
import type { Database } from '@repo/types/database';

type CompletionComponent = Database['public']['Tables']['project_completion_items']['Row']['component'];

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function CompletionBar({ pct }: { pct: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-n-500">Physical Completion</span>
        <span className="text-2xl font-bold text-n-900">{pct}%</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-n-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-shiroi-green transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

interface RowProps {
  item: CompletionItemWithProfile | undefined;
  component: CompletionComponent;
  projectId: string;
  canEdit: boolean;
  canRollback: boolean;
  onChanged: () => void;
}

function ComponentRow({ item, component, projectId, canEdit, canRollback, onChanged }: RowProps) {
  const [busy, setBusy] = React.useState(false);
  const isComplete = item?.completed ?? false;
  const weight = COMPONENT_WEIGHTS[component];

  async function toggle() {
    if (busy) return;
    setBusy(true);
    if (isComplete) {
      if (!canRollback) { setBusy(false); return; }
      await markComponentIncomplete(projectId, component);
    } else {
      await markComponentComplete(projectId, component);
    }
    setBusy(false);
    onChanged();
  }

  const completedDate = item?.completed_at
    ? new Date(item.completed_at).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short',
      })
    : null;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-n-100 last:border-0">
      <button
        onClick={toggle}
        disabled={busy || (!canEdit && !isComplete) || (isComplete && !canRollback)}
        className="flex-shrink-0 disabled:opacity-40 transition-opacity"
        title={isComplete ? (canRollback ? 'Mark incomplete' : 'Completed') : 'Mark complete'}
      >
        {busy ? (
          <RefreshCw className="h-5 w-5 text-n-400 animate-spin" />
        ) : isComplete ? (
          <CheckCircle2 className="h-5 w-5 text-shiroi-green" />
        ) : (
          <Circle className="h-5 w-5 text-n-300" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <span className={`text-sm ${isComplete ? 'text-n-500 line-through' : 'text-n-800'} font-medium`}>
          {COMPONENT_LABELS[component]}
        </span>
        {isComplete && item?.profiles?.full_name && completedDate && (
          <p className="text-xs text-n-400 mt-0.5">
            {item.profiles.full_name} · {completedDate}
          </p>
        )}
      </div>

      {weight > 0 ? (
        <Badge variant="outline" className="text-[10px] flex-shrink-0">
          {weight}%
        </Badge>
      ) : (
        <Badge variant="secondary" className="text-[10px] flex-shrink-0">
          Milestone
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CompletionChecklistProps {
  projectId: string;
  items: CompletionItemWithProfile[];
  completionPct: number;
  viewerRole: string | null;
}

export function CompletionChecklist({
  projectId,
  items,
  completionPct,
  viewerRole,
}: CompletionChecklistProps) {
  const router = useRouter();
  const [initialising, setInitialising] = React.useState(false);

  const canEdit = !!viewerRole && ['founder', 'project_manager', 'site_supervisor'].includes(viewerRole);
  const canRollback = !!viewerRole && ['founder', 'project_manager'].includes(viewerRole);
  const isInitialised = items.length > 0;

  // Build a map for O(1) lookup
  const itemMap = Object.fromEntries(items.map((i) => [i.component, i]));

  async function handleInit() {
    setInitialising(true);
    await initProjectCompletionItems(projectId);
    setInitialising(false);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-n-200 bg-white p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-n-900">Installation Progress</h3>
          <p className="text-xs text-n-500 mt-0.5">Objective completion from physical sub-components</p>
        </div>
        {!isInitialised && canEdit && (
          <button
            onClick={handleInit}
            disabled={initialising}
            className="flex items-center gap-1.5 text-xs text-shiroi-green hover:underline disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {initialising ? 'Initialising…' : 'Initialise checklist'}
          </button>
        )}
      </div>

      <CompletionBar pct={completionPct} />

      {!isInitialised ? (
        <div className="text-center py-4 text-sm text-n-400">
          {canEdit
            ? 'Click "Initialise checklist" to start tracking physical progress.'
            : 'No completion items tracked yet.'}
        </div>
      ) : (
        <div>
          {COMPONENT_ORDER.map((component) => (
            <ComponentRow
              key={component}
              item={itemMap[component]}
              component={component}
              projectId={projectId}
              canEdit={canEdit}
              canRollback={canRollback}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
