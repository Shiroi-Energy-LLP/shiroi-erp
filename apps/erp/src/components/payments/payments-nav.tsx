'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Eyebrow } from '@repo/ui';

const TABS = [
  { label: 'Project Payments', href: '/payments' },
  { label: 'Receipts', href: '/payments/receipts' },
];

export function PaymentsNav() {
  const pathname = usePathname();

  return (
    <div>
      <Eyebrow className="mb-1">FINANCE</Eyebrow>
      <h1 className="text-2xl font-bold text-n-900 mb-4">Payments</h1>
      <div className="border-b border-n-200">
        <nav className="flex items-center gap-0 -mb-px">
          {TABS.map((tab) => {
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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
    </div>
  );
}
