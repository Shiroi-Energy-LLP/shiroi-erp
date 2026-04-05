import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { getProposal, getProposalRevisions } from '@/lib/proposals-queries';
import { getEntityContacts } from '@/lib/contacts-queries';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { EntityContactsCard } from '@/components/contacts/entity-contacts-card';
import { BOMTable } from '@/components/proposals/bom-table';
import { PaymentSchedule } from '@/components/proposals/payment-schedule';
import { ProposalFiles } from '@/components/proposals/proposal-files';
import { GeneratePDFButton } from '@/components/proposals/generate-pdf-button';
import { formatINR, toIST } from '@repo/ui/formatters';
import { calcMarginPct } from '@/lib/proposal-calc';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Breadcrumb,
} from '@repo/ui';

interface ProposalDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProposalDetailPage({ params }: ProposalDetailPageProps) {
  const { id } = await params;
  const proposal = await getProposal(id);

  if (!proposal) {
    notFound();
  }

  const [revisions, entityContacts] = await Promise.all([
    getProposalRevisions(proposal.proposal_number),
    getEntityContacts('proposal', id),
  ]);

  const bomLines = proposal.proposal_bom_lines ?? [];
  const paymentMilestones = proposal.proposal_payment_schedule ?? [];

  // Load files from Supabase Storage
  const supabase = await createClient();
  const { data: storedFiles } = await supabase.storage
    .from('proposal-files')
    .list(proposal.lead_id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  const proposalFiles = (storedFiles ?? []).map(f => ({
    name: f.name,
    id: f.id ?? f.name,
    created_at: f.created_at ?? '',
    metadata: { size: (f.metadata as Record<string, unknown>)?.size as number | undefined, mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined },
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Proposals', href: '/proposals' },
          { label: proposal.proposal_number },
        ]}
      />
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[#1A1D24] font-mono">
            {proposal.proposal_number}
          </h1>
          <div className="flex items-center gap-3">
            <ProposalStatusBadge status={proposal.status} />
            <span className="text-sm text-muted-foreground">
              Rev {proposal.revision_number}
            </span>
            {proposal.leads && (
              <span className="text-sm text-muted-foreground">
                for {proposal.leads.customer_name}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              Created {toIST(proposal.created_at)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {proposal.margin_approval_required && !proposal.margin_approved_by && (
            <Badge variant="warning">Margin Approval Required</Badge>
          )}
          {proposal.margin_approved_by && (
            <Badge variant="success">Margin Approved</Badge>
          )}
          <GeneratePDFButton proposalId={proposal.id} />
          {proposal.status === 'draft' && (
            <Button variant="outline" size="sm">Send Proposal</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left column: BOM + Payment */}
        <div className="col-span-2 space-y-6">
          {/* System Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">System Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <InfoItem label="System Type" value={proposal.system_type.replace(/_/g, ' ')} capitalize />
                <InfoItem label="System Size" value={`${proposal.system_size_kwp} kWp`} />
                <InfoItem label="Structure" value={proposal.structure_type} />
                <InfoItem label="Panel" value={panelLabel(proposal)} />
                <InfoItem label="Inverter" value={inverterLabel(proposal)} />
                {proposal.system_type !== 'on_grid' && (
                  <InfoItem label="Battery" value={batteryLabel(proposal)} />
                )}
              </div>
            </CardContent>
          </Card>

          {/* BOM Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bill of Materials ({bomLines.length} items)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <BOMTable lines={bomLines} />
            </CardContent>
          </Card>

          {/* Payment Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              <PaymentSchedule milestones={paymentMilestones} />
            </CardContent>
          </Card>
        </div>

        {/* Right column: Totals + Revisions */}
        <div className="space-y-6">
          {/* Totals Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Financials</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <TotalRow label="Subtotal — Supply" value={proposal.subtotal_supply} />
              <TotalRow label="Subtotal — Works" value={proposal.subtotal_works} />
              <Divider />
              <TotalRow label="GST on Supply (5%)" value={proposal.gst_supply_amount} muted />
              <TotalRow label="GST on Works (18%)" value={proposal.gst_works_amount} muted />
              <Divider />
              <TotalRow label="Total before discount" value={proposal.total_before_discount} />
              {proposal.discount_amount > 0 && (
                <TotalRow label="Discount" value={-proposal.discount_amount} highlight="discount" />
              )}
              <Divider />
              <TotalRow label="Total after discount" value={proposal.total_after_discount} bold />
              <Divider />
              <div className="flex justify-between text-sm pt-1">
                <span className="text-muted-foreground">Shiroi Revenue</span>
                <span className="font-mono">{formatINR(proposal.shiroi_revenue)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shiroi Cost</span>
                <span className="font-mono">{formatINR(proposal.shiroi_cost)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gross Margin</span>
                <span className="font-mono">{formatINR(proposal.gross_margin_amount)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span>Margin %</span>
                <span className={`font-mono ${proposal.gross_margin_pct < 15 ? 'text-[#991B1B]' : 'text-[#065F46]'}`}>
                  {proposal.gross_margin_pct.toFixed(1)}%
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Lead Info */}
          {proposal.leads && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Name</span>
                  <Link href={`/leads/${proposal.lead_id}`} className="text-[#00B050] hover:underline">
                    {proposal.leads.customer_name}
                  </Link>
                </div>
                {proposal.leads.phone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="font-mono">{proposal.leads.phone}</span>
                  </div>
                )}
                {proposal.leads.email && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Email</span>
                    <span>{proposal.leads.email}</span>
                  </div>
                )}
                {proposal.leads.city && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">City</span>
                    <span>{proposal.leads.city}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Revision History */}
          {revisions.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revision History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {revisions.map((rev) => (
                  <div key={rev.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {rev.id === proposal.id ? (
                        <span className="font-medium">Rev {rev.revision_number}</span>
                      ) : (
                        <Link href={`/proposals/${rev.id}`} className="text-[#00B050] hover:underline">
                          Rev {rev.revision_number}
                        </Link>
                      )}
                      <ProposalStatusBadge status={rev.status} />
                    </div>
                    <span className="font-mono text-muted-foreground">
                      {formatINR(rev.total_after_discount)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {proposal.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[#3E3E3E] whitespace-pre-wrap">{proposal.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Files */}
          <ProposalFiles
            leadId={proposal.lead_id}
            proposalNumber={proposal.proposal_number}
            initialFiles={proposalFiles}
          />

          <EntityContactsCard entityType="proposal" entityId={id} contacts={entityContacts} />
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value, capitalize: cap }: { label: string; value: string | null | undefined; capitalize?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-medium text-[#1A1D24] ${cap ? 'capitalize' : ''}`}>
        {value || '—'}
      </div>
    </div>
  );
}

function TotalRow({ label, value, bold, muted, highlight }: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
  highlight?: 'discount';
}) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold text-base' : ''}`}>
      <span className={muted ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={`font-mono ${highlight === 'discount' ? 'text-[#065F46]' : ''} ${bold ? 'text-[#1A1D24]' : ''}`}>
        {highlight === 'discount' ? `- ${formatINR(Math.abs(value))}` : formatINR(value)}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-dashed border-[#E5E7EB]" />;
}

function panelLabel(p: { panel_brand: string | null; panel_model: string | null; panel_wattage: number | null; panel_count: number | null }): string {
  const parts: string[] = [];
  if (p.panel_brand) parts.push(p.panel_brand);
  if (p.panel_model) parts.push(p.panel_model);
  if (p.panel_wattage) parts.push(`${p.panel_wattage}W`);
  if (p.panel_count) parts.push(`x${p.panel_count}`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

function inverterLabel(p: { inverter_brand: string | null; inverter_model: string | null; inverter_capacity_kw: number | null }): string {
  const parts: string[] = [];
  if (p.inverter_brand) parts.push(p.inverter_brand);
  if (p.inverter_model) parts.push(p.inverter_model);
  if (p.inverter_capacity_kw) parts.push(`${p.inverter_capacity_kw} kW`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

function batteryLabel(p: { battery_brand: string | null; battery_model: string | null; battery_capacity_kwh: number | null }): string {
  const parts: string[] = [];
  if (p.battery_brand) parts.push(p.battery_brand);
  if (p.battery_model) parts.push(p.battery_model);
  if (p.battery_capacity_kwh) parts.push(`${p.battery_capacity_kwh} kWh`);
  return parts.length > 0 ? parts.join(' ') : '—';
}
