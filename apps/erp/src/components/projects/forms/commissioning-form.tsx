'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Checkbox,
} from '@repo/ui';
import { Plus, Trash2, Zap } from 'lucide-react';
import { createCommissioningReport, updateCommissioningReport } from '@/lib/project-step-actions';

interface StringTestEntry {
  inverter_no: string;
  string_no: string;
  vmp: string;
  isc: string;
  polarity_ok: boolean;
}

interface CommissioningFormProps {
  projectId: string;
  defaults: {
    system_size_kwp: number;
    panel_count: number;
    inverter_brand: string | null;
    inverter_model: string | null;
  };
  existingReport?: {
    id: string;
    commissioning_date: string;
    system_size_kwp: number;
    panel_count_installed: number;
    inverter_serial_number: string | null;
    initial_reading_kwh: number;
    dc_voltage_v: number | null;
    dc_current_a: number | null;
    ac_voltage_v: number | null;
    ac_frequency_hz: number | null;
    earth_resistance_ohm: number | null;
    insulation_resistance_mohm: number | null;
    generation_confirmed: boolean;
    customer_explained: boolean;
    app_download_assisted: boolean;
    notes: string | null;
    status: string;
    string_test_data?: StringTestEntry[];
    monitoring_portal_link?: string | null;
    monitoring_login?: string | null;
    monitoring_password?: string | null;
    performance_ratio_pct?: number | null;
  };
  startOpen?: boolean;
}

const EMPTY_STRING_TEST: StringTestEntry = {
  inverter_no: '1',
  string_no: '1',
  vmp: '',
  isc: '',
  polarity_ok: true,
};

