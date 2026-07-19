import { Label, Input, Checkbox } from '@repo/ui';

export function FieldLabel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 300 }}>
      <Label htmlFor="cap">
        Plant capacity (kW) <span style={{ color: '#DC2626' }}>*</span>
      </Label>
      <Input id="cap" placeholder="e.g. 48" />
    </div>
  );
}

export function WithCheckbox() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="gst" defaultChecked />
      <Label htmlFor="gst">Include 13.8% GST in the proposal</Label>
    </div>
  );
}
