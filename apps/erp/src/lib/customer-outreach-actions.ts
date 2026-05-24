'use server';

/**
 * E10 — Customer Quarterly Check-in Outreach
 *
 * generateCustomerCheckinsForWeek: called by a weekly Monday cron (n8n).
 * Finds projects at 90/180/270 days post-commissioning with no outreach
 * in the last 90 days, generates a personalized Claude message, and
 * inserts rows into customer_outreach_queue.
 *
 * The n8n workflow 30-customer-checkin.json picks up 'message_generated'
 * rows and sends them via WhatsApp.
 */

import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { generateText } from './ai/anthropic-client';
import { emitErpEvent } from './n8n/emit';

const CHECKIN_INTERVALS_DAYS = [90, 180, 270, 365];
const RECONTACT_GAP_DAYS = 90;

const ALLOWED_ROLES = new Set(['founder', 'om_technician']);

export interface CustomerOutreachSummary {
  generated: number;
  skipped: number;
  errors: number;
}

/**
 * Generate outreach queue entries for this week's due check-ins.
 *
 * Designed to be called from a Monday morning cron via n8n or a script.
 * Uses the admin client to bypass RLS once the caller's role is verified
 * — founder + om_technician only. Anonymous or other-role callers are rejected
 * so this can't be abused to burn Anthropic quota.
 */
export async function generateCustomerCheckinsForWeek(): Promise<ActionResult<CustomerOutreachSummary>> {
  const op = '[generateCustomerCheckinsForWeek]';

  // Auth + role gate — admin client bypasses RLS, so we must check ourselves.
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return err('Your role cannot generate customer outreach');
  }

  const supabase = createAdminClient();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Find projects that have been commissioned and are due for check-in.
  // projects.commissioned_date is a DATE column (per 004a_projects_core.sql).
  const { data: projects, error: projErr } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp, system_type, site_city, commissioned_date')
    .not('commissioned_date', 'is', null)
    .in('status', ['completed', 'waiting_net_metering', 'meter_client_scope'])
    .order('commissioned_date', { ascending: false });

  if (projErr || !projects) {
    console.error(`${op} projects query failed`, { error: projErr?.message, timestamp: new Date().toISOString() });
    return err(projErr?.message ?? 'Failed to load projects');
  }

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const project of projects) {
    if (!project.commissioned_date) continue;

    const commissionedAt = new Date(project.commissioned_date);
    const daysSinceCommissioning = Math.floor(
      (today.getTime() - commissionedAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Find the nearest upcoming interval
    const dueInterval = CHECKIN_INTERVALS_DAYS.find((interval) => {
      const diff = Math.abs(daysSinceCommissioning - interval);
      return diff <= 7; // Within a week of the target interval
    });

    if (!dueInterval) {
      skipped++;
      continue;
    }

    // Check if we've already sent an outreach in the last RECONTACT_GAP_DAYS
    const { data: recent, error: recentErr } = await supabase
      .from('customer_outreach_queue')
      .select('id, checkin_due')
      .eq('project_id', project.id)
      .in('status', ['message_generated', 'sent', 'responded'])
      .gte('created_at', new Date(today.getTime() - RECONTACT_GAP_DAYS * 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (recentErr) {
      console.error(`${op} recent check query failed`, { projectId: project.id, error: recentErr.message, timestamp: new Date().toISOString() });
      errors++;
      continue;
    }

    if (recent && recent.length > 0) {
      skipped++;
      continue;
    }

    // Generate AI message
    const systemPrompt = `You are a friendly customer success representative for Shiroi Energy LLP, a solar installation company in Chennai, India.
Write warm, personalized WhatsApp messages to solar customers for quarterly check-ins.
Keep messages brief (2-3 sentences). Write in a friendly, professional Tamil Nadu business style.
Include the customer's name. Ask about their solar system's performance.`;

    const userMessage = `Write a WhatsApp check-in message for:
Customer: ${project.customer_name}
Project: ${project.project_number}
System: ${project.system_size_kwp} kWp solar, ${project.system_type ?? 'rooftop'}
Location: ${project.site_city ?? 'Chennai'}
Days since commissioning: ${daysSinceCommissioning} (${dueInterval}-day check-in)

The message should ask how their solar system is performing and if they have any concerns.
If it's the 90-day mark, also mention we'd like to verify everything is working optimally.
If it's the 365-day mark, mention their first solar anniversary.
Keep it to 2-3 sentences. Start with a greeting.`;

    const aiMessage = await generateText(systemPrompt, userMessage, 300);

    if (!aiMessage) {
      console.error(`${op} AI message generation failed for project ${project.id}`, { timestamp: new Date().toISOString() });
      errors++;
      continue;
    }

    // Insert into outreach queue
    const { error: insertErr } = await supabase
      .from('customer_outreach_queue')
      .insert({
        id: crypto.randomUUID(),
        project_id: project.id,
        checkin_due: todayStr,
        days_since_commissioning: daysSinceCommissioning,
        ai_message: aiMessage,
        message_generated_at: new Date().toISOString(),
        status: 'message_generated',
      });

    if (insertErr) {
      console.error(`${op} insert failed`, { projectId: project.id, error: insertErr.message, timestamp: new Date().toISOString() });
      errors++;
      continue;
    }

    // Emit event to n8n bus for WhatsApp send (best-effort; row is already in queue)
    await emitErpEvent('customer_checkin.due', {
      project_id: project.id,
      project_number: project.project_number,
      customer_name: project.customer_name,
      days_since_commissioning: daysSinceCommissioning,
      message: aiMessage,
    });

    generated++;
  }

  console.log(`${op} complete`, { generated, skipped, errors, timestamp: new Date().toISOString() });
  return ok({ generated, skipped, errors });
}

/**
 * List pending outreach queue entries.
 * For the O&M dashboard outreach monitoring view.
 */
export async function listPendingOutreach(limit = 50): Promise<ActionResult<Array<{
  id: string;
  project_id: string;
  project_number: string;
  customer_name: string;
  days_since_commissioning: number;
  checkin_due: string;
  ai_message: string | null;
  status: string;
  whatsapp_sent_at: string | null;
}>>> {
  const op = '[listPendingOutreach]';

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('customer_outreach_queue')
    .select(`
      id,
      project_id,
      days_since_commissioning,
      checkin_due,
      ai_message,
      status,
      whatsapp_sent_at,
      projects (project_number, customer_name)
    `)
    .not('status', 'in', '(responded,no_response)')
    .order('checkin_due', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`${op} query failed`, { error: error.message, timestamp: new Date().toISOString() });
    return err(error.message);
  }

  if (!data) return ok([]);

  return ok(
    data.map((row) => ({
      id: row.id,
      project_id: row.project_id,
      project_number: (row.projects as { project_number: string; customer_name: string } | null)?.project_number ?? '',
      customer_name: (row.projects as { project_number: string; customer_name: string } | null)?.customer_name ?? '',
      days_since_commissioning: row.days_since_commissioning,
      checkin_due: row.checkin_due,
      ai_message: row.ai_message,
      status: row.status,
      whatsapp_sent_at: row.whatsapp_sent_at,
    })),
  );
}
