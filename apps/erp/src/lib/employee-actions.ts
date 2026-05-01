'use server';

import { createAdminClient } from '@repo/supabase/admin';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';
import { emitErpEvent } from '@/lib/n8n/emit';

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

interface CreateEmployeeResult {
  success: boolean;
  tempPassword?: string;
  error?: string;
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export async function createEmployeeAccount(input: CreateEmployeeInput): Promise<CreateEmployeeResult> {
  const op = '[createEmployeeAccount]';
  console.log(`${op} Starting for: ${input.email}`);

  // Validate required fields
  if (!input.fullName.trim()) return { success: false, error: 'Full name is required' };
  if (!input.email.trim()) return { success: false, error: 'Email is required' };
  if (!input.phone.trim()) return { success: false, error: 'Phone is required' };
  if (!input.employeeCode.trim()) return { success: false, error: 'Employee code is required' };
  if (!input.department.trim()) return { success: false, error: 'Department is required' };
  if (!input.designation.trim()) return { success: false, error: 'Designation is required' };
  if (!input.dateOfJoining) return { success: false, error: 'Date of joining is required' };

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
    if (authError.message.includes('already been registered')) {
      return { success: false, error: 'An account with this email already exists' };
    }
    return { success: false, error: `Failed to create auth account: ${authError.message}` };
  }

  if (!authData.user) {
    console.error(`${op} Auth user creation returned no user`);
    return { success: false, error: 'Auth user creation failed unexpectedly' };
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
    // Don't fail entirely — auth user exists, profile can be fixed manually
    return { success: false, error: `Auth account created but profile update failed: ${profileError.message}. The user can still log in.` };
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
    return { success: false, error: `Auth + profile created but employee record failed: ${employeeError?.message ?? 'unknown'}` };
  }

  console.log(`${op} Employee record created for: ${input.fullName}`);

  revalidatePath('/hr/employees');

  void emitEmployeeCreated(newEmployee.id);

  return { success: true, tempPassword };
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

export async function deactivateEmployee(employeeId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deactivateEmployee]';
  console.log(`${op} Starting for employee: ${employeeId}`);

  if (!employeeId) return { success: false, error: 'Employee ID is required' };

  const adminClient = createAdminClient();

  // Get the employee's profile_id to deactivate the auth account too
  const { data: employee, error: fetchError } = await adminClient
    .from('employees')
    .select('id, profile_id, full_name')
    .eq('id', employeeId)
    .single();

  if (fetchError || !employee) {
    console.error(`${op} Employee not found:`, { code: fetchError?.code, message: fetchError?.message });
    return { success: false, error: 'Employee not found' };
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
    return { success: false, error: `Failed to deactivate employee: ${empError.message}` };
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

  revalidatePath('/hr/employees');
  return { success: true };
}
