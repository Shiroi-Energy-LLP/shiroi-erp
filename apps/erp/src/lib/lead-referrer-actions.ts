'use server';

import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { requireAuthUser } from '@/lib/auth';

const ALLOWED_ROLES = new Set(['founder', 'marketing_manager', 'sales_engineer']);

// ── setLeadReferrer ───────────────────────────────────────────────────────────

/**
 * Sets or clears the referrer (channel_partner_id) on a lead.
 * Allowed roles: founder, marketing_manager, sales_engineer.
 */
export async function setLeadReferrer(
  leadId: string,
  channelPartnerId: string | null,
): Promise<ActionResult<null>> {
  const op = '[setLeadReferrer]';

  if (!leadId) {
    console.error(`${op} Missing leadId`);
    return err('Missing lead ID');
  }

  const authed = await requireAuthUser();
  if (!authed.success) {
    console.warn(`${op} Not authenticated`);
    return authed;
  }
  const { user, supabase } = authed.data;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = (profile?.role as string) ?? null;

  if (!role || !ALLOWED_ROLES.has(role)) {
    console.warn(`${op} Role not allowed`, { role, leadId });
    return err('Only founders, marketing managers, and sales engineers can change the referrer');
  }

  try {
    const { error } = await supabase
      .from('leads')
      .update({ channel_partner_id: channelPartnerId })
      .eq('id', leadId);

    if (error) {
      console.error(`${op} Update failed`, {
        code: error.code,
        message: error.message,
        leadId,
        channelPartnerId,
        timestamp: new Date().toISOString(),
      });
      return err(error.message, error.code);
    }

    revalidatePath(`/leads/${leadId}`);
    revalidatePath('/sales');

    return ok(null);
  } catch (e) {
    console.error(`${op} Unexpected error`, {
      error: e instanceof Error ? e.message : String(e),
      leadId,
      timestamp: new Date().toISOString(),
    });
    return err(e instanceof Error ? e.message : 'Unexpected error');
  }
}
