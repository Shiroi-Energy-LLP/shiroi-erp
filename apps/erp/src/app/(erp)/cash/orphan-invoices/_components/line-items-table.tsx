import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';

interface Props {
  items: Array<{
    line_number: number;
    item_name: string | null;
    item_description: string | null;
    quantity: number;
    rate: number;
    amount: number;
  }>;
}

export function LineItemsTable({ items }: Props) {
  if (items.length === 0) {
    return <p className="text-xs text-[#7C818E] italic">No line items recorded.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/2">Item</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((it) => (
          <TableRow key={it.line_number}>
            <TableCell>
              <div className="text-xs font-medium">{it.item_name ?? '—'}</div>
              {it.item_description && (
                <div className="text-[10px] text-[#7C818E]">{it.item_description}</div>
              )}
            </TableCell>
            <TableCell className="text-right text-xs font-mono">{it.quantity}</TableCell>
            <TableCell className="text-right text-xs font-mono">{formatINR(it.rate)}</TableCell>
            <TableCell className="text-right text-xs font-mono">{formatINR(it.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
