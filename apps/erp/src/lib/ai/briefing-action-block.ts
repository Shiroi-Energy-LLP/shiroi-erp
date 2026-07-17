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
  customer_name: string | null;
  project_number: string | null;
}

export interface ActionBlockData {
  overdue: OverdueRow[];
  followupsToday: FollowupRow[];
  wonCount: number;
  wonValue: number;
}
export interface FounderActionBlockData {
  tasksDone24h: TaskDoneRow[];
  wonYesterday: WonLeadRow[];
  dueBeforeToday: OverdueRow[];
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
 * Founder (Vivek) block — Jul-17 spec: work done in 24h with the lead/project
 * name on every line ("what project was followed up yesterday"), leads Won
 * yesterday, all leads whose follow-up/close date is before today, leads
 * closing this week. Replaces the Jul-04 "Closed last week" list (Won
 * yesterday + Won MTD cover it). Lists capped so the block + AI short stay
 * inside the 900-char WhatsApp body.
 */
export function formatFounderActionBlock(d: FounderActionBlockData): string {
  const lines: string[] = [];

  lines.push(`🛠 Work done 24h (${d.tasksDone24h.length})`);
  if (d.tasksDone24h.length === 0) lines.push('(none)');
  pushCapped(lines, d.tasksDone24h, 5, (t) => {
    const title = (t.title ?? '—').slice(0, 28);
    const name = t.customer_name ?? t.project_number;
    return name ? `• ${title} — ${name.slice(0, 24)}` : `• ${title}`;
  });

  lines.push(`🏆 Won yesterday (${d.wonYesterday.length})`);
  if (d.wonYesterday.length === 0) lines.push('(none)');
  pushCapped(lines, d.wonYesterday, 5, (w) => `• ${w.customer_name ?? '—'} (${w.owner_name ?? 'unassigned'})`);

  lines.push(`⏰ Due before today (${d.dueBeforeToday.length})`);
  if (d.dueBeforeToday.length === 0) lines.push('(nothing overdue)');
  pushCapped(lines, d.dueBeforeToday, 8, (o) => {
    const which =
      (o.followup_overdue_days ?? 0) > 0
        ? `f/up ${o.followup_overdue_days}d`
        : `close ${o.close_overdue_days}d`;
    return `• ${o.customer_name ?? '—'} (${which})`;
  });

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
    const [tasksDone, wonYesterday, overdue, closing, wonMtd] = await Promise.all([
      // View joins each completed task to its lead/project so every line
      // carries the customer name (mig 203); 24h window computed in SQL.
      admin.from('v_digest_tasks_done_24h').select('title, customer_name, project_number').limit(50),
      admin.from('v_digest_leads_won_yesterday').select('customer_name, owner_name').limit(50),
      admin
        .from('v_digest_leads_overdue')
        .select('customer_name, owner_name, followup_overdue_days, close_overdue_days')
        .limit(50),
      admin.from('v_digest_leads_closing_this_week').select('customer_name, owner_name, expected_close_date').limit(50),
      admin.rpc('get_won_value_mtd'),
    ]);

    if (tasksDone.error) console.error(`${op} tasks-done failed`, { error: tasksDone.error, timestamp: new Date().toISOString() });
    if (wonYesterday.error) console.error(`${op} won-yesterday failed`, { error: wonYesterday.error, timestamp: new Date().toISOString() });
    if (overdue.error) console.error(`${op} due-before-today failed`, { error: overdue.error, timestamp: new Date().toISOString() });
    if (closing.error) console.error(`${op} closing-this-week failed`, { error: closing.error, timestamp: new Date().toISOString() });
    if (wonMtd.error) console.error(`${op} wonMtd failed`, { error: wonMtd.error, timestamp: new Date().toISOString() });

    const wonRow = (wonMtd.data as Array<{ won_count: number; won_value: number }> | null)?.[0];
    return {
      text: formatFounderActionBlock({
        tasksDone24h: tasksDone.data ?? [],
        wonYesterday: wonYesterday.data ?? [],
        dueBeforeToday: overdue.data ?? [],
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
