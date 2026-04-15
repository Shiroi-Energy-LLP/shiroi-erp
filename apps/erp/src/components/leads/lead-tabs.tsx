'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  label: string;
  href: string;
}

/**
 * Lead detail tab bar - adaptive to /leads or /sales URL space.
 *
 * Post-revamp the preferred URL is `/sales/[id]` (new sidebar label "Sales").
 * The old `/leads/[id]` URL still works so existing bookmarks don't break.
 * Whichever URL space the user arrives in, this component keeps them there
 * by deriving the base from the current pathname.
 *
 * The "Proposal" tab is renamed to "Quote" to match the revamp language but
 * still maps to the existing proposal route for now (will be rewired to the
 * new Quote tab in a follow-up step).
 */
export function LeadTabs({ leadId, showPayments }: { leadId: string; showPayments: boolean }) {
  const pathname = usePathname();
  const urlSpace = pathname.startsWith('/sales/') ? '/sales' : '/leads';
  const base = `${urlSpace}/${leadId}`;

  const tabs: Tab[] = [
    { label: 'Details', href: base },
    { label: 'Activities', href: `${base}/activities` },
    { label: 'Tasks', href: `${base}/tasks` },
    { label: 'Quote', href: `${base}/proposal` },
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
