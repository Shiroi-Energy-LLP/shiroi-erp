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
  return { success: true };
}

export async function getCommissionedProjects(): Promise<{ id: string; project_number: string; customer_name: string; commissioned_date: string | null }[]> {
  const op = '[getCommissionedProjects]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, commissioned_date')
    .is('deleted_at', null)
    .in('status', ['commissioned', 'completed', 'net_metering_pending'])
    .order('commissioned_date', { ascending: false })
    .limit(200);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
