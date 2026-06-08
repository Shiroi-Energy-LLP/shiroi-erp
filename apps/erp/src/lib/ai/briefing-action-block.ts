import { createAdminClient } from '@repo/supabase/admin';
import { shortINR } from '@repo/ui/formatters';

// NOTE: no 'use server' — this module exports a sync formatter (formatActionBlock)
// alongside the async builder. It is imported only by the briefing route (server-side).

export interface OverdueRow {
  customer_name: string | null;
  owner_name: string | null;
  followup_overdue_days: number | null;
  close_overdue_days: number | null;
}
export interface FollowupRow {
  assignee_name: string | null;
  customer_name: string | null;
  title: string | null;
}
export interface ActionBlockData {
  overdue: OverdueRow[];
  followupsToday: FollowupRow[];
  wonCount: number;
  wonValue: number;
}
export interface ActionBlock {
  text: string;
  overdue_count: number;
  followups_today_count: number;
  won_mtd_value: number;
}

/**
 * Pure formatter — unit-tested. Goes into a WhatsApp template body parameter:
 * newlines are kept (matches existing digests); the send node strips tabs / 4+ spaces.
 * Lists are capped at 8 with a "+N more" tail so the body stays under Meta's limit.
 */
export function formatActionBlock(d: ActionBlockData): string {
  const lines: string[] = [];

  lines.push(`⚠ Overdue (${d.overdue.length})`);
  for (const o of d.overdue.slice(0, 8)) {
    const which =
      (o.followup_overdue_days ?? 0) > 0
        ? `f/up ${o.followup_overdue_days}d`
        : `close ${o.close_overdue_days}d`;
    lines.push(`• ${o.customer_name ?? '—'} (${o.owner_name ?? 'unassigned'}, ${which})`);
  }
  if (d.overdue.length > 8) lines.push(`…+${d.overdue.length - 8} more`);

  lines.push(`📋 Today's follow-ups (${d.followupsToday.length})`);
  for (const t of d.followupsToday.slice(0, 8)) {
    lines.push(`• ${t.customer_name ?? t.title ?? '—'} — ${t.assignee_name ?? 'unassigned'}`);
  }
  if (d.followupsToday.length > 8) lines.push(`…+${d.followupsToday.length - 8} more`);

  lines.push(`💰 Won this month: ${shortINR(d.wonValue)} (${d.wonCount})`);
  return lines.join('\n');
}

/** Fetch the three digest sources (admin/service-role) and format the block. */
export async function buildActionBlock(): Promise<ActionBlock> {
  const op = '[buildActionBlock]';
  const admin = createAdminClient();

  const [overdue, followups, wonMtd] = await Promise.all([
    admin
      .from('v_digest_leads_overdue')
      .select('customer_name, owner_name, followup_overdue_days, close_overdue_days')
      .limit(50),
    admin.from('v_digest_followup_tasks_today').select('assignee_name, customer_name, title').limit(50),
    admin.rpc('get_won_value_mtd'),
  ]);

  if (overdue.error) console.error(`${op} overdue failed`, { error: overdue.error, timestamp: new Date().toISOString() });
  if (followups.error) console.error(`${op} followups failed`, { error: followups.error, timestamp: new Date().toISOString() });
  if (wonMtd.error) console.error(`${op} wonMtd failed`, { error: wonMtd.error, timestamp: new Date().toISOString() });

  const wonRow = (wonMtd.data as Array<{ won_count: number; won_value: number }> | null)?.[0];
  const data: ActionBlockData = {
    overdue: overdue.data ?? [],
    followupsToday: followups.data ?? [],
    wonCount: Number(wonRow?.won_count ?? 0),
    wonValue: Number(wonRow?.won_value ?? 0),
  };

  return {
    text: formatActionBlock(data),
    overdue_count: data.overdue.length,
    followups_today_count: data.followupsToday.length,
    won_mtd_value: data.wonValue,
  };
}
