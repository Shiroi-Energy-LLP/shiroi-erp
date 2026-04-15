import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getPartner,
  getPartnerLeads,
  getPartnerPayouts,
  getPartnerSummary,
} from '@/lib/partners-queries';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Breadcrumb,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { MarkPayoutPaidButton } from '@/components/partners/mark-payout-paid-button';

const PARTNER_TYPE_LABELS: Record<string, string> = {
  individual_broker: 'Individual Broker',
  aggregator: 'Aggregator',
  ngo: 'NGO',
  housing_society: 'Housing Society',
  corporate: 'Corporate',
  consultant: 'Consultant',
  referral: 'Referral',
  electrical_contractor: 'Electrical Contractor',
  architect: 'Architect',
  mep_firm: 'MEP Firm',
  other: 'Other',
};

const COMMISSION_TYPE_LABELS: Record<string, string> = {
  per_kwp: 'Per kWp',
  percentage_of_revenue: '% of Revenue',
  fixed_per_deal: 'Fixed per Deal',
};

function formatINR(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

interface PartnerDetailProps {
  params: Promise<{ id: string }>;
}

export default async function PartnerDetailPage({ params }: PartnerDetailProps) {
  const { id } = await params;

  const [partner, summary, leads, pendingPayouts, paidPayouts] = await Promise.all([
    getPartner(id),
    getPartnerSummary(id),
    getPartnerLeads(id),
    getPartnerPayouts(id, { status: 'pending' }),
    getPartnerPayouts(id, { status: 'paid' }),
  ]);

  if (!partner) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-2"
        items={[
          { label: 'Partners', href: '/partners' },
          { label: partner.partner_name },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-n-900">{partner.partner_name}</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <Badge variant="neutral" className="text-xs">
              {PARTNER_TYPE_LABELS[partner.partner_type] ?? partner.partner_type}
            </Badge>
            <Badge variant={partner.is_active ? 'success' : 'neutral'} className="text-xs">
              {partner.is_active ? 'Active' : 'Inactive'}
            </Badge>
            {partner.tds_applicable && (
              <Badge variant="warning" className="text-xs">
                TDS 5% (Section 194H)
              </Badge>
            )}
            <span className="text-sm text-n-500">
              {partner.contact_person} • {partner.phone}
            </span>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-n-500 uppercase">Total Leads</div>
            <div className="text-2xl font-bold text-n-900 mt-1">{summary.total_leads}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-n-500 uppercase">Won</div>
            <div className="text-2xl font-bold text-shiroi-green mt-1">{summary.total_won}</div>
            <div className="text-xs text-n-500 mt-1">
              {summary.total_leads > 0
                ? `${Math.round((summary.total_won / summary.total_leads) * 100)}% conversion`
                : '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-n-500 uppercase">Pending Commission</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              {formatINR(summary.pending_commission)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-n-500 uppercase">Paid YTD (FY)</div>
            <div className="text-2xl font-bold text-n-900 mt-1">
              {formatINR(summary.paid_commission_ytd)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two-column grid: partner details + commission structure */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Contact Person" value={partner.contact_person} />
            <Row label="Phone" value={partner.phone} />
            <Row label="Email" value={partner.email ?? '—'} />
            <Row label="WhatsApp" value={partner.whatsapp ?? '—'} />
            <Row label="PAN" value={partner.pan_number ?? '—'} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commission</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="Type"
              value={COMMISSION_TYPE_LABELS[partner.commission_type] ?? partner.commission_type}
            />
            <Row label="Rate" value={String(partner.commission_rate)} />
            <Row label="TDS Applicable" value={partner.tds_applicable ? 'Yes (5%)' : 'No'} />
            <Row label="Agreement Start" value={formatDate(partner.agreement_start_date as string | null)} />
            <Row label="Agreement End" value={formatDate(partner.agreement_end_date as string | null)} />
            <Row
              label="Total Paid (all time)"
              value={formatINR(Number(partner.total_commission_paid ?? 0))}
            />
          </CardContent>
        </Card>
      </div>

      {/* Pending Payouts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Payouts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pendingPayouts.length === 0 ? (
            <div className="p-8 text-center text-sm text-n-500">No pending payouts</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Tranche %</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">TDS</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingPayouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{p.project_number ?? '—'}</div>
                      <div className="text-xs text-n-500">{p.customer_name ?? ''}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{p.tranche_pct}%</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatINR(Number(p.gross_amount))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-n-500">
                      {formatINR(Number(p.tds_amount))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatINR(Number(p.net_amount))}
                    </TableCell>
                    <TableCell className="text-xs text-n-500">{formatDate(p.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <MarkPayoutPaidButton payoutId={p.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Partner's leads */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leads from this partner ({leads.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <div className="p-8 text-center text-sm text-n-500">No leads yet</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">kWp</TableHead>
                  <TableHead className="text-right">Base Price</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead>Assigned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id} className="hover:bg-n-50">
                    <TableCell className="font-medium">
                      <Link
                        href={`/sales/${l.id}`}
                        className="text-shiroi-green hover:underline"
                      >
                        {l.customer_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-n-500">{l.phone}</TableCell>
                    <TableCell>
                      <Badge variant="neutral" className="text-xs">
                        {l.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {l.estimated_size_kwp ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {l.base_quote_price ? formatINR(Number(l.base_quote_price)) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {l.consultant_commission_amount
                        ? formatINR(Number(l.consultant_commission_amount))
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-n-500">
                      {l.assigned_to_name ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent paid payouts - compact */}
      {paidPayouts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Paid ({paidPayouts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Net Paid</TableHead>
                  <TableHead>Paid On</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paidPayouts.slice(0, 20).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">
                      {p.project_number ?? '—'}
                      <div className="text-xs text-n-500">{p.customer_name ?? ''}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatINR(Number(p.net_amount))}
                    </TableCell>
                    <TableCell className="text-xs text-n-500">{formatDate(p.paid_at)}</TableCell>
                    <TableCell className="text-xs text-n-500 font-mono">
                      {p.payment_reference ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-n-500">{label}</span>
      <span className="font-medium text-n-900">{value}</span>
    </div>
  );
}
