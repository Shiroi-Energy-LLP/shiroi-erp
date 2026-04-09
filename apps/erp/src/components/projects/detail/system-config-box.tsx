import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import { EditableField } from './editable-field';

const SYSTEM_TYPE_OPTIONS = [
  { value: 'on_grid', label: 'On-Grid' },
  { value: 'off_grid', label: 'Off-Grid' },
  { value: 'hybrid', label: 'Hybrid' },
];

const STRUCTURE_OPTIONS = [
  { value: 'elevated_gi', label: 'Elevated (GI)' },
  { value: 'elevated_ms', label: 'Elevated (MS)' },
  { value: 'low_raise_gi', label: 'Low Raise (GI)' },
  { value: 'low_raise_ms', label: 'Low Raise (MS)' },
  { value: 'minirail', label: 'Minirail' },
  { value: 'long_rail', label: 'Long Rail' },
  { value: 'customized', label: 'Customized' },
];

const SCOPE_OPTIONS = [
  { value: 'shiroi', label: 'Shiroi' },
  { value: 'client', label: 'Client' },
];

interface SystemConfigBoxProps {
  projectId: string;
  project: {
    system_size_kwp: number;
    system_type: string;
    structure_type: string | null;
    panel_brand: string | null;
    panel_model: string | null;
    panel_count: number;
    panel_wattage: number | null;
    inverter_brand: string | null;
    inverter_model: string | null;
    inverter_capacity_kw: number | null;
    battery_brand: string | null;
    battery_capacity_kwh: number | null;
    cable_brand: string | null;
    cable_model: string | null;
    scope_la: string | null;
    scope_civil: string | null;
    scope_meter: string | null;
    notes: string | null;
  };
}

export function SystemConfigBox({ projectId, project }: SystemConfigBoxProps) {
  const showBattery = project.system_type !== 'on_grid';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">System Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Core sizing */}
        <div className="grid grid-cols-2 gap-4">
          <EditableField
            projectId={projectId}
            field="system_size_kwp"
            label="System Size (kWp)"
            value={project.system_size_kwp}
            type="number"
          />
          <EditableField
            projectId={projectId}
            field="system_type"
            label="System Type"
            value={project.system_type}
            type="select"
            options={SYSTEM_TYPE_OPTIONS}
          />
          <EditableField
            projectId={projectId}
            field="structure_type"
            label="Mounting Structure"
            value={project.structure_type}
            type="select"
            options={STRUCTURE_OPTIONS}
          />
          <EditableField
            projectId={projectId}
            field="panel_count"
            label="Panel Count"
            value={project.panel_count}
            type="number"
          />
        </div>

        <div className="border-t border-n-100 -mx-6" />

        {/* Brand/model */}
        <div className="grid grid-cols-2 gap-4">
          <EditableField
            projectId={projectId}
            field="panel_brand"
            label="Panel Make"
            value={project.panel_brand}
            placeholder="e.g. Waaree / Vikram"
          />
          <EditableField
            projectId={projectId}
            field="panel_model"
            label="Panel Model"
            value={project.panel_model}
          />
          <EditableField
            projectId={projectId}
            field="inverter_brand"
            label="Inverter Make"
            value={project.inverter_brand}
            placeholder="e.g. Sungrow / Growatt"
          />
          <EditableField
            projectId={projectId}
            field="inverter_model"
            label="Inverter Model"
            value={project.inverter_model}
          />
          <EditableField
            projectId={projectId}
            field="cable_brand"
            label="Cable Make"
            value={project.cable_brand}
            placeholder="e.g. Polycab / Finolex"
          />
          <EditableField
            projectId={projectId}
            field="cable_model"
            label="Cable Model"
            value={project.cable_model}
          />
          {showBattery && (
            <>
              <EditableField
                projectId={projectId}
                field="battery_brand"
                label="Battery Make"
                value={project.battery_brand}
              />
              <EditableField
                projectId={projectId}
                field="battery_capacity_kwh"
                label="Battery Capacity (kWh)"
                value={project.battery_capacity_kwh}
                type="number"
              />
            </>
          )}
        </div>

        <div className="border-t border-n-100 -mx-6" />

        {/* Scopes */}
        <div className="grid grid-cols-3 gap-4">
          <EditableField
            projectId={projectId}
            field="scope_la"
            label="Scope of LA"
            value={project.scope_la}
            type="select"
            options={SCOPE_OPTIONS}
          />
          <EditableField
            projectId={projectId}
            field="scope_civil"
            label="Scope of Civil"
            value={project.scope_civil}
            type="select"
            options={SCOPE_OPTIONS}
          />
          <EditableField
            projectId={projectId}
            field="scope_meter"
            label="Scope of Meter"
            value={project.scope_meter}
            type="select"
            options={SCOPE_OPTIONS}
          />
        </div>

        <div className="border-t border-n-100 -mx-6" />

        {/* Remarks */}
        <EditableField
          projectId={projectId}
          field="notes"
          label="Remarks (PM editable)"
          value={project.notes}
          type="textarea"
          placeholder="Add any remarks or notes for this project…"
        />
      </CardContent>
    </Card>
  );
}
