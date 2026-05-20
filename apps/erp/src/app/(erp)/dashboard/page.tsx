import { getUserProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ProposalGateBanner } from '@/components/proposal-gate-banner';
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

  let dashboard: React.ReactNode;
  switch (effectiveRole) {
    case 'founder':
      dashboard = <FounderDashboard />;
      break;
    case 'project_manager':
    case 'om_technician':
      dashboard = <PMDashboard />;
      break;
    case 'site_supervisor':
      dashboard = <SupervisorDashboard />;
      break;
    case 'sales_engineer':
      dashboard = <SalesDashboard />;
      break;
    case 'designer':
      dashboard = <DesignerDashboard />;
      break;
    case 'purchase_officer':
      dashboard = <PurchaseDashboard />;
      break;
    case 'finance':
      dashboard = <FinanceDashboard />;
      break;
    case 'hr_manager':
      dashboard = <HRDashboard />;
      break;
    default:
      dashboard = <FounderDashboard />;
  }

  return (
    <div className="space-y-4">
      <ProposalGateBanner />
      {dashboard}
    </div>
  );
}
