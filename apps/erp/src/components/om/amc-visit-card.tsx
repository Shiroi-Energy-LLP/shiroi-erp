'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Input, Label, Select } from '@repo/ui';
import {
  ChevronDown, ChevronRight, Upload, Loader2, Trash2, Download,
} from 'lucide-react';
import { formatDate, formatDateFromTimestamp } from '@repo/ui/formatters';
import { uploadProjectFile, getSignedFileUrl } from '@/lib/storage-client';
import {
  updateVisitDetails, updateVisitStatus, addVisitReportFile, rescheduleVisit,
  assignVisitEngineer, deleteAmcVisit,
  type AmcVisitDetailRow, type VisitEventRow,
} from '@/lib/amc-actions';
import { AttachmentLink } from '@/components/om/attachment-link';
import { AmcVisitTimeline } from '@/components/om/amc-visit-timeline';
import { VISIT_STATUS_OPTIONS, visitStatusVariant } from '@/lib/amc-constants';

interface AmcVisitCardProps {
  visit: AmcVisitDetailRow;
  contractId: string;
  employees: { id: string; full_name: string }[];
  events: VisitEventRow[];
  canDelete: boolean;
}

/** Storage paths carry no original filename — show the basename. */
function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function AmcVisitCard({ visit, contractId, employees, events, canDelete }: AmcVisitCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);

  const engineerName = visit.employees?.full_name ?? null;
  const doneByName = visit.done_by?.full_name ?? null;
  const reportPaths = visit.report_file_paths ?? [];
  const isOverdue =
    visit.scheduled_date < new Date().toISOString().split('T')[0]! &&
    visit.status !== 'completed' && visit.status !== 'cancelled';

  return (
    <div className="rounded-lg border border-n-200 bg-white">
      {/* ── Header — always visible summary ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-sm font-medium text-n-900 hover:text-shiroi-gold-dark"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Visit {visit.visit_number}
        </button>

        <span className={`text-sm ${isOverdue ? 'font-medium text-red-600' : 'text-n-700'}`}>
          {formatDate(visit.scheduled_date)}
          {isOverdue && ' · overdue'}
        </span>

        <Badge variant={visitStatusVariant(visit.status)} className="text-[11px] capitalize">
          {visit.status.replace(/_/g, ' ')}
        </Badge>

        <span className="text-xs text-n-500">
          Engineer: <span className="text-n-800">{engineerName ?? '—'}</span>
        </span>
        <span className="text-xs text-n-500">
          Done by: <span className="text-n-800">{doneByName ?? '—'}</span>
        </span>
        {visit.completed_at && (
          <span className="text-xs text-n-500">
            Completed: <span className="text-n-800">{formatDateFromTimestamp(visit.completed_at)}</span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {reportPaths.length > 0 && (
            <span className="text-xs text-green-700">
              {reportPaths.length} report{reportPaths.length !== 1 ? 's' : ''}
            </span>
          )}
          {events.length > 0 && (
            <span className="text-xs text-n-500">
              {events.length} update{events.length !== 1 ? 's' : ''}
            </span>
          )}
          {canDelete && <DeleteVisitButton visitId={visit.id} visitNumber={visit.visit_number} />}
        </div>
      </div>

      {/* ── Body ── */}
      {expanded && (
        <div className="space-y-5 border-t border-n-150 px-4 py-4">
          <VisitEditPanel
            visit={visit}
            employees={employees}
            onSaved={() => router.refresh()}
          />

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-n-500">
              Service Reports
            </h3>
            <VisitReports
              visitId={visit.id}
              contractId={contractId}
              reportPaths={reportPaths}
              onUploaded={() => router.refresh()}
            />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-n-500">
              Work Activity
            </h3>
            <AmcVisitTimeline visitId={visit.id} events={events} />
          </section>
        </div>
      )}
    </div>
  );
}

// ── Delete visit ────────────────────────────────────────────────────────────

function DeleteVisitButton({ visitId, visitNumber }: { visitId: string; visitNumber: number }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm(`Delete Visit ${visitNumber}? Its work activity is removed too. Uploaded reports stay in storage.`)) return;
    setDeleting(true);
    const result = await deleteAmcVisit(visitId);
    setDeleting(false);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error ?? 'Failed to delete visit');
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="text-n-400 hover:text-red-600"
      title={`Delete Visit ${visitNumber}`}
    >
      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}

// ── Reports: view + download + upload ───────────────────────────────────────

