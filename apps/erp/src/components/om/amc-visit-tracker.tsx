'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Input, Label, Select } from '@repo/ui';
import { ChevronDown, ChevronRight, Upload, FileText, X } from 'lucide-react';
import { formatDate } from '@repo/ui/formatters';
import { createClient } from '@repo/supabase/client';
import { getVisitsForContract, updateVisitDetails, updateVisitStatus, addVisitReportFile, rescheduleVisit, assignVisitEngineer } from '@/lib/amc-actions';

function visitStatusVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'outline' {
  switch (status) {
    case 'completed': return 'success';
    case 'scheduled': return 'info';
    case 'confirmed': return 'info';
    case 'rescheduled': return 'warning';
    case 'missed': return 'error';
    case 'cancelled': return 'outline';
    default: return 'outline';
  }
}

interface AmcVisitTrackerProps {
  contractId: string;
  visitsIncluded: number;
  employees: { id: string; full_name: string }[];
}

/**
 * Shows "2 / 3 completed" badge and expands to show full visit table.
 */
export function AmcVisitTracker({ contractId, visitsIncluded, employees }: AmcVisitTrackerProps) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);
  const [visits, setVisits] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [editingVisit, setEditingVisit] = React.useState<string | null>(null);

  async function loadVisits() {
    setLoading(true);
    const data = await getVisitsForContract(contractId);
    setVisits(data);
    setLoading(false);
  }

  function handleToggle() {
    if (!expanded) {
      loadVisits();
    }
    setExpanded(!expanded);
  }

  const completedCount = visits.filter((v) => v.status === 'completed').length;

  return (
    <div>
      {/* Summary badge — clickable */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-1 text-[11px] text-p-600 hover:text-p-700 transition-colors"
      >
        {expanded
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronRight className="h-3 w-3" />}
        <span className="font-medium">
          {expanded ? `${completedCount} / ${visits.length}` : `${visitsIncluded} visits`}
        </span>
      </button>

      {/* Expanded visit detail table */}
      {expanded && (
        <div className="mt-2 border border-n-200 rounded bg-white">
          {loading ? (
            <div className="p-3 text-[10px] text-n-400">Loading visits...</div>
          ) : visits.length === 0 ? (
            <div className="p-3 text-[10px] text-n-400">No visits generated yet.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-n-100 bg-n-50">
                  <th className="px-2 py-1 text-[9px] font-semibold text-n-500 text-left">#</th>
                  <th className="px-2 py-1 text-[9px] font-semibold text-n-500 text-left">Date</th>
                  <th className="px-2 py-1 text-[9px] font-semibold text-n-500 text-left">Engineer</th>
                  <th className="px-2 py-1 text-[9px] font-semibold text-n-500 text-left">Status</th>
                  <th className="px-2 py-1 text-[9px] font-semibold text-n-500 text-left">Done By</th>
                  <th className="px-2 py-1 text-[9px] font-semibold text-n-500 text-left">Reports</th>
                  <th className="px-2 py-1 text-[9px] font-semibold text-n-500 text-left w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((visit) => {
                  const engineerName = visit.employees && 'full_name' in visit.employees
                    ? (visit.employees as { full_name: string }).full_name : null;
                  const doneByName = visit.done_by && 'full_name' in visit.done_by
                    ? (visit.done_by as { full_name: string }).full_name : null;
                  const isOverdue = visit.scheduled_date < new Date().toISOString().split('T')[0]! &&
                    visit.status !== 'completed' && visit.status !== 'cancelled';
                  const reportCount = (visit.report_file_paths ?? []).length;
                  const isEditing = editingVisit === visit.id;

                  return (
                    <React.Fragment key={visit.id}>
                      <tr className={`border-b border-n-50 hover:bg-n-50 ${visit.status === 'completed' ? 'opacity-50' : ''}`}>
                        <td className="px-2 py-1 text-[10px] font-mono">{visit.visit_number}</td>
                        <td className="px-2 py-1 text-[10px]">
                          <span className={isOverdue ? 'text-red-600 font-medium' : 'text-n-700'}>
                            {formatDate(visit.scheduled_date)}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-[10px] text-n-600">{engineerName ?? '—'}</td>
                        <td className="px-2 py-1">
                          <VisitStatusDropdown
                            visitId={visit.id}
                            currentStatus={visit.status}
                            isOverdue={isOverdue}
                            onUpdate={loadVisits}
                          />
                        </td>
                        <td className="px-2 py-1 text-[10px] text-n-600">{doneByName ?? '—'}</td>
                        <td className="px-2 py-1 text-[10px]">
                          <VisitReportCell visitId={visit.id} contractId={contractId} reportPaths={visit.report_file_paths ?? []} onUpdate={loadVisits} />
                        </td>
                        <td className="px-2 py-1">
                          <button
                            onClick={() => setEditingVisit(isEditing ? null : visit.id)}
                            className="text-[10px] text-p-600 hover:underline"
                          >
                            {isEditing ? 'Close' : 'Edit'}
                          </button>
                        </td>
                      </tr>
                      {/* Inline edit panel */}
                      {isEditing && (
                        <tr>
                          <td colSpan={7} className="px-3 py-2 bg-n-50 border-b border-n-200">
                            <VisitEditPanel
                              visit={visit}
                              employees={employees}
                              onSave={() => { setEditingVisit(null); loadVisits(); }}
                              onCancel={() => setEditingVisit(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Visit Status Dropdown (inline) ──

function VisitStatusDropdown({ visitId, currentStatus, isOverdue, onUpdate }: {
  visitId: string; currentStatus: string; isOverdue: boolean; onUpdate: () => void;
}) {
  const [saving, setSaving] = React.useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    if (newStatus === currentStatus) return;
    setSaving(true);
    await updateVisitStatus(visitId, newStatus);
    setSaving(false);
    onUpdate();
  }

  return (
    <select
      value={currentStatus}
      onChange={handleChange}
      disabled={saving}
      className={`text-[10px] px-1 py-0.5 rounded border cursor-pointer ${
        isOverdue && currentStatus !== 'completed' ? 'border-red-300 bg-red-50 text-red-700' :
        currentStatus === 'completed' ? 'border-green-300 bg-green-50 text-green-700' :
        'border-n-200 bg-white text-n-700'
      }`}
    >
      <option value="scheduled">Scheduled</option>
      <option value="confirmed">Confirmed</option>
      <option value="completed">Completed</option>
      <option value="rescheduled">Rescheduled</option>
      <option value="cancelled">Cancelled</option>
      <option value="missed">Missed</option>
    </select>
  );
}

// ── Visit Report Cell (upload + view) ──

function VisitReportCell({ visitId, contractId, reportPaths, onUpdate }: {
  visitId: string; contractId: string; reportPaths: string[]; onUpdate: () => void;
}) {
  const [uploading, setUploading] = React.useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `amc/${contractId}/${visitId}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from('project-files').upload(path, file);
    if (!error) {
      await addVisitReportFile(visitId, path);
      onUpdate();
    }
    setUploading(false);
    e.target.value = '';
  }

  return (
    <div className="flex items-center gap-1">
      {reportPaths.length > 0 && (
        <span className="text-[10px] text-green-600 font-medium flex items-center gap-0.5">
          <FileText className="h-3 w-3" />
          {reportPaths.length}
        </span>
      )}
      <label className="cursor-pointer text-n-400 hover:text-p-600 transition-colors" title="Upload report">
        <Upload className="h-3 w-3" />
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={handleUpload}
          disabled={uploading}
        />
      </label>
      {uploading && <span className="text-[9px] text-n-400">...</span>}
    </div>
  );
}

// ── Visit Edit Panel (inline below row) ──

function VisitEditPanel({ visit, employees, onSave, onCancel }: {
  visit: any;
  employees: { id: string; full_name: string }[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [date, setDate] = React.useState(visit.scheduled_date || '');
  const [engineer, setEngineer] = React.useState(visit.assigned_to || '');
  const [workDone, setWorkDone] = React.useState(visit.work_done || '');
  const [issues, setIssues] = React.useState(visit.issues_identified || '');
  const [resolution, setResolution] = React.useState(visit.resolution_details || '');
  const [feedback, setFeedback] = React.useState(visit.customer_feedback || '');
  const [notes, setNotes] = React.useState(visit.notes || '');

  async function handleSave() {
    setSaving(true);

    // Update visit details
    await updateVisitDetails({
      visitId: visit.id,
      work_done: workDone,
      issues_identified: issues,
      resolution_details: resolution,
      customer_feedback: feedback,
      notes,
    });

    // Reschedule if date changed
    if (date !== visit.scheduled_date) {
      await rescheduleVisit({ visitId: visit.id, newDate: date });
    }

    // Assign engineer if changed
    if (engineer !== (visit.assigned_to || '')) {
      await assignVisitEngineer(visit.id, engineer);
    }

    setSaving(false);
    onSave();
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px]">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 text-[10px]" />
        </div>
        <div>
          <Label className="text-[10px]">Engineer</Label>
          <Select value={engineer} onChange={(e) => setEngineer(e.target.value)} className="h-7 text-[10px]">
            <option value="">— Unassigned —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-[10px]">Customer Feedback</Label>
          <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Customer feedback..." className="h-7 text-[10px]" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px]">Work Done *</Label>
          <textarea value={workDone} onChange={(e) => setWorkDone(e.target.value)} rows={2} placeholder="Maintenance activities..." className="w-full rounded border border-n-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-p-400" />
        </div>
        <div>
          <Label className="text-[10px]">Issues Identified</Label>
          <textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={2} placeholder="Faults or observations..." className="w-full rounded border border-n-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-p-400" />
        </div>
        <div>
          <Label className="text-[10px]">Resolution Details</Label>
          <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} placeholder="How issues were resolved..." className="w-full rounded border border-n-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-p-400" />
        </div>
      </div>
      <div>
        <Label className="text-[10px]">Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." className="h-7 text-[10px]" />
      </div>
      <div className="flex justify-end gap-1.5 pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" className="h-6 text-[10px] px-2" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
