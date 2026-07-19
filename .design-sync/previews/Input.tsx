import { Input, Label } from '@repo/ui';

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 };

export function WithLabel() {
  return (
    <div style={field}>
      <Label htmlFor="cust">Customer name</Label>
      <Input id="cust" defaultValue="Kumar Residence" />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={field}>
      <Label htmlFor="load">Sanctioned load (kW)</Label>
      <Input id="load" placeholder="e.g. 8" />
    </div>
  );
}

export function ErrorState() {
  return (
    <div style={field}>
      <Label htmlFor="gst">GSTIN</Label>
      <Input id="gst" defaultValue="33ABCDE" className="border-status-error-text focus-visible:border-status-error-text focus-visible:shadow-[0_0_0_3px_rgba(220,38,38,0.18)]" />
      <span style={{ fontSize: 11, color: '#991B1B' }}>Enter a valid 15-character GSTIN.</span>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={field}>
      <Label htmlFor="ref">Project reference</Label>
      <Input id="ref" defaultValue="SHI-2025-0142" disabled />
    </div>
  );
}
