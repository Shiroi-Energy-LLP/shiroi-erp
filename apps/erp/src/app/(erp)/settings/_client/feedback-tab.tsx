'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  Badge,
  Button,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui';
import type { Database } from '@repo/types/database';
import { submitBugReport } from '@/lib/settings-actions';
import {
  BUG_REPORT_CATEGORIES,
  BUG_REPORT_CATEGORY_LABEL,
  BUG_REPORT_SEVERITIES,
  BUG_REPORT_SEVERITY_LABEL,
  validateBugReport,
  type BugReportCategory,
  type BugReportSeverity,
} from '@/lib/settings-helpers';

type BugReportRow = Database['public']['Tables']['bug_reports']['Row'];

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'pending'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral';

interface FeedbackTabProps {
  myReports: BugReportRow[];
}

export function FeedbackTab({ myReports }: FeedbackTabProps) {
  const [category, setCategory] = useState<BugReportCategory>('bug');
  const [severity, setSeverity] = useState<BugReportSeverity>('medium');
  const [description, setDescription] = useState('');
  const [pageUrl, setPageUrl] = useState<string>('/settings');
  const [userAgent, setUserAgent] = useState<string>('');
  const [pending, startTransition] = useTransition();
  const { addToast } = useToast();

  useEffect(() => {
    // Capture referrer + UA once on mount (client-only).
    if (typeof window !== 'undefined') {
      setPageUrl(document.referrer || window.location.pathname);
      setUserAgent(navigator.userAgent);
    }
  }, []);

  const validation = useMemo(
    () => validateBugReport({ category, severity, description }),
    [category, severity, description],
  );
  const canSubmit = validation.ok && !pending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await submitBugReport({
        category,
        severity,
        description: description.trim(),
        pageUrl,
        userAgent,
      });
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not submit report',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'Report submitted',
        description: "Thanks — we've got it.",
      });
      setDescription('');
    });
  }

  return (
    <div className="space-y-6">
      {/* Submit form */}
      <section className="space-y-4 rounded-md border border-n-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-n-900">Report a bug or request a feature</h2>
        <form onSubmit={handleSubmit} className="space-y-3 max-w-lg">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="category">Category</Label>
              <Select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value as BugReportCategory)}
                disabled={pending}
              >
                {BUG_REPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUG_REPORT_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="severity">Severity</Label>
              <Select
                id="severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as BugReportSeverity)}
                disabled={pending}
              >
                {BUG_REPORT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {BUG_REPORT_SEVERITY_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
              rows={5}
              className="w-full rounded-md border border-n-300 bg-white px-3 py-2 text-sm text-n-900 placeholder:text-n-400 focus:outline-none focus:ring-2 focus:ring-shiroi-green focus:border-transparent"
              placeholder="What happened? What did you expect to happen?"
            />
            <p className="text-xs text-n-500">
              {description.trim().length} / 10 characters minimum
            </p>
          </div>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? 'Submitting…' : 'Submit report'}
          </Button>
        </form>
      </section>

      {/* History */}
      <section className="space-y-2 rounded-md border border-n-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-n-900">Your past reports</h2>
        {myReports.length === 0 ? (
          <p className="text-sm text-n-500">You haven&apos;t submitted any reports yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submitted</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {myReports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-n-600">
                    {new Date(r.created_at).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Kolkata',
                    })}
                  </TableCell>
                  <TableCell>
                    {BUG_REPORT_CATEGORY_LABEL[r.category as BugReportCategory]}
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={r.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="max-w-[360px] truncate text-sm text-n-700">
                    {r.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: BugReportRow['severity'] }) {
  const variant: BadgeVariant =
    severity === 'high' ? 'destructive' : severity === 'medium' ? 'warning' : 'default';
  return <Badge variant={variant}>{BUG_REPORT_SEVERITY_LABEL[severity as BugReportSeverity]}</Badge>;
}

function StatusBadge({ status }: { status: BugReportRow['status'] }) {
  const label =
    status === 'in_progress' ? 'In progress' : status === 'resolved' ? 'Resolved' : 'Open';
  const variant: BadgeVariant =
    status === 'resolved' ? 'success' : status === 'in_progress' ? 'warning' : 'default';
  return <Badge variant={variant}>{label}</Badge>;
}
