'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createInverter } from '@/lib/inverters-actions';
import { ProjectCombobox } from '@/components/forms/project-combobox';
import type { InverterMonitoringCredentialRow } from '@/lib/inverters-queries';

const INVERTER_BRANDS = [
  { value: 'sungrow', label: 'Sungrow' },
  { value: 'growatt', label: 'Growatt' },
  { value: 'sma', label: 'SMA' },
  { value: 'huawei', label: 'Huawei' },
  { value: 'fronius', label: 'Fronius' },
  { value: 'solarman', label: 'SolarMan' },
  { value: 'goodwe', label: 'GoodWe' },
  { value: 'fimer', label: 'FIMER' },
  { value: 'polycab', label: 'Polycab' },
  { value: 'havells', label: 'Havells' },
  { value: 'flin_energy', label: 'Flin Energy' },
  { value: 'other', label: 'Other' },
];

interface ProjectOpt {
  id: string;
  customer_name: string;
  project_number: string | null;
}

interface AddInverterDialogProps {
  projects: ProjectOpt[];
  monitoringCredentials: InverterMonitoringCredentialRow[];
}

export function AddInverterDialog({ projects, monitoringCredentials }: AddInverterDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [projectId, setProjectId] = React.useState('');
  const [brand, setBrand] = React.useState('');

  // Filter monitoring credentials by selected brand
  const filteredCredentials = React.useMemo(
    () => (brand ? monitoringCredentials.filter((c) => c.brand === brand) : []),
    [brand, monitoringCredentials],
  );

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) {
      setProjectId('');
      setBrand('');
      setError(null);
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    const monCredId = String(form.get('monitoring_credentials_id') ?? '').trim();
    const siteId = String(form.get('monitoring_site_id') ?? '').trim();
    const deviceId = String(form.get('monitoring_device_id') ?? '').trim();

    const result = await createInverter({
      project_id: projectId,
      brand: String(form.get('brand') ?? ''),
      serial_number: String(form.get('serial_number') ?? '').trim(),
      model: String(form.get('model') ?? '').trim() || undefined,
      rated_capacity_kw: String(form.get('rated_capacity_kw') ?? ''),
      string_count: String(form.get('string_count') ?? '1'),
      monitoring_credentials_id: monCredId || null,
      monitoring_site_id: siteId || null,
      monitoring_device_id: deviceId || null,
      polling_interval_minutes: String(form.get('polling_interval_minutes') ?? '15'),
      polling_enabled: form.get('polling_enabled') === 'true',
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    handleOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Inverter
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Inverter</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Project picker */}
          <div>
            <Label>Project *</Label>
            <ProjectCombobox
              projects={projects}
              value={projectId}
              onChange={setProjectId}
              name="project_id"
              placeholder="Search by customer name or project number…"
              className="w-full"
            />
          </div>

          {/* Brand */}
          <div>
            <Label htmlFor="brand">Brand *</Label>
            <select
              id="brand"
              name="brand"
              required
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full h-9 rounded-md border border-n-300 bg-white px-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
            >
              <option value="">Select brand…</option>
              {INVERTER_BRANDS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>

          {/* Serial number */}
          <div>
            <Label htmlFor="serial_number">Serial Number *</Label>
            <Input
              id="serial_number"
              name="serial_number"
              required
              minLength={3}
              maxLength={100}
              placeholder="e.g. A2302020001234"
              className="h-9 text-sm"
            />
          </div>

          {/* Model */}
          <div>
            <Label htmlFor="model">Model (optional)</Label>
            <Input
              id="model"
              name="model"
              maxLength={100}
              placeholder="e.g. SG10RS"
              className="h-9 text-sm"
            />
          </div>

          {/* Rated capacity */}
          <div>
            <Label htmlFor="rated_capacity_kw">Rated Capacity (kWp) *</Label>
            <Input
              id="rated_capacity_kw"
              name="rated_capacity_kw"
              type="number"
              required
              min={0.01}
              max={10000}
              step={0.01}
              placeholder="e.g. 10"
              className="h-9 text-sm"
            />
          </div>

          {/* String count */}
          <div>
            <Label htmlFor="string_count">String Count</Label>
            <Input
              id="string_count"
              name="string_count"
              type="number"
              min={1}
              max={40}
              defaultValue={1}
              className="h-9 text-sm"
            />
          </div>

          {/* Monitoring credential picker */}
          {brand && filteredCredentials.length > 0 && (
            <div>
              <Label htmlFor="monitoring_credentials_id">Monitoring Credential (optional)</Label>
              <select
                id="monitoring_credentials_id"
                name="monitoring_credentials_id"
                className="w-full h-9 rounded-md border border-n-300 bg-white px-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
              >
                <option value="">None</option>
                {filteredCredentials.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-n-400 mt-0.5">
                Master API credential for this brand (e.g. Sungrow OAuth token).
              </p>
            </div>
          )}
          {brand && filteredCredentials.length === 0 && brand !== 'growatt' && (
            <div>
              <Label htmlFor="monitoring_credentials_id">Monitoring Credential (optional)</Label>
              <select
                id="monitoring_credentials_id"
                name="monitoring_credentials_id"
                disabled
                className="w-full h-9 rounded-md border border-n-200 bg-n-50 px-2 text-sm text-n-400 cursor-not-allowed"
              >
                <option>No {brand} credentials configured yet</option>
              </select>
            </div>
          )}
          {brand === 'growatt' && (
            <p className="text-[10px] text-amber-600 bg-amber-50 rounded p-2">
              Growatt uses per-customer credentials from Plant Monitoring, not a master token.
              No credential selection needed here.
            </p>
          )}

          {/* Monitoring site ID */}
          <div>
            <Label htmlFor="monitoring_site_id">Monitoring Site ID (optional)</Label>
            <Input
              id="monitoring_site_id"
              name="monitoring_site_id"
              maxLength={100}
              placeholder={brand === 'sungrow' ? 'Sungrow ps_id' : brand === 'growatt' ? 'Growatt plant_id' : 'Vendor site/plant ID'}
              className="h-9 text-sm"
            />
            <p className="text-[10px] text-n-400 mt-0.5">
              Vendor-specific plant or site identifier (e.g. Sungrow ps_id, Growatt plant_id).
            </p>
          </div>

          {/* Monitoring device ID */}
          <div>
            <Label htmlFor="monitoring_device_id">Monitoring Device ID (optional)</Label>
            <Input
              id="monitoring_device_id"
              name="monitoring_device_id"
              maxLength={100}
              placeholder="Device serial as seen by vendor API"
              className="h-9 text-sm"
            />
            <p className="text-[10px] text-n-400 mt-0.5">
              Device serial number as the vendor API identifies it (may differ from physical label).
            </p>
          </div>

          {/* Polling interval */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="polling_interval_minutes">Poll Interval (min)</Label>
              <Input
                id="polling_interval_minutes"
                name="polling_interval_minutes"
                type="number"
                defaultValue={15}
                min={5}
                max={120}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label>Polling Enabled</Label>
              <div className="flex gap-3 mt-1">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="polling_enabled" value="true" defaultChecked className="accent-shiroi-green" />
                  Yes
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="polling_enabled" value="false" className="accent-shiroi-green" />
                  No
                </label>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !projectId || !brand}>
              {saving ? 'Saving…' : 'Add Inverter'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
