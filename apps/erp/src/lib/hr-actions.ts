'use server';

import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { getUserProfile } from '@/lib/auth';
import { getAttendanceExportData } from '@/lib/hr-queries';

// ---------------------------------------------------------------------------
// C5 — Leave Management
// ---------------------------------------------------------------------------

/**
 * Approve a pending leave request.
 * Role-gated: founder + hr_manager only.
 * On approval, inserts a debit entry into leave_ledger and refreshes leave_balances.
 * SECURITY: No salary amounts involved; leave days are not sensitive.
 */
export async function approveLeaveRequest(
  requestId: string,
): Promise<ActionResult<void>> {
  const op = '[approveLeaveRequest]';

  if (!requestId) return err('Request ID is required');

  // Auth gate — RPC also enforces role, but reject anon callers early.
  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');

  const supabase = await createClient();

  // Atomic: fn_approve_leave_request (mig 136) wraps the 3-step flow
  // (update request + insert ledger + refresh balance via trigger) in a
  // single transaction so a partial failure can't corrupt leave state.
  const { error: rpcErr } = await supabase.rpc('fn_approve_leave_request', {
    p_request_id: requestId,
  });

  if (rpcErr) {
    console.error(`${op} RPC failed`, {
      requestId,
      code: rpcErr.code,
      message: rpcErr.message,
      timestamp: new Date().toISOString(),
    });
    return err(rpcErr.message, rpcErr.code);
  }

  revalidatePath('/hr/leave');
  return ok(undefined);
}

/**
 * Reject a pending leave request.
 * Role-gated: founder + hr_manager only.
 */
export async function rejectLeaveRequest(
  requestId: string,
  reason: string,
): Promise<ActionResult<void>> {
  const op = '[rejectLeaveRequest]';
  console.log(`${op} Starting for request: ${requestId}`);

  if (!requestId) return err('Request ID is required');
  if (!reason?.trim()) return err('Rejection reason is required');

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');

  const allowedRoles: string[] = ['founder', 'hr_manager'];
  if (!allowedRoles.includes(profile.role)) {
    console.warn(`${op} Access denied: role=${profile.role}`);
    return err('Only HR manager or founder can reject leave requests');
  }

  const supabase = await createClient();

  const { data: request, error: fetchError } = await supabase
    .from('leave_requests')
    .select('id, status')
    .eq('id', requestId)
    .single();

  if (fetchError || !request) {
    console.error(`${op} Fetch failed:`, { code: fetchError?.code, message: fetchError?.message });
    return err('Leave request not found');
  }

  if (request.status !== 'pending') {
    return err(`Cannot reject a request with status: ${request.status}`);
  }

  const { error: updateError } = await supabase
    .from('leave_requests')
    .update({
      status: 'rejected',
      rejected_reason: reason.trim(),
    })
    .eq('id', requestId)
    .eq('status', 'pending');

  if (updateError) {
    console.error(`${op} Update failed:`, { code: updateError.code, message: updateError.message });
    return err(`Failed to reject leave request: ${updateError.message}`);
  }

  revalidatePath('/hr/leave');
  console.log(`${op} Rejected request: ${requestId}`);
  return ok(undefined);
}

/**
 * Cancel a pending leave request.
 * Employees can cancel their own pending requests.
 * HR/founder can cancel any pending request.
 */
