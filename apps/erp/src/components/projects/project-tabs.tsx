'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  label: string;
  href: string;
}

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  const tabs: Tab[] = [
    { label: 'Overview', href: base },
    { label: 'Milestones', href: `${base}/milestones` },
    { label: 'QC Gates', href: `${base}/qc` },
    { label: 'Delays', href: `${base}/delays` },
    { label: 'Change Orders', href: `${base}/change-orders` },
    { label: 'Reports', href: `${base}/reports` },
    { label: 'Stepper', href: `${base}/stepper` },
  ];

  return (
    <div className="border-b border-[#E5E7EB]">
      <nav className="flex gap-0 -mb-px">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-[#00B050] text-[#00B050]'
                  : 'border-transparent text-muted-foreground hover:text-[#1A1D24] hover:border-[#BFC3CC]'
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
