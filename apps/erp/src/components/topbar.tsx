'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { getRoleLabel } from '@/lib/roles';
import type { AppRole } from '@/lib/roles';
import { ArrowLeft } from 'lucide-react';
import { RoleSwitcher } from './role-switcher';
import { ProfileMenu } from './profile-menu';

interface TopbarProps {
  profile: {
    full_name: string;
    role: AppRole;
  };
}

export function Topbar({ profile }: TopbarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const pageTitle = getPageTitle(pathname);
  const isFounder = profile.role === 'founder';
  const viewAs = searchParams.get('view_as') ?? undefined;
  const isViewingAsOtherRole = isFounder && viewAs && viewAs !== 'founder';

  return (
    <>
      <header className="h-14 bg-white border-b border-n-200 shadow-xs flex items-center justify-between px-6">
        <h1 className="text-base font-heading font-bold text-n-900">{pageTitle}</h1>
        <div className="flex items-center gap-3">
          {isFounder && <RoleSwitcher currentViewAs={viewAs} />}
          <ProfileMenu fullName={profile.full_name} role={profile.role} />
        </div>
      </header>
      {isViewingAsOtherRole && (
        <div className="bg-status-warning-bg border-b border-[#FACB01] px-6 py-1.5 flex items-center gap-2 text-sm">
          <span className="font-medium text-status-warning-text">
            Viewing as: {getRoleLabel(viewAs as AppRole)}
          </span>
          <button
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-1 text-xs font-medium text-status-warning-text hover:text-[#78350F] underline underline-offset-2"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Founder View
          </button>
        </div>
      )}
    </>
  );
}

function getPageTitle(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const page = segments[0] ?? 'dashboard';
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    leads: 'Leads',
    proposals: 'Proposals',
    projects: 'Projects',
    procurement: 'Procurement',
    cash: 'Cash Flow',
    om: 'O&M',
    hr: 'HR',
    inventory: 'Inventory',
    settings: 'Settings',
  };
  return titles[page] ?? page.charAt(0).toUpperCase() + page.slice(1);
}