function VisitReports({ visitId, contractId, reportPaths, onUploaded }: {
  visitId: string; contractId: string; reportPaths: string[]; onUploaded: () => void;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    const uploaded = await uploadProjectFile(`amc/${contractId}/${visitId}`, file, 'pdf');
    if (!uploaded) {
      setError('Upload failed');
      setUploading(false);
      e.target.value = '';
      return;
    }

    const result = await addVisitReportFile(visitId, uploaded.path);
    setUploading(false);
    e.target.value = '';
    if (result.success) {
      onUploaded();
    } else {
      setError(result.error ?? 'Failed to record report');
    }
  }

  /** Signed URL with the `download` flag so the browser saves instead of previews. */
  async function handleDownload(path: string) {
    setDownloading(path);
    const url = await getSignedFileUrl(path, baseName(path));
    setDownloading(null);
    if (!url) {
      setError('Could not download report');
      return;
    }
    window.location.href = url;
  }

  return (
    <div className="space-y-2">
      {reportPaths.length === 0 ? (
        <p className="text-xs text-n-400">No reports uploaded for this visit yet.</p>
      ) : (
        <ul className="space-y-1">
          {reportPaths.map((path) => (
            <li
              key={path}
              className="flex items-center justify-between gap-2 rounded border border-n-150 px-2.5 py-1.5"
            >
              <AttachmentLink path={path} name={baseName(path)} />
              <button
                type="button"
                onClick={() => handleDownload(path)}
                disabled={downloading === path}
                className="flex-shrink-0 text-n-400 hover:text-shiroi-gold-dark"
                title="Download report"
              >
                {downloading === path
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-n-200 bg-white px-2.5 py-1.5 text-xs text-n-700 hover:bg-n-50">
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {uploading ? 'Uploading…' : 'Upload report'}
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={handleUpload}
          disabled={uploading}
        />
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ── Visit edit panel ────────────────────────────────────────────────────────

function VisitEditPanel({ visit, employees, onSaved }: {
  visit: AmcVisitDetailRow;
  employees: { id: string; full_name: string }[];
  onSaved: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState(visit.status);
  const [date, setDate] = React.useState(visit.scheduled_date || '');
  const [engineer, setEngineer] = React.useState(visit.assigned_to || '');
  const [workDone, setWorkDone] = React.useState(visit.work_done || '');
  const [issues, setIssues] = React.useState(visit.issues_identified || '');
  const [resolution, setResolution] = React.useState(visit.resolution_details || '');
  const [feedback, setFeedback] = React.useState(visit.customer_feedback || '');
  const [notes, setNotes] = React.useState(visit.notes || '');

  async function handleSave() {
    setSaving(true);
    setError(null);

    const detail = await updateVisitDetails({
      visitId: visit.id,
      work_done: workDone,
      issues_identified: issues,
      resolution_details: resolution,
      customer_feedback: feedback,
      notes,
    });
    if (!detail.success) {
      setError(detail.error ?? 'Failed to save visit details');
      setSaving(false);
      return;
    }

    if (status !== visit.status) {
      const res = await updateVisitStatus(visit.id, status);
      if (!res.success) {
        setError(res.error ?? 'Failed to update status');
        setSaving(false);
        return;
      }
    }

    if (date !== visit.scheduled_date) {
      const res = await rescheduleVisit({ visitId: visit.id, newDate: date });
      if (!res.success) {
        setError(res.error ?? 'Failed to reschedule');
        setSaving(false);
        return;
      }
    }

    if (engineer !== (visit.assigned_to || '')) {
      const res = await assignVisitEngineer(visit.id, engineer);
      if (!res.success) {
        setError(res.error ?? 'Failed to assign engineer');
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-n-500">Visit Details</h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label className="text-xs">Scheduled Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 text-xs">
            {VISIT_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Engineer</Label>
          <Select value={engineer} onChange={(e) => setEngineer(e.target.value)} className="h-8 text-xs">
            <option value="">— Unassigned —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Customer Feedback</Label>
          <Input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Customer feedback…"
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div>
          <Label className="text-xs">Work Done</Label>
          <textarea
            value={workDone}
            onChange={(e) => setWorkDone(e.target.value)}
            rows={3}
            placeholder="Maintenance activities…"
            className="w-full rounded border border-n-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-gold"
          />
        </div>
        <div>
          <Label className="text-xs">Issues Identified</Label>
          <textarea
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
            rows={3}
            placeholder="Faults or observations…"
            className="w-full rounded border border-n-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-gold"
          />
        </div>
        <div>
          <Label className="text-xs">Resolution Details</Label>
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={3}
            placeholder="How issues were resolved…"
            className="w-full rounded border border-n-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-gold"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Notes</Label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional notes…"
          className="h-8 text-xs"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Visit'}
        </Button>
      </div>
    </section>
  );
}
