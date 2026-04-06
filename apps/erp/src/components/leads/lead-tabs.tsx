'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  label: string;
  href: string;
}

export function LeadTabs({ leadId, showPayments }: { leadId: string; showPayments: boolean }) {
  const pathname = usePathname();
  const base = `/leads/${leadId}`;

  const tabs: Tab[] = [
    { label: 'Details', href: base },
    { label: 'Activities', href: `${base}/activities` },
    { label: 'Tasks', href: `${base}/tasks` },
    { label: 'Proposal', href: `${base}/proposal` },
    { label: 'Files', href: `${base}/files` },
  ];

  if (showPayments) {
    tabs.push({ label: 'Payments', href: `${base}/payments` });
  }

  return (
    <div className="border-b border-n-200">
      <nav className="flex items-center gap-0 -mb-px overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
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
      </nav>
    </div>
  );
}
