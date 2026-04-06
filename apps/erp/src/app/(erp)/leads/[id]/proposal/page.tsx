import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { QuickQuoteButton } from '@/components/proposals/quick-quote-button';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { Card, CardContent, EmptyState } from '@repo/ui';

interface ProposalTabProps {
  params: Promise<{ id: string }>;
}

export default async function ProposalTab({ params }: ProposalTabProps) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  // Fetch proposals linked to this lead
  const supabase = await createClient();
  const { data: proposals, error } = await supabase
    .from('proposals')
    .select('id, proposal_number, revision_number, status, system_type, system_size_kwp, total_price, margin_pct, created_at, is_budgetary')
    .eq('lead_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ProposalTab] Query failed:', { code: error.code, message: error.message });
  }

  const proposalList = proposals ?? [];

  if (proposalList.length === 0) {
    return (
      <div className="py-12">
        <EmptyState
          title="No proposals yet"
          description="Create a proposal for this lead to get started."
          action={
            <QuickQuoteButton
              leadId={lead.id}
              systemType={lead.system_type}
              sizeKwp={lead.estimated_size_kwp}
              segment={lead.segment}
            />
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick action to create another proposal */}
      <div className="flex justify-end">
        <QuickQuoteButton
          leadId={lead.id}
          systemType={lead.system_type}
          sizeKwp={lead.estimated_size_kwp}
          segment={lead.segment}
        />
      </div>

      {/* Proposal cards */}
      {proposalList.map((proposal: any) => (
        <Card key={proposal.id}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/proposals/${proposal.id}`}
                    className="text-sm font-mono font-medium text-n-900 hover:text-shiroi-green"
                  >
                    {proposal.proposal_number}
                  </Link>
                  <ProposalStatusBadge status={proposal.status} />
                  {proposal.is_budgetary && (
                    <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">Budgetary</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-n-500">
                  <span>Rev {proposal.revision_number}</span>
                  <span>{proposal.system_size_kwp} kWp {proposal.system_type?.replace(/_/g, ' ')}</span>
                  <span>{formatDate(proposal.created_at)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold font-mono text-n-900">
                  {formatINR(proposal.total_price)}
                </div>
                {proposal.margin_pct != null && (
                  <div className="text-xs text-n-500">
                    {proposal.margin_pct.toFixed(1)}% margin
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
