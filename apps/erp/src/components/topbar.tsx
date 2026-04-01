'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import { Badge } from '@repo/ui';
import { getRoleLabel } from '@/lib/roles';
import type { AppRole } from '@/lib/roles';
import { LogOut, ArrowLeft } from 'lucide-react';
import { RoleSwitcher } from './role-switcher';

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
  const supabase = createClient();

  const pageTitle = getPageTitle(pathname);
  const isFounder = profile.role === 'founder';
  const viewAs = searchParams.get('view_as') ?? undefined;
  const isViewingAsOtherRole = isFounder && viewAs && viewAs !== 'founder';

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <>
      <header className="h-14 bg-white border-b border-[#DFE2E8] shadow-xs flex items-center justify-between px-6">
        <h1 className="text-base font-heading font-bold text-[#1A1D24]">{pageTitle}</h1>
        <div className="flex items-center gap-3">
          {isFounder && <RoleSwitcher currentViewAs={viewAs} />}
          <span className="text-sm text-[#5A5E6B]">{profile.full_name}</span>
          <Badge variant="success">{getRoleLabel(profile.role)}</Badge>
          <button
            onClick={handleSignOut}
            className="w-9 h-9 flex items-center justify-center rounded-md text-[#5A5E6B] hover:bg-[#F2F4F7] transition-colors"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      {isViewingAsOtherRole && (
        <div className="bg-[#FFFBEB] border-b border-[#FACB01] px-6 py-1.5 flex items-center gap-2 text-sm">
          <span className="font-medium text-[#92400E]">
            Viewing as: {getRoleLabel(viewAs as AppRole)}
          </span>
          <button
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#92400E] hover:text-[#78350F] underline underline-offset-2"
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
  };
  return titles[page] ?? page.charAt(0).toUpperCase() + page.slice(1);
}