export function CommissioningForm({ projectId, defaults, existingReport, startOpen }: CommissioningFormProps) {
  const router = useRouter();
  const isEdit = !!existingReport;
  const [showForm, setShowForm] = React.useState(!!startOpen);
  const [saving, setSaving] = React.useState(false);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [genConfirmed, setGenConfirmed] = React.useState(existingReport?.generation_confirmed ?? false);
  const [custExplained, setCustExplained] = React.useState(existingReport?.customer_explained ?? false);
  const [appAssisted, setAppAssisted] = React.useState(existingReport?.app_download_assisted ?? false);

  // Multi-string test entries
  const [stringTests, setStringTests] = React.useState<StringTestEntry[]>(
    existingReport?.string_test_data?.length
      ? existingReport.string_test_data
      : [{ ...EMPTY_STRING_TEST }],
  );

  function addStringRow() {
    const lastRow = stringTests[stringTests.length - 1];
    setStringTests([
      ...stringTests,
      {
        inverter_no: lastRow?.inverter_no ?? '1',
        string_no: String(Number(lastRow?.string_no ?? 0) + 1),
        vmp: '',
        isc: '',
        polarity_ok: true,
      },
    ]);
  }

  function removeStringRow(idx: number) {
    if (stringTests.length <= 1) return;
    setStringTests(stringTests.filter((_, i) => i !== idx));
  }

  function updateStringRow(idx: number, field: keyof StringTestEntry, value: string | boolean) {
    setStringTests(stringTests.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>, asDraft = false) {
    e.preventDefault();
    if (asDraft) setSavingDraft(true);
    else setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const getStr = (k: string) => (fd.get(k) as string) || null;
    const getNum = (k: string) => {
      const v = fd.get(k) as string;
      return v ? parseFloat(v) : null;
    };

    const reportData = {
      commissioning_date: (fd.get('commissioning_date') as string) || new Date().toISOString().split('T')[0]!,
      system_size_kwp: getNum('system_size_kwp') ?? defaults.system_size_kwp,
      panel_count_installed: getNum('panel_count_installed') ?? defaults.panel_count,
      inverter_serial_number: getStr('inverter_serial_number'),
      initial_reading_kwh: getNum('initial_reading_kwh') ?? 0,
      dc_voltage_v: getNum('dc_voltage_v'),
      dc_current_a: getNum('dc_current_a'),
      ac_voltage_v: getNum('ac_voltage_v'),
      ac_frequency_hz: getNum('ac_frequency_hz'),
      earth_resistance_ohm: getNum('earth_resistance_ohm'),
      insulation_resistance_mohm: getNum('insulation_resistance_mohm'),
      generation_confirmed: genConfirmed,
      customer_explained: custExplained,
      app_download_assisted: appAssisted,
      notes: getStr('notes'),
      // New fields
      string_test_data: stringTests.filter((r) => r.vmp || r.isc),
      monitoring_portal_link: getStr('monitoring_portal_link'),
      monitoring_login: getStr('monitoring_login'),
      monitoring_password: getStr('monitoring_password'),
      performance_ratio_pct: getNum('performance_ratio_pct'),
      status: asDraft ? 'draft' : 'submitted',
    };

    let result: { success: boolean; error?: string };

    if (isEdit && existingReport) {
      result = await updateCommissioningReport({
        projectId,
        reportId: existingReport.id,
        data: reportData,
      });
    } else {
      result = await createCommissioningReport({
        projectId,
        data: reportData,
      });
    }

    setSaving(false);
    setSavingDraft(false);
    if (result.success) {
      setShowForm(false);
      router.refresh();
    } else {
      setError(result.error ?? `Failed to ${isEdit ? 'update' : 'create'} commissioning report`);
    }
  }

  if (!showForm) {
    return (
      <div className="mb-4">
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Zap className="h-4 w-4 mr-1" />
          {isEdit ? 'Edit Commissioning Report' : 'Create Commissioning Report'}
        </Button>
      </div>
    );
  }

  const r = existingReport;
  const inverterHint = [defaults.inverter_brand, defaults.inverter_model].filter(Boolean).join(' ');

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {isEdit ? 'Edit Commissioning Report' : 'New Commissioning Report'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => handleSubmit(e, false)}
          className="space-y-6"
        >
          {/* ── Section 1: Commissioning Info ── */}
          <div>
            <h4 className="text-xs font-semibold text-n-700 mb-3 uppercase tracking-wide">
              Commissioning Info
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="commissioning_date" className="text-xs">Commissioning Date *</Label>
                <Input id="commissioning_date" name="commissioning_date" type="date"
                  defaultValue={r?.commissioning_date ?? new Date().toISOString().split('T')[0]}
                  required className="text-xs" />
              </div>
              <div>
                <Label htmlFor="system_size_kwp" className="text-xs">System Size (kWp) *</Label>
                <Input id="system_size_kwp" name="system_size_kwp" type="number" step="0.1"
                  defaultValue={r?.system_size_kwp ?? defaults.system_size_kwp}
                  required className="text-xs" />
              </div>
              <div>
                <Label htmlFor="panel_count_installed" className="text-xs">Panels Installed *</Label>
                <Input id="panel_count_installed" name="panel_count_installed" type="number"
                  defaultValue={r?.panel_count_installed ?? defaults.panel_count}
                  required className="text-xs" />
              </div>
              <div>
                <Label htmlFor="inverter_serial_number" className="text-xs">Inverter Serial Number</Label>
                <Input id="inverter_serial_number" name="inverter_serial_number"
                  defaultValue={r?.inverter_serial_number ?? ''}
                  placeholder={inverterHint ? `e.g. ${inverterHint} S/N` : 'S/N...'}
                  className="text-xs" />
              </div>
              <div>
                <Label htmlFor="initial_reading_kwh" className="text-xs">Initial Reading (kWh) *</Label>
                <Input id="initial_reading_kwh" name="initial_reading_kwh" type="number" step="0.01"
                  defaultValue={r?.initial_reading_kwh ?? 0}
                  required className="text-xs" />
              </div>
            </div>
          </div>

          {/* ── Section 2: Multi-String Electrical Tests ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-n-700 uppercase tracking-wide">
                String-Level Electrical Tests
              </h4>
              <Button type="button" variant="ghost" size="sm" onClick={addStringRow}
                className="text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add String
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[15%]">Inverter No.</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[15%]">String No.</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[20%]">Vmp (V)</th>
                    <th className="px-2 py-1.5 text-left text-[10px] font-medium text-n-500 w-[20%]">Isc (A)</th>
                    <th className="px-2 py-1.5 text-center text-[10px] font-medium text-n-500 w-[20%]">Polarity Check</th>
                    <th className="px-2 py-1.5 w-[10%]"></th>
                  </tr>
                </thead>
                <tbody>
                  {stringTests.map((row, idx) => (
                    <tr key={idx} className="border-b border-n-50">
                      <td className="px-2 py-1">
                        <Input value={row.inverter_no}
                          onChange={(e) => updateStringRow(idx, 'inverter_no', e.target.value)}
                          className="h-7 text-xs w-full" placeholder="1" />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={row.string_no}
                          onChange={(e) => updateStringRow(idx, 'string_no', e.target.value)}
                          className="h-7 text-xs w-full" placeholder="1" />
                      </td>
                      <td className="px-2 py-1">
                        <Input type="number" step="0.1" value={row.vmp}
                          onChange={(e) => updateStringRow(idx, 'vmp', e.target.value)}
                          className="h-7 text-xs w-full font-mono" placeholder="37.5" />
                      </td>
                      <td className="px-2 py-1">
                        <Input type="number" step="0.01" value={row.isc}
                          onChange={(e) => updateStringRow(idx, 'isc', e.target.value)}
                          className="h-7 text-xs w-full font-mono" placeholder="9.2" />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <div className="inline-flex gap-1">
                          <button type="button"
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                              row.polarity_ok
                                ? 'bg-green-100 border-green-300 text-green-700'
                                : 'bg-white border-n-200 text-n-400 hover:border-green-300'
                            }`}
                            onClick={() => updateStringRow(idx, 'polarity_ok', true)}>
                            OK
                          </button>
                          <button type="button"
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                              !row.polarity_ok
                                ? 'bg-red-100 border-red-300 text-red-700'
                                : 'bg-white border-n-200 text-n-400 hover:border-red-300'
                            }`}
                            onClick={() => updateStringRow(idx, 'polarity_ok', false)}>
                            Fail
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-1 text-center">
                        {stringTests.length > 1 && (
                          <button type="button" onClick={() => removeStringRow(idx)}
                            className="text-red-400 hover:text-red-600">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section 3: System-Level Electrical Readings ── */}
          <div>
            <h4 className="text-xs font-semibold text-n-700 mb-3 uppercase tracking-wide">
              System-Level Readings
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="dc_voltage_v" className="text-xs">DC Voltage (V)</Label>
                <Input id="dc_voltage_v" name="dc_voltage_v" type="number" step="0.1"
                  defaultValue={r?.dc_voltage_v ?? ''} className="text-xs" />
              </div>
              <div>
                <Label htmlFor="dc_current_a" className="text-xs">DC Current (A)</Label>
                <Input id="dc_current_a" name="dc_current_a" type="number" step="0.01"
                  defaultValue={r?.dc_current_a ?? ''} className="text-xs" />
              </div>
              <div>
                <Label htmlFor="ac_voltage_v" className="text-xs">AC Voltage (V)</Label>
                <Input id="ac_voltage_v" name="ac_voltage_v" type="number" step="0.1"
                  defaultValue={r?.ac_voltage_v ?? ''} className="text-xs" />
              </div>
              <div>
                <Label htmlFor="ac_frequency_hz" className="text-xs">AC Frequency (Hz)</Label>
                <Input id="ac_frequency_hz" name="ac_frequency_hz" type="number" step="0.01"
                  defaultValue={r?.ac_frequency_hz ?? ''} className="text-xs" />
              </div>
              <div>
                <Label htmlFor="earth_resistance_ohm" className="text-xs">Earth Resistance (Ohm)</Label>
                <Input id="earth_resistance_ohm" name="earth_resistance_ohm" type="number" step="0.01"
                  defaultValue={r?.earth_resistance_ohm ?? ''} className="text-xs" />
              </div>
              <div>
                <Label htmlFor="insulation_resistance_mohm" className="text-xs">
                  Insulation Resistance (MOhm)
                </Label>
                <Input id="insulation_resistance_mohm" name="insulation_resistance_mohm" type="number" step="0.01"
                  defaultValue={r?.insulation_resistance_mohm ?? ''} className="text-xs" />
                <p className="text-[10px] text-n-400 mt-0.5">Below 0.5 MOhm triggers critical service ticket</p>
              </div>
            </div>
          </div>

          {/* ── Section 4: Monitoring Details ── */}
          <div>
            <h4 className="text-xs font-semibold text-n-700 mb-3 uppercase tracking-wide">
              Monitoring Details
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="monitoring_portal_link" className="text-xs">Portal Link</Label>
                <Input id="monitoring_portal_link" name="monitoring_portal_link" type="url"
                  defaultValue={r?.monitoring_portal_link ?? ''}
                  placeholder="https://..." className="text-xs" />
              </div>
              <div>
                <Label htmlFor="monitoring_login" className="text-xs">Login / Username</Label>
                <Input id="monitoring_login" name="monitoring_login"
                  defaultValue={r?.monitoring_login ?? ''}
                  placeholder="user@email.com" className="text-xs" />
              </div>
              <div>
                <Label htmlFor="monitoring_password" className="text-xs">Password</Label>
                <Input id="monitoring_password" name="monitoring_password"
                  defaultValue={r?.monitoring_password ?? ''}
                  placeholder="••••••" className="text-xs" />
              </div>
            </div>
          </div>

          {/* ── Section 5: Performance Ratio ── */}
          <div>
            <h4 className="text-xs font-semibold text-n-700 mb-3 uppercase tracking-wide">
              Performance Ratio
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="performance_ratio_pct" className="text-xs">Performance Ratio (%)</Label>
                <Input id="performance_ratio_pct" name="performance_ratio_pct" type="number" step="0.1"
                  defaultValue={r?.performance_ratio_pct ?? ''}
                  placeholder="e.g. 78.5" className="text-xs" />
                <p className="text-[10px] text-n-400 mt-0.5">
                  PR = (Actual Energy / Theoretical Energy) × 100. Typical range: 75–85%.
                </p>
              </div>
            </div>
          </div>

          {/* ── Section 6: Customer Handover ── */}
          <div>
            <h4 className="text-xs font-semibold text-n-700 mb-3 uppercase tracking-wide">
              Customer Handover
            </h4>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Checkbox id="generation_confirmed" checked={genConfirmed}
                  onCheckedChange={(c) => setGenConfirmed(!!c)} />
                <Label htmlFor="generation_confirmed" className="mb-0 text-xs">
                  Generation confirmed with customer on-site
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="customer_explained" checked={custExplained}
                  onCheckedChange={(c) => setCustExplained(!!c)} />
                <Label htmlFor="customer_explained" className="mb-0 text-xs">
                  System operation explained to customer
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="app_download_assisted" checked={appAssisted}
                  onCheckedChange={(c) => setAppAssisted(!!c)} />
                <Label htmlFor="app_download_assisted" className="mb-0 text-xs">
                  Monitoring app download assisted
                </Label>
              </div>
            </div>
          </div>

          {/* ── Notes ── */}
          <div>
            <Label htmlFor="notes" className="text-xs">Notes</Label>
            <textarea id="notes" name="notes" rows={3}
              defaultValue={r?.notes ?? ''}
              className="w-full rounded-md border border-n-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-p-500"
              placeholder="Additional observations..." />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          {/* ── Actions ── */}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" size="sm"
              disabled={savingDraft || saving}
              onClick={(e) => {
                const form = (e.target as HTMLElement).closest('form');
                if (form) {
                  const event = new Event('submit', { bubbles: true, cancelable: true });
                  (form as any).__saveDraft = true;
                  handleSubmit(
                    { preventDefault: () => {}, currentTarget: form } as unknown as React.FormEvent<HTMLFormElement>,
                    true,
                  );
                }
              }}>
              {savingDraft ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button type="submit" size="sm" disabled={saving || savingDraft}>
              {saving ? 'Submitting...' : isEdit ? 'Update & Submit' : 'Submit Report'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
