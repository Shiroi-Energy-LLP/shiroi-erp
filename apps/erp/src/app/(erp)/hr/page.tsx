import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getEmployees, isCertificationExpiringSoon } from '@/lib/hr-queries';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
  Eyebrow,
  EmptyState,
} from '@repo/ui';
import { UserCog } from 'lucide-react';

export default async function HRListPage() {
  await requireRole(['founder', 'hr_manager']);
  const employees = await getEmployees();

  const activeCount = employees.filter((e) => e.is_active).length;
  const certWarnings = employees.filter((e) =>
    e.employee_certifications?.some(
      (c) => c.blocks_deployment && isCertificationExpiringSoon(c.expiry_date),
    ),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">HR OVERVIEW</Eyebrow>
          <h1 className="text-2xl font-bold text-[#1A1D24]">HR Master</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/hr/payroll">
            <Button variant="outline">Payroll Export</Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Active Employees</p>
            <p className="text-2xl font-bold text-[#1A1D24]">{activeCount}</p>
            <p className="text-xs text-gray-400 mt-1">
              {employees.length - activeCount} inactive
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Certification Warnings</p>
            <p className={`text-2xl font-bold ${certWarnings.length > 0 ? 'text-red-600' : 'text-green-700'}`}>
              {certWarnings.length}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Blocking certifications expiring within 30 days
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Total Employees</p>
            <p className="text-2xl font-bold text-[#1A1D24]">{employees.length}</p>
            <p className="text-xs text-gray-400 mt-1">All time</p>
          </CardContent>
        </Card>
      </div>

      {/* Employee Table */}
      <Card>
        <CardHeader>
          <CardTitle>Employees</CardTitle>
        </CardHeader>
        <CardContent>
          {employees.length === 0 ? (
            <EmptyState
              icon={<UserCog className="h-12 w-12" />}
              title="No employees found"
              description="Add employees to start managing your team."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Joining Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cert Warnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => {
                  const hasCertWarning = emp.employee_certifications?.some(
                    (c) => c.blocks_deployment && isCertificationExpiringSoon(c.expiry_date),
                  );
                  return (
                    <TableRow key={emp.id}>
                      <TableCell>
                        <Link
                          href={`/hr/${emp.id}`}
                          className="text-[#00B050] hover:underline font-medium"
                        >
                          {emp.employee_code}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">{emp.full_name}</TableCell>
                      <TableCell>{emp.designation ?? '—'}</TableCell>
                      <TableCell>{emp.department ?? '—'}</TableCell>
                      <TableCell>
                        {emp.date_of_joining ? formatDate(emp.date_of_joining) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={emp.is_active ? 'default' : 'secondary'}>
                          {emp.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {hasCertWarning ? (
                          <Badge variant="destructive">Expiring</Badge>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
