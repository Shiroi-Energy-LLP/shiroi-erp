import { Button } from '@repo/ui';

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' };

export function Variants() {
  return (
    <div style={row}>
      <Button variant="default">Save proposal</Button>
      <Button variant="solar">Generate quote</Button>
      <Button variant="secondary">Assign designer</Button>
      <Button variant="outline">Add note</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Delete lead</Button>
      <Button variant="link">View details</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add">+</Button>
    </div>
  );
}

export function States() {
  return (
    <div style={row}>
      <Button variant="default">Approve</Button>
      <Button variant="default" disabled>Approving…</Button>
      <Button variant="outline" disabled>Locked</Button>
    </div>
  );
}
