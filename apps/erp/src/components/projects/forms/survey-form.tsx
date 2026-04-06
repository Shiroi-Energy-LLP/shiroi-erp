'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Select, Checkbox,
} from '@repo/ui';
import { createOrUpdateSurvey } from '@/lib/project-step-actions';

interface SurveyFormProps {
  projectId: string;
  existing?: {
    id: string;
    roof_type: string | null;
    structure_type: string | null;
    roof_area_sqft: number | null;
    usable_area_sqft: number | null;
    shading_assessment: string | null;
    shading_notes: string | null;
    existing_load_kw: number | null;
    sanctioned_load_kw: number | null;
    meter_type: string | null;
    discom_name: string | null;
    net_metering_eligible: boolean | null;
    recommended_size_kwp: number | null;
    recommended_system_type: string | null;
    survey_date: string;
    notes: string | null;
  } | null;
  onCancel?: () => void;
}

const ROOF_TYPES = ['RCC Flat', 'Metal Sheet', 'Tiled', 'Asbestos', 'Mixed', 'Other'];
const STRUCTURE_TYPES = ['Elevated', 'Flush Mount', 'Ground Mount', 'Tilt Structure', 'Custom'];
const SHADING_OPTIONS = ['No Shade', 'Minimal', 'Moderate', 'Heavy'];
const METER_TYPES = ['Single Phase', 'Three Phase', 'HT'];
const SYSTEM_TYPES = ['on_grid', 'hybrid', 'off_grid'];

export function SurveyForm({ projectId, existing, onCancel }: SurveyFormProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(!!existing);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const getString = (key: string) => (fd.get(key) as string) || null;
    const getNum = (key: string) => {
      const v = fd.get(key) as string;
      return v ? parseFloat(v) : null;
    };

    const result = await createOrUpdateSurvey({
      projectId,
      surveyId: existing?.id,
      data: {
        roof_type: getString('roof_type') ?? '',
        structure_type: getString('structure_type') ?? '',
        roof_area_sqft: getNum('roof_area_sqft'),
        usable_area_sqft: getNum('usable_area_sqft'),
        shading_assessment: getString('shading_assessment'),
        shading_notes: getString('shading_notes'),
        existing_load_kw: getNum('existing_load_kw'),
        sanctioned_load_kw: getNum('sanctioned_load_kw'),
        meter_type: getString('meter_type'),
        discom_name: getString('discom_name'),
        net_metering_eligible: fd.get('net_metering_eligible') === 'on' ? true : false,
        recommended_size_kwp: getNum('recommended_size_kwp'),
        recommended_system_type: getString('recommended_system_type'),
        survey_date: getString('survey_date') ?? new Date().toISOString().split('T')[0]!,
        notes: getString('notes'),
      },
    });

    setSaving(false);
    if (result.success) {
      setShowForm(false);
      // Navigate to BOM tab so PM continues workflow
      router.push(`/projects/${projectId}?tab=bom`);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to save survey');
    }
  }

  if (!showForm) {
    return (
      <div className="mb-4">
        <Button size="sm" onClick={() => setShowForm(true)}>
          {existing ? 'Edit Survey' : '+ Create Site Survey'}
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">{existing ? 'Edit Site Survey' : 'New Site Survey'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Roof & Structure Section */}
          <div>
            <h4 className="text-sm font-semibold text-n-700 mb-3">Roof & Structure</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="roof_type">Roof Type *</Label>
                <Select id="roof_type" name="roof_type" defaultValue={existing?.roof_type ?? ''} required>
                  <option value="" disabled>Select roof type...</option>
                  {ROOF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="structure_type">Structure Type *</Label>
                <Select id="structure_type" name="structure_type" defaultValue={existing?.structure_type ?? ''} required>
                  <option value="" disabled>Select structure type...</option>
                  {STRUCTURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="roof_area_sqft">Total Roof Area (sq.ft)</Label>
                <Input id="roof_area_sqft" name="roof_area_sqft" type="number" step="0.1" defaultValue={existing?.roof_area_sqft ?? ''} />
              </div>
              <div>
                <Label htmlFor="usable_area_sqft">Usable Area (sq.ft)</Label>
                <Input id="usable_area_sqft" name="usable_area_sqft" type="number" step="0.1" defaultValue={existing?.usable_area_sqft ?? ''} />
              </div>
              <div>
                <Label htmlFor="shading_assessment">Shading Assessment</Label>
                <Select id="shading_assessment" name="shading_assessment" defaultValue={existing?.shading_assessment ?? ''}>
                  <option value="">Select...</option>
                  {SHADING_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="shading_notes">Shading Notes</Label>
                <Input id="shading_notes" name="shading_notes" defaultValue={existing?.shading_notes ?? ''} />
              </div>
            </div>
          </div>

          {/* Electrical Section */}
          <div>
            <h4 className="text-sm font-semibold text-n-700 mb-3">Electrical & Load</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="existing_load_kw">Existing Load (kW)</Label>
                <Input id="existing_load_kw" name="existing_load_kw" type="number" step="0.1" defaultValue={existing?.existing_load_kw ?? ''} />
              </div>
              <div>
                <Label htmlFor="sanctioned_load_kw">Sanctioned Load (kW)</Label>
                <Input id="sanctioned_load_kw" name="sanctioned_load_kw" type="number" step="0.1" defaultValue={existing?.sanctioned_load_kw ?? ''} />
              </div>
              <div>
                <Label htmlFor="meter_type">Meter Type</Label>
                <Select id="meter_type" name="meter_type" defaultValue={existing?.meter_type ?? ''}>
                  <option value="">Select...</option>
                  {METER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="discom_name">DISCOM</Label>
                <Input id="discom_name" name="discom_name" defaultValue={existing?.discom_name ?? ''} placeholder="e.g. TANGEDCO" />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox id="net_metering_eligible" name="net_metering_eligible" defaultChecked={existing?.net_metering_eligible ?? false} />
                <Label htmlFor="net_metering_eligible" className="mb-0">Net Metering Eligible</Label>
              </div>
            </div>
          </div>

          {/* Recommendation Section */}
          <div>
            <h4 className="text-sm font-semibold text-n-700 mb-3">Recommendation</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="recommended_size_kwp">Recommended Size (kWp)</Label>
                <Input id="recommended_size_kwp" name="recommended_size_kwp" type="number" step="0.1" defaultValue={existing?.recommended_size_kwp ?? ''} />
              </div>
              <div>
                <Label htmlFor="recommended_system_type">Recommended System Type</Label>
                <Select id="recommended_system_type" name="recommended_system_type" defaultValue={existing?.recommended_system_type ?? ''}>
                  <option value="">Select...</option>
                  {SYSTEM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="survey_date">Survey Date *</Label>
                <Input id="survey_date" name="survey_date" type="date" defaultValue={existing?.survey_date ?? new Date().toISOString().split('T')[0]} required />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-p-500"
              defaultValue={existing?.notes ?? ''}
              placeholder="Additional survey observations..."
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setShowForm(false); onCancel?.(); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : existing ? 'Update Survey' : 'Create Survey'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