export async function cancelLeaveRequest(
  requestId: string,
): Promise<ActionResult<void>> {
  const op = '[cancelLeaveRequest]';
  console.log(`${op} Starting for request: ${requestId}`);

  if (!requestId) return err('Request ID is required');

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');

  const supabase = await createClient();

  // Fetch request — RLS will enforce visibility
  const { data: request, error: fetchError } = await supabase
    .from('leave_requests')
    .select('id, employee_id, status')
    .eq('id', requestId)
    .single();

  if (fetchError || !request) {
    console.error(`${op} Fetch failed:`, { code: fetchError?.code, message: fetchError?.message });
    return err('Leave request not found');
  }

  if (request.status !== 'pending') {
    return err(`Cannot cancel a request with status: ${request.status}`);
  }

  // Verify ownership unless HR/founder
  const hrRoles: string[] = ['founder', 'hr_manager'];
  if (!hrRoles.includes(profile.role)) {
    const { data: myEmployee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', profile.id)
      .single();

    if (!myEmployee || myEmployee.id !== request.employee_id) {
      console.warn(`${op} Access denied: not own request`);
      return err('You can only cancel your own leave requests');
    }
  }

  const { error: updateError } = await supabase
    .from('leave_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .eq('status', 'pending');

  if (updateError) {
    console.error(`${op} Update failed:`, { code: updateError.code, message: updateError.message });
    return err(`Failed to cancel leave request: ${updateError.message}`);
  }

  revalidatePath('/hr/leave');
  revalidatePath(`/hr/${request.employee_id}`);
  console.log(`${op} Cancelled request: ${requestId}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// C7 — Attendance Tracking
// ---------------------------------------------------------------------------

type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'work_from_home';

// Statuses an employee can mark for themselves (less privileged set)
const SELF_MARK_STATUSES: AttendanceStatus[] = ['present', 'work_from_home', 'half_day'];

interface MarkAttendanceInput {
  employeeId: string;
  date: string;          // 'YYYY-MM-DD'
  status: AttendanceStatus;
  checkInTime?: string;  // 'HH:MM'
  checkOutTime?: string; // 'HH:MM'
  notes?: string;
}

/**
 * Mark attendance for a single employee on a specific date.
 * HR/founder can mark any status for any employee.
 * Employees can mark their own as present/wfh/half_day only.
 */
export async function markAttendance(
  input: MarkAttendanceInput,
): Promise<ActionResult<void>> {
  const op = '[markAttendance]';
  console.log(`${op} Starting for employee: ${input.employeeId}, date: ${input.date}`);

  if (!input.employeeId) return err('Employee ID is required');
  if (!input.date) return err('Date is required');
  if (!input.status) return err('Status is required');

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');

  const supabase = await createClient();
  const hrRoles: string[] = ['founder', 'hr_manager'];
  const isHR = hrRoles.includes(profile.role);

  // If not HR, resolve and check own employee ID
  let markerEmployeeId: string | null = null;
  if (!isHR) {
    const { data: myEmployee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', profile.id)
      .single();

    if (!myEmployee) return err('Could not resolve employee record');
    markerEmployeeId = myEmployee.id;

    if (myEmployee.id !== input.employeeId) {
      return err('You can only mark your own attendance');
    }

    if (!SELF_MARK_STATUSES.includes(input.status)) {
      return err(`Employees can only mark: ${SELF_MARK_STATUSES.join(', ')}`);
    }
  }

  // Resolve marker employee ID for HR
  if (isHR && !markerEmployeeId) {
    const { data: hrEmployee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', profile.id)
      .single();
    markerEmployeeId = hrEmployee?.id ?? null;
  }

  const { error: upsertError } = await supabase
    .from('attendance')
    .upsert(
      {
        id: crypto.randomUUID(),
        employee_id: input.employeeId,
        date: input.date,
        status: input.status,
        check_in_time: input.checkInTime ?? null,
        check_out_time: input.checkOutTime ?? null,
        notes: input.notes ?? null,
        marked_by: markerEmployeeId,
      },
      { onConflict: 'employee_id,date' },
    );

  if (upsertError) {
    console.error(`${op} Upsert failed:`, { code: upsertError.code, message: upsertError.message });
    return err(`Failed to mark attendance: ${upsertError.message}`);
  }

  revalidatePath('/hr/attendance');
  console.log(`${op} Marked ${input.status} for ${input.employeeId} on ${input.date}`);
  return ok(undefined);
}

/**
 * Bulk-mark attendance for multiple employees on a single date.
 * HR/founder only.
 */
export async function bulkMarkAttendance(
  date: string,
  employeeIds: string[],
  status: AttendanceStatus,
): Promise<ActionResult<{ marked: number; skipped: number }>> {
  const op = '[bulkMarkAttendance]';
  console.log(`${op} Starting for date: ${date}, employees: ${employeeIds.length}, status: ${status}`);

  if (!date) return err('Date is required');
  if (!employeeIds.length) return err('At least one employee ID is required');
  if (!status) return err('Status is required');

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');

  const hrRoles: string[] = ['founder', 'hr_manager'];
  if (!hrRoles.includes(profile.role)) {
    console.warn(`${op} Access denied: role=${profile.role}`);
    return err('Only HR manager or founder can bulk-mark attendance');
  }

  const adminClient = createAdminClient();

  // Resolve marker employee ID
  const { data: markerEmployee } = await adminClient
    .from('employees')
    .select('id')
    .eq('profile_id', profile.id)
    .single();

  const markerEmployeeId = markerEmployee?.id ?? null;

  const rows = employeeIds.map((empId) => ({
    id: crypto.randomUUID(),
    employee_id: empId,
    date,
    status,
    marked_by: markerEmployeeId,
  }));

  const { data: upserted, error: upsertError } = await adminClient
    .from('attendance')
    .upsert(rows, { onConflict: 'employee_id,date' })
    .select('id');

  if (upsertError) {
    console.error(`${op} Upsert failed:`, { code: upsertError.code, message: upsertError.message });
    return err(`Failed to bulk-mark attendance: ${upsertError.message}`);
  }

  const marked = upserted?.length ?? 0;
  const skipped = employeeIds.length - marked;

  revalidatePath('/hr/attendance');
  console.log(`${op} Bulk-marked ${marked} attendance records (${skipped} skipped) for date ${date}`);
  return ok({ marked, skipped });
}

/**
 * Update an existing employee profile (non-sensitive fields).
 * Employees can update their own blood_group, emergency contact, address.
 * HR/founder can update any non-salary field.
 * Salary fields are never updated here — use compensation table.
 */
export async function updateEmployeeProfile(
  employeeId: string,
  patch: {
    blood_group?: string;
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
  },
): Promise<ActionResult<void>> {
  const op = '[updateEmployeeProfile]';
  console.log(`${op} Starting for employee: ${employeeId}`);

  if (!employeeId) return err('Employee ID is required');

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');

  const supabase = await createClient();
  const hrRoles: string[] = ['founder', 'hr_manager'];

  if (!hrRoles.includes(profile.role)) {
    // Employees can only update their own
    const { data: myEmployee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', profile.id)
      .single();

    if (!myEmployee || myEmployee.id !== employeeId) {
      return err('You can only update your own profile');
    }
  }

  const { error: updateError } = await supabase
    .from('employees')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', employeeId);

  if (updateError) {
    console.error(`${op} Update failed:`, { code: updateError.code, message: updateError.message });
    return err(`Failed to update employee profile: ${updateError.message}`);
  }

  revalidatePath(`/hr/${employeeId}`);
  revalidatePath('/hr/employees');
  console.log(`${op} Updated profile for: ${employeeId}`);
  return ok(undefined);
}

/**
 * Update sensitive employee fields (bank, Aadhar, PAN).
 * HR/founder only. These fields are NEVER logged.
 */
export async function updateEmployeeSensitiveFields(
  employeeId: string,
  patch: {
    aadhar_number?: string;
    pan_number?: string;
    bank_account_number?: string;
    bank_ifsc?: string;
    bank_name?: string;
  },
): Promise<ActionResult<void>> {
  const op = '[updateEmployeeSensitiveFields]';
  // SECURITY: do NOT log any fields from patch — they contain sensitive data
  console.log(`${op} Starting for employee: ${employeeId}`);

  if (!employeeId) return err('Employee ID is required');

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');

  const hrRoles: string[] = ['founder', 'hr_manager'];
  if (!hrRoles.includes(profile.role)) {
    console.warn(`${op} Access denied: role=${profile.role}`);
    return err('Only HR manager or founder can update sensitive fields');
  }

  const adminClient = createAdminClient();

  const { error: updateError } = await adminClient
    .from('employees')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', employeeId);

  if (updateError) {
    // Do NOT log error data — it may echo the row values back
    console.error(`${op} Update failed:`, { code: updateError.code, message: updateError.message });
    return err(`Failed to update employee sensitive fields: ${updateError.message}`);
  }

  revalidatePath(`/hr/${employeeId}`);
  console.log(`${op} Updated sensitive fields for: ${employeeId}`);
  return ok(undefined);
}

/**
 * Fetches attendance data for CSV export as a server action.
 * HR/founder only. Data is returned as rows; CSV generation happens on the client.
 * This keeps Supabase calls out of client components.
 */
export async function fetchAttendanceForExport(
  month: number,
  year: number,
): Promise<ActionResult<Array<{
  employee_code: string;
  full_name: string;
  date: string;
  status: string;
  check_in_time: string | null;
  check_out_time: string | null;
  notes: string | null;
}>>> {
  const op = '[fetchAttendanceForExport]';
  console.log(`${op} Starting for ${year}-${month}`);

  try {
    const rows = await getAttendanceExportData(month, year);
    return ok(
      (rows as Array<Record<string, unknown>>).map((r) => ({
        employee_code: String(r.employee_code ?? ''),
        full_name: String(r.full_name ?? ''),
        date: String(r.date ?? ''),
        status: String(r.status ?? ''),
        check_in_time: r.check_in_time != null ? String(r.check_in_time) : null,
        check_out_time: r.check_out_time != null ? String(r.check_out_time) : null,
        notes: r.notes != null ? String(r.notes) : null,
      })),
    );
  } catch (e) {
    console.error(`${op} Failed:`, { error: e instanceof Error ? e.message : String(e), timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Failed to fetch attendance data');
  }
}
