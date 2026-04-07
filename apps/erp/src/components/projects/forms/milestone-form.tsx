'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { RefreshCw, Plus } from 'lucide-react';
import { seedProjectMilestones, updateMilestoneStatus, createQuickTask } from '@/lib/project-step-actions';

// ── Seed Button ──

interface MilestoneSeedButtonProps {
  projectId: string;
}

export function MilestoneSeedButton({ projectId }: MilestoneSeedButtonProps) {
  const router = useRouter();
  const [seeding, setSeeding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSeed() {
    setSeeding(true);
    setError(null);
    const result = await seedProjectMilestones({ projectId });
    setSeeding(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to seed milestones');
    }
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <Button size="sm" onClick={handleSeed} disabled={seeding}>
        <RefreshCw className={`h-4 w-4 mr-1.5 ${seeding ? 'animate-spin' : ''}`} />
        {seeding ? 'Creating...' : 'Seed Default Milestones'}
      </Button>
      <span className="text-xs text-n-500">
        Creates the standard 9 project milestones (Advance Payment → Handover).
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// ── Status Control ──

const MILESTONE_STATUSES = [
  { value: 'pending', label: 'Pending', dot: '#9CA3AF' },
  { value: 'in_progress', label: 'In Progress', dot: '#2563EB' },
  { value: 'completed', label: 'Completed', dot: '#059669' },
  { value: 'blocked', label: 'Blocked', dot: '#DC2626' },
  { value: 'skipped', label: 'Skipped', dot: '#9CA3AF' },
];

interface MilestoneStatusControlProps {
  projectId: string;
  milestoneId: string;
  currentStatus: string;
  isBlocked: boolean;
  blockedReason: string | null;
}

export function MilestoneStatusControl({
  projectId,
  milestoneId,
  currentStatus,
  isBlocked,
  blockedReason,
}: MilestoneStatusControlProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    if (newStatus === currentStatus) return;

    // If setting to blocked, prompt for reason
    if (newStatus === 'blocked') {
      const reason = prompt('Blocked reason:');
      if (reason === null) return; // cancelled
      setSaving(true);
      const result = await updateMilestoneStatus({
        projectId,
        milestoneId,
        is_blocked: true,
        blocked_reason: reason || 'No reason specified',
      });
      setSaving(false);
      if (result.success) router.refresh();
      return;
    }

    // If currently blocked and changing away, unblock
    setSaving(true);
    const updateInput: Parameters<typeof updateMilestoneStatus>[0] = {
      projectId,
      milestoneId,
      status: newStatus,
    };

    if (isBlocked) {
      updateInput.is_blocked = false;
      updateInput.blocked_reason = null;
    }

    const result = await updateMilestoneStatus(updateInput);
    setSaving(false);
    if (result.success) router.refresh();
  }

  const currentDot = MILESTONE_STATUSES.find((s) => s.value === currentStatus)?.dot ?? '#9CA3AF';

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: currentDot }}
      />
      <select
        value={currentStatus}
        onChange={handleStatusChange}
        disabled={saving}
        className="text-xs bg-transparent border-0 cursor-pointer focus:ring-1 focus:ring-p-300 rounded px-1 py-0.5 -ml-1 appearance-none pr-4"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237C818E' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 2px center',
        }}
      >
        {MILESTONE_STATUSES.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {saving && <span className="text-[10px] text-n-400">…</span>}
    </div>
  );
}

// ── Quick Task Form (inline in execution step) ──

interface QuickTaskFormProps {
  projectId: string;
  milestones: { id: string; milestone_name: string }[];
  employees: { id: string; full_name: string }[];
}

export function QuickTaskForm({ projectId, milestones, employees }: QuickTaskFormProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = (fd.get('title') as string)?.trim();
    if (!title) return;

    setSaving(true);
    setError(null);

    const result = await createQuickTask({
      projectId,
      milestoneId: (fd.get('milestone_id') as string) || undefined,
      title,
      priority: (fd.get('priority') as string) || 'medium',
      dueDate: (fd.get('due_date') as string) || undefined,
      assignedTo: (fd.get('assigned_to') as string) || undefined,
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create task');
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} className="text-xs">
        <Plus className="h-3.5 w-3.5 mr-1" /> Task
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 bg-n-50 rounded-lg px-3 py-2">
      <input
        name="title"
        placeholder="Task title..."
        required
        autoFocus
        className="text-xs border border-n-200 rounded px-2 py-1 w-40 focus:ring-1 focus:ring-p-300 bg-white"
      />
      <select name="assigned_to" className="text-xs border border-n-200 rounded px-2 py-1 bg-white">
        <option value="">Assign to...</option>
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.full_name}
          </option>
        ))}
      </select>
      <select name="milestone_id" className="text-xs border border-n-200 rounded px-2 py-1 bg-white">
        <option value="">No milestone</option>
        {milestones.map((m) => (
          <option key={m.id} value={m.id}>
            {m.milestone_name.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <select name="priority" defaultValue="medium" className="text-xs border border-n-200 rounded px-2 py-1 bg-white">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <input name="due_date" type="date" className="text-xs border border-n-200 rounded px-2 py-1 bg-white" />
      <Button type="submit" size="sm" disabled={saving} className="text-xs">
        {saving ? '...' : 'Add'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} className="text-xs">
        ✕
      </Button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </form>
  );
}
