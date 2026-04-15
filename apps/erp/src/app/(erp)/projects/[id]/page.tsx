import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getProject } from '@/lib/projects-queries';
import { createClient } from '@repo/supabase/server';
import {
  getCurrentUserRoleForProject,
  getActiveEmployeesLite,
  getProjectFinancials,
} from '@/lib/project-detail-actions';
import { FinancialBox } from '@/components/projects/detail/financial-box';
import { SystemConfigBox } from '@/components/projects/detail/system-config-box';
import { CustomerInfoBox } from '@/components/projects/detail/customer-info-box';
import { TimelineTeamBox } from '@/components/projects/detail/timeline-team-box';
import { DocumentsTab } from '@/components/projects/detail/documents-tab';
import { StepSurvey } from '@/components/projects/stepper-steps/step-survey';
import { StepBom } from '@/components/projects/stepper-steps/step-bom';
import { StepBoq } from '@/components/projects/stepper-steps/step-boq';
import { StepDelivery } from '@/components/projects/stepper-steps/step-delivery';
import { StepExecution } from '@/components/projects/stepper-steps/step-execution';
import { StepQc } from '@/components/projects/stepper-steps/step-qc';
import { StepLiaison } from '@/components/projects/stepper-steps/step-liaison';
import { StepCommissioning } from '@/components/projects/stepper-steps/step-commissioning';
import { StepAmc } from '@/components/projects/stepper-steps/step-amc';
import { StepActuals } from '@/components/projects/stepper-steps/step-actuals';

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

function StepLoadingFallback() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-48 bg-n-150 rounded animate-pulse" />
      <div className="h-32 bg-n-150 rounded-lg animate-pulse" />
    </div>
  );
}

export default async function ProjectDetailPage({ params, searchParams }: ProjectDetailPageProps) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = tab ?? 'details';

  // Non-details tabs — skip the heavy details fetch
  if (activeTab !== 'details') {
    return (
      <Suspense fallback={<StepLoadingFallback />}>
        <TabContent projectId={id} tab={activeTab} />
      </Suspense>
    );
  }

  // Details tab — fetch everything the new boxes need in parallel
  const [project, viewerRole, employees, financials] = await Promise.all([
    getProject(id),
    getCurrentUserRoleForProject(),
    getActiveEmployeesLite(),
    getProjectFinancials(id),
  ]);

  if (!project) {
    notFound();
  }

  // Resolve the primary contact (if the project has one linked) so the
  // Customer Information box can show "from contacts DB" details instead
  // of the denormalized project columns.
  type LinkedContact = { id: string; name: string; phone: string | null; email: string | null };
  let primaryContact: LinkedContact | null = null;
  if ((project as any).primary_contact_id) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('contacts')
      .select('id, name, phone, email')
      .eq('id', (project as any).primary_contact_id)
      .maybeSingle();
    if (data) primaryContact = data as LinkedContact;
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Left / middle — editable boxes */}
      <div className="col-span-2 space-y-6">
        <SystemConfigBox
          projectId={id}
          project={{
            system_size_kwp: (project as any).system_size_kwp ?? 0,
            system_type: (project as any).system_type ?? 'on_grid',
            structure_type: (project as any).structure_type ?? null,
            panel_brand: (project as any).panel_brand ?? null,
            panel_model: (project as any).panel_model ?? null,
            panel_count: (project as any).panel_count ?? 0,
            panel_wattage: (project as any).panel_wattage ?? null,
            inverter_brand: (project as any).inverter_brand ?? null,
            inverter_model: (project as any).inverter_model ?? null,
            inverter_capacity_kw: (project as any).inverter_capacity_kw ?? null,
            battery_brand: (project as any).battery_brand ?? null,
            battery_capacity_kwh: (project as any).battery_capacity_kwh ?? null,
            cable_brand: (project as any).cable_brand ?? null,
            cable_model: (project as any).cable_model ?? null,
            scope_la: (project as any).scope_la ?? null,
            scope_civil: (project as any).scope_civil ?? null,
            scope_meter: (project as any).scope_meter ?? null,
            notes: (project as any).notes ?? null,
          }}
        />

        <CustomerInfoBox
          projectId={id}
          project={{
            customer_name: (project as any).customer_name ?? '',
            customer_email: (project as any).customer_email ?? null,
            customer_phone: (project as any).customer_phone ?? '',
            primary_contact_id: (project as any).primary_contact_id ?? null,
            site_address_line1: (project as any).site_address_line1 ?? '',
            site_address_line2: (project as any).site_address_line2 ?? null,
            site_city: (project as any).site_city ?? '',
            site_state: (project as any).site_state ?? '',
            site_pincode: (project as any).site_pincode ?? null,
            billing_address: (project as any).billing_address ?? null,
            location_map_link: (project as any).location_map_link ?? null,
          }}
          primaryContact={primaryContact}
        />

        <TimelineTeamBox
          projectId={id}
          project={{
            order_date: (project as any).order_date ?? null,
            planned_start_date: (project as any).planned_start_date ?? null,
            planned_end_date: (project as any).planned_end_date ?? null,
            actual_start_date: (project as any).actual_start_date ?? null,
            actual_end_date: (project as any).actual_end_date ?? null,
            commissioned_date: (project as any).commissioned_date ?? null,
            project_manager_id: (project as any).project_manager_id ?? null,
            site_supervisor_id: (project as any).site_supervisor_id ?? null,
          }}
          employees={employees}
        />
      </div>

      {/* Right — role-gated Financial */}
      <div className="space-y-6">
        <FinancialBox
          projectId={id}
          contractedValue={financials.contractedValue}
          actualExpenses={financials.actualExpenses}
          boqTotal={financials.boqTotal}
          siteExpensesTotal={financials.siteExpensesTotal}
          marginAmount={financials.marginAmount}
          marginPct={financials.marginPct}
          viewerRole={viewerRole}
        />
      </div>
    </div>
  );
}

// ── Tab content router for non-details tabs ──

async function TabContent({ projectId, tab }: { projectId: string; tab: string }) {
  switch (tab) {
    case 'survey':
      return <StepSurvey projectId={projectId} />;
    case 'bom':
      return <StepBom projectId={projectId} />;
    case 'boq':
      return <StepBoq projectId={projectId} />;
    case 'delivery':
      return <StepDelivery projectId={projectId} />;
    case 'execution':
      return <StepExecution projectId={projectId} />;
    case 'actuals':
      return <StepActuals projectId={projectId} />;
    case 'qc':
      return <StepQc projectId={projectId} />;
    case 'liaison': {
      // Post-Marketing-revamp: liaison is owned by marketing_manager.
      // Project managers get a read-only view so they can answer client
      // questions but can't edit CEIG / DISCOM / net-meter fields.
      const viewerRole = await getCurrentUserRoleForProject();
      const liaisonReadOnly = viewerRole === 'project_manager';
      return <StepLiaison projectId={projectId} readOnly={liaisonReadOnly} />;
    }
    case 'commissioning':
      return <StepCommissioning projectId={projectId} />;
    case 'amc':
      return <StepAmc projectId={projectId} />;
    case 'documents': {
      const supabase = await createClient();
      const { data } = await supabase
        .from('projects')
        .select('lead_id')
        .eq('id', projectId)
        .maybeSingle();
      return <DocumentsTab projectId={projectId} leadId={(data as any)?.lead_id ?? null} />;
    }
    default:
      return null;
  }
}
