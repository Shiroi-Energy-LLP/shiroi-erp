'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Plus, PhoneForwarded, Upload, Pencil, Check, X, MessageSquare } from 'lucide-react';
import { createClient } from '@repo/supabase/client';
import { formatDate } from '@repo/ui/formatters';
import {
  createNetMeteringApplication,
  updateDiscomStatus,
  updateCeigStatus,
  updateNetMeterInstallation,
  recordFollowup,
  uploadLiaisonDocument,
  addLiaisonActivity,
  updateLiaisonFields,
} from '@/lib/liaison-actions';

/* ------------------------------------------------------------------ */
/*  Create Application Button                                          */
/* ------------------------------------------------------------------ */

export function LiaisonCreateButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    const result = await createNetMeteringApplication({
      projectId,
      discomName: 'TANGEDCO',
    });
    setCreating(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create application');
    }
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <Button size="sm" onClick={handleCreate} disabled={creating}>
        <Plus className={`h-4 w-4 mr-1.5 ${creating ? 'animate-spin' : ''}`} />
        {creating ? 'Creating...' : 'Start Net Metering Application'}
      </Button>
      <span className="text-xs text-n-500">
        Creates a TANGEDCO net metering application for this project.
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DISCOM Status Inline Selector                                      */
/* ------------------------------------------------------------------ */

const DISCOM_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'applied', label: 'Applied' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'site_inspection_scheduled', label: 'Site Inspection Scheduled' },
  { value: 'approved', label: 'Approved' },
  { value: 'net_meter_installed', label: 'Net Meter Installed' },
  { value: 'activated', label: 'Activated' },
  { value: 'objection_raised', label: 'Objection Raised' },
  { value: 'rejected', label: 'Rejected' },
];

