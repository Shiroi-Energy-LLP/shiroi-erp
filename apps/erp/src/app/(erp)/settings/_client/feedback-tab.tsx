'use client';
import type { Database } from '@repo/types/database';

type BugReportRow = Database['public']['Tables']['bug_reports']['Row'];

interface Props {
  myReports: BugReportRow[];
}

export function FeedbackTab({ myReports }: Props) {
  return <div className="text-sm text-n-600">Feedback tab — {myReports.length} past reports</div>;
}
