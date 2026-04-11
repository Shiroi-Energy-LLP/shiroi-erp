'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Label } from '@repo/ui';
import { ShieldCheck, Check, X } from 'lucide-react';
import { createQcInspection } from '@/lib/project-step-actions';
import {
  QC_SECTIONS,
  buildInitialChecklist,
  type QcChecklistData,
} from '@/lib/qc-constants';

interface QcInspectionFormProps {
  projectId: string;
  systemType?: string;
  existingData?: QcChecklistData;
}

export function QcInspectionForm({ projectId, systemType, existingData }: QcInspectionFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(!!existingData);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isBatterySystem = systemType === 'hybrid' || systemType === 'off_grid';
  const [batteryApplicable, setBatteryApplicable] = React.useState(
    existingData?.battery_applicable ?? isBatterySystem,
  );

  const [checklist, setChecklist] = React.useState<QcChecklistData>(
    existingData ?? buildInitialChecklist(isBatterySystem),
  );
  const [finalApproval, setFinalApproval] = React.useState<'approved' | 'rework_required'>('approved');

  // Rebuild sections when battery toggle changes (only if no existing data)
  React.useEffect(() => {
    if (!existingData) {
      setChecklist(buildInitialChecklist(batteryApplicable));
    }
  }, [batteryApplicable, existingData]);

  function updateItem(
    sectionIdx: number,
    itemIdx: number,
    field: 'passed' | 'remarks',
    value: boolean | null | string,
  ) {
    setChecklist((prev) => ({
      ...prev,
      sections: prev.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        return {
          ...s,
          items: s.items.map((item, ii) => {
            if (ii !== itemIdx) return item;
            return { ...item, [field]: value };
          }),
        };
      }),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validate: all items must have Yes or No
    for (const section of checklist.sections) {
      for (const item of section.items) {
        if (item.passed === null) {
          setError(`Please mark all items. "${item.item}" in "${section.name}" is not checked.`);
          return;
        }
      }
    }

    setSaving(true);
    setError(null);

    const res = await createQcInspection({
      projectId,
      data: {
        checklist_data: { ...checklist, remarks: checklist.remarks },
        overall_result: finalApproval,
        remarks: checklist.remarks,
      },
    });

    setSaving(false);
    if (res.success) {
      setShowForm(false);
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to submit QC inspection');
    }
  }

  if (!showForm) {
    return (
      <div className="mb-4">
        <Button
          size="sm"
          onClick={() => {
            setChecklist(existingData ?? buildInitialChecklist(isBatterySystem));
            setShowForm(true);
          }}
        >
          <ShieldCheck className="h-4 w-4 mr-1" />
          {existingData ? 'Redo QC Inspection' : 'Start QC Inspection'}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Solar System Quality Check Form</CardTitle>
          <label className="flex items-center gap-2 text-xs text-n-600 cursor-pointer">
            <input
              type="checkbox"
              checked={batteryApplicable}
              onChange={(e) => setBatteryApplicable(e.target.checked)}
              className="rounded border-n-300"
            />
            Battery system
          </label>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {checklist.sections.map((section, sIdx) => (
            <div key={section.id} className="border border-n-200 rounded-lg overflow-hidden">
              <div className="bg-n-50 px-3 py-2 border-b border-n-200">
                <h4 className="text-xs font-semibold text-n-700">
                  {sIdx + 1}. {section.name}
                </h4>
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-n-100">
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500 w-[50%]">
                      Check Item
                    </th>
                    <th className="px-3 py-1.5 text-center text-[10px] font-medium text-n-500 w-[15%]">
                      Yes / No
                    </th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500 w-[35%]">
                      Remarks
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((item, iIdx) => (
                    <tr key={iIdx} className="border-b border-n-50 last:border-b-0">
                      <td className="px-3 py-1.5 text-n-800">{item.item}</td>
                      <td className="px-3 py-1.5 text-center">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                              item.passed === true
                                ? 'bg-green-100 border-green-300 text-green-700'
                                : 'bg-white border-n-200 text-n-400 hover:border-green-300'
                            }`}
                            onClick={() => updateItem(sIdx, iIdx, 'passed', true)}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                              item.passed === false
                                ? 'bg-red-100 border-red-300 text-red-700'
                                : 'bg-white border-n-200 text-n-400 hover:border-red-300'
                            }`}
                            onClick={() => updateItem(sIdx, iIdx, 'passed', false)}
                          >
                            No
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={item.remarks}
                          onChange={(e) => updateItem(sIdx, iIdx, 'remarks', e.target.value)}
                          placeholder="—"
                          className="w-full bg-transparent border-0 border-b border-transparent hover:border-n-200 focus:border-p-400 text-[11px] px-0 py-0.5 outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {/* Overall Remarks */}
          <div>
            <Label className="text-xs font-semibold text-n-700 mb-1">Remarks</Label>
            <textarea
              value={checklist.remarks}
              onChange={(e) => setChecklist((prev) => ({ ...prev, remarks: e.target.value }))}
              rows={3}
              className="w-full rounded-md border border-n-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-p-500"
              placeholder="Overall observations and notes..."
            />
          </div>

          {/* Final Approval */}
          <div className="flex items-center gap-6 p-3 bg-n-50 rounded-lg">
            <span className="text-xs font-semibold text-n-700">Final Approval:</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="final_approval"
                value="approved"
                checked={finalApproval === 'approved'}
                onChange={() => setFinalApproval('approved')}
                className="text-green-600"
              />
              <span
                className={`text-xs font-medium ${finalApproval === 'approved' ? 'text-green-700' : 'text-n-500'}`}
              >
                <Check className="h-3 w-3 inline mr-0.5" /> Approved
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="final_approval"
                value="rework_required"
                checked={finalApproval === 'rework_required'}
                onChange={() => setFinalApproval('rework_required')}
                className="text-red-600"
              />
              <span
                className={`text-xs font-medium ${finalApproval === 'rework_required' ? 'text-red-700' : 'text-n-500'}`}
              >
                <X className="h-3 w-3 inline mr-0.5" /> Rework Required
              </span>
            </label>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Submitting...' : 'Submit QC Inspection'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
