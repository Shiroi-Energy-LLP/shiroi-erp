'use server';

import { createAdminClient } from '@repo/supabase/admin';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';
import { emitErpEvent } from '@/lib/n8n/emit';
import { requireRole } from '@/lib/auth';
import { ok, err, type ActionResult } from '@/lib/types/actions';

type AppRole = Database['public']['Enums']['app_role'];

interface CreateEmployeeInput {
  fullName: string;
  email: string;
  phone: string;
  role: AppRole;
  department: string;
  designation: string;
  employeeCode: string;
  dateOfJoining: string;
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export async function createEmployeeAccount(input: CreateEmployeeInput): Promise<ActionResult<{ tempPassword: string }>> {
  const op = '[createEmployeeAccount]';

  // Role gate (security review 2026-05-30 #1 — CRITICAL): server actions are
  // independent HTTP endpoints; the page-level gate at /hr/employees/new
  // does not protect this action against direct invocation. Without this
  // check any authenticated user could POST { role: 'founder', ... }.
  const caller = await requireRole(['founder', 'hr_manager']);

  // Audit log: every creation attempt (5a — defense-in-depth audit trail).
  console.log(op, 'attempt', {
    callerId: caller.id,
    callerRole: caller.role,
    targetEmail: input.email,
    requestedRole: input.role,
    timestamp: new Date().toISOString(),
  });

  // 5c: Block non-founder from creating founder-role accounts (privilege escalation prevention).
  if (input.role === 'founder' && caller.role !== 'founder') {
    console.log(op, 'rejected', {
      callerId: caller.id,
      callerRole: caller.role,
      targetEmail: input.email,
      reason: 'non_founder_creating_founder',
      timestamp: new Date().toISOString(),
    });
    return err('Only an existing founder can create another founder account', 'FORBIDDEN_FOUNDER_ROLE');
  }

  // 5b: Enforce @shiroienergy.com email domain when caller is NOT founder.
  if (caller.role !== 'founder' && !input.email.trim().toLowerCase().endsWith('@shiroienergy.com')) {
    console.log(op, 'rejected', {
      callerId: caller.id,
      callerRole: caller.role,
      targetEmail: input.email,
      reason: 'non_shiroi_domain',
      timestamp: new Date().toISOString(),
    });
    return err('Non-founder callers may only create accounts with @shiroienergy.com email addresses', 'INVALID_DOMAIN');
  }

  console.log(`${op} Starting for: ${input.email}`);

  // Validate required fields
  if (!input.fullName.trim()) return err('Full name is required', 'MISSING_FIELD');
  if (!input.email.trim()) return err('Email is required', 'MISSING_FIELD');
  if (!input.phone.trim()) return err('Phone is required', 'MISSING_FIELD');
  if (!input.employeeCode.trim()) return err('Employee code is required', 'MISSING_FIELD');
  if (!input.department.trim()) return err('Department is required', 'MISSING_FIELD');
  if (!input.designation.trim()) return err('Designation is required', 'MISSING_FIELD');
  if (!input.dateOfJoining) return err('Date of joining is required', 'MISSING_FIELD');

  const adminClient = createAdminClient();
  const tempPassword = generateTempPassword();

  // Step 1: Create auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: input.email.trim().toLowerCase(),
    password: tempPassword,
    email_confirm: true, // Skip email verification
    user_metadata: {
      full_name: input.fullName.trim(),
    },
  });

  if (authError) {
    console.error(`${op} Auth user creation failed:`, { message: authError.message });
    console.log(op, 'failure', {
      callerId: caller.id,
      targetEmail: input.email,
      requestedRole: input.role,
      stage: 'auth_user_create',
      reason: authError.message,
      timestamp: new Date().toISOString(),
    });
    if (authError.message.includes('already been registered')) {
      return err('An account with this email already exists', 'EMAIL_EXISTS');
    }
    return err(`Failed to create auth account: ${authError.message}`, 'AUTH_CREATE_FAILED');
  }

  if (!authData.user) {
    console.error(`${op} Auth user creation returned no user`);
    console.log(op, 'failure', {
      callerId: caller.id,
      targetEmail: input.email,
      requestedRole: input.role,
      stage: 'auth_user_create_no_user',
      timestamp: new Date().toISOString(),
    });
    return err('Auth user creation failed unexpectedly', 'AUTH_NO_USER');
  }

  const userId = authData.user.id;
  console.log(`${op} Auth user created: ${userId}`);

  // Step 2: Update the auto-created profile with correct role and details
  // The on_auth_user_created trigger creates a profile row automatically
  // We need to wait a moment for the trigger to fire, then update it
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({
      role: input.role,
      full_name: input.fullName.trim(),
      phone: input.phone.trim(),
      email: input.email.trim().toLowerCase(),
    })
    .eq('id', userId);

  if (profileError) {
    console.error(`${op} Profile update failed:`, { code: profileError.code, message: profileError.message });
    console.log(op, 'failure', {
      callerId: caller.id,
      targetEmail: input.email,
      requestedRole: input.role,
      stage: 'profile_update',
      reason: profileError.message,
      timestamp: new Date().toISOString(),
    });
    // Don't fail entirely — auth user exists, profile can be fixed manually
    return err(`Auth account created but profile update failed: ${profileError.message}. The user can still log in.`, profileError.code);
  }

  console.log(`${op} Profile updated with role: ${input.role}`);

  // Step 3: Create employee record
  const { data: newEmployee, error: employeeError } = await adminClient
    .from('employees')
    .insert({
      profile_id: userId,
      employee_code: input.employeeCode.trim(),
      full_name: input.fullName.trim(),
      personal_phone: input.phone.trim(),
      personal_email: input.email.trim().toLowerCase(),
      whatsapp_number: input.phone.trim(),
      department: input.department.trim(),
      designation: input.designation.trim(),
      date_of_joining: input.dateOfJoining,
      is_active: true,
    })
    .select('id, full_name, employee_code, department, designation, date_of_joining, whatsapp_number')
    .single();

  if (employeeError || !newEmployee) {
    console.error(`${op} Employee insert failed:`, { code: employeeError?.code, message: employeeError?.message });
    console.log(op, 'failure', {
      callerId: caller.id,
      targetEmail: input.email,
      requestedRole: input.role,
      stage: 'employee_insert',
      reason: employeeError?.message ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
    return err(`Auth + profile created but employee record failed: ${employeeError?.message ?? 'unknown'}`, employeeError?.code);
  }

  console.log(`${op} Employee record created for: ${input.fullName}`);
  console.log(op, 'success', {
    callerId: caller.id,
    callerRole: caller.role,
    targetEmail: input.email,
    targetEmployeeId: newEmployee.id,
    grantedRole: input.role,
    timestamp: new Date().toISOString(),
  });

  revalidatePath('/hr/employees');

  void emitEmployeeCreated(newEmployee.id);

  return ok({ tempPassword });
}

async function emitEmployeeCreated(employeeId: string): Promise<void> {
  const op = '[emitEmployeeCreated]';
  try {
    const adminClient = createAdminClient();
    const { data: enriched } = await adminClient
      .from('employees')
      .select('id, employee_code, full_name, department, designation, date_of_joining, personal_email, whatsapp_number')
      .eq('id', employeeId)
      .single();
    if (!enriched) return;

    await emitErpEvent('employee.created', {
      employee_id: enriched.id,
      employee_code: enriched.employee_code,
      full_name: enriched.full_name,
      department: enriched.department,
      designation: enriched.designation,
      date_of_joining: enriched.date_of_joining,
      personal_email: enriched.personal_email,
      whatsapp_number: enriched.whatsapp_number,
      erp_url: `https://erp.shiroienergy.com/hr/employees/${enriched.id}`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      employeeId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function deactivateEmployee(employeeId: string): Promise<ActionResult<void>> {
  const op = '[deactivateEmployee]';

  // Role gate (security review 2026-05-30 #2 — CRITICAL): without this
  // check any authenticated user could lock the founder out for 100 years.
  const caller = await requireRole(['founder', 'hr_manager']);

  // Audit log: every deactivation attempt (5a — defense-in-depth audit trail).
  console.log(op, 'attempt', {
    callerId: caller.id,
    callerRole: caller.role,
    targetEmployeeId: employeeId,
    timestamp: new Date().toISOString(),
  });

  console.log(`${op} Starting for employee: ${employeeId}`);

  if (!employeeId) {
    console.log(op, 'failure', {
      callerId: caller.id,
      targetEmployeeId: employeeId,
      stage: 'validation',
      reason: 'missing_employee_id',
      timestamp: new Date().toISOString(),
    });
    return err('Employee ID is required', 'MISSING_ID');
  }

  const adminClient = createAdminClient();

  // Get the employee's profile_id to deactivate the auth account too
  const { data: employee, error: fetchError } = await adminClient
    .from('employees')
    .select('id, profile_id, full_name')
    .eq('id', employeeId)
    .single();

  if (fetchError || !employee) {
    console.error(`${op} Employee not found:`, { code: fetchError?.code, message: fetchError?.message });
    console.log(op, 'failure', {
      callerId: caller.id,
      targetEmployeeId: employeeId,
      stage: 'employee_fetch',
      reason: fetchError?.message ?? 'not_found',
      timestamp: new Date().toISOString(),
    });
    return err('Employee not found', fetchError?.code);
  }

  // Deactivate employee record
  const { error: empError } = await adminClient
    .from('employees')
    .update({
      is_active: false,
      last_working_day: new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString(),
    })
    .eq('id', employeeId);

  if (empError) {
    console.error(`${op} Employee deactivation failed:`, { code: empError.code, message: empError.message });
    console.log(op, 'failure', {
      callerId: caller.id,
      targetEmployeeId: employeeId,
      targetEmployeeName: employee.full_name,
      stage: 'employee_update',
      reason: empError.message,
      timestamp: new Date().toISOString(),
    });
    return err(`Failed to deactivate employee: ${empError.message}`, empError.code);
  }

  // Deactivate profile
  if (employee.profile_id) {
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', employee.profile_id);

    if (profileError) {
      console.error(`${op} Profile deactivation failed:`, { code: profileError.code, message: profileError.message });
      // Don't fail — employee is already deactivated
    }

    // Disable the auth user so they can't log in
    const { error: authError } = await adminClient.auth.admin.updateUserById(
      employee.profile_id,
      { ban_duration: '876600h' } // ~100 years = effectively permanent ban
    );

    if (authError) {
      console.error(`${op} Auth user ban failed:`, { message: authError.message });
      // Don't fail — employee and profile are already deactivated
    }
  }

  console.log(`${op} Employee deactivated: ${employee.full_name}`);
  console.log(op, 'success', {
    callerId: caller.id,
    callerRole: caller.role,
    targetEmployeeId: employeeId,
    targetEmployeeName: employee.full_name,
    timestamp: new Date().toISOString(),
  });

  revalidatePath('/hr/employees');
  return ok(undefined);
}
