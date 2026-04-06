'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

interface StageCount {
  status: LeadStatus;
  count: number;
}

/** The marketing-relevant stages in display order */
const STAGE_ORDER: { status: LeadStatus; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'contacted', label: 'Contacted' },
  { status: 'site_survey_scheduled', label: 'Survey Sched.' },
  { status: 'site_survey_done', label: 'Survey Done' },
  { status: 'proposal_sent', label: 'Proposal Sent' },
  { status: 'design_confirmed', label: 'Design Confirmed' },
  { status: 'negotiation', label: 'Negotiation' },
  { status: 'won', label: 'Won' },
  { status: 'lost', label: 'Lost' },
  { status: 'on_hold', label: 'On Hold' },
];

interface LeadStageNavProps {
  stageCounts: StageCount[];
}

export function LeadStageNav({ stageCounts }: LeadStageNavProps) {
  const searchParams = useSearchParams();
  const activeStatus = searchParams.get('status');
  const isArchived = searchParams.get('archived') === 'true';

  const countsMap = new Map(stageCounts.map(sc => [sc.status, sc.count]));

  return (
    <div className="border-b border-n-200">
      <nav className="flex items-center gap-0 -mb-px overflow-x-auto">
        {/* All leads tab */}
        <Link
          href="/leads"
          className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            !activeStatus && !isArchived
              ? 'border-shiroi-green text-shiroi-green'
              : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
          }`}
        >
          All
        </Link>

        {STAGE_ORDER.map(({ status, label }) => {
          const count = countsMap.get(status) ?? 0;
          const isActive = activeStatus === status && !isArchived;
          return (
            <Link
              key={status}
              href={`/leads?status=${status}`}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-shiroi-green text-shiroi-green'
                  : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-shiroi-green/10 text-shiroi-green' : 'bg-n-100 text-n-500'
                }`}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}

        {/* Archived tab */}
        <Link
          href="/leads?archived=true"
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
