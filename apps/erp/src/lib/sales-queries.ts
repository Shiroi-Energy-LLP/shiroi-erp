import { createClient } from '@repo/supabase/server';
import Decimal from 'decimal.js';

export interface SalesDashboardData {
  newLeadsThisMonth: number;
  pipelineValue: number;
  wonThisMonth: number;
  conversionRate: number;
  followUpsToday: Array<{
    id: string;
    customer_name: string;
    phone: string;
    city: string;
    status: string;
    next_followup_date: string;
  }>;
  leadFunnel: Array<{ status: string; count: number }>;
  employeeId: string | null;
}

export async function getSalesDashboardData(profileId: string): Promise<SalesDashboardData> {
  const op = '[getSalesDashboardData]';
  console.log(`${op} Starting for: ${profileId}`);

  const supabase = await createClient();

  // Get employee ID
  const { data: emp, error: empError } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .single();

  if (empError) {
    console.error(`${op} Employee lookup failed:`, { code: empError.code, message: empError.message, profileId });
  }
  const employeeId = emp?.id ?? null;

  // Dates
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split('T')[0];
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const [
    newLeadsResult,
    pipelineResult,
    wonResult,
    qualifiedResult,
    followUpsResult,
    funnelResult,
  ] = await Promise.all([
    // New leads this month (assigned to this sales engineer or all)
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStartStr)
      .is('deleted_at', null),

    // Pipeline value (active proposals)
    supabase
      .from('proposals')
      .select('total_after_discount')
      .in('status', ['draft', 'sent', 'viewed', 'negotiating']),

    // Won this month
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'won')
      .gte('converted_at', monthStartStr)
      .is('deleted_at', null),

    // Total qualified leads this month (for conversion rate)
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('is_qualified', true)
      .gte('created_at', monthStartStr)
      .is('deleted_at', null),

    // Follow-ups today
    supabase
      .from('leads')
      .select('id, customer_name, phone, city, status, next_followup_date')
      .eq('next_followup_date', todayStr)
      .is('deleted_at', null)
      .not('status', 'in', '(won,lost,disqualified)')
      .order('customer_name'),

    // All active leads for funnel
    supabase
      .from('leads')
      .select('status')
      .is('deleted_at', null)
      .not('status', 'in', '(lost,disqualified)'),
  ]);

  if (newLeadsResult.error) {
    console.error(`${op} New leads query failed:`, { code: newLeadsResult.error.code, message: newLeadsResult.error.message });
    throw new Error(`Failed to load new leads: ${newLeadsResult.error.message}`);
  }

  if (pipelineResult.error) {
    console.error(`${op} Pipeline query failed:`, { code: pipelineResult.error.code, message: pipelineResult.error.message });
    throw new Error(`Failed to load pipeline: ${pipelineResult.error.message}`);
  }

  if (wonResult.error) {
    console.error(`${op} Won leads query failed:`, { code: wonResult.error.code, message: wonResult.error.message });
    throw new Error(`Failed to load won leads: ${wonResult.error.message}`);
  }

  if (qualifiedResult.error) {
    console.error(`${op} Qualified leads query failed:`, { code: qualifiedResult.error.code, message: qualifiedResult.error.message });
  }

  if (followUpsResult.error) {
    console.error(`${op} Follow-ups query failed:`, { code: followUpsResult.error.code, message: followUpsResult.error.message });
  }

  if (funnelResult.error) {
    console.error(`${op} Funnel query failed:`, { code: funnelResult.error.code, message: funnelResult.error.message });
  }

  // Calculate pipeline value with decimal.js
  const pipelineTotal = (pipelineResult.data ?? []).reduce(
    (sum, p) => sum.add(new Decimal(p.total_after_discount ?? '0')),
    new Decimal(0),
  );

  // Conversion rate
  const wonCount = wonResult.count ?? 0;
  const qualifiedCount = qualifiedResult.count ?? 0;
  const conversionRate = qualifiedCount > 0
    ? Math.round((wonCount / qualifiedCount) * 100)
    : 0;

  // Lead funnel
  const funnelMap = new Map<string, number>();
  const funnelOrder = ['new', 'contacted', 'site_survey_scheduled', 'site_survey_done', 'proposal_sent', 'negotiation', 'won', 'on_hold'];
  for (const lead of (funnelResult.data ?? [])) {
    const status = lead.status ?? 'unknown';
    funnelMap.set(status, (funnelMap.get(status) ?? 0) + 1);
  }
  const leadFunnel = funnelOrder
    .filter((s) => funnelMap.has(s))
    .map((status) => ({ status, count: funnelMap.get(status) ?? 0 }));

  const followUps = (followUpsResult.data ?? []).map((l) => ({
    id: l.id,
    customer_name: l.customer_name,
    phone: l.phone,
    city: l.city,
    status: l.status,
    next_followup_date: l.next_followup_date ?? todayStr,
  }));

  return {
    newLeadsThisMonth: newLeadsResult.count ?? 0,
    pipelineValue: pipelineTotal.toNumber(),
    wonThisMonth: wonCount,
    conversionRate,
    followUpsToday: followUps,
    leadFunnel,
    employeeId,
  };
}
