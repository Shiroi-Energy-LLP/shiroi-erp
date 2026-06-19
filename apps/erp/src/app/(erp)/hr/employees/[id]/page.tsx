import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getEmployee, getLeaveBalances } from '@/lib/hr-queries';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Breadcrumb,
} from '@repo/ui';
import { SensitiveField } from '@/components/hr/sensitive-field';
import { CompensationView } from '@/components/hr/compensation-view';

interface EmployeeProfilePageProps {
  params: Promise<{ id: string }>;
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: 'Casual Leave',
  sick: 'Sick Leave',
  earned: 'Earned Leave',
  maternity: 'Maternity Leave',
  paternity: 'Paternity Leave',
  compensatory: 'Comp Off',
  loss_of_pay: 'Loss of Pay',
  other: 'Other',
};

export default async function EmployeeProfilePage({ params }: EmployeeProfilePageProps) {
  await requireRole(['founder', 'hr_manager']);
  const { id } = await params;

  const [employee, balances] = await Promise.all([
    getEmployee(id),
    getLeaveBalances(id).catch(() => []),
  ]);

  if (!employee) notFound();

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'HR', href: '/hr' },
          { label: 'Employees', href: '/hr/employees' },
          { label: employee.full_name },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-n-950">{employee.full_name}</h1>
          <p className="text-sm text-gray-500">
            {employee.employee_code} &middot; {employee.designation ?? 'No designation'} &middot; {employee.department ?? 'No department'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={employee.is_active ? 'default' : 'secondary'}>
            {employee.is_active ? 'Active' : 'Inactive'}
          </Badge>
          <Link
            href={`/hr/${id}`}
            className="text-sm text-shiroi-gold-dark hover:underline"
          >
            Full Detail &rarr;
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Personal + Contact */}
        <div className="lg:col-span-2 space-y-6">
          {/* Personal Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoItem label="Employee Code" value={employee.employee_code} />
                <InfoItem label="Full Name" value={employee.full_name} />
                <InfoItem label="Gender" value={employee.gender} />
                <InfoItem
                  label="Date of Birth"
                  value={employee.date_of_birth ? formatDate(employee.date_of_birth) : null}
                />
                <InfoItem
                  label="Date of Joining"
                  value={employee.date_of_joining ? formatDate(employee.date_of_joining) : null}
                />
                <InfoItem label="Employment Type" value={employee.employment_type} />
                <InfoItem label="Department" value={employee.department} />
                <InfoItem label="Designation" value={employee.designation} />
                <InfoItem label="Blood Group" value={employee.blood_group} />
              </div>
            </CardContent>
          </Card>

          {/* Contact & Address */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact & Address</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoItem label="Personal Phone" value={employee.personal_phone} />
                <InfoItem label="WhatsApp" value={employee.whatsapp_number} />
                <InfoItem label="Emergency Contact" value={employee.emergency_contact_name} />
                <InfoItem label="Emergency Phone" value={employee.emergency_contact_phone} />
                <InfoItem label="Address" value={employee.address_line1} />
                <InfoItem label="City" value={employee.city} />
              </div>
            </CardContent>
          </Card>

          {/* Sensitive — Bank + ID */}
          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader>
              <CardTitle className="text-base text-amber-800">
                Bank & Identity Details
                <span className="text-xs font-normal text-amber-600 ml-2">(HR / Founder only)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Aadhar Number</p>
                  <SensitiveField value={employee.aadhar_number} maskPartial />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">PAN Number</p>
                  <SensitiveField value={employee.pan_number} maskPartial />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Bank Account Number</p>
                  <SensitiveField value={employee.bank_account_number} maskPartial />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Bank IFSC</p>
                  <p className="text-sm font-medium text-n-950">{employee.bank_ifsc ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Bank Name</p>
                  <p className="text-sm font-medium text-n-950">{employee.bank_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">ESIC Number</p>
                  <p className="text-sm font-medium text-n-950">{employee.esic_number ?? '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right — Leave Balances + Compensation */}
        <div className="space-y-6">
          {/* Leave Balances */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leave Balances</CardTitle>
            </CardHeader>
            <CardContent>
              {balances.length === 0 ? (
                <p className="text-sm text-gray-500">No leave balances on record.</p>
              ) : (
                <div className="space-y-2">
                  {balances.map((b) => (
                    <div key={b.leave_type} className="flex justify-between items-center py-1.5 border-b last:border-0">
                      <span className="text-sm text-gray-700">
                        {LEAVE_TYPE_LABELS[b.leave_type] ?? b.leave_type}
                      </span>
                      <span className={`text-sm font-semibold ${Number(b.balance_days) > 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {b.balance_days} days
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Compensation — server-gated */}
          <CompensationView employeeId={id} />
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-medium text-n-950">{value ?? '—'}</p>
    </div>
  );
}
