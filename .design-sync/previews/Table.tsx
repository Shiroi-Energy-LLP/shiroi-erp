import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption,
  Badge,
} from '@repo/ui';

const rows = [
  { name: 'Kumar Residence', cap: '8 kW', city: 'Adyar', value: '₹4,80,000', status: 'Commissioned', v: 'success' as const },
  { name: 'Sunrise Textiles', cap: '110 kW', city: 'Tiruppur', value: '₹58,20,000', status: 'In progress', v: 'warning' as const },
  { name: 'Anand Villa', cap: '5 kW', city: 'T. Nagar', value: '₹3,05,000', status: 'Awaiting', v: 'pending' as const },
  { name: 'Chettinad School', cap: '48 kW', city: 'Karaikudi', value: '₹27,60,000', status: 'Net metered', v: 'info' as const },
];

export function ProjectsTable() {
  return (
    <Table>
      <TableCaption>Active projects — updated 3 days ago</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead>Capacity</TableHead>
          <TableHead>Location</TableHead>
          <TableHead style={{ textAlign: 'right' }}>Value</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.name} data-state={i === 0 ? 'selected' : undefined}>
            <TableCell style={{ fontWeight: 600 }}>{r.name}</TableCell>
            <TableCell>{r.cap}</TableCell>
            <TableCell>{r.city}</TableCell>
            <TableCell style={{ textAlign: 'right' }}>{r.value}</TableCell>
            <TableCell><Badge variant={r.v}>{r.status}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
