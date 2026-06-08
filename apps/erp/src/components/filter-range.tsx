'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useRef } from 'react';

interface FilterRangeProps {
  /** Label shown above/before the inputs */
  label: string;
  /** URL param name for the minimum value */
  minParam: string;
  /** URL param name for the maximum value */
  maxParam: string;
  /** Input type: 'number' (default) or 'date' */
  type?: 'number' | 'date';
  /** Placeholder for min input */
  minPlaceholder?: string;
  /** Placeholder for max input */
  maxPlaceholder?: string;
  className?: string;
}

/**
 * Dual-input range filter that syncs min/max values as separate URL params.
 * Supports 'number' and 'date' input types. Navigates on blur.
 *
 * Both inputs commit through a single `commit()` that reads BOTH live values
 * from refs — so a rapid second blur can't rebuild the URL from a stale
 * searchParams snapshot and silently drop the first bound (the old per-input
 * handleBlur did exactly that).
 */
export function FilterRange({
  label,
  minParam,
  maxParam,
  type = 'number',
  minPlaceholder = 'Min',
  maxPlaceholder = 'Max',
  className,
}: FilterRangeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const minValue = searchParams.get(minParam) ?? '';
  const maxValue = searchParams.get(maxParam) ?? '';

  const minRef = useRef<HTMLInputElement>(null);
  const maxRef = useRef<HTMLInputElement>(null);

  function commit() {
    const params = new URLSearchParams(searchParams.toString());
    const min = minRef.current?.value ?? '';
    const max = maxRef.current?.value ?? '';
    if (min) params.set(minParam, min); else params.delete(minParam);
    if (max) params.set(maxParam, max); else params.delete(maxParam);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  const isActive = !!minValue || !!maxValue;

  const inputClass =
    'h-9 px-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-shiroi-green focus:border-shiroi-green border-n-200 text-n-900 placeholder:text-n-400';

  const widthClass = type === 'date' ? 'w-[130px]' : 'w-[80px]';

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <span
        className={`text-xs font-medium whitespace-nowrap ${
          isActive ? 'text-shiroi-green' : 'text-n-500'
        }`}
      >
        {label}
      </span>
      <input
        ref={minRef}
        type={type}
        defaultValue={minValue}
        key={`${minParam}-${minValue}`}
        placeholder={minPlaceholder}
        onBlur={commit}
        className={`${inputClass} ${widthClass}`}
      />
      <span className="text-n-400 text-xs">—</span>
      <input
        ref={maxRef}
        type={type}
        defaultValue={maxValue}
        key={`${maxParam}-${maxValue}`}
        placeholder={maxPlaceholder}
        onBlur={commit}
        className={`${inputClass} ${widthClass}`}
      />
    </div>
  );
}
