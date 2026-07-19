import { Checkbox, Label } from '@repo/ui';

const rowItem: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };

export function States() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={rowItem}><Checkbox id="c1" /><Label htmlFor="c1">Site survey done</Label></div>
      <div style={rowItem}><Checkbox id="c2" defaultChecked /><Label htmlFor="c2">Net-meter application filed</Label></div>
      <div style={rowItem}><Checkbox id="c3" indeterminate /><Label htmlFor="c3">Documents (2 of 5 uploaded)</Label></div>
      <div style={rowItem}><Checkbox id="c4" disabled /><Label htmlFor="c4">Commissioning (locked)</Label></div>
    </div>
  );
}
