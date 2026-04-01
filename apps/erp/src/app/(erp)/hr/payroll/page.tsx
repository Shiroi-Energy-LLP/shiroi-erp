import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from '@repo/ui';
import { PayrollExportForm } from '@/components/hr/payroll-export-form';

export default async function PayrollExportPage() {
  await requireRole(['founder', 'hr_manager']);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/hr" className="text-sm text-[#00B050] hover:underline">
            &larr; Back to HR
          </Link>
          <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">Payroll Export</h1>
          <p className="text-sm text-gray-500">
            Generate Zoho-compatible CSV for monthly payroll processing
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate Payroll CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <PayrollExportForm
            defaultYear={currentYear}
            defaultMonth={currentMonth}
          />
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-gray-600">
            The CSV includes all active employees with current compensation records.
          </p>
          <p className="text-sm text-gray-600">
            Column order matches Zoho Payroll import format: employee_id, full_name, uan_number,
            esic_number, paid_days, lop_days, basic_salary, hra, special_allowance,
            travel_allowance, other_allowances, variable_pay, one_time_additions,
            one_time_deductions, pf_employee, esic_employee, professional_tax, remarks.
          </p>
          <p className="text-sm text-gray-500 italic">
            Standard schedule: export generated on 25th of every month.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
