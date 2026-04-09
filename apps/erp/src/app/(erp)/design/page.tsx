import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { Palette } from 'lucide-react';

function statusBadgeVariant(status: string): 'default' | 'outline' {
  return status === 'design_confirmed' ? 'default' : 'outline';
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function daysWaiting(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export default async function DesignPage() {
  const op = '[DesignPage]';

  let leads: Array<{
    id: string;
    customer_name: string;
    phone: string | null;
    city: string | null;
    segment: string | null;
    estimated_size_kwp: number | null;
    status: string;
    created_at: string;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('leads')
      .select('id, customer_name, phone, city, segment, estimated_size_kwp, status, created_at')
      .in('status', ['site_survey_done', 'design_confirmed'])
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(`${op} Query failed:`, { code: error.code, message: error.message });
      throw error;
    }
    leads = (data ?? []) as typeof leads;
  } catch {
    return (
      <div className="space-y-6">
        <div>
          <Eyebrow className="mb-1">DESIGN QUEUE</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Design Queue</h1>
        </div>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">Could not load design queue. Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalCount = leads.length;
  const surveyDoneCount = leads.filter((l) => l.status === 'site_survey_done').length;
  const designConfirmedCount = leads.filter((l) => l.status === 'design_confirmed').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">DESIGN QUEUE</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Design Queue</h1>
        <p className="text-sm text-gray-500">
          {totalCount} lead{totalCount !== 1 ? 's' : ''} awaiting design
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-medium text-[#7C818E] uppercase tracking-wide">Total in Queue</p>
            <p className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">{totalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-medium text-[#7C818E] uppercase tracking-wide">Site Survey Done</p>
            <p className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">{surveyDoneCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-medium text-[#7C818E] uppercase tracking-wide">Design Confirmed</p>
            <p className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">{designConfirmedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead className="text-right">Size (kWp)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Days Waiting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      icon={<Palette className="h-12 w-12" />}
                      title="No designs in queue"
                      description="Leads awaiting system design will appear here. Complete site surveys are required before design can begin."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => {
                  const days = daysWaiting(lead.created_at);
                  return (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">
                        <Link href={`/design/${lead.id}`} className="text-[#00B050] hover:underline">
                          {lead.customer_name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {lead.phone ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {lead.city ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {lead.segment ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {lead.estimated_size_kwp != null ? lead.estimated_size_kwp : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(lead.status)}>
                          {statusLabel(lead.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(lead.created_at.slice(0, 10))}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {days}d
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
