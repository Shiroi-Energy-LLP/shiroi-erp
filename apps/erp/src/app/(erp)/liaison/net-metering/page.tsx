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
} from '@repo/ui';

function ceigVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'approved':
      return 'default';
    case 'pending':
      return 'outline';
    case 'rejected':
      return 'destructive';
    case 'not_required':
      return 'secondary';
    case 'applied':
      return 'outline';
    default:
      return 'outline';
  }
}

function netMeterVariant(installed: boolean): 'default' | 'outline' {
  return installed ? 'default' : 'outline';
}

export default async function NetMeteringPage() {
  let applications: Array<{
    id: string;
    discom_name: string;
    discom_application_number: string | null;
    discom_application_date: string | null;
    ceig_status: string;
    discom_status: string;
    net_meter_installed: boolean;
    projects: { project_number: string; customer_name: string } | null;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('net_metering_applications')
      .select('id, discom_name, discom_application_number, discom_application_date, ceig_status, discom_status, net_meter_installed, projects!net_metering_applications_project_id_fkey(project_number, customer_name)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[NetMeteringPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    applications = (data ?? []) as typeof applications;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Net Metering Applications</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load net metering applications.</p>
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
          <Link href="/liaison" className="text-sm text-[#00B050] hover:underline">
            &larr; Back to Liaison
          </Link>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">Net Metering Applications</h1>
          <p className="text-sm text-gray-500">
            {applications.length} application{applications.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Application #</TableHead>
                <TableHead>DISCOM</TableHead>
                <TableHead>Application Date</TableHead>
                <TableHead>CEIG Status</TableHead>
                <TableHead>Net Meter Status</TableHead>
                <TableHead>Current Stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No net metering applications found.
                  </TableCell>
                </TableRow>
              ) : (
                applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">
                      {app.projects
                        ? `${app.projects.project_number} — ${app.projects.customer_name}`
                        : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {app.discom_application_number ?? '—'}
                    </TableCell>
                    <TableCell>{app.discom_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {app.discom_application_date ? formatDate(app.discom_application_date) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ceigVariant(app.ceig_status)}>
                        {app.ceig_status?.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={netMeterVariant(app.net_meter_installed)}>
                        {app.net_meter_installed ? 'Installed' : 'Pending'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {app.discom_status?.replace(/_/g, ' ')}
                      </Badge>
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
