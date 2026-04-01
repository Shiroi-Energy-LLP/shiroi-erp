import Link from 'next/link';
import { getProposals } from '@/lib/proposals-queries';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { formatINR, toIST, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import type { Database } from '@repo/types/database';

type ProposalStatus = Database['public']['Enums']['proposal_status'];

const STATUS_OPTIONS: { value: ProposalStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'superseded', label: 'Superseded' },
];

interface ProposalsPageProps {
  searchParams: Promise<{
    status?: string;
    search?: string;
  }>;
}

export default async function ProposalsPage({ searchParams }: ProposalsPageProps) {
  const params = await searchParams;
  const proposals = await getProposals({
    status: (params.status as ProposalStatus) || undefined,
    search: params.search || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Proposals</h1>
        <Link href="/proposals/new">
          <Button>New Proposal</Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-4">
            <Select name="status" defaultValue={params.status ?? ''} className="w-44">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search proposal # or customer..."
              className="w-72"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {(params.status || params.search) && (
              <Link href="/proposals">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proposal #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>System</TableHead>
                <TableHead className="text-right">Size (kWp)</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Valid Until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No proposals found.
                  </TableCell>
                </TableRow>
              ) : (
                proposals.map((proposal) => {
                  const isExpiringSoon = proposal.valid_until &&
                    new Date(proposal.valid_until) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) &&
                    proposal.status === 'sent';

                  return (
                    <TableRow key={proposal.id}>
                      <TableCell>
                        <Link
                          href={`/proposals/${proposal.id}`}
                          className="text-[#00B050] hover:underline font-medium font-mono text-sm"
                        >
                          {proposal.proposal_number}
                        </Link>
                        {proposal.revision_number > 1 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (Rev {proposal.revision_number})
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{proposal.leads?.customer_name ?? '—'}</TableCell>
                      <TableCell className="capitalize text-sm">
                        {proposal.system_type.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {proposal.system_size_kwp}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatINR(proposal.total_after_discount)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={proposal.gross_margin_pct < 15 ? 'text-[#991B1B]' : 'text-[#065F46]'}>
                          {proposal.gross_margin_pct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <ProposalStatusBadge status={proposal.status} />
                        {proposal.margin_approval_required && !proposal.margin_approved_by && (
                          <span className="ml-1 text-xs text-[#9A3412]" title="Margin approval needed">
                            !
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {toIST(proposal.created_at)}
                      </TableCell>
                      <TableCell className={`text-sm ${isExpiringSoon ? 'text-[#991B1B] font-medium' : 'text-muted-foreground'}`}>
                        {formatDate(proposal.valid_until)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
