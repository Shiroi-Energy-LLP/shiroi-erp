'use client';
import type { AppRole } from '@/lib/roles';

interface Props {
  fullName: string;
  email: string;
  role: AppRole;
}

export function AccountTab({ fullName, email, role }: Props) {
  return <div className="text-sm text-n-600">Account tab — {fullName} · {email} · {role}</div>;
}
