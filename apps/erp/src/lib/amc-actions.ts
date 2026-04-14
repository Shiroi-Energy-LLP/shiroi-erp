'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// ── Create AMC Schedule (Free or Paid) ──

export async function createAmcSchedule(input: {
  projectId: string;
  category: 'free_amc' | 'paid_amc';
  assignedTo?: string;
  // Free AMC fields
  commissioningDate?: string;
  // Paid AMC fields
  startDate?: string;
  durationMonths?: number;
  visitCount?: number;
  amcAmount?: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createAmcSchedule]';
  console.log(`${op} Starting ${input.category} for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

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

  const isFree = input.category === 'free_amc';
  const prefix = isFree ? 'AMC-FREE' : 'AMC-PAID';
  const contractNumber = `${prefix}-${String(nextNum).padStart(4, '0')}`;

  // Calculate dates
  let startDate: string;
  let endDate: string;
  let visitCount: number;
  let annualValue: number;
  let durationMonths: number | null = null;

  if (isFree) {
    startDate = input.commissioningDate || new Date().toISOString().split('T')[0]!;
    const end = new Date(startDate);
    end.setFullYear(end.getFullYear() + 1);
    endDate = end.toISOString().split('T')[0]!;
    visitCount = 3;
    annualValue = 0;
  } else {
    startDate = input.startDate || new Date().toISOString().split('T')[0]!;
    durationMonths = input.durationMonths || 12;
    const end = new Date(startDate);
    end.setMonth(end.getMonth() + durationMonths);
    endDate = end.toISOString().split('T')[0]!;
    visitCount = input.visitCount || 4;
    annualValue = input.amcAmount || 0;
  }

  // Create contract
  const { data: contract, error: contractError } = await supabase
    .from('om_contracts' as any)
    .insert({
      project_id: input.projectId,
      created_by: employee.id,
      contract_number: contractNumber,
      contract_type: isFree ? 'warranty_period' : 'amc_basic',
      amc_category: input.category,
      amc_duration_months: durationMonths,
      status: 'active',
      start_date: startDate,
      end_date: endDate,
      annual_value: annualValue,
      visits_included: visitCount,
      emergency_callouts_included: 0,
    } as any)
    .select('id')
    .single();

  if (contractError) {
    console.error(`${op} Contract creation failed:`, { code: contractError.code, message: contractError.message });
    return { success: false, error: contractError.message };
  }

  // Auto-generate visit schedules spread evenly across the duration
  const visits = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalMs = end.getTime() - start.getTime();
  const intervalMs = totalMs / (visitCount + 1); // +1 so visits don't land on start/end

  for (let i = 0; i < visitCount; i++) {
    const visitDate = new Date(start.getTime() + intervalMs * (i + 1));
    visits.push({
      contract_id: (contract as any).id,
      project_id: input.projectId,
      assigned_to: input.assignedTo || employee.id,
      visit_number: i + 1,
      visit_type: 'scheduled_quarterly',
      scheduled_date: visitDate.toISOString().split('T')[0],
      scheduled_time_slot: 'morning',
      status: 'scheduled',
    });
  }

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

// ── Update AMC Status (Open/Closed) ──

export async function updateAmcStatus(
  contractId: string,
  newStatus: 'active' | 'expired',
): Promise<{ success: boolean; error?: string }> {
  const op = '[updateAmcStatus]';
  console.log(`${op} Setting contract ${contractId} to ${newStatus}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('om_contracts' as any)
    .update({ status: newStatus, updated_by: user.id } as any)
    .eq('id', contractId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/amc');
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
    // Set completed_by
    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (emp) updateData.completed_by = emp.id;
  }
  if (newStatus === 'scheduled' || newStatus === 'confirmed') {
    updateData.completed_at = null;
    updateData.completed_by = null;
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

// ── Update Visit Details (work done, issues, resolution, feedback, notes) ──

export async function updateVisitDetails(input: {
  visitId: string;
  work_done?: string;
  issues_identified?: string;
  resolution_details?: string;
  customer_feedback?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateVisitDetails]';
  console.log(`${op} Updating details for visit ${input.visitId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, any> = {};
  if (input.work_done !== undefined) updateData.work_done = input.work_done || null;
  if (input.issues_identified !== undefined) updateData.issues_identified = input.issues_identified || null;
  if (input.resolution_details !== undefined) updateData.resolution_details = input.resolution_details || null;
  if (input.customer_feedback !== undefined) updateData.customer_feedback = input.customer_feedback || null;
  if (input.notes !== undefined) updateData.notes = input.notes || null;

  const { error } = await supabase
    .from('om_visit_schedules' as any)
    .update(updateData as any)
    .eq('id', input.visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/amc');
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

// ── Delete (soft-close) AMC ──

export async function deleteAmc(contractId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteAmc]';
  console.log(`${op} Archiving contract: ${contractId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('om_contracts' as any)
    .update({ status: 'cancelled', updated_by: user.id } as any)
    .eq('id', contractId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/amc');
  return { success: true };
}

// ── Add Report File to Visit ──

export async function addVisitReportFile(
  visitId: string,
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  const op = '[addVisitReportFile]';
  console.log(`${op} Adding report file to visit ${visitId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get current paths
  const { data: visit } = await supabase
    .from('om_visit_schedules' as any)
    .select('report_file_paths')
    .eq('id', visitId)
    .single();

  const currentPaths: string[] = (visit as any)?.report_file_paths ?? [];
  const newPaths = [...currentPaths, filePath];

  const { error } = await supabase
    .from('om_visit_schedules' as any)
    .update({ report_file_paths: newPaths } as any)
    .eq('id', visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/amc');
  return { success: true };
}

// ── Get All AMC Data (flat contract-centric table) ──

export interface AmcVisitStats {
  completed_visit_count: number;
  total_visit_count: number;
  next_visit_date: string | null;
  last_completed_date: string | null;
}

export async function getAllAmcData(filters: {
  status?: string;
  category?: string;
  project_id?: string;
}): Promise<{
  contracts: (any & AmcVisitStats)[];
  total: number;
}> {
  const op = '[getAllAmcData]';
  const supabase = await createClient();

  let query = supabase
    .from('om_contracts' as any)
    .select(
      'id, contract_number, contract_type, amc_category, amc_duration_months, start_date, end_date, annual_value, status, visits_included, project_id, notes, created_at, updated_at, projects!om_contracts_project_id_fkey(project_number, customer_name), employees!om_contracts_created_by_fkey(full_name)' as any,
      { count: 'estimated' as any },
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters.status) {
    if (filters.status === 'open') {
      query = query.eq('status', 'active');
    } else if (filters.status === 'closed') {
      query = query.in('status', ['expired', 'cancelled']);
    } else {
      query = query.eq('status', filters.status);
    }
  }
  if (filters.category) query = query.eq('amc_category', filters.category);
  if (filters.project_id) query = query.eq('project_id', filters.project_id);

  const { data, error, count } = await query;

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { contracts: [], total: 0 };
  }

  const contracts = (data ?? []) as any[];

  // Fetch visit stats for all contracts in one query
  const contractIds = contracts.map((c) => c.id as string).filter(Boolean);

  const visitStats: Record<string, AmcVisitStats> = {};

  if (contractIds.length > 0) {
    const { data: allVisits } = await supabase
      .from('om_visit_schedules' as any)
      .select('id, contract_id, scheduled_date, status, completed_at' as any)
      .in('contract_id', contractIds)
      .order('scheduled_date', { ascending: true });

    for (const v of (allVisits ?? []) as any[]) {
      const cid = v.contract_id as string;
      if (!visitStats[cid]) {
        visitStats[cid] = { completed: 0, total: 0, nextDate: null, lastCompleted: null } as any;
      }
      const s = visitStats[cid] as any;
      s.total++;
      if (v.status === 'completed') {
        s.completed++;
        if (!s.lastCompleted || (v.completed_at && v.completed_at > s.lastCompleted)) {
          s.lastCompleted = v.completed_at as string;
        }
      } else if (v.status !== 'cancelled' && !s.nextDate) {
        s.nextDate = v.scheduled_date as string;
      }
    }
  }

  // Merge visit stats into each contract
  const enriched = contracts.map((c) => {
    const s = visitStats[c.id as string] as any;
    return {
      ...c,
      completed_visit_count: s?.completed ?? 0,
      total_visit_count: s?.total ?? 0,
      next_visit_date: s?.nextDate ?? null,
      last_completed_date: s?.lastCompleted ?? null,
    } as any & AmcVisitStats;
  });

  return { contracts: enriched, total: count ?? 0 };
}

// ── Get Visits for a Contract ──

export async function getVisitsForContract(contractId: string): Promise<any[]> {
  const op = '[getVisitsForContract]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('om_visit_schedules' as any)
    .select(
      'id, visit_number, visit_type, scheduled_date, status, completed_at, completed_by, assigned_to, work_done, issues_identified, resolution_details, customer_feedback, notes, report_file_paths, reschedule_count, employees!om_visit_schedules_assigned_to_fkey(full_name), done_by:employees!om_visit_schedules_completed_by_fkey(full_name)' as any,
    )
    .eq('contract_id', contractId)
    .order('visit_number', { ascending: true });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  return (data ?? []) as any[];
}

// ── Get Commissioned Projects (for Create AMC dialog) ──

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

// ── Get All Projects (for Create Paid AMC — any active project) ──

export async function getAllProjectsForAmc(): Promise<{ id: string; project_number: string; customer_name: string }[]> {
  const op = '[getAllProjectsForAmc]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name')
    .is('deleted_at', null)
    .order('project_number', { ascending: true })
    .limit(500);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}

// ── Get Projects that have at least one AMC contract (for filter dropdown) ──

export async function getProjectsWithAmc(): Promise<{ id: string; project_number: string; customer_name: string }[]> {
  const op = '[getProjectsWithAmc]';
  console.log(`${op} Starting`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('om_contracts' as any)
    .select('project_id, projects!om_contracts_project_id_fkey(id, project_number, customer_name)' as any)
    .not('project_id', 'is', null)
    .limit(500);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  // Deduplicate by project_id
  const seen = new Set<string>();
  const result: { id: string; project_number: string; customer_name: string }[] = [];
  for (const row of (data ?? []) as any[]) {
    const p = row.projects as { id: string; project_number: string; customer_name: string } | null;
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      result.push({ id: p.id, project_number: p.project_number ?? '', customer_name: p.customer_name ?? '' });
    }
  }
  return result.sort((a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? ''));
}
