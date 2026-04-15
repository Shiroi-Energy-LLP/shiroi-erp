'use client';

/**
 * Step 1 of the Proposal Wizard — Lead selection + System configuration.
 */
import { Card, CardHeader, CardTitle, CardContent, Input, Label, Select } from '@repo/ui';

import type { Lead, SystemType } from './shared';
import { SYSTEM_TYPES } from './shared';

export interface StepLeadSystemProps {
  leads: Lead[];
  leadId: string;
  onLeadChange: (id: string) => void;
  systemType: SystemType;
  onSystemTypeChange: (t: SystemType) => void;
  systemSizeKwp: string;
  onSystemSizeChange: (v: string) => void;
  panelBrand: string;
  onPanelBrandChange: (v: string) => void;
  panelModel: string;
  onPanelModelChange: (v: string) => void;
  panelWattage: string;
  onPanelWattageChange: (v: string) => void;
  panelCount: string;
  onPanelCountChange: (v: string) => void;
  inverterBrand: string;
  onInverterBrandChange: (v: string) => void;
  inverterModel: string;
  onInverterModelChange: (v: string) => void;
  inverterCapacity: string;
  onInverterCapacityChange: (v: string) => void;
  batteryBrand: string;
  onBatteryBrandChange: (v: string) => void;
  batteryModel: string;
  onBatteryModelChange: (v: string) => void;
  batteryCapacity: string;
  onBatteryCapacityChange: (v: string) => void;
  structureType: string;
  onStructureTypeChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
}

export function StepLeadSystem(props: StepLeadSystemProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Lead</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label>Lead *</Label>
              <Select
                value={props.leadId}
                onChange={(e) => props.onLeadChange(e.target.value)}
                className="mt-1"
              >
                <option value="">Select a lead...</option>
                {props.leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.customer_name} — {lead.phone} ({lead.city ?? 'No city'})
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>System Type *</Label>
                <Select
                  value={props.systemType}
                  onChange={(e) => props.onSystemTypeChange(e.target.value as SystemType)}
                  className="mt-1"
                >
                  {SYSTEM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>System Size (kWp) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={props.systemSizeKwp}
                  onChange={(e) => props.onSystemSizeChange(e.target.value)}
                  placeholder="e.g. 10.00"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">System Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Panels</h4>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <Label>Brand</Label>
                <Input
                  value={props.panelBrand}
                  onChange={(e) => props.onPanelBrandChange(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Model</Label>
                <Input
                  value={props.panelModel}
                  onChange={(e) => props.onPanelModelChange(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Wattage (W)</Label>
                <Input
                  type="number"
                  value={props.panelWattage}
                  onChange={(e) => props.onPanelWattageChange(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Count</Label>
                <Input
                  type="number"
                  value={props.panelCount}
                  onChange={(e) => props.onPanelCountChange(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <h4 className="text-sm font-medium text-muted-foreground">Inverter</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Brand</Label>
                <Input
                  value={props.inverterBrand}
                  onChange={(e) => props.onInverterBrandChange(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Model</Label>
                <Input
                  value={props.inverterModel}
                  onChange={(e) => props.onInverterModelChange(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Capacity (kW)</Label>
                <Input
                  type="number"
                  value={props.inverterCapacity}
                  onChange={(e) => props.onInverterCapacityChange(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            {props.systemType !== 'on_grid' && (
              <>
                <h4 className="text-sm font-medium text-muted-foreground">Battery</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Brand</Label>
                    <Input
                      value={props.batteryBrand}
                      onChange={(e) => props.onBatteryBrandChange(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Model</Label>
                    <Input
                      value={props.batteryModel}
                      onChange={(e) => props.onBatteryModelChange(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Capacity (kWh)</Label>
                    <Input
                      type="number"
                      value={props.batteryCapacity}
                      onChange={(e) => props.onBatteryCapacityChange(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Structure Type</Label>
                <Input
                  value={props.structureType}
                  onChange={(e) => props.onStructureTypeChange(e.target.value)}
                  placeholder="e.g. Elevated, Flush mount"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <textarea
                className="mt-1 flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={props.notes}
                onChange={(e) => props.onNotesChange(e.target.value)}
                placeholder="Internal notes for this proposal..."
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
