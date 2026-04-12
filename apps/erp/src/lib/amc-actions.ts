'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createAmcSchedule(input: {
  projectId: string;
  commissioningDate: string;
  visitDates: string[];
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createAmcSchedule]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get employee ID
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Generate contract number
  const { data: lastContract } = await supabase
    .from('om_contracts' as any)
    .select('contract_number')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const nextNum = lastContract
    ? parseInt((lastContract as any).contract_number?.split('-').pop() ?? '0', 10) + 1
    : 1;
  const contractNumber = `AMC-FREE-${String(nextNum).padStart(4, '0')}`;

  // Calculate end date as 1 year from commissioning
  const startDate = new Date(input.commissioningDate);
  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);

  // Create contract
  const { data: contract, error: contractError } = await supabase
    .from('om_contracts' as any)
    .insert({
      project_id: input.projectId,
      created_by: employee.id,
      contract_number: contractNumber,
      contract_type: 'warranty_period',
      status: 'active',
      start_date: input.commissioningDate,
      end_date: endDate.toISOString().split('T')[0],
      annual_value: 0, // Free AMC
      visits_included: input.visitDates.length,
      emergency_callouts_included: 0,
    } as any)
    .select('id')
    .single();

  if (contractError) {
    console.error(`${op} Contract creation failed:`, { code: contractError.code, message: contractError.message });
    return { success: false, error: contractError.message };
  }

  // Create visit schedules
  const visits = input.visitDates.map((date, i) => ({
    contract_id: (contract as any).id,
    project_id: input.projectId,
    assigned_to: employee.id,
    visit_number: i + 1,
    visit_type: 'scheduled_quarterly',
    scheduled_date: date,
    scheduled_time_slot: 'morning',
    status: 'scheduled',
  }));

  const { error: visitsError } = await supabase
    .from('om_visit_schedules' as any)
    .insert(visits as any);

  if (visitsError) {
    console.error(`${op} Visit creation failed:`, { code: visitsError.code, message: visitsError.message });
    return { success: false, error: visitsError.message };
  }

  revalidatePath('/om/amc');
  revalidatePath('/om/visits');
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Update Visit Status ──

export async function updateVisitStatus(
  visitId: string,
  newStatus: string,
): Promise<{ success: boolean; error?: string }> {
  const op = '[updateVisitStatus]';
  console.log(`${op} Updating visit ${visitId} to ${newStatus}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, any> = { status: newStatus };

  if (newStatus === 'completed') {
    updateData.completed_at = new Date().toISOString();
  }
  if (newStatus === 'scheduled' || newStatus === 'confirmed') {
    // Reopening — clear completed
    updateData.completed_at = null;
  }

  const { error } = await supabase
    .from('om_visit_schedules' as any)
    .update(updateData as any)
    .eq('id', visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/amc');
  revalidatePath('/om/visits');
  return { success: true };
}

// ── Reschedule Visit ──

export async function rescheduleVisit(input: {
  visitId: string;
  newDate: string;
  reason?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[rescheduleVisit]';
  console.log(`${op} Rescheduling visit ${input.visitId} to ${input.newDate}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get current date first for rescheduled_from
  const { data: currentVisit } = await supabase
    .from('om_visit_schedules' as any)
    .select('scheduled_date, reschedule_count')
    .eq('id', input.visitId)
    .single();

  const { error } = await supabase
    .from('om_visit_schedules' as any)
    .update({
      scheduled_date: input.newDate,
      status: 'rescheduled',
      rescheduled_from: (currentVisit as any)?.scheduled_date || null,
      reschedule_reason: input.reason || null,
      reschedule_count: ((currentVisit as any)?.reschedule_count || 0) + 1,
    } as any)
    .eq('id', input.visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/amc');
  revalidatePath('/om/visits');
  return { success: true };
}

// ── Assign Engineer to Visit ──

export async function assignVisitEngineer(
  visitId: string,
  employeeId: string,
): Promise<{ success: boolean; error?: string }> {
  const op = '[assignVisitEngineer]';
  console.log(`${op} Assigning engineer ${employeeId} to visit ${visitId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('om_visit_schedules' as any)
    .update({ assigned_to: employeeId || null } as any)
    .eq('id', visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/amc');
  revalidatePath('/om/visits');
  return { success: true };
}

// ── Get All AMC Data (paginated) ──

export async function getAllAmcData(filters: {
  contract_status?: string;
  visit_status?: string;
  project_id?: string;
  search?: string;
}): Promise<{
  contracts: any[];
  visits: any[];
  totalContracts: number;
  totalVisits: number;
}> {
  const op = '[getAllAmcData]';
  const supabase = await createClient();

  // Contracts query
  let contractQuery = supabase
    .from('om_contracts' as any)
    .select(
      'id, contract_number, contract_type, start_date, end_date, annual_value, status, visits_included, project_id, projects!om_contracts_project_id_fkey(project_number, customer_name)' as any,
      { count: 'estimated' as any },
    )
    .order('start_date', { ascending: false })
    .limit(200);

  if (filters.contract_status) contractQuery = contractQuery.eq('status', filters.contract_status);
  if (filters.project_id) contractQuery = contractQuery.eq('project_id', filters.project_id);

  // Visits query
  let visitQuery = supabase
    .from('om_visit_schedules' as any)
    .select(
      'id, visit_number, visit_type, scheduled_date, status, completed_at, project_id, contract_id, assigned_to, rescheduled_from, reschedule_count, employees!om_visit_schedules_assigned_to_fkey(full_name), projects!om_visit_schedules_project_id_fkey(project_number, customer_name)' as any,
      { count: 'estimated' as any },
    )
    .order('scheduled_date', { ascending: true })
    .limit(200);

  if (filters.visit_status) {
    if (filters.visit_status === 'active') {
      visitQuery = visitQuery.not('status', 'in', '("completed","cancelled")');
    } else {
      visitQuery = visitQuery.eq('status', filters.visit_status);
    }
  }
  if (filters.project_id) visitQuery = visitQuery.eq('project_id', filters.project_id);

  const [contractResult, visitResult] = await Promise.all([contractQuery, visitQuery]);

  if (contractResult.error) {
    console.error(`${op} Contracts query failed:`, { code: contractResult.error.code, message: contractResult.error.message });
  }
  if (visitResult.error) {
    console.error(`${op} Visits query failed:`, { code: visitResult.error.code, message: visitResult.error.message });
  }

  return {
    contracts: (contractResult.data ?? []) as any[],
    visits: (visitResult.data ?? []) as any[],
    totalContracts: contractResult.count ?? 0,
    totalVisits: visitResult.count ?? 0,
  };
}

export async function getCommissionedProjects(): Promise<{ id: string; project_number: string; customer_name: string; commissioned_date: string | null }[]> {
  const op = '[getCommissionedProjects]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, commissioned_date')
    .is('deleted_at', null)
    .in('status', ['completed', 'waiting_net_metering'])
    .order('commissioned_date', { ascending: false })
    .limit(200);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
