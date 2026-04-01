import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireAuth, getUserProfile } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

export default async function ERPLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();
  const profile = await getUserProfile();

  if (!profile) {
    redirect('/login');
  }

  return (
    <div className="flex h-screen bg-[#F8F9FB]">
      <Sidebar role={profile.role} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Suspense fallback={<TopbarFallback />}>
          <Topbar profile={profile} />
        </Suspense>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

function TopbarFallback() {
  return (
    <header className="h-14 bg-white border-b border-[#DFE2E8] shadow-xs flex items-center px-6">
      <div className="h-4 w-24 bg-[#F2F4F7] rounded animate-pulse" />
    </header>
  );
}
