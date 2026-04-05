import { createClient } from '@repo/supabase/server';
import { toIST } from '@repo/ui/formatters';
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
import { Wrench } from 'lucide-react';

function priorityVariant(severity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (severity) {
    case 'critical':
      return 'destructive';
    case 'high':
      return 'destructive';
    case 'medium':
      return 'outline';
    case 'low':
      return 'secondary';
    default:
      return 'outline';
  }
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'open':
      return 'outline';
    case 'in_progress':
      return 'default';
    case 'resolved':
      return 'secondary';
    case 'closed':
      return 'secondary';
    default:
      return 'outline';
  }
}

export default async function ServiceTicketsPage() {
  let tickets: Array<{
    id: string;
    ticket_number: string;
    title: string;
    severity: string;
    issue_type: string;
    status: string;
    created_at: string;
    sla_deadline: string | null;
    sla_breached: boolean;
    projects: { project_number: string; customer_name: string } | null;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('om_service_tickets')
      .select('id, ticket_number, title, severity, issue_type, status, created_at, sla_deadline, sla_breached, projects!om_service_tickets_project_id_fkey(project_number, customer_name)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ServiceTicketsPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    tickets = (data ?? []) as typeof tickets;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Service Tickets</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load service tickets.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">SERVICE TICKETS</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Service Tickets</h1>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket #</TableHead>
                <TableHead>Project / Customer</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>SLA Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<Wrench className="h-12 w-12" />}
                      title="No service tickets found"
                      description="Service tickets will appear here when issues are reported."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-mono text-sm">{ticket.ticket_number}</TableCell>
                    <TableCell className="font-medium">
                      {ticket.projects
                        ? `${ticket.projects.project_number} — ${ticket.projects.customer_name}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant(ticket.severity)}>
                        {ticket.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">
                      {ticket.issue_type?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(ticket.status)}>
                        {ticket.status?.replace(/_/g, ' ')}
                      </Badge>
                      {ticket.sla_breached && (
                        <Badge variant="destructive" className="ml-1">
                          SLA Breached
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {toIST(ticket.created_at)}
                    </TableCell>
                    <TableCell className={`text-sm ${ticket.sla_breached ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                      {ticket.sla_deadline ? toIST(ticket.sla_deadline) : '—'}
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
