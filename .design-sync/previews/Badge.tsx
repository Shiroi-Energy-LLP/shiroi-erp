import { Badge } from '@repo/ui';

const wrap: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' };

export function StatusVariants() {
  return (
    <div style={wrap}>
      <Badge variant="default">Brand</Badge>
      <Badge variant="success">Commissioned</Badge>
      <Badge variant="pending">Awaiting</Badge>
      <Badge variant="warning">In progress</Badge>
      <Badge variant="error">Overdue</Badge>
      <Badge variant="info">Net metered</Badge>
      <Badge variant="neutral">Archived</Badge>
      <Badge variant="secondary">Draft</Badge>
      <Badge variant="outline">Optional</Badge>
      <Badge variant="destructive">Fault</Badge>
    </div>
  );
}

export function InRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
      <span style={{ fontWeight: 600 }}>Sunrise Textiles — 110 kW</span>
      <Badge variant="warning">In progress</Badge>
    </div>
  );
}
