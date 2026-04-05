import Link from 'next/link';
import { getEmployees } from '@/lib/hr-queries';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
} from '@repo/ui';
import { UserCog } from 'lucide-react';
import { DeactivateEmployeeButton } from '@/components/hr/deactivate-employee-button';

export default async function EmployeesPage() {
  let employees: Awaited<ReturnType<typeof getEmployees>> = [];

  try {
    employees = await getEmployees();
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Employees</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load employees.</p>
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
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">Employees</h1>
        </div>
        <Link href="/hr/employees/new">
          <Button>New Employee</Button>
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {employees.length} employee{employees.length !== 1 ? 's' : ''} total
          </p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Employment Type</TableHead>
                <TableHead>Date of Joining</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      icon={<UserCog className="h-12 w-12" />}
                      title="No employees found"
                      description="Add employees to start managing your team."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                employees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-mono text-sm">{emp.employee_code}</TableCell>
                    <TableCell>
                      <Link
                        href={`/hr/${emp.id}`}
                        className="text-[#00B050] hover:underline font-medium"
                      >
                        {emp.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>{emp.designation ?? '—'}</TableCell>
                    <TableCell>{emp.department ?? '—'}</TableCell>
                    <TableCell className="capitalize">
                      {emp.employment_type?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {emp.date_of_joining ? formatDate(emp.date_of_joining) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={emp.is_active ? 'default' : 'secondary'}>
                        {emp.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DeactivateEmployeeButton
                        employeeId={emp.id}
                        employeeName={emp.full_name}
                        isActive={emp.is_active}
                      />
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
