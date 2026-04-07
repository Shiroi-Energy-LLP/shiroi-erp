'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Plus, PhoneForwarded } from 'lucide-react';
import {
  createNetMeteringApplication,
  updateDiscomStatus,
  updateCeigStatus,
  updateNetMeterInstallation,
  recordFollowup,
} from '@/lib/liaison-actions';

// ── Create Application Button ──

interface LiaisonCreateButtonProps {
  projectId: string;
}

export function LiaisonCreateButton({ projectId }: LiaisonCreateButtonProps) {
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

// ── DISCOM Status Inline Selector ──

const DISCOM_STATUSES = [
  'not_started',
  'submitted',
  'under_review',
  'objection_raised',
  'approved',
  'activated',
  'rejected',
];

interface DiscomStatusFormProps {
  projectId: string;
  currentStatus: string;
}

export function DiscomStatusForm({ projectId, currentStatus }: DiscomStatusFormProps) {
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
      className="text-xs bg-transparent border border-n-200 rounded px-2 py-1 cursor-pointer focus:ring-1 focus:ring-p-300"
    >
      {DISCOM_STATUSES.map((s) => (
        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
      ))}
    </select>
  );
}

// ── CEIG Status Inline Selector ──

const CEIG_STATUSES = [
  'not_required',
  'pending',
  'applied',
  'inspection_scheduled',
  'approved',
  'rejected',
];

interface CeigStatusFormProps {
  projectId: string;
  currentStatus: string;
}

export function CeigStatusForm({ projectId, currentStatus }: CeigStatusFormProps) {
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
      className="text-xs bg-transparent border border-n-200 rounded px-2 py-1 cursor-pointer focus:ring-1 focus:ring-p-300"
    >
      {CEIG_STATUSES.map((s) => (
        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
      ))}
    </select>
  );
}

// ── Net Meter Toggle ──

interface NetMeterFormProps {
  projectId: string;
  installed: boolean;
}

export function NetMeterForm({ projectId, installed }: NetMeterFormProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleToggle() {
    const newValue = !installed;
    let serialNumber: string | undefined;
    if (newValue) {
      serialNumber = prompt('Net meter serial number:') ?? undefined;
    }
    setSaving(true);
    const result = await updateNetMeterInstallation({
      projectId,
      netMeterInstalled: newValue,
      netMeterInstalledDate: newValue ? new Date().toISOString().split('T')[0] : undefined,
      netMeterSerialNumber: serialNumber,
    });
    setSaving(false);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error ?? 'Failed to update');
    }
  }

  return (
    <Button size="sm" variant="ghost" onClick={handleToggle} disabled={saving} className="text-xs">
      {saving ? '...' : installed ? 'Mark as Pending' : 'Mark as Installed'}
    </Button>
  );
}

// ── Followup Button ──

interface FollowupButtonProps {
  projectId: string;
}

export function FollowupButton({ projectId }: FollowupButtonProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleFollowup() {
    const nextDate = prompt('Next followup date (YYYY-MM-DD):');
    if (!nextDate) return;
    setSaving(true);
    const result = await recordFollowup({
      projectId,
      nextFollowupDate: nextDate,
    });
    setSaving(false);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error ?? 'Failed to record followup');
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleFollowup} disabled={saving} className="text-xs">
      <PhoneForwarded className="h-3.5 w-3.5 mr-1" />
      {saving ? 'Recording...' : 'Record Followup'}
    </Button>
  );
}
