/**
 * 48-hour lock logic for daily site reports (Tier 2 immutability).
 *
 * Lock is based on report_date (TEXT 'YYYY-MM-DD'), NOT created_at.
 * After 48h from the END of report_date (i.e., midnight IST of that day + 48h),
 * the report becomes locked. Direct edits are no longer possible — only
 * correction requests (Tier 2) are allowed.
 */

const LOCK_HOURS = 48;

/**
 * Returns true if a report should be considered locked.
 * A report is locked if:
 *   - The is_locked flag is already true in the DB, OR
 *   - More than 48h have passed since the end of report_date (IST midnight)
 */
export function isReportLocked(reportDate: string, isLockedFlag?: boolean): boolean {
  if (isLockedFlag) return true;

  const deadlineMs = getLockDeadlineMs(reportDate);
  return Date.now() >= deadlineMs;
}

/**
 * Returns the number of hours remaining until the report auto-locks.
 * Returns 0 if already locked.
 */
export function hoursUntilLock(reportDate: string, isLockedFlag?: boolean): number {
  if (isLockedFlag) return 0;

  const deadlineMs = getLockDeadlineMs(reportDate);
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (60 * 60 * 1000));
}

/**
 * Returns true if the report can still be directly edited (not locked).
 */
export function canEditReport(reportDate: string, isLocked: boolean): boolean {
  return !isReportLocked(reportDate, isLocked);
}

/**
 * Returns the lock deadline as epoch ms.
 * Lock triggers at: report_date (interpreted as IST midnight) + 48h.
 *
 * We parse the YYYY-MM-DD as IST midnight, then add 48h.
 */
function getLockDeadlineMs(reportDate: string): number {
  // Parse as IST midnight (UTC+05:30). reportDate is 'YYYY-MM-DD'.
  const istMidnight = new Date(`${reportDate}T00:00:00+05:30`);
  return istMidnight.getTime() + LOCK_HOURS * 60 * 60 * 1000;
}
