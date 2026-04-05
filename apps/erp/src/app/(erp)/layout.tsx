import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireAuth, getUserProfile } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { SkipToContent, LogoMark } from '@repo/ui';

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
    <div className="flex h-screen bg-n-050">
      <SkipToContent />
      <Suspense fallback={<SidebarFallback />}>
        <Sidebar role={profile.role} />
      </Suspense>
      <div className="flex flex-col flex-1 overflow-hidden">
        <Suspense fallback={<TopbarFallback />}>
          <Topbar profile={profile} />
        </Suspense>
        <main id="main-content" className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarFallback() {
  return (
    <aside className="hidden lg:flex w-60 h-full bg-n-950 flex-col border-r border-[rgba(255,255,255,0.06)]">
      <div className="h-14 flex items-center gap-2.5 px-5 shrink-0">
        <LogoMark size={28} />
        <span className="font-brand text-sm font-bold uppercase tracking-wider text-[rgba(255,255,255,0.95)]">
          Shiroi Energy
        </span>
      </div>
    </aside>
  );
}

function TopbarFallback() {
  return (
    <header className="h-14 bg-white border-b border-n-200 shadow-xs flex items-center px-6">
      <div className="h-4 w-24 bg-n-100 rounded animate-pulse" />
    </header>
  );
}
