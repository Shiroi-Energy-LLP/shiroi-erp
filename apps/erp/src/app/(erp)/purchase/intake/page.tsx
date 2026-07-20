// =============================================================================
// /purchase/intake — site-engineer Bill of Items intake (spec §11)
// =============================================================================
// Server component. Accessible to INTAKE_ROLES ∪ PRICE_VISIBLE_ROLES (the
// office can use it too), but the screen itself NEVER renders price data for
// anyone — searchPriceBookAction strips prices for site_supervisor at the
// query level and this UI simply never shows price fields at all (spec §1).
// =============================================================================

import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { getProjectOptions } from '@/lib/purchase-flow-queries';
import {
  INTAKE_ROLES,
  PRICE_VISIBLE_ROLES,
} from '@/lib/purchase-flow-constants';
import { IntakeClient } from '@/components/purchase-flow/intake-client';

export const dynamic = 'force-dynamic';

export default async function PurchaseIntakePage() {
  const { role, profile } = await getSessionContext();
  if (!role) redirect('/login');

  const allowed = new Set<string>([...INTAKE_ROLES, ...PRICE_VISIBLE_ROLES]);
  if (!allowed.has(role)) redirect('/dashboard');

  const projects = await getProjectOptions();
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || 'there';

  return <IntakeClient firstName={firstName} projects={projects} />;
}
