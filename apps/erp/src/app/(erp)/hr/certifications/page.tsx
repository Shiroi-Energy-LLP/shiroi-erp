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

function expiryStatus(expiryDate: string | null): { label: string; variant: 'default' | 'destructive' | 'outline' } {
  if (!expiryDate) return { label: 'No Expiry', variant: 'outline' };
  const now = new Date();
  const expiry = new Date(expiryDate + 'T00:00:00+05:30');
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { label: 'Expired', variant: 'destructive' };
  if (diffDays <= 90) return { label: `${diffDays}d left`, variant: 'outline' };
  return { label: 'Valid', variant: 'default' };
}

function expiryClassName(expiryDate: string | null): string {
  if (!expiryDate) return '';
  const now = new Date();
  const expiry = new Date(expiryDate + 'T00:00:00+05:30');
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'text-red-600 font-medium';
  if (diffDays <= 90) return 'text-yellow-600 font-medium';
  return 'text-green-600';
}

export default async function CertificationsPage() {
  let certifications: Array<{
    id: string;
    certification_name: string;
    issuing_authority: string;
    issued_date: string;
    expiry_date: string | null;
    is_expired: boolean;
    employees: { full_name: string } | null;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('employee_certifications')
      .select('id, certification_name, issuing_authority, issued_date, expiry_date, is_expired, employees!employee_certifications_employee_id_fkey(full_name)')
      .order('expiry_date', { ascending: true });

    if (error) {
      console.error('[CertificationsPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    certifications = (data ?? []) as typeof certifications;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Certifications</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load certifications.</p>
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
          <Link href="/hr" className="text-sm text-[#00B050] hover:underline">
            &larr; Back to HR
          </Link>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">Certifications</h1>
          <p className="text-sm text-gray-500">
            {certifications.length} certification{certifications.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Certification Name</TableHead>
                <TableHead>Issuing Body</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {certifications.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No certifications found.
                  </TableCell>
                </TableRow>
              ) : (
                certifications.map((cert) => {
                  const status = expiryStatus(cert.expiry_date);
                  return (
                    <TableRow key={cert.id}>
                      <TableCell className="font-medium">
                        {cert.employees?.full_name ?? '—'}
                      </TableCell>
                      <TableCell>{cert.certification_name}</TableCell>
                      <TableCell>{cert.issuing_authority}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(cert.issued_date)}
                      </TableCell>
                      <TableCell className={`text-sm ${expiryClassName(cert.expiry_date)}`}>
                        {cert.expiry_date ? formatDate(cert.expiry_date) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>
                          {status.label}
                        </Badge>
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
