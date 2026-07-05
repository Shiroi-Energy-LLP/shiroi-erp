import { createAdminClient } from '@repo/supabase/admin';
import { shortINR } from '@repo/ui/formatters';

// NOTE: no 'use server' — this module exports sync formatters (unit-tested)
// alongside the async builder. It is imported only by the briefing route (server-side).

// ── Row shapes ────────────────────────────────────────────────────────────────

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
export interface WonLeadRow {
  customer_name: string | null;
  owner_name: string | null;
}
export interface ClosingLeadRow {
  customer_name: string | null;
  owner_name: string | null;
  expected_close_date: string | null;
}
export interface TaskDoneRow {
  title: string | null;
}

export interface ActionBlockData {
  overdue: OverdueRow[];
  followupsToday: FollowupRow[];
  wonCount: number;
  wonValue: number;
}
export interface FounderActionBlockData {
  wonLastWeek: WonLeadRow[];
  tasksDone24h: TaskDoneRow[];
  closingThisWeek: ClosingLeadRow[];
  wonCount: number;
  wonValue: number;
}
export interface SalesActionBlockData {
  followupOverdue: OverdueRow[];
  closingThisWeek: ClosingLeadRow[];
}
export interface ActionBlock {
  text: string;
}

// ── Shared list helpers ───────────────────────────────────────────────────────

/** "2026-07-08" → "08 Jul" for compact WhatsApp lines. */
function shortDate(iso: string | null): string {
  if (!iso || iso.length < 10) return '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = Number(iso.slice(5, 7));
  return `${iso.slice(8, 10)} ${months[m - 1] ?? '—'}`;
}

function pushCapped<T>(lines: string[], rows: T[], cap: number, render: (r: T) => string): void {
  for (const r of rows.slice(0, cap)) lines.push(render(r));
  if (rows.length > cap) lines.push(`…+${rows.length - cap} more`);
}

/**
 * Founder (Vivek) block — Jul-04 spec: leads closed last week (names), work
 * done, leads closing this week (names). No follow-up sections. Lists capped
 * at 5 so the block + AI short stay inside the 900-char WhatsApp body.
 */
export function formatFounderActionBlock(d: FounderActionBlockData): string {
  const lines: string[] = [];

  lines.push(`✅ Closed last week (${d.wonLastWeek.length})`);
  if (d.wonLastWeek.length === 0) lines.push('(none)');
  pushCapped(lines, d.wonLastWeek, 5, (w) => `• ${w.customer_name ?? '—'} (${w.owner_name ?? 'unassigned'})`);

  lines.push(`🛠 Work done 24h (${d.tasksDone24h.length})`);
  if (d.tasksDone24h.length === 0) lines.push('(none)');
  pushCapped(lines, d.tasksDone24h, 5, (t) => `• ${(t.title ?? '—').slice(0, 45)}`);

  lines.push(`📈 Closing this week (${d.closingThisWeek.length})`);
  if (d.closingThisWeek.length === 0) lines.push('(none forecast)');
  pushCapped(lines, d.closingThisWeek, 5, (c) => `• ${c.customer_name ?? '—'} (${shortDate(c.expected_close_date)})`);

  lines.push(`💰 Won this month: ${shortINR(d.wonValue)} (${d.wonCount})`);
  return lines.join('\n');
}

/**
 * Sales-head (Prem) block — Jul-04 spec: flag leads whose follow-up date is
 * before today, and remind him of the leads closing this week.
 */
export function formatSalesActionBlock(d: SalesActionBlockData): string {
  const lines: string[] = [];

  lines.push(`⚠ Follow-up overdue (${d.followupOverdue.length})`);
  if (d.followupOverdue.length === 0) lines.push('(all follow-ups on time)');
  pushCapped(lines, d.followupOverdue, 8, (o) => `• ${o.customer_name ?? '—'} — ${o.followup_overdue_days ?? 0}d overdue`);

  lines.push(`📈 Closing this week (${d.closingThisWeek.length}) — stay on these`);
  if (d.closingThisWeek.length === 0) lines.push('(none forecast)');
  pushCapped(lines, d.closingThisWeek, 8, (c) => `• ${c.customer_name ?? '—'} (${shortDate(c.expected_close_date)})`);

  return lines.join('\n');
}

/**
 * Legacy block (overdue + today's follow-ups + won MTD) — still used for the
 * project_manager briefing (Manivel) so his message is unchanged.
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

// ── Builder ───────────────────────────────────────────────────────────────────

type RecipientRole = 'founder' | 'marketing_manager' | 'project_manager';

/** Fetch role-scoped digest sources (admin/service-role) and format the block. */
export async function buildActionBlock(role: RecipientRole): Promise<ActionBlock> {
  const op = '[buildActionBlock]';
  const admin = createAdminClient();

  if (role === 'founder') {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [won, tasksDone, closing, wonMtd] = await Promise.all([
      admin.from('v_digest_leads_won_last_week').select('customer_name, owner_name').limit(50),
      admin
        .from('tasks')
        .select('title')
        .eq('is_completed', true)
        .gte('completed_at', since24h)
        .is('deleted_at', null)
        .limit(50),
      admin.from('v_digest_leads_closing_this_week').select('customer_name, owner_name, expected_close_date').limit(50),
      admin.rpc('get_won_value_mtd'),
    ]);

    if (won.error) console.error(`${op} won-last-week failed`, { error: won.error, timestamp: new Date().toISOString() });
    if (tasksDone.error) console.error(`${op} tasks-done failed`, { error: tasksDone.error, timestamp: new Date().toISOString() });
    if (closing.error) console.error(`${op} closing-this-week failed`, { error: closing.error, timestamp: new Date().toISOString() });
    if (wonMtd.error) console.error(`${op} wonMtd failed`, { error: wonMtd.error, timestamp: new Date().toISOString() });

    const wonRow = (wonMtd.data as Array<{ won_count: number; won_value: number }> | null)?.[0];
    return {
      text: formatFounderActionBlock({
        wonLastWeek: won.data ?? [],
        tasksDone24h: tasksDone.data ?? [],
        closingThisWeek: closing.data ?? [],
        wonCount: Number(wonRow?.won_count ?? 0),
        wonValue: Number(wonRow?.won_value ?? 0),
      }),
    };
  }

  if (role === 'marketing_manager') {
    const [overdue, closing] = await Promise.all([
      // followup_overdue_days is GREATEST(0, today - next_followup_date), so
      // gt.0 keeps exactly the "follow-up date before today" rows Vivek asked
      // to flag for Prem (and drops close-date-only overdues).
      admin
        .from('v_digest_leads_overdue')
        .select('customer_name, owner_name, followup_overdue_days, close_overdue_days')
        .gt('followup_overdue_days', 0)
        .limit(50),
      admin.from('v_digest_leads_closing_this_week').select('customer_name, owner_name, expected_close_date').limit(50),
    ]);

    if (overdue.error) console.error(`${op} followup-overdue failed`, { error: overdue.error, timestamp: new Date().toISOString() });
    if (closing.error) console.error(`${op} closing-this-week failed`, { error: closing.error, timestamp: new Date().toISOString() });

    return {
      text: formatSalesActionBlock({
        followupOverdue: overdue.data ?? [],
        closingThisWeek: closing.data ?? [],
      }),
    };
  }

  // project_manager — legacy block, unchanged.
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
  return {
    text: formatActionBlock({
      overdue: overdue.data ?? [],
      followupsToday: followups.data ?? [],
      wonCount: Number(wonRow?.won_count ?? 0),
      wonValue: Number(wonRow?.won_value ?? 0),
    }),
  };
}
