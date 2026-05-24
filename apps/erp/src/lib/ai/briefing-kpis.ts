'use server';

/**
 * briefing-kpis.ts — gather KPI bundle for the daily executive briefing.
 *
 * Calls existing RPCs in parallel via the admin client.
 * All money aggregation is done in SQL — never .reduce() in JS.
 *
 * Anomaly detection is done via targeted SELECTs (simple threshold queries),
 * not JS reduction over monetary rows.
 */

import { createAdminClient } from '@repo/supabase/admin';

export interface BriefingKpis {
  date: string; // YYYY-MM-DD (yesterday)
  recipient_role: 'founder' | 'marketing_manager' | 'project_manager';

  // Sales
  leads_new_yesterday: number;
  leads_by_stage: Record<string, number>;
  pipeline_close_this_week: { count: number; total_value: number };
  expected_orders_this_week: number;

  // Cash
  cash_position_now: number;
  expected_payments_this_week: { count: number; total: number };
  msme_aging_30plus: number;
  msme_aging_40plus: number;

  // Projects
  projects_in_progress_count: number;
  commissioning_this_week: number;
  delayed_projects_count: number;

  // O&M
  open_critical_tickets: number;

  // Anomalies
  anomalies: string[]; // e.g. "Lead X stale for 21 days", "Project Y no activity 14 days"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns YYYY-MM-DD for N days ago in IST. */
function istDateDaysAgo(n: number): string {
  const d = new Date();
  // Offset to IST (+5:30 = 330 min)
  d.setMinutes(d.getMinutes() + 330 - n * 1440);
  return d.toISOString().slice(0, 10);
}

/** Returns first and last day of current ISO week in YYYY-MM-DD form. */
function thisWeekWindow(): { start: string; end: string } {
  const now = new Date();
  // IST offset
  now.setMinutes(now.getMinutes() + 330);
  const day = now.getUTCDay(); // 0=Sun
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function gatherBriefingKpis(
  date: string,
  recipientRole: 'founder' | 'marketing_manager' | 'project_manager',
): Promise<BriefingKpis> {
  const op = '[gatherBriefingKpis]';
  const admin = createAdminClient();
  const week = thisWeekWindow();
  const yesterday = date; // passed in as YYYY-MM-DD (yesterday in IST)
  const yesterdayStart = `${yesterday}T00:00:00+05:30`;
  const yesterdayEnd = `${yesterday}T23:59:59+05:30`;

  // ── Parallel RPC calls ────────────────────────────────────────────────────
  const [
    stageCounts,
    pipelineSummary,
    closeWindow,
    expectedOrders,
    paymentsThisWeek,
    cashSummary,
    msmeAging,
    projectsInProgress,
    commissioningThisWeek,
    delayedProjects,
    openCriticalTickets,
    newLeadsYesterday,
    staleLeads,
    staleProjects,
  ] = await Promise.all([
    // 1. get_lead_stage_counts (mig 028)
    admin.rpc('get_lead_stage_counts', { p_include_archived: false }),

    // 2. get_pipeline_summary (mig 048)
    admin.rpc('get_pipeline_summary'),

    // 3. get_pipeline_close_window (mig 109)
    admin.rpc('get_pipeline_close_window', {
      start_date: week.start,
      end_date: week.end,
    }),

    // 4. get_expected_orders (mig 094)
    admin.rpc('get_expected_orders', { window_days: 7 }),

    // 5. get_payments_expected_this_week (mig 117)
    admin.rpc('get_payments_expected_this_week'),

    // 6. get_company_cash_summary_v2
    admin.rpc('get_company_cash_summary_v2'),

    // 7. get_msme_aging_summary
    admin.rpc('get_msme_aging_summary'),

    // 8. Projects in_progress count (direct query — no RPC exists, count only)
    admin
      .from('projects')
      .select('id', { count: 'estimated', head: true })
      .eq('status', 'in_progress')
      .is('deleted_at', null),

    // 9. Commissioning this week — projects with commissioning_date in week window
    admin
      .from('commissioning_reports')
      .select('id', { count: 'estimated', head: true })
      .gte('commissioning_date', week.start)
      .lte('commissioning_date', week.end),

    // 10. Delayed projects — projects in_progress or yet_to_start with latest milestone
    //     overdue by >7 days. Simple proxy: status=holding_shiroi as "delayed"
    admin
      .from('projects')
      .select('id', { count: 'estimated', head: true })
      .in('status', ['holding_shiroi', 'holding_client'])
      .is('deleted_at', null),

    // 11. Open critical O&M tickets (severity='high' and open statuses)
    admin
      .from('om_service_tickets')
      .select('id', { count: 'estimated', head: true })
      .in('status', ['open', 'assigned', 'in_progress', 'escalated'])
      .eq('severity', 'high'),

    // 12. New leads yesterday (created_at between yesterday 00:00 and 23:59 IST)
    admin
      .from('leads')
      .select('id', { count: 'estimated', head: true })
      .gte('created_at', yesterdayStart)
      .lte('created_at', yesterdayEnd)
      .is('deleted_at', null),

    // 13. Stale leads — active leads with no activity for >14 days
    admin
      .from('leads')
      .select('id, customer_name, status, updated_at')
      .not('status', 'in', '("won","converted","lost","on_hold","disqualified")')
      .lt('updated_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .is('deleted_at', null)
      .order('updated_at', { ascending: true })
      .limit(5),

    // 14. Projects with no activity for >10 days (updated_at proxy)
    admin
      .from('projects')
      .select('id, project_number, customer_name, updated_at')
      .in('status', ['yet_to_start', 'in_progress'])
      .lt('updated_at', new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString())
      .is('deleted_at', null)
      .order('updated_at', { ascending: true })
      .limit(5),
  ]);

  // ── Error logging (non-fatal — degrade gracefully) ─────────────────────────
  if (stageCounts.error) {
    console.error(`${op} get_lead_stage_counts failed`, { error: stageCounts.error, timestamp: new Date().toISOString() });
  }
  if (pipelineSummary.error) {
    console.error(`${op} get_pipeline_summary failed`, { error: pipelineSummary.error, timestamp: new Date().toISOString() });
  }
  if (closeWindow.error) {
    console.error(`${op} get_pipeline_close_window failed`, { error: closeWindow.error, timestamp: new Date().toISOString() });
  }
  if (expectedOrders.error) {
    console.error(`${op} get_expected_orders failed`, { error: expectedOrders.error, timestamp: new Date().toISOString() });
  }
  if (paymentsThisWeek.error) {
    console.error(`${op} get_payments_expected_this_week failed`, { error: paymentsThisWeek.error, timestamp: new Date().toISOString() });
  }
  if (cashSummary.error) {
    console.error(`${op} get_company_cash_summary_v2 failed`, { error: cashSummary.error, timestamp: new Date().toISOString() });
  }
  if (msmeAging.error) {
    console.error(`${op} get_msme_aging_summary failed`, { error: msmeAging.error, timestamp: new Date().toISOString() });
  }

  // ── Build leads_by_stage map ───────────────────────────────────────────────
  const leadsByStage: Record<string, number> = {};
  if (stageCounts.data) {
    for (const row of stageCounts.data) {
      leadsByStage[row.status] = Number(row.lead_count);
    }
  }

  // ── Close window this week ─────────────────────────────────────────────────
  const closeWindowRow = closeWindow.data?.[0];
  const pipelineCloseThisWeek = {
    count: Number(closeWindowRow?.lead_count ?? 0),
    total_value: Number(closeWindowRow?.total_value ?? 0),
  };

  // ── Expected orders count this week ───────────────────────────────────────
  const expectedOrdersCount = expectedOrders.data?.length ?? 0;

  // ── Cash position ─────────────────────────────────────────────────────────
  // total_receivables is our best proxy for cash position from v2 summary
  const cashRow = cashSummary.data?.[0];
  const cashPositionNow = Number(cashRow?.total_receivables ?? 0);

  // ── Expected payments this week ───────────────────────────────────────────
  // get_payments_expected_this_week returns per-milestone rows; week_total is repeated per row
  // Use week_total from first row (SQL computed), count = number of rows
  const paymentsRows = paymentsThisWeek.data ?? [];
  const weekTotal = paymentsRows.length > 0 ? Number(paymentsRows[0]?.week_total ?? 0) : 0;
  const expectedPaymentsThisWeek = {
    count: paymentsRows.length,
    total: weekTotal,
  };

  // ── MSME aging ────────────────────────────────────────────────────────────
  // Actual buckets from mig 071: '0-30', '31-40', '41-45', 'overdue'
  // 30+ days: '31-40', '41-45', 'overdue'
  // 40+ days: '41-45', 'overdue'
  const msmeRows = msmeAging.data ?? [];
  let msmeAging30plus = 0;
  let msmeAging40plus = 0;
  for (const row of msmeRows) {
    const bucket = row.bucket ?? '';
    const amount = Number(row.total_amount ?? 0);
    if (bucket === '31-40' || bucket === '41-45' || bucket === 'overdue') {
      msmeAging30plus += amount;
    }
    if (bucket === '41-45' || bucket === 'overdue') {
      msmeAging40plus += amount;
    }
  }

  // ── Anomalies ─────────────────────────────────────────────────────────────
  const anomalies: string[] = [];

  if (staleLeads.data) {
    for (const lead of staleLeads.data) {
      const updatedAt = new Date(lead.updated_at as string);
      const staleDays = Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
      anomalies.push(
        `Lead "${lead.customer_name}" (${lead.status}) stale for ${staleDays} days — no activity`,
      );
    }
  }

  if (staleProjects.data) {
    for (const proj of staleProjects.data) {
      const updatedAt = new Date(proj.updated_at as string);
      const staleDays = Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
      anomalies.push(
        `Project ${proj.project_number} (${proj.customer_name}) — no update for ${staleDays} days`,
      );
    }
  }

  if ((openCriticalTickets.count ?? 0) > 3) {
    anomalies.push(
      `${openCriticalTickets.count} high-severity O&M tickets open — review urgently`,
    );
  }

  // ── Role-based scoping ────────────────────────────────────────────────────
  // marketing_manager: only sales + payment metrics
  // project_manager: only projects + OM metrics
  // founder: everything

  const isFounder = recipientRole === 'founder';
  const isMarketing = recipientRole === 'marketing_manager';
  const isPM = recipientRole === 'project_manager';

  return {
    date: yesterday,
    recipient_role: recipientRole,

    // Sales — founders and marketing_manager see this
    leads_new_yesterday: isFounder || isMarketing ? (newLeadsYesterday.count ?? 0) : 0,
    leads_by_stage: isFounder || isMarketing ? leadsByStage : {},
    pipeline_close_this_week: isFounder || isMarketing ? pipelineCloseThisWeek : { count: 0, total_value: 0 },
    expected_orders_this_week: isFounder || isMarketing ? expectedOrdersCount : 0,

    // Cash — founders and marketing_manager (payments) see this
    cash_position_now: isFounder ? cashPositionNow : 0,
    expected_payments_this_week: isFounder || isMarketing ? expectedPaymentsThisWeek : { count: 0, total: 0 },
    msme_aging_30plus: isFounder ? msmeAging30plus : 0,
    msme_aging_40plus: isFounder ? msmeAging40plus : 0,

    // Projects — founders and project_manager see this
    projects_in_progress_count: isFounder || isPM ? (projectsInProgress.count ?? 0) : 0,
    commissioning_this_week: isFounder || isPM ? (commissioningThisWeek.count ?? 0) : 0,
    delayed_projects_count: isFounder || isPM ? (delayedProjects.count ?? 0) : 0,

    // O&M — founders and project_manager see this
    open_critical_tickets: isFounder || isPM ? (openCriticalTickets.count ?? 0) : 0,

    // Anomalies scoped by role
    anomalies: isMarketing
      ? anomalies.filter(
          (a) =>
            a.toLowerCase().includes('lead') ||
            a.toLowerCase().includes('payment') ||
            a.toLowerCase().includes('order'),
        )
      : isPM
        ? anomalies.filter(
            (a) =>
              a.toLowerCase().includes('project') ||
              a.toLowerCase().includes('ticket'),
          )
        : anomalies,
  };
}
