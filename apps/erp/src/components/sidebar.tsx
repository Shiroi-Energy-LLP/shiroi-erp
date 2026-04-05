'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { navSectionsForRole, type AppRole } from '@/lib/roles';
import { Logo, LogoMark, Sheet, SheetContent, SheetTrigger, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@repo/ui';
import {
  LayoutDashboard, Users, FileText, HardHat, ShoppingCart,
  TrendingUp, Wrench, UserCog, Package,
  Palette, ClipboardList, FileCheck, Globe, Megaphone,
  DollarSign, Award, GraduationCap, BookOpen, Truck,
  BarChart3, CalendarCheck, Building2, Shield,
  PanelLeftClose, PanelLeftOpen, Menu,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Users, FileText, HardHat, ShoppingCart,
  TrendingUp, Wrench, UserCog, Package,
  Palette, ClipboardList, FileCheck, Globe, Megaphone,
  DollarSign, Award, GraduationCap, BookOpen, Truck,
  BarChart3, CalendarCheck, Building2, Shield,
};

const STORAGE_KEY = 'shiroi-sidebar-collapsed';

function SidebarNav({ role, collapsed }: { role: AppRole; collapsed: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get('view_as');
  const effectiveRole = (role === 'founder' && viewAs) ? (viewAs as AppRole) : role;
  const sections = navSectionsForRole(effectiveRole);

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
      {sections.map((section) => (
        <div key={section.label}>
          {!collapsed && (
            <div className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[rgba(255,255,255,0.25)] font-sans">
              {section.label}
            </div>
          )}
          {collapsed && <div className="my-1 mx-3 h-px bg-[rgba(255,255,255,0.08)]" />}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const Icon = ICON_MAP[item.icon];
              const linkContent = (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center ${collapsed ? 'justify-center' : ''} gap-3 ${collapsed ? 'px-0 py-2' : 'px-3 py-2'} rounded-md text-[13px] font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-[rgba(0,176,80,0.12)] border-l-[3px] border-shiroi-green text-white'
                      : 'text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.85)]'
                  }`}
                >
                  {Icon && (
                    <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-white' : 'text-[rgba(255,255,255,0.55)]'}`} />
                  )}
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.href} delayDuration={0}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right" className="font-medium">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return <div key={item.href}>{linkContent}</div>;
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ role }: { role: AppRole }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') setCollapsed(true);
  }, []);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  return (
    <TooltipProvider>
      {/* Mobile hamburger trigger — rendered outside sidebar, positioned by layout */}
      <div className="lg:hidden fixed top-3 left-3 z-[101]">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button
              className="w-10 h-10 flex items-center justify-center rounded-md bg-n-950 text-white shadow-md"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[260px] bg-n-950 border-r-0 p-0">
            <div className="h-14 flex items-center gap-2.5 px-5 shrink-0">
              <Logo size="md" className="text-[rgba(255,255,255,0.95)]" />
            </div>
            <SidebarNav role={role} collapsed={false} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex ${collapsed ? 'w-[60px]' : 'w-60'} h-full bg-n-950 flex-col border-r border-[rgba(255,255,255,0.06)] transition-[width] duration-200 ease-in-out`}
      >
        {/* Logo lockup */}
        <div className={`h-14 flex items-center ${collapsed ? 'justify-center px-2' : 'gap-2.5 px-5'} shrink-0`}>
          {collapsed ? (
            <LogoMark size={28} />
          ) : (
            <Logo size="md" className="text-[rgba(255,255,255,0.95)]" />
          )}
        </div>

        <SidebarNav role={role} collapsed={collapsed} />

        {/* Collapse toggle */}
        <div className="px-3 py-3 border-t border-[rgba(255,255,255,0.06)]">
          <button
            onClick={toggleCollapse}
            className={`flex items-center ${collapsed ? 'justify-center w-full' : 'gap-3 px-3 w-full'} py-2 rounded-md text-[13px] font-medium text-[rgba(255,255,255,0.45)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.75)] transition-all duration-150`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-5 w-5 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
