import { Select, Label } from '@repo/ui';

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 300 };

export function Stage() {
  return (
    <div style={field}>
      <Label htmlFor="stage">Project stage</Label>
      <Select id="stage" defaultValue="installation">
        <option value="survey">Survey</option>
        <option value="design">Design</option>
        <option value="installation">Installation</option>
        <option value="inspection">Inspection</option>
        <option value="net-metering">Net metering</option>
        <option value="handover">Handover</option>
      </Select>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={field}>
      <Label htmlFor="circle">TNEB circle</Label>
      <Select id="circle" defaultValue="chennai-south" disabled>
        <option value="chennai-south">Chennai South</option>
      </Select>
    </div>
  );
}
