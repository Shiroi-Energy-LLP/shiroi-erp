'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { isoToDisplay, buildCalendarMatrix, addMonths, orderRange } from '@/lib/date-range-utils';

interface DateRangeFilterProps {
  /** Label on the trigger, e.g. "Closing" */
  label: string;
  /** URL param for the inclusive lower bound (yyyy-mm-dd) */
  fromParam: string;
  /** URL param for the inclusive upper bound (yyyy-mm-dd) */
  toParam: string;
  className?: string;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function todayIso(): string {
  // IST "today" for the initial calendar view (fixed offset, dep-free).
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0]!;
}

/**
 * Date-range filter with a dd/mm/yyyy display and a single-month calendar
 * popover. Commits BOTH bounds in one navigation (no per-input blur race —
 * unlike FilterRange), so the upper bound can never be silently dropped.
 * Values are 'yyyy-mm-dd' URL params consumed by the leads query.
 */
export function DateRangeFilter({ label, fromParam, toParam, className }: DateRangeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fromValue = searchParams.get(fromParam) ?? '';
  const toValue = searchParams.get(toParam) ?? '';

  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(fromValue);
  const [draftTo, setDraftTo] = useState(toValue);
  const [view, setView] = useState(() => {
    const seed = fromValue || toValue || todayIso();
    const [y, m] = seed.split('-');
    return { year: Number(y), month: Number(m) };
  });

  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  function openPopover() {
    setDraftFrom(fromValue);
    setDraftTo(toValue);
    const seed = fromValue || toValue || todayIso();
    const [y, m] = seed.split('-');
    setView({ year: Number(y), month: Number(m) });
    setOpen(true);
  }

  function pickDay(iso: string) {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(iso);
      setDraftTo('');
      return;
    }
    const [lo, hi] = orderRange(draftFrom, iso);
    setDraftFrom(lo);
    setDraftTo(hi);
  }

  function commit(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFrom) params.set(fromParam, nextFrom); else params.delete(fromParam);
    if (nextTo) params.set(toParam, nextTo); else params.delete(toParam);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function clear(e?: React.MouseEvent) {
    e?.stopPropagation();
    setDraftFrom('');
    setDraftTo('');
    commit('', '');
  }

  const isActive = !!fromValue || !!toValue;
  const rangeText = `${fromValue ? isoToDisplay(fromValue) : '…'} – ${toValue ? isoToDisplay(toValue) : '…'}`;
  const cells = buildCalendarMatrix(view.year, view.month);

  function inDraftRange(iso: string): boolean {
    if (draftFrom && draftTo) return iso >= draftFrom && iso <= draftTo;
    return iso === draftFrom;
  }

  return (
    <div className={`relative ${className ?? ''}`} ref={popoverRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm border rounded-md bg-white hover:bg-n-50 transition-colors ${
          isActive ? 'border-shiroi-green text-shiroi-green font-medium' : 'border-n-200 text-n-700'
        }`}
      >
        <span className="text-xs font-medium">{label}:</span>
        <span>{isActive ? rangeText : 'All'}</span>
        {isActive && (
          <span
            role="button"
            aria-label="Clear date range"
            onClick={clear}
            className="ml-0.5 flex items-center justify-center w-4 h-4 rounded-full hover:bg-shiroi-green/10 text-shiroi-green"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-n-200 rounded-md shadow-lg p-3 w-[268px]">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setView((v) => addMonths(v.year, v.month, -1))}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-n-100 text-n-600"
            >
              ‹
            </button>
            <span className="text-sm font-medium text-n-900">{MONTHS[view.month - 1]} {view.year}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setView((v) => addMonths(v.year, v.month, 1))}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-n-100 text-n-600"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-[10px] font-medium text-n-400 text-center py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c) => {
              const selected = inDraftRange(c.iso);
              const isEdge = c.iso === draftFrom || c.iso === draftTo;
              return (
                <button
                  key={c.iso}
                  type="button"
                  onClick={() => pickDay(c.iso)}
                  className={`h-8 text-xs rounded flex items-center justify-center transition-colors ${
                    c.inMonth ? '' : 'text-n-300'
                  } ${
                    isEdge
                      ? 'bg-shiroi-green text-white font-semibold'
                      : selected
                        ? 'bg-shiroi-green/15 text-shiroi-green'
                        : 'hover:bg-n-100 text-n-700'
                  }`}
                >
                  {c.day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-n-100">
            <button type="button" onClick={() => clear()} className="text-xs text-n-500 hover:text-n-900">
              Clear
            </button>
            <span className="text-[11px] text-n-500">
              {draftFrom ? isoToDisplay(draftFrom) : 'dd/mm/yyyy'} – {draftTo ? isoToDisplay(draftTo) : 'dd/mm/yyyy'}
            </span>
            <button
              type="button"
              onClick={() => commit(draftFrom, draftTo)}
              className="text-xs font-medium px-3 h-7 rounded-md bg-shiroi-green text-white hover:bg-shiroi-green/90"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
