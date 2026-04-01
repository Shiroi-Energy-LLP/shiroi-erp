import { createClient } from '@repo/supabase/server';
import { daysUntilPayrollExport, isCertificationExpiringSoon } from './hr-helpers';

export interface HRDashboardData {
  activeEmployeeCount: number;
  pendingLeaveCount: number;
  expiringCertCount: number;
  daysToPayroll: number;
  recentLeaveRequests: Array<{
    id: string;
    employee_name: string;
    leave_type: string;
    from_date: string;
    to_date: string;
    days_requested: number;
    status: string;
    applied_at: string;
  }>;
  certExpiryAlerts: Array<{
    id: string;
    employee_name: string;
    certification_name: string;
    expiry_date: string;
    blocks_deployment: boolean;
  }>;
  employeeId: string | null;
}

export async function getHRDashboardData(profileId: string): Promise<HRDashboardData> {
  const op = '[getHRDashboardData]';
  console.log(`${op} Starting for: ${profileId}`);

  const supabase = await createClient();

  // Get employee ID
  const { data: emp, error: empError } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .single();

  if (empError) {
    console.error(`${op} Employee lookup failed:`, { code: empError.code, message: empError.message, profileId });
  }
  const employeeId = emp?.id ?? null;

  const [
    activeEmpResult,
    pendingLeaveResult,
    recentLeavesResult,
    certsResult,
  ] = await Promise.all([
    // Active employee count
    supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),

    // Pending leave requests count
    supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Recent leave requests (last 10) with employee name
    supabase
      .from('leave_requests')
      .select('id, leave_type, from_date, to_date, days_requested, status, applied_at, employees!leave_requests_employee_id_fkey(full_name)')
      .order('applied_at', { ascending: false })
      .limit(10),

    // All certifications with expiry dates and employee names
    supabase
      .from('employee_certifications')
      .select('id, certification_name, expiry_date, blocks_deployment, employees!employee_certifications_employee_id_fkey(full_name)')
      .not('expiry_date', 'is', null)
      .order('expiry_date', { ascending: true }),
  ]);

  if (activeEmpResult.error) {
    console.error(`${op} Active employees query failed:`, { code: activeEmpResult.error.code, message: activeEmpResult.error.message });
    throw new Error(`Failed to load active employees: ${activeEmpResult.error.message}`);
  }

  if (pendingLeaveResult.error) {
    console.error(`${op} Pending leaves query failed:`, { code: pendingLeaveResult.error.code, message: pendingLeaveResult.error.message });
  }

  if (recentLeavesResult.error) {
    console.error(`${op} Recent leaves query failed:`, { code: recentLeavesResult.error.code, message: recentLeavesResult.error.message });
  }

  if (certsResult.error) {
    console.error(`${op} Certifications query failed:`, { code: certsResult.error.code, message: certsResult.error.message });
  }

  // Process leave requests
  const recentLeaveRequests = (recentLeavesResult.data ?? []).map((lr) => {
    const empData = lr.employees as { full_name: string } | null;
    return {
      id: lr.id,
      employee_name: empData?.full_name ?? 'Unknown',
      leave_type: lr.leave_type,
      from_date: lr.from_date,
      to_date: lr.to_date,
      days_requested: lr.days_requested,
      status: lr.status,
      applied_at: lr.applied_at,
    };
  });

  // Filter expiring certifications (within 30 days)
  const certExpiryAlerts = (certsResult.data ?? [])
    .filter((cert) => isCertificationExpiringSoon(cert.expiry_date))
    .map((cert) => {
      const empData = cert.employees as { full_name: string } | null;
      return {
        id: cert.id,
        employee_name: empData?.full_name ?? 'Unknown',
        certification_name: cert.certification_name,
        expiry_date: cert.expiry_date ?? '',
        blocks_deployment: cert.blocks_deployment,
      };
    });

  return {
    activeEmployeeCount: activeEmpResult.count ?? 0,
    pendingLeaveCount: pendingLeaveResult.count ?? 0,
    expiringCertCount: certExpiryAlerts.length,
    daysToPayroll: daysUntilPayrollExport(),
    recentLeaveRequests,
    certExpiryAlerts,
    employeeId,
  };
}
