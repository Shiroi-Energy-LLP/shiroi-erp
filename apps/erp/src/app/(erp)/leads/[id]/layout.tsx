import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { LeadTabs } from '@/components/leads/lead-tabs';
import { StatusChange } from '@/components/leads/status-change';
import { QuickQuoteButton } from '@/components/proposals/quick-quote-button';
import { ClosureBandBadge, ClosureBandHelper } from '@/components/sales/closure-band-badge';
import { AttemptWonButton } from '@/components/sales/attempt-won-button';
import { CreateProjectFromLeadButton } from '@/components/sales/create-project-from-lead-button';
import { computeMargin } from '@/lib/closure-actions';
import { Breadcrumb, Card, CardContent } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';

interface LeadDetailLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

export default async function LeadDetailLayout({ params, children }: LeadDetailLayoutProps) {
  const { id } = await params;
  const lead = await getLead(id);

  if (!lead) {
    notFound();
  }

  const showPayments = lead.status === 'won' || lead.status === 'converted';

  // For closure_soon leads, compute margin + band so the banner shows live
  // numbers (and AttemptWonButton routes through attemptWon server action).
  const inClosure = lead.status === 'closure_soon' || lead.status === 'negotiation';
  const marginSnapshot = inClosure ? await computeMargin(id) : null;
  const margin = marginSnapshot && marginSnapshot.success ? marginSnapshot.data : null;

  // Won leads should always have a project. If the cascade missed (bulk
  // import, no in-play proposal at won-time), surface a manual fallback so
  // ops isn't stuck. Hidden once a project exists.
  let hasProjectForLead = true;
  if (lead.status === 'won') {
    const supabase = await createClient();
    const { data: existingProject } = await supabase
      .from('projects')
      .select('id')
      .eq('lead_id', id)
      .is('deleted_at', null)
      .limit(1);
    hasProjectForLead = !!(existingProject && existingProject.length > 0);
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb - middleware redirects /leads -> /sales so this always
          renders under /sales URL space post-revamp. */}
      <Breadcrumb
        className="mb-2"
        items={[
          { label: 'Sales', href: '/sales' },
          { label: lead.customer_name },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-n-900">{lead.customer_name}</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <LeadStatusBadge status={lead.status} />
            {lead.employees?.full_name && (
              <span className="text-sm text-n-500">
                Assigned to {lead.employees.full_name}
              </span>
            )}
            {lead.expected_close_date && (
              <span className="text-sm text-n-500">
                Expected close: {formatDate(lead.expected_close_date)}
              </span>
            )}
            {lead.close_probability != null && lead.close_probability > 0 && (
              <span className="text-sm font-medium text-n-600">
                {lead.close_probability}% probability
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.status === 'won' && !hasProjectForLead && (
            <CreateProjectFromLeadButton leadId={lead.id} />
          )}
          <QuickQuoteButton
            leadId={lead.id}
            systemType={lead.system_type}
            sizeKwp={lead.estimated_size_kwp}
            segment={lead.segment}
          />
          <StatusChange leadId={lead.id} currentStatus={lead.status} />
        </div>
      </div>

      {/* Closure Soon banner - shows live margin band + Attempt Won button */}
      {lead.status === 'closure_soon' && margin && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/40">
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-2 flex-1 min-w-[240px]">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-semibold text-n-800">Closure Soon</span>
                  <ClosureBandBadge band={margin.band} grossMargin={margin.grossMargin} size="lg" />
                </div>
                <ClosureBandHelper band={margin.band} />
                <div className="text-xs text-n-500 font-mono">
                  Base: ₹{Math.round(margin.basePrice).toLocaleString('en-IN')} · BOM cost: ₹
                  {Math.round(margin.bomCost).toLocaleString('en-IN')} · Site est: ₹
                  {Math.round(margin.siteExpensesEst).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <AttemptWonButton leadId={lead.id} disabled={margin.band === 'red'} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <LeadTabs leadId={id} showPayments={showPayments} />

      {/* Tab content */}
      {children}
    </div>
  );
}
