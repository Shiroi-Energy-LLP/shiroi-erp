import Link from 'next/link';
import { getLeads } from '@/lib/leads-queries';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { toIST } from '@repo/ui/formatters';
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

type LeadStatus = Database['public']['Enums']['lead_status'];
type LeadSource = Database['public']['Enums']['lead_source'];

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'site_survey_scheduled', label: 'Survey Scheduled' },
  { value: 'site_survey_done', label: 'Survey Done' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'disqualified', label: 'Disqualified' },
];

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'builder_tie_up', label: 'Builder Tie-up' },
  { value: 'channel_partner', label: 'Channel Partner' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'walkin', label: 'Walk-in' },
];

interface LeadsPageProps {
  searchParams: Promise<{
    status?: string;
    source?: string;
    search?: string;
  }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const leads = await getLeads({
    status: (params.status as LeadStatus) || undefined,
    source: (params.source as LeadSource) || undefined,
    search: params.search || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Leads</h1>
        <Link href="/leads/new">
          <Button>New Lead</Button>
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
            <Select name="source" defaultValue={params.source ?? ''} className="w-44">
              <option value="">All Sources</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search name or phone..."
              className="w-60"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {(params.status || params.source || params.search) && (
              <Link href="/leads">
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
                <TableHead>Customer Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No leads found.
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-[#00B050] hover:underline font-medium"
                      >
                        {lead.customer_name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{lead.phone}</TableCell>
                    <TableCell>{lead.city}</TableCell>
                    <TableCell className="capitalize">{lead.source?.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      <LeadStatusBadge status={lead.status} />
                    </TableCell>
                    <TableCell>{lead.employees?.full_name ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {toIST(lead.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
