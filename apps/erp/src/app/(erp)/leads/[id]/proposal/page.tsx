import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { createDraftDetailedProposal } from '@/lib/quote-actions';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { QuickQuoteButton } from '@/components/proposals/quick-quote-button';
import { BomPicker, type BomLineRow, type PriceBookOption } from '@/components/sales/bom-picker';
import { ConsultantPicker } from '@/components/sales/consultant-picker';
import { FinalizeDetailedProposalButton } from '@/components/sales/finalize-detailed-proposal-button';
import { formatINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  EmptyState,
  Badge,
} from '@repo/ui';

interface ProposalTabProps {
  params: Promise<{ id: string }>;
}

/**
 * Quote tab — the consolidated proposal workspace on /sales/[id]/proposal.
 *
 * Post-Marketing-revamp this tab has 3 main surfaces:
 *
 *   1. Draft detailed proposal editor (BomPicker) — appears for Path B leads
 *      once a draft proposal exists, with the Finalize button when design is
 *      confirmed.
 *
 *   2. Consultant picker — assign a channel_partner to trigger the DB
 *      commission lock trigger.
 *
 *   3. Historical proposals list — keeps the old list-of-proposals view so
 *      sent/accepted proposals remain visible.
 *
 * The QuickQuoteButton in the lead header (layout.tsx) handles Path A quick
 * quote creation — not duplicated here.
 */
