'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, Select } from '@repo/ui';
import { AlertTriangle } from 'lucide-react';
import { createObjection } from '@/lib/liaison-actions';

const OBJECTION_SOURCES = [
  { value: 'tneb', label: 'TNEB' },
  { value: 'ceig', label: 'CEIG' },
  { value: 'discom_field', label: 'DISCOM Field' },
  { value: 'municipal', label: 'Municipal' },
];

const OBJECTION_TYPES = [
  { value: 'document_missing', label: 'Document Missing' },
  { value: 'document_incorrect', label: 'Document Incorrect' },
  { value: 'site_inspection_issue', label: 'Site Inspection Issue' },
  { value: 'load_calculation_error', label: 'Load Calculation Error' },
  { value: 'single_line_diagram_error', label: 'Single-Line Diagram Error' },
  { value: 'capacity_mismatch', label: 'Capacity Mismatch' },
  { value: 'ownership_dispute', label: 'Ownership Dispute' },
  { value: 'technical_standard', label: 'Technical Standard' },
  { value: 'other', label: 'Other' },
];

interface ObjectionFormProps {
  projectId: string;
  netMeteringId: string;
}

export function ObjectionForm({ projectId, netMeteringId }: ObjectionFormProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(e.currentTarget);

    const description = (form.get('description') as string | null)?.trim() ?? '';
    if (!description) {
      setError('Description is required.');
      setSaving(false);
      return;
    }

    const res = await createObjection({
      projectId,
      netMeteringId,
      objectionSource: form.get('objectionSource') as string,
      objectionType: form.get('objectionType') as string,
      description,
      raisedDate:
        (form.get('raisedDate') as string) || new Date().toISOString().split('T')[0]!,
    });

    setSaving(false);
    if (res.success) {
      formRef.current?.reset();
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to record objection');
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3 border-t border-[#E5DFD3] pt-4 mt-4">
      <p className="text-sm font-medium text-[#221C12]">Record a new objection</p>
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Source</Label>
          <Select name="objectionSource" defaultValue="tneb" className="h-9 text-sm">
            {OBJECTION_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select name="objectionType" defaultValue="document_missing" className="h-9 text-sm">
            {OBJECTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Raised Date</Label>
          <Input
            name="raisedDate"
            type="date"
            defaultValue={new Date().toISOString().split('T')[0]}
            className="h-9 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <textarea
          name="description"
          rows={3}
          required
          placeholder="Describe the objection raised by the authority..."
          className="flex w-full rounded-md border-[1.5px] border-n-200 bg-white px-3 py-2 text-[13px] text-n-900 focus-visible:outline-none focus-visible:border-shiroi-gold focus-visible:shadow-[0_0_0_3px_rgba(224,138,0,0.22)]"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving...' : 'Save Objection'}
        </Button>
      </div>
    </form>
  );
}
