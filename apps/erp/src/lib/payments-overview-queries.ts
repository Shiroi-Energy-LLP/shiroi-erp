import { createClient } from '@repo/supabase/server';
import Decimal from 'decimal.js';

export interface ProjectPaymentRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  project_status: string;
  contracted_value: number;
  completion_pct: number;
  total_received: number;
  outstanding: number;
  total_po_cost: number;
  total_site_expenses: number;
  project_pnl: number;
  next_milestone_name: string | null;
  next_milestone_amount: number | null;
  next_milestone_pct: number | null;
  payment_stage: string;
  expected_payment_date: string | null;
  pm_name: string | null;
}

export interface PaymentsSummary {
  total_contracted: number;
  total_received: number;
  total_outstanding: number;
  total_invested: number;
  net_position: number;
  expected_this_week: number;
  expected_this_month: number;
  projects_with_outstanding: number;
}

/**
 * Get all active projects with payment tracking data.
 * This is the crux query for the Payments page.
 */
export async function getProjectPaymentOverview(): Promise<ProjectPaymentRow[]> {
  const op = '[getProjectPaymentOverview]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  // Get all non-cancelled projects with contracted value
  const { data: projects, error: projError } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, status, contracted_value, completion_pct, lead_id, project_manager_id, employees!projects_project_manager_id_fkey(full_name)')
    .not('status', 'eq', 'cancelled')
    .gt('contracted_value', 0)
    .order('contracted_value', { ascending: false });

  if (projError) {
    console.error(`${op} Projects query failed:`, { code: projError.code, message: projError.message });
    throw new Error(`Failed to load projects: ${projError.message}`);
  }

  if (!projects || projects.length === 0) return [];

  const projectIds = projects.map((p: any) => p.id);

  // Batch-fetch all payments, POs, site expenses
  const [paymentsResult, posResult, expensesResult, schedulesResult] = await Promise.all([
    supabase
      .from('customer_payments')
      .select('project_id, amount')
      .in('project_id', projectIds),
    supabase
      .from('purchase_orders')
      .select('project_id, total_amount')
      .in('project_id', projectIds),
    supabase
      .from('project_site_expenses')
      .select('project_id, amount')
      .in('project_id', projectIds),
    // Get payment schedules via proposals linked to these projects' leads only
    supabase
      .from('proposals')
      .select('lead_id, proposal_payment_schedule(milestone_name, milestone_order, amount, percentage)')
      .eq('status', 'accepted')
      .in('lead_id', projects.map((p: any) => p.lead_id).filter(Boolean)),
  ]);

  // Build lookup maps
  const paymentsByProject = new Map<string, number>();
  for (const p of paymentsResult.data ?? []) {
    const current = paymentsByProject.get(p.project_id) ?? 0;
    paymentsByProject.set(p.project_id, current + Number(p.amount));
  }

  const poCostByProject = new Map<string, number>();
  for (const po of posResult.data ?? []) {
    const current = poCostByProject.get(po.project_id) ?? 0;
    poCostByProject.set(po.project_id, current + Number(po.total_amount));
  }

  const expensesByProject = new Map<string, number>();
  for (const exp of expensesResult.data ?? []) {
    const current = expensesByProject.get(exp.project_id) ?? 0;
    expensesByProject.set(exp.project_id, current + Number(exp.amount));
  }

  // Build schedule lookup by lead_id
  const scheduleByLead = new Map<string, any[]>();
  for (const proposal of schedulesResult.data ?? []) {
    if (proposal.lead_id && proposal.proposal_payment_schedule) {
      const existing = scheduleByLead.get(proposal.lead_id) ?? [];
      existing.push(...(proposal.proposal_payment_schedule as any[]));
      scheduleByLead.set(proposal.lead_id, existing);
    }
  }

  // Build rows
  return projects.map((proj: any) => {
    const contractedValue = Number(proj.contracted_value);
    const totalReceived = paymentsByProject.get(proj.id) ?? 0;
    const totalPoCost = poCostByProject.get(proj.id) ?? 0;
    const totalSiteExpenses = expensesByProject.get(proj.id) ?? 0;
    const totalInvested = totalPoCost + totalSiteExpenses;
    const outstanding = contractedValue - totalReceived;

    // P&L = received - invested (positive = profit so far)
    const projectPnl = totalReceived - totalInvested;

    // Figure out payment stage and next milestone
    const schedule = scheduleByLead.get(proj.lead_id) ?? [];
    const sortedSchedule = [...schedule].sort((a, b) => a.milestone_order - b.milestone_order);

    let paymentStage = 'No schedule';
    let nextMilestoneName: string | null = null;
    let nextMilestoneAmount: number | null = null;
    let nextMilestonePct: number | null = null;

    if (sortedSchedule.length > 0) {
      // Determine which milestone we're at based on received amount
      let runningTotal = 0;
      let currentMilestoneIdx = 0;
      for (let i = 0; i < sortedSchedule.length; i++) {
        runningTotal += Number(sortedSchedule[i].amount);
        if (totalReceived >= runningTotal) {
          currentMilestoneIdx = i + 1;
        }
      }

      if (currentMilestoneIdx >= sortedSchedule.length) {
        paymentStage = `${sortedSchedule.length}/${sortedSchedule.length} Complete`;
      } else {
        paymentStage = `${currentMilestoneIdx}/${sortedSchedule.length} Paid`;
        const nextMs = sortedSchedule[currentMilestoneIdx];
        nextMilestoneName = nextMs.milestone_name;
        nextMilestoneAmount = Number(nextMs.amount);
        nextMilestonePct = Number(nextMs.percentage);
      }
    }

    return {
      project_id: proj.id,
      project_number: proj.project_number,
      customer_name: proj.customer_name,
      project_status: proj.status,
      contracted_value: contractedValue,
      completion_pct: Number(proj.completion_pct),
      total_received: totalReceived,
      outstanding,
      total_po_cost: totalPoCost,
      total_site_expenses: totalSiteExpenses,
      project_pnl: projectPnl,
      next_milestone_name: nextMilestoneName,
      next_milestone_amount: nextMilestoneAmount,
      next_milestone_pct: nextMilestonePct,
      payment_stage: paymentStage,
      expected_payment_date: null, // Future: link to expected_close_date or trigger dates
      pm_name: (proj.employees as any)?.full_name ?? null,
    };
  });
}

