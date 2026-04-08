'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@repo/ui';
import { ChevronDown, FileDown } from 'lucide-react';
import { ProjectPdfButton } from '@/components/projects/forms/project-pdf-button';

interface Tab {
  label: string;
  href: string;
  /** If true, match via searchParams ?tab= instead of pathname */
  queryTab?: string;
}

const WORKFLOW_TABS: { label: string; queryTab: string }[] = [
  { label: 'Details', queryTab: 'details' },
  { label: 'Survey', queryTab: 'survey' },
  { label: 'BOI', queryTab: 'bom' },
  { label: 'BOQ', queryTab: 'boq' },
  { label: 'Delivery', queryTab: 'delivery' },
  { label: 'Execution', queryTab: 'execution' },
  { label: 'QC', queryTab: 'qc' },
  { label: 'Liaison', queryTab: 'liaison' },
  { label: 'Commissioning', queryTab: 'commissioning' },
  { label: 'Free AMC', queryTab: 'amc' },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/projects/${projectId}`;
  const currentTab = searchParams.get('tab');

  // Determine if we're on a sub-route (milestones, delays, etc.)
  const isSubRoute = pathname !== base;

  // If no ?tab= param and on the base route, default to 'details'
  const activeTab = currentTab ?? (pathname === base && !isSubRoute ? 'details' : null);

  const morePages: Tab[] = [
    { label: 'Milestones', href: `${base}/milestones` },
    { label: 'Delays', href: `${base}/delays` },
    { label: 'Change Orders', href: `${base}/change-orders` },
    { label: 'Reports', href: `${base}/reports` },
  ];

  const isMoreActive = morePages.some((p) => pathname.startsWith(p.href));

  return (
    <div className="border-b border-n-200">
      <nav className="flex items-center gap-0 -mb-px overflow-x-auto">
        {/* 10 Workflow tabs */}
        {WORKFLOW_TABS.map((tab) => {
          const isActive = activeTab === tab.queryTab;
          return (
            <Link
              key={tab.queryTab}
              href={`${base}?tab=${tab.queryTab}`}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-shiroi-green text-shiroi-green'
                  : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}

        {/* More dropdown for auxiliary pages */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`flex items-center gap-1 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isMoreActive
                  ? 'border-shiroi-green text-shiroi-green'
                  : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
              }`}
            >
              More <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {morePages.map((page) => (
              <DropdownMenuItem key={page.href} asChild>
                <Link
                  href={page.href}
                  className={pathname.startsWith(page.href) ? 'font-semibold text-shiroi-green' : ''}
                >
                  {page.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* PDF Export */}
        <div className="ml-auto pl-3">
          <ProjectPdfButton projectId={projectId} label="PDF" />
        </div>
      </nav>
    </div>
  );
}
