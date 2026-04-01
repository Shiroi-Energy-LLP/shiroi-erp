import { getUserProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { FounderDashboard } from './founder-dashboard';
import { PMDashboard } from './pm-dashboard';
import { SalesDashboard } from './sales-dashboard';
import { DesignerDashboard } from './designer-dashboard';
import { PurchaseDashboard } from './purchase-dashboard';
import { SupervisorDashboard } from './supervisor-dashboard';
import { FinanceDashboard } from './finance-dashboard';
import { HRDashboard } from './hr-dashboard';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view_as?: string }>;
}) {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const params = await searchParams;
  // Founder can view as any role
  const effectiveRole = (profile.role === 'founder' && params.view_as)
    ? params.view_as
    : profile.role;

  switch (effectiveRole) {
    case 'founder':
      return <FounderDashboard />;
    case 'project_manager':
    case 'om_technician':
      return <PMDashboard />;
    case 'site_supervisor':
      return <SupervisorDashboard />;
    case 'sales_engineer':
      return <SalesDashboard />;
    case 'designer':
      return <DesignerDashboard />;
    case 'purchase_officer':
      return <PurchaseDashboard />;
    case 'finance':
      return <FinanceDashboard />;
    case 'hr_manager':
      return <HRDashboard />;
    default:
      return <FounderDashboard />;
  }
}
