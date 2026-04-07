'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Select, Checkbox,
} from '@repo/ui';
import { Plus, Trash2 } from 'lucide-react';
import { createQcInspection } from '@/lib/project-step-actions';

interface QcInspectionFormProps {
  projectId: string;
  milestones: { id: string; milestone_name: string; milestone_order: number }[];
  nextGateNumber: number;
}

interface ChecklistItem {
  item: string;
  passed: boolean;
  notes: string;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { item: 'Panel alignment and mounting torque verified', passed: false, notes: '' },
  { item: 'Wiring connections secure and labelled', passed: false, notes: '' },
  { item: 'Earthing system continuity tested', passed: false, notes: '' },
  { item: 'Inverter configuration verified', passed: false, notes: '' },
  { item: 'Safety signage in place', passed: false, notes: '' },
  { item: 'Walkway clearances adequate', passed: false, notes: '' },
];

export function QcInspectionForm({ projectId, milestones, nextGateNumber }: QcInspectionFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [checklist, setChecklist] = React.useState<ChecklistItem[]>(DEFAULT_CHECKLIST);
  const [result, setResult] = React.useState('passed');

  function addChecklistItem() {
    setChecklist([...checklist, { item: '', passed: false, notes: '' }]);
  }

  function removeChecklistItem(idx: number) {
    setChecklist(checklist.filter((_, i) => i !== idx));
  }

  function updateChecklistItem(idx: number, field: keyof ChecklistItem, value: string | boolean) {
    setChecklist(checklist.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const milestoneId = fd.get('milestone_id') as string;
    const inspDate = fd.get('inspection_date') as string;
    const failureNotes = fd.get('failure_notes') as string;
    const conditionalNotes = fd.get('conditional_notes') as string;

    if (!milestoneId) {
      setError('Please select a milestone');
      setSaving(false);
      return;
    }

    // Filter out empty checklist items
    const validChecklist = checklist.filter((c) => c.item.trim() !== '');

    const res = await createQcInspection({
      projectId,
      data: {
        gate_number: nextGateNumber,
        milestone_id: milestoneId,
        inspection_date: inspDate || new Date().toISOString().split('T')[0]!,
        overall_result: result,
        requires_reinspection: result === 'failed' || result === 'conditional_pass',
        checklist_items: validChecklist,
        failure_notes: failureNotes || undefined,
        conditional_notes: conditionalNotes || undefined,
      },
    });

    setSaving(false);
    if (res.success) {
      setShowForm(false);
      setChecklist(DEFAULT_CHECKLIST);
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to create QC inspection');
    }
  }

  if (!showForm) {
    return (
      <div className="mb-4">
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> New QC Inspection
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">New QC Gate Inspection — Gate #{nextGateNumber}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="milestone_id">Milestone *</Label>
              <Select id="milestone_id" name="milestone_id" required>
                <option value="" disabled>Select milestone...</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>#{m.milestone_order} — {m.milestone_name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="inspection_date">Inspection Date *</Label>
              <Input id="inspection_date" name="inspection_date" type="date" defaultValue={new Date().toISOString().split('T')[0]} required />
            </div>
            <div>
              <Label htmlFor="overall_result">Overall Result *</Label>
              <Select id="overall_result" name="overall_result" value={result} onChange={(e) => setResult(e.target.value)} required>
                <option value="passed">Pass</option>
                <option value="failed">Fail</option>
                <option value="conditional_pass">Conditional Pass</option>
              </Select>
            </div>
          </div>

          {/* Checklist Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-n-700">QC Checklist</h4>
              <Button type="button" variant="ghost" size="sm" onClick={addChecklistItem}>
                <Plus className="h-3 w-3 mr-1" /> Add Item
              </Button>
            </div>
            <div className="space-y-3">
              {checklist.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-n-50 rounded-md">
                  <Checkbox
                    checked={item.passed}
                    onCheckedChange={(checked) => updateChecklistItem(idx, 'passed', !!checked)}
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-2">
                    <Input
                      value={item.item}
                      onChange={(e) => updateChecklistItem(idx, 'item', e.target.value)}
                      placeholder="Checklist item description..."
                      className="text-sm"
                    />
                    <Input
                      value={item.notes}
                      onChange={(e) => updateChecklistItem(idx, 'notes', e.target.value)}
                      placeholder="Notes (optional)"
                      className="text-xs"
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeChecklistItem(idx)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Conditional/failure notes */}
          {(result === 'failed' || result === 'conditional_pass') && (
            <div>
              <Label htmlFor={result === 'failed' ? 'failure_notes' : 'conditional_notes'}>
                {result === 'failed' ? 'Failure Notes' : 'Conditional Notes'} *
              </Label>
              <textarea
                id={result === 'failed' ? 'failure_notes' : 'conditional_notes'}
                name={result === 'failed' ? 'failure_notes' : 'conditional_notes'}
                rows={3}
                className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-p-500"
                required
                placeholder={result === 'failed' ? 'Describe what failed and corrective action needed...' : 'Describe conditions that must be met...'}
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Submit QC Inspection'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
