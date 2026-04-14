'use server';

import type { Database } from '@repo/types/database';
import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

type OmContractStatus = Database['public']['Enums']['om_contract_status'];

// ═══════════════════════════════════════════════════════════════════════
// Row type aliases — CLAUDE.md NEVER-DO rule #11: no `as any` on Supabase
// ═══════════════════════════════════════════════════════════════════════

type OmContract = Database['public']['Tables']['om_contracts']['Row'];
type OmContractInsert = Database['public']['Tables']['om_contracts']['Insert'];
type OmContractUpdate = Database['public']['Tables']['om_contracts']['Update'];

type OmVisitSchedule = Database['public']['Tables']['om_visit_schedules']['Row'];
type OmVisitScheduleInsert = Database['public']['Tables']['om_visit_schedules']['Insert'];
type OmVisitScheduleUpdate = Database['public']['Tables']['om_visit_schedules']['Update'];

type ProjectLite = {
  id: string;
  project_number: string;
  customer_name: string;
  commissioned_date: string | null;
};

// ═══════════════════════════════════════════════════════════════════════
// Create AMC Schedule (Free or Paid)
// ═══════════════════════════════════════════════════════════════════════

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
}): Promise<ActionResult<{ contractId: string }>> {
  const op = '[createAmcSchedule]';
  console.log(`${op} Starting ${input.category} for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return err('Employee profile not found');

  // Generate contract number
  const { data: lastContract } = await supabase
    .from('om_contracts')
    .select('contract_number')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextNum = lastContract?.contract_number
    ? parseInt(lastContract.contract_number.split('-').pop() ?? '0', 10) + 1
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
  const contractInsert: OmContractInsert = {
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
  };

  const { data: contract, error: contractError } = await supabase
    .from('om_contracts')
    .insert(contractInsert)
    .select('id')
    .single();

  if (contractError || !contract) {
    console.error(`${op} Contract creation failed:`, { code: contractError?.code, message: contractError?.message });
    return err(contractError?.message ?? 'Contract creation failed', contractError?.code);
  }

  // Auto-generate visit schedules spread evenly across the duration
  const visits: OmVisitScheduleInsert[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalMs = end.getTime() - start.getTime();
  const intervalMs = totalMs / (visitCount + 1); // +1 so visits don't land on start/end

  for (let i = 0; i < visitCount; i++) {
    const visitDate = new Date(start.getTime() + intervalMs * (i + 1));
    visits.push({
      contract_id: contract.id,
      project_id: input.projectId,
      assigned_to: input.assignedTo || employee.id,
      visit_number: i + 1,
      visit_type: 'scheduled_quarterly',
      scheduled_date: visitDate.toISOString().split('T')[0]!,
      scheduled_time_slot: 'morning',
      status: 'scheduled',
    });
  }

  const { error: visitsError } = await supabase
    .from('om_visit_schedules')
    .insert(visits);

  if (visitsError) {
    console.error(`${op} Visit creation failed:`, { code: visitsError.code, message: visitsError.message });
    return err(visitsError.message, visitsError.code);
  }

  revalidatePath('/om/amc');
  revalidatePath('/om/visits');
  revalidatePath(`/projects/${input.projectId}`);
  return ok({ contractId: contract.id });
}

// ═══════════════════════════════════════════════════════════════════════
// Update AMC Status (Open/Closed)
// ═══════════════════════════════════════════════════════════════════════

export async function updateAmcStatus(
  contractId: string,
  newStatus: 'active' | 'expired',
): Promise<ActionResult<void>> {
  const op = '[updateAmcStatus]';
  console.log(`${op} Setting contract ${contractId} to ${newStatus}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const update: OmContractUpdate = { status: newStatus, updated_by: user.id };
  const { error } = await supabase
    .from('om_contracts')
    .update(update)
    .eq('id', contractId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/amc');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Update Visit Status
// ═══════════════════════════════════════════════════════════════════════

export async function updateVisitStatus(
  visitId: string,
  newStatus: string,
): Promise<ActionResult<void>> {
  const op = '[updateVisitStatus]';
  console.log(`${op} Updating visit ${visitId} to ${newStatus}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const updateData: OmVisitScheduleUpdate = { status: newStatus };

  if (newStatus === 'completed') {
    updateData.completed_at = new Date().toISOString();
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
    .from('om_visit_schedules')
    .update(updateData)
    .eq('id', visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/amc');
  revalidatePath('/om/visits');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Update Visit Details (work done, issues, resolution, feedback, notes)
// ═══════════════════════════════════════════════════════════════════════

export async function updateVisitDetails(input: {
  visitId: string;
  work_done?: string;
  issues_identified?: string;
  resolution_details?: string;
  customer_feedback?: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  const op = '[updateVisitDetails]';
  console.log(`${op} Updating details for visit ${input.visitId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const updateData: OmVisitScheduleUpdate = {};
  if (input.work_done !== undefined) updateData.work_done = input.work_done || null;
  if (input.issues_identified !== undefined) updateData.issues_identified = input.issues_identified || null;
  if (input.resolution_details !== undefined) updateData.resolution_details = input.resolution_details || null;
  if (input.customer_feedback !== undefined) updateData.customer_feedback = input.customer_feedback || null;
  if (input.notes !== undefined) updateData.notes = input.notes || null;

  const { error } = await supabase
    .from('om_visit_schedules')
    .update(updateData)
    .eq('id', input.visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/amc');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Reschedule Visit
// ═══════════════════════════════════════════════════════════════════════

export async function rescheduleVisit(input: {
  visitId: string;
  newDate: string;
  reason?: string;
}): Promise<ActionResult<void>> {
  const op = '[rescheduleVisit]';
  console.log(`${op} Rescheduling visit ${input.visitId} to ${input.newDate}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: currentVisit } = await supabase
    .from('om_visit_schedules')
    .select('scheduled_date, reschedule_count')
    .eq('id', input.visitId)
    .maybeSingle();

  const update: OmVisitScheduleUpdate = {
    scheduled_date: input.newDate,
    status: 'rescheduled',
    rescheduled_from: currentVisit?.scheduled_date ?? null,
    reschedule_reason: input.reason || null,
    reschedule_count: (currentVisit?.reschedule_count ?? 0) + 1,
  };

  const { error } = await supabase
    .from('om_visit_schedules')
    .update(update)
    .eq('id', input.visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/amc');
  revalidatePath('/om/visits');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Assign Engineer to Visit
// ═══════════════════════════════════════════════════════════════════════

export async function assignVisitEngineer(
  visitId: string,
  employeeId: string,
): Promise<ActionResult<void>> {
  const op = '[assignVisitEngineer]';
  console.log(`${op} Assigning engineer ${employeeId} to visit ${visitId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const update: OmVisitScheduleUpdate = { assigned_to: employeeId || null };
  const { error } = await supabase
    .from('om_visit_schedules')
    .update(update)
    .eq('id', visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/amc');
  revalidatePath('/om/visits');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Delete (soft-close) AMC
// ═══════════════════════════════════════════════════════════════════════

export async function deleteAmc(contractId: string): Promise<ActionResult<void>> {
  const op = '[deleteAmc]';
  console.log(`${op} Archiving contract: ${contractId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const update: OmContractUpdate = { status: 'cancelled', updated_by: user.id };
  const { error } = await supabase
    .from('om_contracts')
    .update(update)
    .eq('id', contractId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/amc');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Add Report File to Visit
// ═══════════════════════════════════════════════════════════════════════

export async function addVisitReportFile(
  visitId: string,
  filePath: string,
): Promise<ActionResult<void>> {
  const op = '[addVisitReportFile]';
  console.log(`${op} Adding report file to visit ${visitId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: visit } = await supabase
    .from('om_visit_schedules')
    .select('report_file_paths')
    .eq('id', visitId)
    .maybeSingle();

  const currentPaths: string[] = visit?.report_file_paths ?? [];
  const newPaths = [...currentPaths, filePath];

  const update: OmVisitScheduleUpdate = { report_file_paths: newPaths };
  const { error } = await supabase
    .from('om_visit_schedules')
    .update(update)
    .eq('id', visitId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/om/amc');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Get All AMC Data (flat contract-centric table)
// ═══════════════════════════════════════════════════════════════════════

export interface AmcVisitStats {
  completed_visit_count: number;
  total_visit_count: number;
  next_visit_date: string | null;
  last_completed_date: string | null;
}

type AmcContractRow = Pick<
  OmContract,
  | 'id' | 'contract_number' | 'contract_type' | 'amc_category' | 'amc_duration_months'
  | 'start_date' | 'end_date' | 'annual_value' | 'status' | 'visits_included'
  | 'project_id' | 'notes' | 'created_at' | 'updated_at'
> & {
  projects: { project_number: string; customer_name: string } | null;
  employees: { full_name: string } | null;
};

export type AmcContractWithStats = AmcContractRow & AmcVisitStats;

export async function getAllAmcData(filters: {
  status?: string;
  category?: string;
  project_id?: string;
}): Promise<{
  contracts: AmcContractWithStats[];
  total: number;
}> {
  const op = '[getAllAmcData]';
  const supabase = await createClient();

  let query = supabase
    .from('om_contracts')
    .select(
      'id, contract_number, contract_type, amc_category, amc_duration_months, start_date, end_date, annual_value, status, visits_included, project_id, notes, created_at, updated_at, projects!om_contracts_project_id_fkey(project_number, customer_name), employees!om_contracts_created_by_fkey(full_name)',
      { count: 'estimated' },
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters.status) {
    if (filters.status === 'open') {
      query = query.eq('status', 'active');
    } else if (filters.status === 'closed') {
      query = query.in('status', ['expired', 'cancelled']);
    } else {
      // Narrow to the enum for type-safe equality
      const VALID: OmContractStatus[] = ['quoted', 'active', 'expired', 'cancelled', 'renewal_pending'];
      if ((VALID as string[]).includes(filters.status)) {
        query = query.eq('status', filters.status as OmContractStatus);
      }
    }
  }
  if (filters.category) query = query.eq('amc_category', filters.category);
  if (filters.project_id) query = query.eq('project_id', filters.project_id);

  const { data, error, count } = await query.returns<AmcContractRow[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { contracts: [], total: 0 };
  }

  const contracts = data ?? [];

  // Fetch visit stats for all contracts in one query
  const contractIds = contracts.map((c) => c.id).filter(Boolean);

  interface VisitStatsAcc {
    completed: number;
    total: number;
    nextDate: string | null;
    lastCompleted: string | null;
  }
  const visitStats: Record<string, VisitStatsAcc> = {};

  if (contractIds.length > 0) {
    type VisitRow = Pick<
      OmVisitSchedule,
      'id' | 'contract_id' | 'scheduled_date' | 'status' | 'completed_at'
    >;
    const { data: allVisits } = await supabase
      .from('om_visit_schedules')
      .select('id, contract_id, scheduled_date, status, completed_at')
      .in('contract_id', contractIds)
      .order('scheduled_date', { ascending: true })
      .returns<VisitRow[]>();

    for (const v of allVisits ?? []) {
      const cid = v.contract_id;
      if (!cid) continue;
      if (!visitStats[cid]) {
        visitStats[cid] = { completed: 0, total: 0, nextDate: null, lastCompleted: null };
      }
      const s = visitStats[cid]!;
      s.total++;
      if (v.status === 'completed') {
        s.completed++;
        if (v.completed_at && (!s.lastCompleted || v.completed_at > s.lastCompleted)) {
          s.lastCompleted = v.completed_at;
        }
      } else if (v.status !== 'cancelled' && !s.nextDate) {
        s.nextDate = v.scheduled_date;
      }
    }
  }

  // Merge visit stats into each contract
  const enriched: AmcContractWithStats[] = contracts.map((c) => {
    const s = visitStats[c.id];
    return {
      ...c,
      completed_visit_count: s?.completed ?? 0,
      total_visit_count: s?.total ?? 0,
      next_visit_date: s?.nextDate ?? null,
      last_completed_date: s?.lastCompleted ?? null,
    };
  });

  return { contracts: enriched, total: count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
// Get Visits for a Contract
// ═══════════════════════════════════════════════════════════════════════

export type AmcVisitDetailRow = Pick<
  OmVisitSchedule,
  | 'id' | 'visit_number' | 'visit_type' | 'scheduled_date' | 'status'
  | 'completed_at' | 'completed_by' | 'assigned_to' | 'work_done'
  | 'issues_identified' | 'resolution_details' | 'customer_feedback'
  | 'notes' | 'report_file_paths' | 'reschedule_count'
> & {
  employees: { full_name: string } | null;
  done_by: { full_name: string } | null;
};

export async function getVisitsForContract(contractId: string): Promise<AmcVisitDetailRow[]> {
  const op = '[getVisitsForContract]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('om_visit_schedules')
    .select(
      'id, visit_number, visit_type, scheduled_date, status, completed_at, completed_by, assigned_to, work_done, issues_identified, resolution_details, customer_feedback, notes, report_file_paths, reschedule_count, employees!om_visit_schedules_assigned_to_fkey(full_name), done_by:employees!om_visit_schedules_completed_by_fkey(full_name)',
    )
    .eq('contract_id', contractId)
    .order('visit_number', { ascending: true })
    .returns<AmcVisitDetailRow[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// Get Commissioned Projects (for Create AMC dialog)
// ═══════════════════════════════════════════════════════════════════════

export async function getCommissionedProjects(): Promise<ProjectLite[]> {
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

// ═══════════════════════════════════════════════════════════════════════
// Get All Projects (for Create Paid AMC — any active project)
// ═══════════════════════════════════════════════════════════════════════

export async function getAllProjectsForAmc(): Promise<Omit<ProjectLite, 'commissioned_date'>[]> {
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

// ═══════════════════════════════════════════════════════════════════════
// Get Projects that have at least one AMC contract (for filter dropdown)
// ═══════════════════════════════════════════════════════════════════════

export async function getProjectsWithAmc(): Promise<Omit<ProjectLite, 'commissioned_date'>[]> {
  const op = '[getProjectsWithAmc]';
  console.log(`${op} Starting`);

  const supabase = await createClient();

  type ContractWithProject = {
    project_id: string | null;
    projects: { id: string; project_number: string; customer_name: string } | null;
  };

  const { data, error } = await supabase
    .from('om_contracts')
    .select('project_id, projects!om_contracts_project_id_fkey(id, project_number, customer_name)')
    .not('project_id', 'is', null)
    .limit(500)
    .returns<ContractWithProject[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  // Deduplicate by project_id
  const seen = new Set<string>();
  const result: Omit<ProjectLite, 'commissioned_date'>[] = [];
  for (const row of data ?? []) {
    const p = row.projects;
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      result.push({
        id: p.id,
        project_number: p.project_number ?? '',
        customer_name: p.customer_name ?? '',
      });
    }
  }
  return result.sort((a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? ''));
}
