'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@repo/ui';
import { Plus, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { addWorkLog, getWorkLogs } from '@/lib/tasks-actions';
import { formatDate } from '@repo/ui/formatters';

interface WorkLogEntry {
  id: string;
  log_date: string;
  description: string;
  progress_pct: number | null;
  hours_spent: number | null;
  employees?: { full_name: string } | null;
}

export function TaskWorkLog({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);
  const [logs, setLogs] = React.useState<WorkLogEntry[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) {
      const data = await getWorkLogs(taskId);
      setLogs(data as WorkLogEntry[]);
      setLoaded(true);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await addWorkLog({
      taskId,
      description: form.get('description') as string,
      logDate: form.get('logDate') as string || undefined,
      progressPct: form.get('progressPct') ? parseFloat(form.get('progressPct') as string) : undefined,
      hoursSpent: form.get('hoursSpent') ? parseFloat(form.get('hoursSpent') as string) : undefined,
    });

    setSaving(false);
    if (result.success) {
      setAdding(false);
      // Refresh logs
      const data = await getWorkLogs(taskId);
      setLogs(data as WorkLogEntry[]);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add log');
    }
  }

  return (
    <div className="bg-n-50 border-t border-n-200">
      <button
        type="button"
        onClick={handleExpand}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-n-600 hover:bg-n-100 transition-colors"
      >
        <Clock className="h-3 w-3" />
        <span>Work Log</span>
        {expanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {!adding ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-p-600 h-7 gap-1"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3 w-3" /> Add Log Entry
            </Button>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white border border-n-200 rounded-md p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[11px]">Date</Label>
                  <Input
                    name="logDate"
                    type="date"
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Progress %</Label>
                  <Input name="progressPct" type="number" min="0" max="100" step="5" placeholder="%" className="h-7 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px]">Hours</Label>
                  <Input name="hoursSpent" type="number" min="0" step="0.5" placeholder="hrs" className="h-7 text-xs" />
                </div>
              </div>
              <div>
                <Label className="text-[11px]">Description *</Label>
                <textarea
                  name="description"
                  required
                  rows={2}
                  className="w-full rounded-md border border-n-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-green"
                  placeholder="What was done today..."
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2 justify-end">
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAdding(false); setError(null); }}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="h-7 text-xs" disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          )}

          {logs.length === 0 && loaded ? (
            <p className="text-xs text-n-400 py-2">No work logs yet.</p>
          ) : (
            <div className="space-y-1.5">
              {logs.map((log) => (
                <div key={log.id} className="bg-white border border-n-200 rounded-md px-3 py-2">
                  <div className="flex items-center gap-3 text-[11px] text-n-500 mb-1">
                    <span className="font-medium text-n-700">{formatDate(log.log_date)}</span>
                    {log.employees && 'full_name' in log.employees && (
                      <span>by {(log.employees as { full_name: string }).full_name}</span>
                    )}
                    {log.progress_pct != null && (
                      <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{log.progress_pct}%</span>
                    )}
                    {log.hours_spent != null && (
                      <span className="bg-n-100 text-n-600 px-1.5 py-0.5 rounded">{log.hours_spent}h</span>
                    )}
                  </div>
                  <p className="text-xs text-n-700">{log.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
