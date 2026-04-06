'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Input } from '@repo/ui';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  /** URL param name to use (default: "search") */
  paramName?: string;
  placeholder?: string;
  className?: string;
  /** Debounce delay in ms (default: 350) */
  debounceMs?: number;
}

/**
 * Auto-search input that debounces keystrokes and updates URL searchParams.
 * Preserves all existing params (filters, sort, view). Resets page to 1 on new search.
 */
export function SearchInput({
  paramName = 'search',
  placeholder = 'Search...',
  className = 'w-64 h-9 text-sm',
  debounceMs = 350,
}: SearchInputProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramName) ?? '');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRender = useRef(true);

  // Sync if URL changes externally (e.g. "Clear" link)
  useEffect(() => {
    const urlValue = searchParams.get(paramName) ?? '';
    setValue(urlValue);
  }, [searchParams, paramName]);

  const pushSearch = useCallback(
    (term: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (term.trim()) {
        params.set(paramName, term.trim());
      } else {
        params.delete(paramName);
      }
      // Reset to page 1 on new search
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, paramName],
  );

  useEffect(() => {
    // Skip firing on initial render — the URL already has the right value
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => pushSearch(value), debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, debounceMs, pushSearch]);

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
