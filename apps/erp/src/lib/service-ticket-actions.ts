'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createServiceTicket(input: {
  projectId: string;
  title: string;
  description: string;
  issueType: string;
  severity: string;
  assignedTo?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createServiceTicket]';
  console.log(`${op} Starting: ${input.title}`);

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

  // Generate ticket number
  const { data: lastTicket } = await supabase
    .from('om_service_tickets' as any)
    .select('ticket_number')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const nextNum = lastTicket
    ? parseInt((lastTicket as any).ticket_number?.split('-').pop() ?? '0', 10) + 1
    : 1;
  const ticketNumber = `TKT-${String(nextNum).padStart(4, '0')}`;

  const { error } = await supabase
    .from('om_service_tickets' as any)
    .insert({
      project_id: input.projectId,
      title: input.title,
      description: input.description,
      issue_type: input.issueType,
      severity: input.severity,
      status: 'open',
      ticket_number: ticketNumber,
      raised_by_employee: employee.id,
      assigned_to: input.assignedTo || null,
      sla_hours: input.severity === 'critical' ? 4 : input.severity === 'high' ? 24 : 48,
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/om/tickets');
  return { success: true };
}
