import { createClient } from '@repo/supabase/server';
import { formatDate, formatINR } from '@repo/ui/formatters';
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
} from '@repo/ui';
import { CalendarCheck } from 'lucide-react';

function contractStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'expired':
      return 'destructive';
    case 'draft':
      return 'outline';
    case 'cancelled':
      return 'secondary';
    default:
      return 'outline';
  }
}

export default async function AmcPage() {
  let contracts: Array<{
    id: string;
    contract_number: string;
    contract_type: string;
    start_date: string;
    end_date: string;
    annual_value: number;
    status: string;
    visits_included: number;
    projects: { project_number: string; customer_name: string } | null;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('om_contracts')
      .select('id, contract_number, contract_type, start_date, end_date, annual_value, status, visits_included, projects!om_contracts_project_id_fkey(project_number, customer_name)')
      .order('start_date', { ascending: false });

    if (error) {
      console.error('[AmcPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    contracts = (data ?? []) as typeof contracts;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">AMC Contracts</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load AMC contracts.</p>
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
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">AMC Contracts</h1>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Contract Type</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Annual Value</TableHead>
                <TableHead>Visits Included</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<CalendarCheck className="h-12 w-12" />}
                      title="No AMC contracts found"
                      description="AMC contracts will appear here once created for commissioned projects."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                contracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">
                      {contract.projects
                        ? `${contract.projects.project_number} — ${contract.projects.customer_name}`
                        : '—'}
                    </TableCell>
                    <TableCell className="capitalize">
                      {contract.contract_type?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(contract.start_date)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(contract.end_date)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatINR(contract.annual_value)}
                    </TableCell>
                    <TableCell>{contract.visits_included}</TableCell>
                    <TableCell>
                      <Badge variant={contractStatusVariant(contract.status)}>
                        {contract.status}
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
