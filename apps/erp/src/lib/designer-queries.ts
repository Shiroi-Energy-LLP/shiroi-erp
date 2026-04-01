import { createClient } from '@repo/supabase/server';

export interface DesignerDashboardData {
  pendingDesigns: number;
  inProgress: number;
  completedThisMonth: number;
  queueLength: number;
  designQueue: Array<{
    id: string;
    customer_name: string;
    phone: string;
    city: string;
    estimated_size_kwp: number | null;
    status_updated_at: string;
    daysWaiting: number;
  }>;
  employeeId: string | null;
}

async function getEmployeeId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
): Promise<string | null> {
  const op = '[designer/getEmployeeId]';
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, profileId });
    return null;
  }
  return data?.id ?? null;
}

export async function getDesignerDashboardData(profileId: string): Promise<DesignerDashboardData> {
  const op = '[getDesignerDashboardData]';
  console.log(`${op} Starting for: ${profileId}`);

  const supabase = await createClient();
  const employeeId = await getEmployeeId(supabase, profileId);

  if (!employeeId) {
    console.warn(`${op} No active employee found for profile: ${profileId}`);
    return {
      pendingDesigns: 0,
      inProgress: 0,
      completedThisMonth: 0,
      queueLength: 0,
      designQueue: [],
      employeeId: null,
    };
  }

  // Start of current month in IST
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split('T')[0];

  const [
    pendingLeadsResult,
    inProgressResult,
    completedResult,
  ] = await Promise.all([
    // Leads at site_survey_done status (awaiting design)
    supabase
      .from('leads')
      .select('id, customer_name, phone, city, estimated_size_kwp, status_updated_at')
      .eq('status', 'site_survey_done')
      .is('deleted_at', null)
      .order('status_updated_at', { ascending: true }),

    // Proposals in draft by this designer
    supabase
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('prepared_by', employeeId)
      .eq('status', 'draft'),

    // Proposals sent or accepted this month by this designer
    supabase
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('prepared_by', employeeId)
      .in('status', ['sent', 'viewed', 'negotiating', 'accepted'])
      .gte('sent_at', monthStartStr),
  ]);

  if (pendingLeadsResult.error) {
    console.error(`${op} Pending leads query failed:`, {
      code: pendingLeadsResult.error.code,
      message: pendingLeadsResult.error.message,
    });
    throw new Error(`Failed to load pending leads: ${pendingLeadsResult.error.message}`);
  }

  if (inProgressResult.error) {
    console.error(`${op} In-progress query failed:`, {
      code: inProgressResult.error.code,
      message: inProgressResult.error.message,
    });
    throw new Error(`Failed to load in-progress proposals: ${inProgressResult.error.message}`);
  }

  if (completedResult.error) {
    console.error(`${op} Completed query failed:`, {
      code: completedResult.error.code,
      message: completedResult.error.message,
    });
    throw new Error(`Failed to load completed proposals: ${completedResult.error.message}`);
  }

  const pendingLeads = pendingLeadsResult.data ?? [];

  // Calculate days waiting for each lead
  const todayMs = Date.now();
  const designQueue = pendingLeads.map((lead) => {
    const surveyDate = new Date(lead.status_updated_at);
    const daysWaiting = Math.max(0, Math.floor((todayMs - surveyDate.getTime()) / (1000 * 60 * 60 * 24)));
    return {
      id: lead.id,
      customer_name: lead.customer_name,
      phone: lead.phone,
      city: lead.city,
      estimated_size_kwp: lead.estimated_size_kwp,
      status_updated_at: lead.status_updated_at,
      daysWaiting,
    };
  });

  return {
    pendingDesigns: pendingLeads.length,
    inProgress: inProgressResult.count ?? 0,
    completedThisMonth: completedResult.count ?? 0,
    queueLength: pendingLeads.length,
    designQueue,
    employeeId,
  };
}
