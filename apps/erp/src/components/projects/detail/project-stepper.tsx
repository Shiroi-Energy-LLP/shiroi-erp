'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';

interface Stage {
  label: string;
  queryTab: string;
}

const STAGES: Stage[] = [
  { label: 'Details',        queryTab: 'details' },
  { label: 'Survey',         queryTab: 'survey' },
  { label: 'BOI',            queryTab: 'bom' },
  { label: 'BOQ',            queryTab: 'boq' },
  { label: 'Delivery',       queryTab: 'delivery' },
  { label: 'Execution',      queryTab: 'execution' },
  { label: 'Actuals',        queryTab: 'actuals' },
  { label: 'QC',             queryTab: 'qc' },
  { label: 'Liaison',        queryTab: 'liaison' },
  { label: 'Commissioning',  queryTab: 'commissioning' },
  { label: 'Free AMC',       queryTab: 'amc' },
  { label: 'Documents',      queryTab: 'documents' },
];

interface ProjectStepperProps {
  projectId: string;
  /** Status-derived completion: each stage key → completed */
  completedStages: Record<string, boolean>;
}

/**
 * Horizontal stage indicator for the project detail page.
 * Replaces the old <ProjectTabs/> + AdvanceStatusButton combo.
 *
 * Visual:
 *   [✓ Details] ─ [✓ Survey] ─ [● BOI (active)] ─ [ BOQ ] ─ ...
 *
 * - Filled green circle with checkmark = completed
 * - Green ring = currently active tab
 * - Gray = not yet reached
 */
export function ProjectStepper({ projectId, completedStages }: ProjectStepperProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/projects/${projectId}`;
  const currentTab = searchParams.get('tab');
  const isBase = pathname === base;
  const activeTab = currentTab ?? (isBase ? 'details' : null);

  return (
    <div className="border-b border-n-200 bg-white">
      <div className="overflow-x-auto">
        <ol className="flex items-center gap-1 px-1 py-3 min-w-max">
          {STAGES.map((stage, idx) => {
            const isActive = activeTab === stage.queryTab;
            const isDone = !!completedStages[stage.queryTab];
            const stateCls = isActive
              ? 'border-shiroi-green bg-shiroi-green/10 text-shiroi-green'
              : isDone
                ? 'border-shiroi-green/40 bg-white text-shiroi-green hover:bg-shiroi-green/5'
                : 'border-n-200 bg-white text-n-500 hover:bg-n-50';

            const dotCls = isActive
              ? 'bg-shiroi-green text-white'
              : isDone
                ? 'bg-shiroi-green text-white'
                : 'bg-n-200 text-n-600';

            return (
              <li key={stage.queryTab} className="flex items-center">
                <Link
                  href={`${base}?tab=${stage.queryTab}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors ${stateCls}`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${dotCls}`}
                  >
                    {isDone && !isActive ? <Check className="h-3 w-3" /> : idx + 1}
                  </span>
                  {stage.label}
                </Link>
                {idx < STAGES.length - 1 && (
                  <div
                    className={`w-2 h-px ${isDone ? 'bg-shiroi-green/40' : 'bg-n-200'}`}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// Note: deriveCompletedStages lives in @/lib/project-stages because it's
// called from the projects/[id] server layout. Exporting a pure function
// from a 'use client' file turns it into a client reference and crashes
// server components with "m is not a function" in production builds.