export default async function ProposalTab({ params }: ProposalTabProps) {
  const { id: leadId } = await params;
  const lead = await getLead(leadId);
  if (!lead) notFound();

  const supabase = await createClient();

  // Fetch everything in parallel
  const [proposalsRes, leadMetaRes, priceBookRes, partnersRes, currentPartnerRes] = await Promise.all([
    supabase
      .from('proposals')
      .select(
        'id, proposal_number, revision_number, status, system_type, system_size_kwp, total_after_discount, gross_margin_pct, created_at, is_budgetary',
      )
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),
    supabase
      .from('leads')
      .select(
        'draft_proposal_id, channel_partner_id, consultant_commission_amount, base_quote_price',
      )
      .eq('id', leadId)
      .maybeSingle(),
    supabase
      .from('price_book')
      .select('id, item_category, item_description, brand, unit, base_price')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('item_category')
      .order('base_price', { ascending: true }),
    supabase
      .from('channel_partners')
      .select('id, partner_name, partner_type, commission_type, commission_rate, tds_applicable')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('partner_name'),
    // Current partner (if any) pre-fetched so we don't need to re-look it up in the client
    (async () => {
      const { data: leadRow } = await supabase
        .from('leads')
        .select('channel_partner_id')
        .eq('id', leadId)
        .maybeSingle();
      if (!leadRow?.channel_partner_id) return { data: null };
      return supabase
        .from('channel_partners')
        .select(
          'id, partner_name, partner_type, commission_type, commission_rate, tds_applicable',
        )
        .eq('id', leadRow.channel_partner_id)
        .maybeSingle();
    })(),
  ]);

  const proposalList = proposalsRes.data ?? [];
  const leadMeta = leadMetaRes.data;
  const priceBookItems = (priceBookRes.data ?? []) as PriceBookOption[];
  const availablePartners = partnersRes.data ?? [];
  const currentPartner = currentPartnerRes.data ?? null;

  // Draft detailed proposal resolution. Auto-create one if the lead is in
  // a Path B stage and doesn't have a draft yet (mirrors /design/[leadId]).
  let draftProposalId = leadMeta?.draft_proposal_id ?? null;
  const isPathBStage = [
    'site_survey_scheduled',
    'site_survey_done',
    'design_in_progress',
    'design_confirmed',
    'detailed_proposal_sent',
  ].includes(lead.status);
  if (!draftProposalId && isPathBStage) {
    const createResult = await createDraftDetailedProposal(leadId);
    if (createResult.success) {
      draftProposalId = createResult.data.proposalId;
    }
  }

  // Draft proposal's BOM lines
  let draftBomLines: BomLineRow[] = [];
  let draftProposalStatus: string | null = null;
  if (draftProposalId) {
    const [linesRes, proposalRes] = await Promise.all([
      supabase
        .from('proposal_bom_lines')
        .select(
          'id, item_category, item_description, brand, unit, quantity, unit_price, total_price, price_book_id',
        )
        .eq('proposal_id', draftProposalId)
        .order('line_number'),
      supabase
        .from('proposals')
        .select('status')
        .eq('id', draftProposalId)
        .maybeSingle(),
    ]);
    draftBomLines = (linesRes.data ?? []) as BomLineRow[];
    draftProposalStatus = proposalRes.data?.status ?? null;
  }

  const canFinalize =
    draftProposalId !== null &&
    draftProposalStatus === 'draft' &&
    draftBomLines.length > 0 &&
    draftBomLines.every((l) => l.price_book_id) &&
    lead.status === 'design_confirmed';

  return (
    <div className="space-y-6">
      {/* ─── Quick actions bar ─── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-n-500">
          Generate a Quick Quote for Path A, or build a Detailed Proposal for Path B through the{' '}
          <Link href={`/design/${leadId}`} className="text-shiroi-green hover:underline">
            design workspace
          </Link>
          .
        </div>
        <QuickQuoteButton
          leadId={lead.id}
          systemType={lead.system_type}
          sizeKwp={lead.estimated_size_kwp}
          segment={lead.segment}
        />
      </div>

      {/* ─── Consultant picker ─── */}
      <ConsultantPicker
        leadId={leadId}
        currentPartner={currentPartner as any}
        lockedCommissionAmount={leadMeta?.consultant_commission_amount ?? null}
        basePrice={leadMeta?.base_quote_price ?? null}
        availablePartners={availablePartners as any}
      />

      {/* ─── Draft detailed proposal editor ─── */}
      {draftProposalId && isPathBStage && (
        <>
          <BomPicker
            proposalId={draftProposalId}
            bomLines={draftBomLines}
            priceBookOptions={priceBookItems}
            readOnly={draftProposalStatus !== 'draft'}
          />

          {/* Finalize action */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Send Detailed Proposal</CardTitle>
            </CardHeader>
            <CardContent>
              {canFinalize ? (
                <div className="flex items-start justify-between gap-4">
                  <div className="text-sm text-n-600 flex-1">
                    Design is confirmed and BOM is fully price-book-sourced. Clicking finalize
                    recomputes totals, bakes in the consultant commission (if any), flips the
                    lead to <strong>Detailed Proposal Sent</strong>, and stamps the send time.
                    One click — no wizard.
                  </div>
                  <FinalizeDetailedProposalButton proposalId={draftProposalId} />
                </div>
              ) : (
                <div className="text-sm text-n-500 space-y-1">
                  <div>
                    <strong className="text-n-700">Cannot finalize yet.</strong> Requirements:
                  </div>
                  <ul className="list-disc list-inside text-xs">
                    <li
                      className={
                        draftBomLines.length > 0 ? 'text-green-700' : 'text-amber-700 font-medium'
                      }
                    >
                      BOM has at least one line ({draftBomLines.length})
                    </li>
                    <li
                      className={
                        draftBomLines.every((l) => l.price_book_id)
                          ? 'text-green-700'
                          : 'text-amber-700 font-medium'
                      }
                    >
                      Every BOM line sourced from Price Book
                    </li>
                    <li
                      className={
                        lead.status === 'design_confirmed'
                          ? 'text-green-700'
                          : 'text-amber-700 font-medium'
                      }
                    >
                      Lead is in <code>design_confirmed</code> stage (currently{' '}
                      <code>{lead.status}</code>)
                    </li>
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ─── Historical proposals list ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Proposals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {proposalList.length === 0 ? (
            <EmptyState
              title="No proposals yet"
              description="Use Generate Quick Quote above, or start a Detailed Proposal via the Design workspace."
            />
          ) : (
            <div className="divide-y divide-n-100">
              {proposalList.map((proposal: any) => (
                <div
                  key={proposal.id}
                  className="px-4 py-3 flex items-center justify-between hover:bg-n-50"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Link
                        href={`/proposals/${proposal.id}`}
                        className="text-sm font-mono font-medium text-n-900 hover:text-shiroi-green"
                      >
                        {proposal.proposal_number}
                      </Link>
                      <ProposalStatusBadge status={proposal.status} />
                      {proposal.is_budgetary ? (
                        <Badge variant="warning" className="text-[10px]">
                          Quick Quote
                        </Badge>
                      ) : (
                        <Badge variant="info" className="text-[10px]">
                          Detailed
                        </Badge>
                      )}
                      {proposal.id === draftProposalId && (
                        <Badge variant="neutral" className="text-[10px]">
                          Active Draft
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-n-500">
                      <span>Rev {proposal.revision_number}</span>
                      <span>
                        {proposal.system_size_kwp} kWp{' '}
                        {proposal.system_type?.replace(/_/g, ' ')}
                      </span>
                      <span>{formatDate(proposal.created_at)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-bold font-mono text-n-900">
                      {formatINR(Number(proposal.total_after_discount ?? 0))}
                    </div>
                    {proposal.gross_margin_pct != null && (
                      <div className="text-xs text-n-500">
                        {Number(proposal.gross_margin_pct).toFixed(1)}% margin
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
