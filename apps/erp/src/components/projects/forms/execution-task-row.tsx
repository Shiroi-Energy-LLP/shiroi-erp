'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Badge } from '@repo/ui';
import { Pencil, Trash2, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { updateTask, deleteTask, addWorkLog, getWorkLogs } from '@/lib/tasks-actions';
import { TaskCompletionToggle } from '@/components/projects/forms/task-completion-toggle';

// ── Task Status Dropdown (Open / Closed) ──

export function TaskStatusDropdown({
  taskId,
  isCompleted,
  projectId,
}: {
  taskId: string;
  isCompleted: boolean;
  projectId: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    const newCompleted = val === 'closed';
    if (newCompleted === isCompleted) return;

    setSaving(true);
    // Toggle completion uses the existing toggleTaskCompletion
    // But we can reuse updateTask for setting completed state
    const { toggleTaskCompletion } = await import('@/lib/project-step-actions');
    await toggleTaskCompletion({ projectId, taskId, isCompleted: newCompleted });
    setSaving(false);
    router.refresh();
  }

  return (
    <select
      value={isCompleted ? 'closed' : 'open'}
      onChange={handleChange}
      disabled={saving}
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium border-0 cursor-pointer bg-transparent focus:ring-1 focus:ring-p-300 ${
        isCompleted ? 'text-green-700' : 'text-blue-700'
      }`}
    >
      <option value="open">Open</option>
      <option value="closed">Closed</option>
    </select>
  );
}

// ── Activity Log Toggle ──

export function ActivityLogCell({ taskId }: { taskId: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const [logs, setLogs] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [showAddForm, setShowAddForm] = React.useState(false);

  async function loadLogs() {
    if (logs.length > 0 && expanded) {
      setExpanded(false);
      return;
    }
    setLoading(true);
    const result = await getWorkLogs(taskId);
    setLogs(result);
    setLoading(false);
    setExpanded(true);
  }

  return (
    <div>
      <button
        onClick={loadLogs}
        className="flex items-center gap-0.5 text-[10px] text-p-600 hover:text-p-700 font-medium"
      >
        {loading ? '...' : expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {logs.length > 0 ? `${logs.length} logs` : 'View'}
      </button>

      {expanded && (
        <div className="mt-1 space-y-1">
          {logs.length === 0 && <p className="text-[9px] text-n-400">No activity logs</p>}
          {logs.map((log: any) => (
            <div key={log.id} className="text-[9px] text-n-600 border-l-2 border-p-200 pl-1.5 py-0.5">
              <span className="font-medium">{log.employees?.full_name || '—'}</span>
              <span className="text-n-400 ml-1">
                {log.log_date ? new Date(log.log_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
              </span>
              <p className="text-n-600">{log.description}</p>
            </div>
          ))}

          {/* Quick add log */}
          {showAddForm ? (
            <AddLogForm taskId={taskId} onDone={() => { setShowAddForm(false); loadLogs(); }} />
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="text-[9px] text-p-500 hover:text-p-700 flex items-center gap-0.5"
            >
              <Plus className="h-2.5 w-2.5" /> Add log
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddLogForm({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const description = (fd.get('description') as string)?.trim();
    if (!description) return;

    setSaving(true);
    await addWorkLog({
      taskId,
      description,
      logDate: new Date().toISOString().split('T')[0],
    });
    setSaving(false);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1">
      <input
        name="description"
        placeholder="Activity..."
        className="text-[10px] border border-n-200 rounded px-1.5 py-0.5 w-32 bg-white"
        autoFocus
      />
      <button type="submit" disabled={saving} className="text-[10px] text-p-600 font-medium">
        {saving ? '...' : 'Save'}
      </button>
      <button type="button" onClick={onDone} className="text-[10px] text-n-400">✕</button>
    </form>
  );
}

// ── Edit Task Dialog (inline) ──

export function EditTaskButton({
  task,
  milestones,
  employees,
  projectId,
}: {
  task: any;
  milestones: { id: string; milestone_name: string }[];
  employees: { id: string; full_name: string }[];
  projectId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    await updateTask({
      taskId: task.id,
      title: (fd.get('title') as string) || undefined,
      milestoneId: (fd.get('milestone_id') as string) || undefined,
      assignedTo: (fd.get('assigned_to') as string) || undefined,
      priority: (fd.get('priority') as string) || undefined,
      dueDate: (fd.get('due_date') as string) || undefined,
      remarks: (fd.get('remarks') as string) || undefined,
    });
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-n-400 hover:text-p-600"
        title="Edit task"
      >
        <Pencil className="h-3 w-3" />
      </button>
    );
  }

  return (
    <tr className="border-b border-p-100 bg-p-50">
      <td colSpan={11} className="px-3 py-2">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
          <input name="title" defaultValue={task.title} className="text-[11px] border border-n-200 rounded px-2 py-1 w-40 bg-white" />
          <select name="milestone_id" defaultValue={task.milestone_id ?? ''} className="text-[11px] border border-n-200 rounded px-1 py-1 bg-white">
            <option value="">No milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>{m.milestone_name.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select name="assigned_to" defaultValue={task.assigned_to ?? ''} className="text-[11px] border border-n-200 rounded px-1 py-1 bg-white">
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
          <select name="priority" defaultValue={task.priority ?? 'medium'} className="text-[11px] border border-n-200 rounded px-1 py-1 bg-white">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <input name="due_date" type="date" defaultValue={task.due_date ?? ''} className="text-[11px] border border-n-200 rounded px-1 py-1 bg-white" />
          <input name="remarks" defaultValue={task.remarks ?? ''} placeholder="Notes..." className="text-[11px] border border-n-200 rounded px-1 py-1 w-36 bg-white" />
          <Button type="submit" size="sm" disabled={saving} className="text-[10px] h-6 px-2">
            {saving ? '...' : 'Save'}
          </Button>
          <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-n-400">✕</button>
        </form>
      </td>
    </tr>
  );
}

// ── Delete Task Button ──

export function DeleteTaskButton({ taskId, projectId }: { taskId: string; projectId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm('Delete this task? This action cannot be undone.')) return;
    setDeleting(true);
    await deleteTask(taskId);
    setDeleting(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-n-400 hover:text-red-600"
      title="Delete task"
    >
      <Trash2 className="h-3 w-3" />
    </button>
  );
}

// ── Milestone Inline Edit (Planned Date, Actual Date, Info) ──

export function MilestoneEditableField({
  projectId,
  milestoneId,
  field,
  value,
  type = 'text',
}: {
  projectId: string;
  milestoneId: string;
  field: 'planned_start_date' | 'planned_end_date' | 'actual_start_date' | 'actual_end_date' | 'notes';
  value: string | null;
  type?: 'date' | 'text';
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function handleSave(newValue: string) {
    setSaving(true);
    const { updateMilestoneStatus } = await import('@/lib/project-step-actions');
    await updateMilestoneStatus({
      projectId,
      milestoneId,
      [field]: newValue || null,
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          handleSave(fd.get('value') as string);
        }}
        className="flex items-center gap-1"
      >
        <input
          name="value"
          type={type}
          defaultValue={value ?? ''}
          autoFocus
          className="text-[11px] border border-n-200 rounded px-1.5 py-0.5 w-24 bg-white"
          placeholder={type === 'date' ? '' : 'Info...'}
        />
        <button type="submit" disabled={saving} className="text-[10px] text-p-600 font-medium">
          {saving ? '...' : '✓'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-[10px] text-n-400">✕</button>
      </form>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-pointer hover:bg-p-50 rounded px-1 py-0.5 -mx-1 text-[11px]"
      title="Click to edit"
    >
      {type === 'date' && value
        ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
        : value || '—'}
    </span>
  );
}
