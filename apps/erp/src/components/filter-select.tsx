'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Select } from '@repo/ui';

interface FilterSelectProps {
  /** URL param name */
  paramName: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Select that immediately updates URL searchParams on change.
 * Preserves all existing params. Resets page to 1.
 */
export function FilterSelect({
  paramName,
  className = 'w-44 h-9 text-sm',
  children,
}: FilterSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) {
      params.set(paramName, e.target.value);
    } else {
      params.delete(paramName);
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select
      value={searchParams.get(paramName) ?? ''}
      onChange={handleChange}
      className={className}
    >
      {children}
    </Select>
  );
}