export function DiscomStatusForm({
  projectId,
  currentStatus,
}: {
  projectId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    if (newStatus === currentStatus) return;
    setSaving(true);
    const result = await updateDiscomStatus({ projectId, discomStatus: newStatus });
    setSaving(false);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error ?? 'Failed to update status');
    }
  }

  return (
    <select
      value={currentStatus}
      onChange={handleChange}
      disabled={saving}
      className="text-[10px] bg-transparent border border-n-200 rounded px-2 py-0.5 cursor-pointer focus:ring-1 focus:ring-p-300"
    >
      {DISCOM_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/*  CEIG Status Inline Selector                                        */
/* ------------------------------------------------------------------ */

const CEIG_STATUSES = [
  { value: 'not_applicable', label: 'Not Applicable' },
  { value: 'pending', label: 'Pending' },
  { value: 'applied', label: 'Applied' },
  { value: 'inspection_scheduled', label: 'Inspection Scheduled' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'reapplied', label: 'Reapplied' },
];

export function CeigStatusForm({
  projectId,
  currentStatus,
}: {
  projectId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    if (newStatus === currentStatus) return;
    setSaving(true);
    const result = await updateCeigStatus({ projectId, ceigStatus: newStatus });
    setSaving(false);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error ?? 'Failed to update CEIG status');
    }
  }

  return (
    <select
      value={currentStatus}
      onChange={handleChange}
      disabled={saving}
      className="text-[10px] bg-transparent border border-n-200 rounded px-2 py-0.5 cursor-pointer focus:ring-1 focus:ring-p-300"
    >
      {CEIG_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/*  Net Meter Toggle                                                   */
/* ------------------------------------------------------------------ */

export function NetMeterForm({
  projectId,
  installed,
}: {
  projectId: string;
  installed: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleToggle() {
    const newValue = !installed;
    setSaving(true);
    const result = await updateNetMeterInstallation({
      projectId,
      netMeterInstalled: newValue,
      netMeterInstalledDate: newValue ? new Date().toISOString().split('T')[0] : undefined,
    });
    setSaving(false);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error ?? 'Failed to update');
    }
  }

  return (
    <Button size="sm" variant="ghost" onClick={handleToggle} disabled={saving} className="text-[10px] h-6 px-2">
      {saving ? '...' : installed ? 'Mark Pending' : 'Mark Installed'}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Follow-up Form (replaces prompt())                                 */
/* ------------------------------------------------------------------ */

export function FollowupForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    setSaving(true);
    const result = await recordFollowup({
      projectId,
      nextFollowupDate: date,
      notes: notes || undefined,
    });
    setSaving(false);
    if (result.success) {
      setOpen(false);
      setDate('');
      setNotes('');
      router.refresh();
    } else {
      alert(result.error ?? 'Failed to record followup');
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="text-[10px] h-7">
        <PhoneForwarded className="h-3 w-3 mr-1" /> Record Follow-up
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border border-n-200 rounded-md p-2 space-y-2 bg-n-50/40">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-n-500 block mb-0.5">Next Follow-up Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full text-[11px] border border-n-200 rounded px-2 py-1 bg-white"
            required
          />
        </div>
        <div>
          <label className="text-[10px] text-n-500 block mb-0.5">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Called TANGEDCO office..."
            className="w-full text-[11px] border border-n-200 rounded px-2 py-1 bg-white"
          />
        </div>
      </div>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={saving} className="text-[10px] h-6 px-2">
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} className="text-[10px] h-6 px-2">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Field Editor (click-to-edit for dates, text fields)         */
/* ------------------------------------------------------------------ */

export function LiaisonFieldEditor({
  projectId,
  field,
  value,
  type = 'text',
  mono,
}: {
  projectId: string;
  field: string;
  value: string | null;
  type?: 'date' | 'text';
  mono?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [inputVal, setInputVal] = React.useState(value ?? '');
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    const result = await updateLiaisonFields({
      projectId,
      fields: { [field]: inputVal || null },
    });
    setSaving(false);
    if (result.success) {
      setEditing(false);
      router.refresh();
    }
  }

  function handleCancel() {
    setEditing(false);
    setInputVal(value ?? '');
  }

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          type={type}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          className={`text-[11px] border border-n-200 rounded px-1.5 py-0.5 bg-white ${type === 'date' ? 'w-28' : 'w-32'} ${mono ? 'font-mono' : ''}`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
        />
        <button onClick={handleSave} disabled={saving} className="p-0.5 text-green-600 hover:text-green-800">
          <Check className="h-3 w-3" />
        </button>
        <button onClick={handleCancel} className="p-0.5 text-n-400 hover:text-n-700">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  const displayVal = type === 'date' && value ? formatDate(value) : value;
  return (
    <span
      className={`font-medium text-n-900 cursor-pointer hover:text-p-600 group inline-flex items-center gap-1 ${mono ? 'font-mono' : ''}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {displayVal || '\u2014'}
      <Pencil className="h-2.5 w-2.5 text-n-300 group-hover:text-p-500 opacity-0 group-hover:opacity-100 transition-opacity" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Document Upload                                                    */
/* ------------------------------------------------------------------ */

const DOC_TYPE_OPTIONS = [
  { value: 'application_form', label: 'Application Form' },
  { value: 'single_line_diagram', label: 'Single Line Diagram' },
  { value: 'load_calculation', label: 'Load Calculation' },
  { value: 'ownership_proof', label: 'Ownership Proof' },
  { value: 'eb_bill', label: 'EB Bill' },
  { value: 'ceig_certificate', label: 'CEIG Certificate' },
  { value: 'discom_sanction', label: 'DISCOM Sanction' },
  { value: 'net_meter_installation', label: 'Net Meter Installation' },
  { value: 'objection_response', label: 'Objection Response' },
  { value: 'other', label: 'Other' },
];

export function LiaisonDocUpload({
  projectId,
  netMeteringId,
}: {
  projectId: string;
  netMeteringId: string;
}) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [docType, setDocType] = React.useState('application_form');
  const [uploading, setUploading] = React.useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const ext = file.name.split('.').pop() ?? 'pdf';
    const path = `projects/${projectId}/liaison/${docType}_${Date.now()}.${ext}`;

    const supabase = createClient();
    const { error: uploadErr } = await supabase.storage
      .from('project-files')
      .upload(path, file, { upsert: true });

    if (uploadErr) {
      console.error('[LiaisonDocUpload] Upload failed:', uploadErr.message);
      setUploading(false);
      return;
    }

    const result = await uploadLiaisonDocument({
      projectId,
      netMeteringId,
      documentType: docType,
      documentName: file.name,
      storagePath: path,
      fileSizeBytes: file.size,
    });

    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';

    if (result.success) {
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={docType}
        onChange={(e) => setDocType(e.target.value)}
        className="text-[10px] border border-n-200 rounded px-2 py-1 bg-white"
      >
        {DOC_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <label className="inline-flex items-center gap-1 px-2 py-1 rounded border border-dashed border-n-300 text-[10px] text-n-500 hover:border-p-400 hover:text-p-600 cursor-pointer transition-colors">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />
        {uploading ? (
          <span className="animate-pulse">Uploading...</span>
        ) : (
          <>
            <Upload className="h-3 w-3" /> Upload
          </>
        )}
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Activity Log Form                                                  */
/* ------------------------------------------------------------------ */

export function LiaisonActivityForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    const result = await addLiaisonActivity({
      projectId,
      description: note.trim(),
      activityType: 'note',
    });
    setSaving(false);
    if (result.success) {
      setNote('');
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <MessageSquare className="h-3.5 w-3.5 text-n-400 flex-shrink-0" />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note or activity log entry..."
        className="flex-1 text-[11px] border border-n-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-p-400"
      />
      <Button type="submit" size="sm" variant="ghost" disabled={saving || !note.trim()} className="text-[10px] h-6 px-2">
        {saving ? '...' : 'Add'}
      </Button>
    </form>
  );
}
