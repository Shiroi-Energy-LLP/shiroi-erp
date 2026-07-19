import * as React from 'react';
import {
  TrendingUp, TrendingDown, Minus, DollarSign, HardHat, FileText,
  Users, Wrench, Sun, ClipboardList, Package, Truck, Shield,
  Palette, Clock, CheckCircle, LayoutList, Award, BarChart3,
  UserCog, CalendarCheck, ShoppingCart,
} from 'lucide-react';
import { cn } from '../lib/utils';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  TrendingUp, DollarSign, HardHat, FileText, Users, Wrench, Sun,
  ClipboardList, Package, Truck, Shield, Palette, Clock, CheckCircle,
  LayoutList, Award, BarChart3, UserCog, CalendarCheck, ShoppingCart,
};

export interface KpiCardTrend {
  direction: 'up' | 'down' | 'flat';
  label: string;
  /**
   * Whether an 'up' movement is good (rendered green). Defaults to true.
   * Set false for cost/overdue-style metrics where a 'down' movement is good.
   */
  positiveIsGood?: boolean;
}

export interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: KpiCardTrend;
  subNote?: string;
  /** String key into the internal icon map (kept a string so RSC callers stay serializable). */
  icon?: string;
  className?: string;
}

export function KpiCard({ label, value, unit, trend, subNote, icon, className }: KpiCardProps) {
  const Icon = icon ? ICON_MAP[icon] : undefined;

  let trendTone = 'text-n-400';
  let TrendIcon: React.ComponentType<{ className?: string }> = Minus;
  if (trend) {
    if (trend.direction === 'flat') {
      trendTone = 'text-n-400';
      TrendIcon = Minus;
    } else {
      const positiveIsGood = trend.positiveIsGood ?? true;
      const isGood = trend.direction === 'up' ? positiveIsGood : !positiveIsGood;
      trendTone = isGood ? 'text-status-success-text' : 'text-status-error-text';
      TrendIcon = trend.direction === 'up' ? TrendingUp : TrendingDown;
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-n-200 bg-white px-5 py-[18px] shadow-xs hover:shadow-sm hover:border-n-300 transition-all duration-150',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-n-500">
            {label}
          </span>

          <div className="flex items-baseline gap-1.5">
            <span className="font-heading text-[28px] font-bold leading-none text-n-950">
              {value}
            </span>
            {unit && <span className="text-[13px] text-n-500">{unit}</span>}
          </div>

          {trend && (
            <div className="flex items-center gap-1">
              <TrendIcon className={cn('h-3 w-3', trendTone)} />
              <span className={cn('text-[11px] font-semibold', trendTone)}>{trend.label}</span>
            </div>
          )}

          {subNote && <span className="text-[11px] text-n-400">{subNote}</span>}
        </div>

        {Icon && <Icon className="h-5 w-5 text-n-500 flex-shrink-0" />}
      </div>
    </div>
  );
}
