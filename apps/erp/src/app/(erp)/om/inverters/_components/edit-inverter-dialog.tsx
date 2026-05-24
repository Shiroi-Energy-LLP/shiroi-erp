'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  Button, Input, Label,
} from '@repo/ui';
import { updateInverter } from '@/lib/inverters-actions';
import type { InverterWithProject } from '@/lib/inverters-queries';

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

interface EditInverterDialogTriggerProps {
  inverter: InverterWithProject;
  open: boolean;
  onClose: () => void;
}

/**
 * EditInverterDialogTrigger — receives an already-selected inverter and an
 * `open` flag from the parent (InverterTable). The parent manages the open state
 * and passes it here to avoid per-row dialog mounting overhead.
 */
export function EditInverterDialogTrigger({
  inverter,
  open,
  onClose,
}: EditInverterDialogTriggerProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(val: boolean) {
    if (!val) onClose();
    if (!val) {
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

    const result = await updateInverter(inverter.id, {
      serial_number: String(form.get('serial_number') ?? '').trim(),
      model: String(form.get('model') ?? '').trim() || undefined,
      rated_capacity_kw: String(form.get('rated_capacity_kw') ?? ''),
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

    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Edit Inverter
            <span className="ml-2 text-xs font-mono font-normal text-n-500">
              {inverter.serial_number}
            </span>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Brand — read-only in edit; brand+serial_number is the unique key */}
          <div>
            <Label>Brand</Label>
            <select
              disabled
              className="w-full h-9 rounded-md border border-n-200 bg-n-50 px-2 text-sm text-n-500 cursor-not-allowed"
            >
              <option>
                {INVERTER_BRANDS.find((b) => b.value === inverter.brand)?.label ?? inverter.brand}
              </option>
            </select>
            <p className="text-[10px] text-n-400 mt-0.5">
              Brand cannot be changed (part of the unique key). Create a new inverter if needed.
            </p>
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
              defaultValue={inverter.serial_number}
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
              defaultValue={inverter.model ?? ''}
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
              defaultValue={Number(inverter.rated_capacity_kw)}
              className="h-9 text-sm"
            />
          </div>

          {/* Monitoring credential ID */}
          <div>
            <Label htmlFor="monitoring_credentials_id">Monitoring Credential ID (optional)</Label>
            <Input
              id="monitoring_credentials_id"
              name="monitoring_credentials_id"
              defaultValue={inverter.monitoring_credentials_id ?? ''}
              placeholder="UUID of inverter_monitoring_credentials row"
              className="h-9 text-sm font-mono"
            />
          </div>

          {/* Monitoring site ID */}
          <div>
            <Label htmlFor="monitoring_site_id">Monitoring Site ID (optional)</Label>
            <Input
              id="monitoring_site_id"
              name="monitoring_site_id"
              maxLength={100}
              defaultValue={inverter.monitoring_site_id ?? ''}
              placeholder="Vendor site/plant ID"
              className="h-9 text-sm"
            />
          </div>

          {/* Monitoring device ID */}
          <div>
            <Label htmlFor="monitoring_device_id">Monitoring Device ID (optional)</Label>
            <Input
              id="monitoring_device_id"
              name="monitoring_device_id"
              maxLength={100}
              defaultValue={inverter.monitoring_device_id ?? ''}
              placeholder="Device serial as seen by vendor API"
              className="h-9 text-sm"
            />
          </div>

          {/* Polling interval + enabled */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="polling_interval_minutes">Poll Interval (min)</Label>
              <Input
                id="polling_interval_minutes"
                name="polling_interval_minutes"
                type="number"
                defaultValue={inverter.polling_interval_minutes}
                min={5}
                max={120}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label>Polling Enabled</Label>
              <div className="flex gap-3 mt-1">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="polling_enabled"
                    value="true"
                    defaultChecked={inverter.polling_enabled}
                    className="accent-shiroi-green"
                  />
                  Yes
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="polling_enabled"
                    value="false"
                    defaultChecked={!inverter.polling_enabled}
                    className="accent-shiroi-green"
                  />
                  No
                </label>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
