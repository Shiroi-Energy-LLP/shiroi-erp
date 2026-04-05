import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  getEmployee,
  getEmployeeCertifications,
  getLeaveRequests,
  certificationExpiryStatus,
  maskSensitiveField,
} from '@/lib/hr-queries';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
  EmptyState,
  Breadcrumb,
} from '@repo/ui';
import { Award } from 'lucide-react';
import { CompensationView } from '@/components/hr/compensation-view';
import { LeaveRequestForm } from '@/components/hr/leave-request-form';

interface EmployeeDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function EmployeeDetailPage({ params }: EmployeeDetailPageProps) {
  await requireRole(['founder', 'hr_manager']);
  const { id } = await params;

  const [employee, certifications, leaveRequests] = await Promise.all([
    getEmployee(id),
    getEmployeeCertifications(id),
    getLeaveRequests(id),
  ]);

  if (!employee) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'HR', href: '/hr' },
          { label: employee.full_name },
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1D24]">
            {employee.full_name}
          </h1>
          <p className="text-sm text-gray-500">
            {employee.employee_code} &middot; {employee.designation ?? 'No designation'} &middot; {employee.department ?? 'No department'}
          </p>
        </div>
        <Badge variant={employee.is_active ? 'default' : 'secondary'}>
          {employee.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Personal Info + Certifications */}
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
                <InfoItem label="Phone" value={employee.personal_phone} />
                <InfoItem label="Employment Type" value={employee.employment_type} />
                <InfoItem
                  label="Date of Joining"
                  value={employee.date_of_joining ? formatDate(employee.date_of_joining) : null}
                />
                {employee.last_working_day && (
                  <InfoItem
                    label="Last Working Day"
                    value={formatDate(employee.last_working_day)}
                  />
                )}
                {employee.exit_reason && (
                  <InfoItem label="Exit Reason" value={employee.exit_reason} />
                )}
                <InfoItem label="City" value={employee.city} />
                <InfoItem label="Address" value={employee.address_line1} />

                {/* Sensitive fields — masked */}
                <InfoItem label="Aadhar Number" value={maskSensitiveField(employee.aadhar_number)} />
                <InfoItem label="PAN Number" value={maskSensitiveField(employee.pan_number)} />
                <InfoItem label="Bank Account" value={maskSensitiveField(employee.bank_account_number)} />
                <InfoItem label="Bank IFSC" value={employee.bank_ifsc} />

                {/* Emergency */}
                <InfoItem label="Emergency Contact" value={employee.emergency_contact_name} />
                <InfoItem label="Emergency Phone" value={employee.emergency_contact_phone} />

                {/* Statutory */}
                <InfoItem label="ESIC Applicable" value={employee.esic_applicable ? 'Yes' : 'No'} />
                {employee.esic_number && (
                  <InfoItem label="ESIC Number" value={employee.esic_number} />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Certifications */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Certifications
                {certifications.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {certifications.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {certifications.length === 0 ? (
                <EmptyState
                  icon={<Award className="h-12 w-12" />}
                  title="No certifications"
                  description="No certifications on file for this employee."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Certification</TableHead>
                      <TableHead>Issuing Authority</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Blocks Deployment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certifications.map((cert) => {
                      const status = certificationExpiryStatus(cert.expiry_date);
                      return (
                        <TableRow key={cert.id}>
                          <TableCell className="font-medium">
                            {cert.certification_name}
                          </TableCell>
                          <TableCell>{cert.issuing_authority ?? '—'}</TableCell>
                          <TableCell>
                            {cert.issued_date ? formatDate(cert.issued_date) : '—'}
                          </TableCell>
                          <TableCell>
                            {cert.expiry_date ? formatDate(cert.expiry_date) : 'No Expiry'}
                          </TableCell>
                          <TableCell>
                            <CertStatusBadge status={status} />
                          </TableCell>
                          <TableCell>
                            {cert.blocks_deployment ? (
                              <Badge variant={status === 'red' ? 'destructive' : 'outline'}>
                                Yes
                              </Badge>
                            ) : (
                              <span className="text-gray-400">No</span>
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

          {/* Leave History — READ ONLY, no edit/delete */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Leave History
                {leaveRequests.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {leaveRequests.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {leaveRequests.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No leave requests.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead>Half Day</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Applied</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaveRequests.map((lr) => (
                      <TableRow key={lr.id}>
                        <TableCell className="capitalize">
                          {lr.leave_type.replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell>{formatDate(lr.from_date)}</TableCell>
                        <TableCell>{formatDate(lr.to_date)}</TableCell>
                        <TableCell className="text-right">{lr.days_requested}</TableCell>
                        <TableCell>
                          {lr.is_half_day ? (
                            <Badge variant="outline">
                              {lr.half_day_session === 'first_half' ? '1st Half' : '2nd Half'}
                            </Badge>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <LeaveStatusBadge status={lr.status} />
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {lr.reason ?? '—'}
                        </TableCell>
                        <TableCell>
                          {lr.applied_at ? formatDate(lr.applied_at.split('T')[0] ?? lr.applied_at) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Compensation + Leave Request Form */}
        <div className="space-y-6">
          {/* Compensation — server-gated, only for founder/hr_manager */}
          <CompensationView employeeId={id} />

          {/* Leave Request Form */}
          <LeaveRequestForm employeeId={id} />
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-medium text-[#1A1D24]">{value ?? '—'}</p>
    </div>
  );
}

function CertStatusBadge({ status }: { status: 'red' | 'amber' | 'green' | 'none' }) {
  switch (status) {
    case 'red':
      return <Badge variant="destructive">Expired / &lt;30d</Badge>;
    case 'amber':
      return <Badge variant="outline" className="text-amber-600 border-amber-300">&lt;90 days</Badge>;
    case 'green':
      return <Badge variant="default">Valid</Badge>;
    case 'none':
      return <span className="text-gray-400">No Expiry</span>;
  }
}

function LeaveStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'approved':
      return <Badge variant="default">Approved</Badge>;
    case 'rejected':
      return <Badge variant="destructive">Rejected</Badge>;
    case 'pending':
      return <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>;
    case 'cancelled':
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}
