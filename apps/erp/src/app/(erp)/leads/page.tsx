import Link from 'next/link';
import { getLeads, getSalesEngineers } from '@/lib/leads-queries';
import { LeadsTable } from '@/components/leads/leads-table';
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  Pagination,
} from '@repo/ui';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];
type LeadSource = Database['public']['Enums']['lead_source'];
type CustomerSegment = Database['public']['Enums']['customer_segment'];

const STATUS_OPTIONS: { value: LeadStatus | 'converted'; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'site_survey_scheduled', label: 'Survey Scheduled' },
  { value: 'site_survey_done', label: 'Survey Done' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'design_confirmed', label: 'Design Confirmed' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'converted', label: 'Converted (Projects)' },
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

const SEGMENT_OPTIONS: { value: CustomerSegment; label: string }[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
];

interface LeadsPageProps {
  searchParams: Promise<{
    status?: string;
    source?: string;
    segment?: string;
    assigned_to?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const [result, employees] = await Promise.all([
    getLeads({
      status: (params.status as LeadStatus) || undefined,
      source: (params.source as LeadSource) || undefined,
      segment: (params.segment as CustomerSegment) || undefined,
      assignedTo: params.assigned_to || undefined,
      search: params.search || undefined,
      includeConverted: params.status === 'converted',
      page,
      pageSize: 50,
    }),
    getSalesEngineers(),
  ]);

  const filterParams: Record<string, string> = {};
  if (params.status) filterParams.status = params.status;
  if (params.source) filterParams.source = params.source;
  if (params.segment) filterParams.segment = params.segment;
  if (params.assigned_to) filterParams.assigned_to = params.assigned_to;
  if (params.search) filterParams.search = params.search;

  const hasFilters = Object.keys(filterParams).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Leads</h1>
        <Link href="/leads/new">
          <Button>New Lead</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-4">
          <form className="flex flex-wrap items-center gap-3">
            <Select name="status" defaultValue={params.status ?? ''} className="w-40">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="source" defaultValue={params.source ?? ''} className="w-40">
              <option value="">All Sources</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="segment" defaultValue={params.segment ?? ''} className="w-40">
              <option value="">All Segments</option>
              {SEGMENT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="assigned_to" defaultValue={params.assigned_to ?? ''} className="w-44">
              <option value="">All Assignees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search name or phone..."
              className="w-56"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {hasFilters && (
              <Link href="/leads">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <LeadsTable leads={result.data} employees={employees} />
          <Pagination
            currentPage={result.page}
            totalPages={result.totalPages}
            totalRecords={result.total}
            pageSize={result.pageSize}
            basePath="/leads"
            searchParams={filterParams}
            entityName="leads"
          />
        </CardContent>
      </Card>
    </div>
  );
}
