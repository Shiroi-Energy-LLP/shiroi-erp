'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createEmployeeAccount } from '@/lib/employee-actions';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Select,
  Label,
} from '@repo/ui';
import { Copy, CheckCircle, AlertTriangle } from 'lucide-react';

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'founder', label: 'Founder' },
  { value: 'hr_manager', label: 'HR Manager' },
  { value: 'sales_engineer', label: 'Sales Engineer' },
  { value: 'designer', label: 'Designer' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'purchase_officer', label: 'Purchase Officer' },
  { value: 'site_supervisor', label: 'Site Supervisor' },
  { value: 'om_technician', label: 'O&M Technician' },
  { value: 'finance', label: 'Finance' },
];

const DEPARTMENT_OPTIONS = [
  { value: 'sales', label: 'Sales' },
  { value: 'projects', label: 'Projects' },
  { value: 'operations', label: 'Operations' },
  { value: 'finance', label: 'Finance' },
  { value: 'hr', label: 'HR' },
  { value: 'management', label: 'Management' },
  { value: 'om', label: 'O&M' },
];

export function CreateEmployeeForm() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ tempPassword: string; name: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    const res = await createEmployeeAccount({
      fullName: form.get('fullName') as string,
      email: form.get('email') as string,
      phone: form.get('phone') as string,
      role: form.get('role') as any,
      department: form.get('department') as string,
      designation: form.get('designation') as string,
      employeeCode: form.get('employeeCode') as string,
      dateOfJoining: form.get('dateOfJoining') as string,
    });

    setLoading(false);

    if (res.success && res.tempPassword) {
      setResult({
        tempPassword: res.tempPassword,
        name: form.get('fullName') as string,
      });
    } else {
      setError(res.error ?? 'Unknown error');
    }
  }

  function copyCredentials() {
    if (!result) return;
    const text = `Email: ${(document.querySelector('input[name="email"]') as HTMLInputElement)?.value}\nTemporary Password: ${result.tempPassword}\n\nPlease log in at https://erp.shiroienergy.com and change your password.`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Show success screen with temp password
  if (result) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle className="h-12 w-12 text-[#00B050]" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">
              Account Created for {result.name}
            </h2>
            <p className="text-sm text-[#7C818E]">
              Share the temporary password below with the employee. They should change it after their first login.
            </p>

            <div className="mt-2 rounded-lg border-2 border-dashed border-[#00B050] bg-[#ECFDF5] px-6 py-4 font-mono text-lg font-bold text-[#065F46] select-all">
              {result.tempPassword}
            </div>

            <div className="flex gap-3 mt-4">
              <Button variant="outline" onClick={copyCredentials} className="gap-2">
                <Copy className="h-4 w-4" />
                {copied ? 'Copied!' : 'Copy Login Details'}
              </Button>
              <Button
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                Create Another
              </Button>
              <Button variant="ghost" onClick={() => router.push('/hr/employees')}>
                Back to Employees
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Create Employee Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Row 1: Name + Email */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                name="fullName"
                required
                placeholder="e.g., Manivel Kumar"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email (login) *</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="e.g., manivel@shiroienergy.com"
              />
            </div>
          </div>

          {/* Row 2: Phone + Role */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone *</Label>
              <Input
                id="phone"
                name="phone"
                required
                placeholder="10-digit mobile number"
                maxLength={10}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Role *</Label>
              <Select id="role" name="role" required defaultValue="">
                <option value="" disabled>Select role...</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Row 3: Department + Designation */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="department">Department *</Label>
              <Select id="department" name="department" required defaultValue="">
                <option value="" disabled>Select department...</option>
                {DEPARTMENT_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="designation">Designation *</Label>
              <Input
                id="designation"
                name="designation"
                required
                placeholder="e.g., Senior Project Manager"
              />
            </div>
          </div>

          {/* Row 4: Employee Code + Date of Joining */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="employeeCode">Employee Code *</Label>
              <Input
                id="employeeCode"
                name="employeeCode"
                required
                placeholder="e.g., SE001, PM003"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateOfJoining">Date of Joining *</Label>
              <Input
                id="dateOfJoining"
                name="dateOfJoining"
                type="date"
                required
              />
            </div>
          </div>

          {/* Info note */}
          <p className="text-xs text-[#9CA0AB]">
            A temporary password will be generated automatically. Share it with the employee so they can log in. Additional details (address, bank, PAN, Aadhar) can be filled in later on the employee detail page.
          </p>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/hr/employees')}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
