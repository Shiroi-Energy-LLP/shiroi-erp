'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
} from '@repo/ui';
import { addProjectActivity, updateProjectActivity } from '@/lib/project-activities-actions';
import type { ActivityStageOption, ProjectActivityRow } from '@/lib/project-activities-constants';
import { ProjectCombobox } from '@/components/forms/project-combobox';

interface ActivityFormDialogProps {
  projectId?: string;
  stages: ActivityStageOption[];
  /** When set, the dialog edits this row; otherwise it creates. */
  existing?: ProjectActivityRow;
  trigger: React.ReactNode;
  /** List of projects for global add (when projectId is absent). */
  projects?: { id: string; project_number: string | null; customer_name: string; project_name?: string | null }[];
}

export function ActivityFormDialog({ projectId, stages, existing, trigger, projects }: ActivityFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pickedProjectId, setPickedProjectId] = React.useState('');

  const todayIso = new Date().toISOString().slice(0, 10);
  const [activityDate, setActivityDate] = React.useState(existing?.activity_date ?? todayIso);
  // If existing has stage_custom and no stage_id, init select to __custom__
  const initStageId = existing?.stage_custom && !existing.stage_id ? '__custom__' : (existing?.stage_id ?? '');
  const [stageId, setStageId] = React.useState(initStageId);
  const [stageCustom, setStageCustom] = React.useState(existing?.stage_custom ?? '');
  const [doneBy, setDoneBy] = React.useState(existing?.done_by ?? '');
  const [description, setDescription] = React.useState(existing?.description ?? '');
  const [seCount, setSeCount] = React.useState(String(existing?.se_count ?? 0));
  const [osCount, setOsCount] = React.useState(String(existing?.os_count ?? 0));
  const [contractorCount, setContractorCount] = React.useState(String(existing?.contractor_count ?? 0));
  const [notes, setNotes] = React.useState(existing?.notes ?? '');

  React.useEffect(() => {
    if (!open) {
      setActivityDate(existing?.activity_date ?? todayIso);
      const sid = existing?.stage_custom && !existing.stage_id ? '__custom__' : (existing?.stage_id ?? '');
      setStageId(sid);
      setStageCustom(existing?.stage_custom ?? '');
      setDoneBy(existing?.done_by ?? '');
      setDescription(existing?.description ?? '');
      setSeCount(String(existing?.se_count ?? 0));
      setOsCount(String(existing?.os_count ?? 0));
      setContractorCount(String(existing?.contractor_count ?? 0));
      setNotes(existing?.notes ?? '');
      setError(null);
      setSaving(false);
      setPickedProjectId('');
    }
  }, [open]);

  async function handleSave() {
    const resolvedProjectId = projectId ?? pickedProjectId;
    if (!resolvedProjectId) {
      setError('Pick a project');
      return;
    }
    setSaving(true);
    setError(null);
    const data = {
      activityDate,
      stageId: stageId && stageId !== '__custom__' ? stageId : null,
      stageCustom: stageId === '__custom__' ? (stageCustom || null) : null,
      doneBy: doneBy || null,
      description,
      seCount: parseInt(seCount || '0', 10),
      osCount: parseInt(osCount || '0', 10),
      contractorCount: parseInt(contractorCount || '0', 10),
      notes: notes || null,
    };
    const result = existing
      ? await updateProjectActivity({ projectId: resolvedProjectId, activityId: existing.id, data })
      : await addProjectActivity({ projectId: resolvedProjectId, data });
    setSaving(false);
    if (!result.success) { setError(result.error); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit activity' : 'Add activity'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Project picker — only when no projectId prop given */}
          {!projectId && projects && (
            <div>
              <Label>Project *</Label>
              <ProjectCombobox
                projects={projects}
                value={pickedProjectId}
                onChange={setPickedProjectId}
                placeholder="Search project…"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} />
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                <option value="">— No stage —</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                <option value="__custom__">Other (type below)…</option>
              </Select>
              {stageId === '__custom__' && (
                <Input
                  className="mt-1"
                  value={stageCustom}
                  onChange={(e) => setStageCustom(e.target.value)}
                  placeholder="Custom stage name"
                />
              )}
            </div>
          </div>
          <div>
            <Label>Done by</Label>
            <Input
              value={doneBy}
              onChange={(e) => setDoneBy(e.target.value)}
              placeholder="Person / crew (free text)"
            />
          </div>
          <div>
            <Label>Description *</Label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened on site today?"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>SE (Shiroi)</Label>
              <Input type="number" min="0" step="1" value={seCount} onChange={(e) => setSeCount(e.target.value)} />
            </div>
            <div>
              <Label>OS (Outsourced)</Label>
              <Input type="number" min="0" step="1" value={osCount} onChange={(e) => setOsCount(e.target.value)} />
            </div>
            <div>
              <Label>Contractor</Label>
              <Input type="number" min="0" step="1" value={contractorCount} onChange={(e) => setContractorCount(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Add activity'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
