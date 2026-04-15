'use client';

import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

interface StageCount {
  status: LeadStatus;
  count: number;
}

/**
 * The full marketing pipeline in display order.
 *
 * Post-revamp (migrations 051-053): the pipeline bifurcates after Contacted.
 * Path A (Quick) leads fly through `quick_quote_sent` → `negotiation`.
 * Path B (Detailed) leads go through the full survey → design → detailed
 * proposal chain.
 *
 * The stage bar renders both paths inline — the sales team sees the whole
 * pipeline at a glance and can filter down to any individual stage.
 */
const STAGE_ORDER: { status: LeadStatus; label: string; section?: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'contacted', label: 'Contacted' },
  // ---- Path A (Quick) ----
  { status: 'quick_quote_sent', label: 'Quick Quote', section: 'A' },
  // ---- Path B (Detailed) ----
  { status: 'site_survey_scheduled', label: 'Survey Sched.', section: 'B' },
  { status: 'site_survey_done', label: 'Survey Done', section: 'B' },
  { status: 'design_in_progress', label: 'In Design', section: 'B' },
  { status: 'design_confirmed', label: 'Design Done', section: 'B' },
  { status: 'detailed_proposal_sent', label: 'Detailed Sent', section: 'B' },
  // ---- Shared tail ----
  { status: 'negotiation', label: 'Negotiation' },
  { status: 'closure_soon', label: 'Closure Soon' },
  { status: 'won', label: 'Won' },
  { status: 'lost', label: 'Lost' },
  { status: 'on_hold', label: 'On Hold' },
];

interface LeadStageNavProps {
  stageCounts: StageCount[];
  /**
   * Optional base path - defaults to the current pathname. Lets this component
   * work both under /leads and /sales without duplication.
   */
  basePath?: string;
}

export function LeadStageNav({ stageCounts, basePath }: LeadStageNavProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const activeStatus = searchParams.get('status');
  const isArchived = searchParams.get('archived') === 'true';

  // Determine base path - use override or derive from current pathname
  const base = basePath ?? (pathname.startsWith('/sales') ? '/sales' : '/leads');

  const countsMap = new Map(stageCounts.map((sc) => [sc.status, sc.count]));

  return (
    <div className="border-b border-n-200">
      <nav className="flex items-center gap-0 -mb-px overflow-x-auto">
        {/* All leads tab */}
        <Link
          href={base}
          className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            !activeStatus && !isArchived
              ? 'border-shiroi-green text-shiroi-green'
              : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
          }`}
        >
          All
        </Link>

        {STAGE_ORDER.map(({ status, label, section }) => {
          const count = countsMap.get(status) ?? 0;
          const isActive = activeStatus === status && !isArchived;
          // Subtle path-section visual cue so the user can tell Quick vs Detailed apart
          const sectionBorder =
            section === 'A'
              ? 'border-t-2 border-t-blue-200/60'
              : section === 'B'
                ? 'border-t-2 border-t-purple-200/60'
                : '';
          return (
            <Link
              key={status}
              href={`${base}?status=${status}`}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${sectionBorder} ${
                isActive
                  ? 'border-b-shiroi-green text-shiroi-green'
                  : 'border-b-transparent text-n-500 hover:text-n-900 hover:border-b-n-300'
              }`}
              title={section === 'A' ? 'Path A (Quick)' : section === 'B' ? 'Path B (Detailed)' : undefined}
            >
              {label}
              {count > 0 && (
                <span
                  className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-shiroi-green/10 text-shiroi-green' : 'bg-n-100 text-n-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}

        {/* Archived tab */}
        <Link
          href={`${base}?archived=true`}
          className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            isArchived
              ? 'border-shiroi-green text-shiroi-green'
              : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
          }`}
        >
          Archived
        </Link>
      </nav>
    </div>
  );
}
