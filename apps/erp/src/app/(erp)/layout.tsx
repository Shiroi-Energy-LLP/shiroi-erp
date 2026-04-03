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
      <Suspense fallback={<SidebarFallback />}>
        <Sidebar role={profile.role} />
      </Suspense>
      <div className="flex flex-col flex-1 overflow-hidden">
        <Suspense fallback={<TopbarFallback />}>
          <Topbar profile={profile} />
        </Suspense>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

function SidebarFallback() {
  return (
    <aside className="w-60 h-full bg-[#111318] flex flex-col border-r border-[rgba(255,255,255,0.06)]">
      <div className="h-14 flex items-center gap-2.5 px-5 shrink-0">
        <div className="w-7 h-7 rounded-md bg-[#00B050] flex items-center justify-center">
          <span className="text-white font-brand text-sm font-bold">S</span>
        </div>
        <span className="font-brand text-sm font-bold uppercase tracking-wider text-[rgba(255,255,255,0.95)]">
          Shiroi Energy
        </span>
      </div>
    </aside>
  );
}

function TopbarFallback() {
  return (
    <header className="h-14 bg-white border-b border-[#DFE2E8] shadow-xs flex items-center px-6">
      <div className="h-4 w-24 bg-[#F2F4F7] rounded animate-pulse" />
    </header>
  );
}
