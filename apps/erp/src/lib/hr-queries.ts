import { createClient } from '@repo/supabase/server';
import { getUserProfile } from './auth';

// Re-export helpers for convenience
export {
  daysUntilPayrollExport,
  isCertificationExpiringSoon,
  certificationExpiryStatus,
  generatePayrollFilename,
  maskSensitiveField,
} from './hr-helpers';

/**
 * Fetches all employees with their certifications and leave request counts.
 * Used on the HR list page.
 */
export async function getEmployees() {
  const op = '[getEmployees]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('employees')
    .select(
      'id, employee_code, full_name, designation, department, employment_type, date_of_joining, last_working_day, is_active, employee_certifications(id, certification_name, expiry_date, is_expired, blocks_deployment)',
    )
    .order('employee_code', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch employees: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Fetches a single employee's full detail.
 * Sensitive fields (aadhar, pan, bank) are included but should be masked at display level.
 */
export async function getEmployee(id: string) {
  const op = '[getEmployee]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('employees')
    .select(
      'id, employee_code, full_name, designation, department, employment_type, date_of_joining, last_working_day, is_active, gender, date_of_birth, personal_phone, address_line1, address_line2, city, aadhar_number, pan_number, bank_account_number, bank_ifsc, emergency_contact_name, emergency_contact_phone, esic_applicable, esic_number, exit_reason, profile_id, created_at',
    )
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, employeeId: id });
    throw new Error(`Failed to fetch employee: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found:`, { employeeId: id });
    return null;
  }

  return data;
}

/**
 * Fetches certifications for an employee with expiry status.
 */
export async function getEmployeeCertifications(employeeId: string) {
  const op = '[getEmployeeCertifications]';
  console.log(`${op} Starting for: ${employeeId}`);
  if (!employeeId) throw new Error(`${op} Missing required parameter: employeeId`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('employee_certifications')
    .select(
      'id, certification_name, issuing_authority, issued_date, expiry_date, certificate_number, certificate_storage_path, is_expired, blocks_deployment, notes, created_at, updated_at',
    )
    .eq('employee_id', employeeId)
    .order('expiry_date', { ascending: true, nullsFirst: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, employeeId });
    throw new Error(`Failed to fetch certifications: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Fetches leave requests for an employee.
 */
export async function getLeaveRequests(employeeId: string) {
  const op = '[getLeaveRequests]';
  console.log(`${op} Starting for: ${employeeId}`);
  if (!employeeId) throw new Error(`${op} Missing required parameter: employeeId`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('leave_requests')
    .select(
      'id, leave_type, from_date, to_date, days_requested, is_half_day, half_day_session, reason, status, approved_by, approved_at, rejected_reason, backup_assigned_to, applied_at, created_at',
    )
    .eq('employee_id', employeeId)
    .order('from_date', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, employeeId });
    throw new Error(`Failed to fetch leave requests: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Fetches employee compensation data — ROLE-GATED.
 * Only returns data if the caller is founder, hr_manager, or the employee themselves.
 * Returns null if unauthorized (does NOT throw — caller renders nothing).
 *
 * SECURITY: No salary amounts are logged anywhere in this function.
 */
export async function getEmployeeCompensation(employeeId: string) {
  const op = '[getEmployeeCompensation]';
  console.log(`${op} Starting for employee (role check in progress)`);
  if (!employeeId) throw new Error(`${op} Missing required parameter: employeeId`);

  const profile = await getUserProfile();
  if (!profile) {
    console.warn(`${op} No authenticated profile`);
    return null;
  }

  // Role gate: only founder, hr_manager, or self
  const allowedRoles: string[] = ['founder', 'hr_manager'];
  const isSelf = profile.id === employeeId;
  if (!allowedRoles.includes(profile.role) && !isSelf) {
    console.warn(`${op} Access denied: role=${profile.role}, isSelf=${isSelf}`);
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('employee_compensation')
    .select(
      'id, employee_id, basic_salary, hra, special_allowance, travel_allowance, other_allowances, variable_pay, gross_monthly, pf_employee, pf_employer, esic_employee, esic_employer, professional_tax, net_take_home, ctc_monthly, ctc_annual, effective_from, effective_until, is_current, set_by, created_at',
    )
    .eq('employee_id', employeeId)
    .eq('is_current', true)
    .single();

  if (error) {
    // Do NOT log any salary-related data
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return null;
  }
  if (!data) {
    console.warn(`${op} No current compensation found`);
    return null;
  }

  return data;
}

/**
 * Fetches all active employees with current compensation for payroll export.
 * ROLE-GATED: only founder or hr_manager.
 *
 * SECURITY: No salary amounts are logged anywhere in this function.
 */
export async function getPayrollData(year: number, month: number) {
  const op = '[getPayrollData]';
  console.log(`${op} Starting for: ${year}-${String(month).padStart(2, '0')}`);

  const profile = await getUserProfile();
  if (!profile) {
    console.warn(`${op} No authenticated profile`);
    return null;
  }

  const allowedRoles: string[] = ['founder', 'hr_manager'];
  if (!allowedRoles.includes(profile.role)) {
    console.warn(`${op} Access denied: role=${profile.role}`);
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('employees')
    .select(
      'id, employee_code, full_name, esic_number, employee_compensation!employee_compensation_employee_id_fkey!inner(basic_salary, hra, special_allowance, travel_allowance, other_allowances, variable_pay, pf_employee, esic_employee, professional_tax)',
    )
    .eq('is_active', true)
    .eq('employee_compensation.is_current', true)
    .order('employee_code', { ascending: true });

  if (error) {
    // Do NOT log any salary-related data
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch payroll data: ${error.message}`);
  }

  return data ?? [];
}
