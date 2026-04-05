'use client';

import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

const VIEWABLE_ROLES = [
  { value: 'founder', label: 'Founder' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'sales_engineer', label: 'Sales Engineer' },
  { value: 'designer', label: 'Designer' },
  { value: 'purchase_officer', label: 'Purchase Officer' },
  { value: 'site_supervisor', label: 'Site Supervisor' },
  { value: 'om_technician', label: 'O&M Technician' },
  { value: 'finance', label: 'Finance' },
  { value: 'hr_manager', label: 'HR Manager' },
] as const;

interface RoleSwitcherProps {
  currentViewAs: string | undefined;
}

export function RoleSwitcher({ currentViewAs }: RoleSwitcherProps) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === 'founder') {
      router.push('/dashboard');
    } else {
      router.push(`/dashboard?view_as=${value}`);
    }
  }

  return (
    <div className="relative">
      <select
        value={currentViewAs ?? 'founder'}
        onChange={handleChange}
        className="appearance-none bg-n-100 border border-n-200 rounded-md text-xs font-medium text-n-600 pl-2 pr-6 py-1.5 cursor-pointer hover:bg-[#E8EAEF] transition-colors focus:outline-none focus:ring-2 focus:ring-[#FACB01] focus:ring-offset-1"
      >
        {VIEWABLE_ROLES.map((role) => (
          <option key={role.value} value={role.value}>
            View as: {role.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-n-400 pointer-events-none" />
    </div>
  );
}
