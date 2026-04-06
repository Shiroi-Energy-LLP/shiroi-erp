import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { LeadTabs } from '@/components/leads/lead-tabs';
import { StatusChange } from '@/components/leads/status-change';
import { QuickQuoteButton } from '@/components/proposals/quick-quote-button';
import { Breadcrumb } from '@repo/ui';
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

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        className="mb-2"
        items={[
          { label: 'Leads', href: '/leads' },
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
          <QuickQuoteButton
            leadId={lead.id}
            systemType={lead.system_type}
            sizeKwp={lead.estimated_size_kwp}
            segment={lead.segment}
          />
          <StatusChange leadId={lead.id} currentStatus={lead.status} />
        </div>
      </div>

      {/* Tabs */}
      <LeadTabs leadId={id} showPayments={showPayments} />

      {/* Tab content */}
      {children}
    </div>
  );
}
