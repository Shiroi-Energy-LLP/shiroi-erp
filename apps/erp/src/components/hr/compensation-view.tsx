/**
 * Compensation View — SERVER COMPONENT.
 *
 * Role-gated at the server level: only renders compensation data
 * if the authenticated user is founder or hr_manager.
 * If unauthorized, renders nothing.
 *
 * SECURITY: No salary amounts are logged. No client-side role checks.
 */

import { getUserProfile } from '@/lib/auth';
import { getEmployeeCompensation } from '@/lib/hr-queries';
import { formatINR } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@repo/ui';

interface CompensationViewProps {
  employeeId: string;
}

export async function CompensationView({ employeeId }: CompensationViewProps) {
  const profile = await getUserProfile();
  if (!profile) return null;

  // Server-side role gate — only founder and hr_manager see compensation
  const allowedRoles: string[] = ['founder', 'hr_manager'];
  if (!allowedRoles.includes(profile.role)) return null;

  const compensation = await getEmployeeCompensation(employeeId);
  if (!compensation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compensation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">No compensation record found.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Compensation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {/* Earnings */}
          <CompItem label="Basic Salary" value={compensation.basic_salary} />
          <CompItem label="HRA" value={compensation.hra} />
          <CompItem label="Special Allowance" value={compensation.special_allowance} />
          <CompItem label="Travel Allowance" value={compensation.travel_allowance} />
          <CompItem label="Other Allowances" value={compensation.other_allowances} />
          <CompItem label="Variable Pay" value={compensation.variable_pay} />

          {/* Gross */}
          <div className="col-span-full border-t pt-3 mt-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Gross Monthly</span>
              <span className="text-base font-bold text-n-900">
                {formatINR(compensation.gross_monthly)}
              </span>
            </div>
          </div>

          {/* Deductions */}
          <div className="col-span-full border-t pt-3 mt-2">
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide">Deductions</p>
          </div>
          <CompItem label="PF (Employee)" value={compensation.pf_employee} isDeduction />
          <CompItem label="PF (Employer)" value={compensation.pf_employer} isDeduction />
          <CompItem label="ESIC (Employee)" value={compensation.esic_employee} isDeduction />
          <CompItem label="ESIC (Employer)" value={compensation.esic_employer} isDeduction />
          <CompItem label="Professional Tax" value={compensation.professional_tax} isDeduction />

          {/* Net */}
          <div className="col-span-full border-t pt-3 mt-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Net Take-Home</span>
              <span className="text-base font-bold text-green-700">
                {formatINR(compensation.net_take_home)}
              </span>
            </div>
          </div>

          {/* CTC */}
          <div className="col-span-full border-t pt-3 mt-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">CTC Monthly</span>
              <span className="text-sm font-medium text-n-900">
                {formatINR(compensation.ctc_monthly)}
              </span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-sm font-semibold text-gray-700">CTC Annual</span>
              <span className="text-base font-bold text-n-900">
                {formatINR(compensation.ctc_annual)}
              </span>
            </div>
          </div>

          {/* Effective period */}
          <div className="col-span-full border-t pt-3 mt-2">
            <p className="text-xs text-gray-400">
              Effective from: {compensation.effective_from}
              {compensation.effective_until ? ` — until: ${compensation.effective_until}` : ' (current)'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CompItem({
  label,
  value,
  isDeduction = false,
}: {
  label: string;
  value: number;
  isDeduction?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-sm font-medium ${isDeduction ? 'text-red-600' : 'text-n-900'}`}>
        {formatINR(value)}
      </p>
    </div>
  );
}