/**
 * Compute summary stats for the payments overview.
 */
export function computePaymentsSummary(rows: ProjectPaymentRow[]): PaymentsSummary {
  let totalContracted = new Decimal(0);
  let totalReceived = new Decimal(0);
  let totalInvested = new Decimal(0);
  let projectsWithOutstanding = 0;

  for (const row of rows) {
    totalContracted = totalContracted.add(row.contracted_value);
    totalReceived = totalReceived.add(row.total_received);
    totalInvested = totalInvested.add(row.total_po_cost + row.total_site_expenses);
    if (row.outstanding > 0) {
      projectsWithOutstanding++;
    }
  }

  const totalOutstanding = totalContracted.sub(totalReceived);
  const netPosition = totalReceived.sub(totalInvested);

  // Expected this week/month: sum of next_milestone_amount for active projects
  // (Projects that are in progress and have an outstanding next milestone)
  const activeStatuses = ['advance_received', 'planning', 'material_procurement', 'installation', 'electrical_work', 'testing', 'commissioned', 'net_metering_pending'];
  const activeRows = rows.filter(r => activeStatuses.includes(r.project_status) && r.next_milestone_amount);
  const expectedThisWeek = activeRows
    .slice(0, 10) // Top 10 active projects most likely to pay
    .reduce((sum, r) => sum + (r.next_milestone_amount ?? 0), 0);
  const expectedThisMonth = activeRows
    .reduce((sum, r) => sum + (r.next_milestone_amount ?? 0), 0);

  return {
    total_contracted: totalContracted.toNumber(),
    total_received: totalReceived.toNumber(),
    total_outstanding: totalOutstanding.toNumber(),
    total_invested: totalInvested.toNumber(),
    net_position: netPosition.toNumber(),
    expected_this_week: expectedThisWeek,
    expected_this_month: expectedThisMonth,
    projects_with_outstanding: projectsWithOutstanding,
  };
}
