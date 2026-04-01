'use client';

import * as React from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, HardHat, FileText,
  Users, Wrench, Sun, ClipboardList, Package, Truck, Shield,
  Palette, Clock, CheckCircle, LayoutList, Award, BarChart3,
  UserCog, CalendarCheck, ShoppingCart,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  TrendingUp, DollarSign, HardHat, FileText, Users, Wrench, Sun,
  ClipboardList, Package, Truck, Shield, Palette, Clock, CheckCircle,
  LayoutList, Award, BarChart3, UserCog, CalendarCheck, ShoppingCart,
};

export interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: { direction: 'up' | 'down'; label: string };
  subNote?: string;
  icon?: string;
}

export function KpiCard({ label, value, unit, trend, subNote, icon }: KpiCardProps) {
  const Icon = icon ? ICON_MAP[icon] : undefined;

  return (
    <div className="rounded-lg border border-[#DFE2E8] bg-white px-5 py-[18px] shadow-xs hover:shadow-sm hover:border-[#BFC3CC] transition-all duration-150">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E]">
            {label}
          </span>

          <div className="flex items-baseline gap-1.5">
            <span className="font-heading text-[28px] font-bold leading-none text-[#111318]">
              {value}
            </span>
            {unit && (
              <span className="text-[13px] text-[#7C818E]">{unit}</span>
            )}
          </div>

          {trend && (
            <div className="flex items-center gap-1">
              {trend.direction === 'up' ? (
                <TrendingUp className="h-3 w-3 text-[#065F46]" />
              ) : (
                <TrendingDown className="h-3 w-3 text-[#991B1B]" />
              )}
              <span
                className={`text-[11px] font-semibold ${
                  trend.direction === 'up' ? 'text-[#065F46]' : 'text-[#991B1B]'
                }`}
              >
                {trend.label}
              </span>
            </div>
          )}

          {subNote && (
            <span className="text-[11px] text-[#9CA0AB]">{subNote}</span>
          )}
        </div>

        {Icon && (
          <Icon className="h-5 w-5 text-[#7C818E] flex-shrink-0" />
        )}
      </div>
    </div>
  );
}
