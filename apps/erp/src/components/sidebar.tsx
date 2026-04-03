'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { navSectionsForRole, type AppRole } from '@/lib/roles';
import {
  LayoutDashboard, Users, FileText, HardHat, ShoppingCart,
  TrendingUp, Wrench, UserCog, Package,
  Palette, ClipboardList, FileCheck, Globe, Megaphone,
  DollarSign, Award, GraduationCap, BookOpen, Truck,
  BarChart3, CalendarCheck, Building2, Shield,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Users, FileText, HardHat, ShoppingCart,
  TrendingUp, Wrench, UserCog, Package,
  Palette, ClipboardList, FileCheck, Globe, Megaphone,
  DollarSign, Award, GraduationCap, BookOpen, Truck,
  BarChart3, CalendarCheck, Building2, Shield,
};

export function Sidebar({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // When founder uses "view as" role switcher, sidebar should reflect the viewed role
  const viewAs = searchParams.get('view_as');
  const effectiveRole = (role === 'founder' && viewAs)
    ? (viewAs as AppRole)
    : role;

  const sections = navSectionsForRole(effectiveRole);

  return (
    <aside className="w-60 h-full bg-[#111318] flex flex-col border-r border-[rgba(255,255,255,0.06)]">
      {/* Logo lockup */}
      <div className="h-14 flex items-center gap-2.5 px-5 shrink-0">
        <div className="w-7 h-7 rounded-md bg-[#00B050] flex items-center justify-center">
          <span className="text-white font-brand text-sm font-bold">S</span>
        </div>
        <span className="font-brand text-sm font-bold uppercase tracking-wider text-[rgba(255,255,255,0.95)]">
          Shiroi Energy
        </span>
      </div>

      {/* Navigation — scrollable if items overflow */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {sections.map((section) => (
          <div key={section.label}>
            {/* Section label */}
            <div
              className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[rgba(255,255,255,0.25)] font-sans"
            >
              {section.label}
            </div>

            {/* Section items */}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname.startsWith(item.href);
                const Icon = ICON_MAP[item.icon];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-[rgba(0,176,80,0.12)] border-l-[3px] border-[#00B050] text-white'
                        : 'text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.85)]'
                    }`}
                  >
                    {Icon && (
                      <Icon
                        className={`h-5 w-5 shrink-0 ${
                          isActive ? 'text-white' : 'text-[rgba(255,255,255,0.55)]'
                        }`}
                      />
                    )}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
