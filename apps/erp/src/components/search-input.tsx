'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Input } from '@repo/ui';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  /** URL param name to use (default: "search") */
  paramName?: string;
  placeholder?: string;
  className?: string;
  /** Debounce delay in ms (default: 200) */
  debounceMs?: number;
}

/**
 * Auto-search input that debounces keystrokes and updates URL searchParams.
 * Preserves all existing params (filters, sort, view). Resets page to 1 on new search.
 *
 * IMPORTANT: the debounce effect must only push when the user actually typed
 * something new. If we re-push on every searchParams change (e.g. when the user
 * clicks a pagination button), the delete('page') inside pushSearch would
 * silently reset the pager back to page 1 ~350ms later.
 */
export function SearchInput({
  paramName = 'search',
  placeholder = 'Search...',
  className = 'w-64 h-9 text-sm',
  debounceMs = 200,
}: SearchInputProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get(paramName) ?? '';
  const [value, setValue] = useState(urlValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when URL changes externally (e.g. Clear link, nav)
  useEffect(() => {
    setValue(urlValue);
  }, [urlValue]);

  // Debounce-push only when the user actually typed a new value.
  // Early-returning when `value === urlValue` prevents the effect from
  // overwriting pagination/sort/view URL changes that left `search` alone.
  useEffect(() => {
    if (value === urlValue) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set(paramName, value.trim());
      } else {
        params.delete(paramName);
      }
      // Reset to page 1 on new search
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, urlValue, debounceMs, pathname, paramName, router, searchParams]);

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-400 pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={`pl-8 pr-8 ${className}`}
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-n-200 hover:bg-n-300 flex items-center justify-center"
        >
          <X className="h-3 w-3 text-n-600" />
        </button>
      )}
    </div>
  );
}
