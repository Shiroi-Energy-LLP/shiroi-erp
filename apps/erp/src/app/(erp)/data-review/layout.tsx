// apps/erp/src/app/(erp)/data-review/layout.tsx
// Role guard for the entire /data-review section.
// Allowed: founder · marketing_manager · project_manager
// Others: redirect to /dashboard?notice=data-review-forbidden

import { getUserProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';

const ALLOWED_ROLES = new Set(['founder', 'marketing_manager', 'project_manager']);

export default async function DataReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');
  if (!ALLOWED_ROLES.has(profile.role)) {
    redirect('/dashboard?notice=data-review-forbidden');
  }
  return <>{children}</>;
}
