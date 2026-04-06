'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Checkbox,
} from '@repo/ui';
import { createCommissioningReport } from '@/lib/project-step-actions';

interface CommissioningFormProps {
  projectId: string;
  defaults: {
    system_size_kwp: number;
    panel_count: number;
    inverter_brand: string | null;
    inverter_model: string | null;
  };
}

export function CommissioningForm({ projectId, defaults }: CommissioningFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [genConfirmed, setGenConfirmed] = React.useState(false);
  const [custExplained, setCustExplained] = React.useState(false);
  const [appAssisted, setAppAssisted] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const getStr = (k: string) => (fd.get(k) as string) || null;
    const getNum = (k: string) => {
      const v = fd.get(k) as string;
      return v ? parseFloat(v) : null;
    };

    const result = await createCommissioningReport({
      projectId,
      data: {
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
      },
    });

    setSaving(false);
    if (result.success) {
      setShowForm(false);
      // Navigate to AMC tab to schedule free maintenance
      router.push(`/projects/${projectId}?tab=amc`);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create commissioning report');
    }
  }

  if (!showForm) {
    return (
      <div className="mb-4">
        <Button size="sm" onClick={() => setShowForm(true)}>
          + Create Commissioning Report
        </Button>
      </div>
    );
  }

  const inverterHint = [defaults.inverter_brand, defaults.inverter_model].filter(Boolean).join(' ');

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">New Commissioning Report</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div>
            <h4 className="text-sm font-semibold text-n-700 mb-3">Commissioning Info</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="commissioning_date">Commissioning Date *</Label>
                <Input id="commissioning_date" name="commissioning_date" type="date" defaultValue={new Date().toISOString().split('T')[0]} required />
              </div>
              <div>
                <Label htmlFor="system_size_kwp">System Size (kWp) *</Label>
                <Input id="system_size_kwp" name="system_size_kwp" type="number" step="0.1" defaultValue={defaults.system_size_kwp} required />
              </div>
              <div>
                <Label htmlFor="panel_count_installed">Panels Installed *</Label>
                <Input id="panel_count_installed" name="panel_count_installed" type="number" defaultValue={defaults.panel_count} required />
              </div>
              <div>
                <Label htmlFor="inverter_serial_number">Inverter Serial Number</Label>
                <Input id="inverter_serial_number" name="inverter_serial_number" placeholder={inverterHint ? `e.g. ${inverterHint} S/N` : 'S/N...'} />
              </div>
              <div>
                <Label htmlFor="initial_reading_kwh">Initial Reading (kWh) *</Label>
                <Input id="initial_reading_kwh" name="initial_reading_kwh" type="number" step="0.01" defaultValue="0" required />
              </div>
            </div>
          </div>

          {/* Electrical Readings */}
          <div>
            <h4 className="text-sm font-semibold text-n-700 mb-3">Electrical Readings</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="dc_voltage_v">DC Voltage (V)</Label>
                <Input id="dc_voltage_v" name="dc_voltage_v" type="number" step="0.1" />
              </div>
              <div>
                <Label htmlFor="dc_current_a">DC Current (A)</Label>
                <Input id="dc_current_a" name="dc_current_a" type="number" step="0.01" />
              </div>
              <div>
                <Label htmlFor="ac_voltage_v">AC Voltage (V)</Label>
                <Input id="ac_voltage_v" name="ac_voltage_v" type="number" step="0.1" />
              </div>
              <div>
                <Label htmlFor="ac_frequency_hz">AC Frequency (Hz)</Label>
                <Input id="ac_frequency_hz" name="ac_frequency_hz" type="number" step="0.01" />
              </div>
              <div>
                <Label htmlFor="earth_resistance_ohm">Earth Resistance (Ω)</Label>
                <Input id="earth_resistance_ohm" name="earth_resistance_ohm" type="number" step="0.01" />
              </div>
              <div>
                <Label htmlFor="insulation_resistance_mohm">Insulation Resistance (MΩ)</Label>
                <Input id="insulation_resistance_mohm" name="insulation_resistance_mohm" type="number" step="0.01" />
                <p className="text-xs text-n-500 mt-1">Below 0.5 MΩ triggers critical service ticket</p>
              </div>
            </div>
          </div>

          {/* Customer Handover */}
          <div>
            <h4 className="text-sm font-semibold text-n-700 mb-3">Customer Handover</h4>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Checkbox id="generation_confirmed" checked={genConfirmed} onCheckedChange={(c) => setGenConfirmed(!!c)} />
                <Label htmlFor="generation_confirmed" className="mb-0">Generation confirmed with customer on-site</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="customer_explained" checked={custExplained} onCheckedChange={(c) => setCustExplained(!!c)} />
                <Label htmlFor="customer_explained" className="mb-0">System operation explained to customer</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="app_download_assisted" checked={appAssisted} onCheckedChange={(c) => setAppAssisted(!!c)} />
                <Label htmlFor="app_download_assisted" className="mb-0">Monitoring app download assisted</Label>
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
              placeholder="Additional observations..."
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Submit Commissioning Report'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
