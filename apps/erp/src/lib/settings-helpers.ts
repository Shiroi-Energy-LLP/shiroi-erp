/**
 * Pure validation helpers for the Settings page.
 *
 * These run on the client for fast feedback and are ALSO called from the
 * server actions as defence-in-depth. Keep them free of Supabase / framework
 * imports so they stay unit-testable.
 */

export type ValidationResult = { ok: true } | { ok: false; error: string };

// Supabase Auth's default minimum is 6 characters. Raise via the Supabase
// dashboard if tighter rules are ever desired — do not reimplement here.
const MIN_PASSWORD_LENGTH = 6;

export function validateNewPassword(newPassword: string, confirmPassword: string): ValidationResult {
  if (!newPassword) return { ok: false, error: 'New password is required' };
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (newPassword !== confirmPassword) return { ok: false, error: 'Passwords do not match' };
  return { ok: true };
}

export const BUG_REPORT_CATEGORIES = ['bug', 'feature_request', 'question', 'other'] as const;
export type BugReportCategory = (typeof BUG_REPORT_CATEGORIES)[number];

export const BUG_REPORT_SEVERITIES = ['low', 'medium', 'high'] as const;
export type BugReportSeverity = (typeof BUG_REPORT_SEVERITIES)[number];

export const BUG_REPORT_CATEGORY_LABEL: Record<BugReportCategory, string> = {
  bug: 'Bug',
  feature_request: 'Feature request',
  question: 'Question',
  other: 'Other',
};

export const BUG_REPORT_SEVERITY_LABEL: Record<BugReportSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export interface BugReportDraft {
  category: BugReportCategory;
  severity: BugReportSeverity;
  description: string;
}

export function validateBugReport(draft: BugReportDraft): ValidationResult {
  if (!draft.description) return { ok: false, error: 'Description is required' };
  if (draft.description.trim().length < 10) {
    return { ok: false, error: 'Description must be at least 10 characters' };
  }
  if (!BUG_REPORT_CATEGORIES.includes(draft.category)) {
    return { ok: false, error: 'Invalid category' };
  }
  if (!BUG_REPORT_SEVERITIES.includes(draft.severity)) {
    return { ok: false, error: 'Invalid severity' };
  }
  return { ok: true };
}
