import { createAdminClient } from '@repo/supabase/admin';

export const PER_USER_DAILY_CAP = 5;

/**
 * howManyMoreCanThisUserReceive — returns how many more AI-suggested tasks
 * can be created for the given employee today (rolling 24-hour window).
 *
 * AI-suggested tasks are identified by title prefix '[AI] '.
 * Returns max(0, CAP - count_today).
 */
export async function howManyMoreCanThisUserReceive(employeeId: string): Promise<number> {
  const op = '[howManyMoreCanThisUserReceive]';
  const admin = createAdminClient();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', employeeId)
    .gt('created_at', since)
    .like('title', '[AI] %')
    .is('deleted_at', null);

  if (error) {
    console.error(`${op} Cap query failed:`, {
      employeeId,
      error,
      timestamp: new Date().toISOString(),
    });
    // Fail safe: treat as no capacity remaining to avoid spam on DB errors
    return 0;
  }

  const todayCount = count ?? 0;
  return Math.max(0, PER_USER_DAILY_CAP - todayCount);
}
