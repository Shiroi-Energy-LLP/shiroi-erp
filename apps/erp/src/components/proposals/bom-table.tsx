'use client';

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import type { Database } from '@repo/types/database';

type GSTType = Database['public']['Enums']['gst_type'];
type ScopeOwner = Database['public']['Enums']['scope_owner'];

interface BOMLine {
  id: string;
  line_number: number;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  gst_type: GSTType;
  gst_rate: number;
  gst_amount: number;
  scope_owner: ScopeOwner;
  correction_factor: number | null;
  raw_estimated_cost: number | null;
  corrected_cost: number | null;
  correction_overridden: boolean;
  override_reason: string | null;
}

const SCOPE_COLORS: Record<ScopeOwner, string> = {
  shiroi: 'bg-status-success-bg text-status-success-text',
  client: 'bg-status-info-bg text-status-info-text',
  builder: 'bg-status-warning-bg text-status-warning-text',
  excluded: 'bg-status-neutral-bg text-n-500',
};

const SCOPE_LABEL: Record<ScopeOwner, string> = {
  shiroi: 'Shiroi',
  client: 'Client',
  builder: 'Builder',
  excluded: 'Excluded',
};

const GST_LABEL: Record<GSTType, string> = {
  supply: 'Supply (5%)',
  works_contract: 'Works (18%)',
};

export function BOMTable({ lines }: { lines: BOMLine[] }) {
  const sorted = [...lines].sort((a, b) => a.line_number - b.line_number);

  // `Table` already supplies its own bordered scroll container, so the previous
  // overflow-x-auto wrapper only added a second scrollbar. table-fixed with
  // explicit widths lets Description and Brand wrap instead of pushing the
  // table wider than the page.
  return (
    <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead className="w-[11%]">Category</TableHead>
            <TableHead className="w-[22%]">Description</TableHead>
            <TableHead className="w-[13%]">Brand / Model</TableHead>
            <TableHead className="w-[7%] text-right">Qty</TableHead>
            <TableHead className="w-[7%]">Unit</TableHead>
            <TableHead className="w-[10%] text-right">Unit Price</TableHead>
            <TableHead className="w-[10%] text-right">Total</TableHead>
            <TableHead className="w-[9%]">GST Type</TableHead>
            <TableHead className="w-[8%]">Scope</TableHead>
            <TableHead className="w-[12%]">Correction</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                No BOM lines added.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="text-muted-foreground">{line.line_number}</TableCell>
                <TableCell className="font-medium">{line.item_category}</TableCell>
                <TableCell>{line.item_description}</TableCell>
                <TableCell className="text-sm">
                  {line.brand || line.model
                    ? `${line.brand ?? ''}${line.brand && line.model ? ' / ' : ''}${line.model ?? ''}`
                    : '—'}
                </TableCell>
                <TableCell className="text-right font-mono">{line.quantity}</TableCell>
                <TableCell>{line.unit}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(line.unit_price)}</TableCell>
                <TableCell className="text-right font-mono font-medium">{formatINR(line.total_price)}</TableCell>
                <TableCell>
                  <span>{GST_LABEL[line.gst_type]}</span>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${SCOPE_COLORS[line.scope_owner]}`}>
                    {SCOPE_LABEL[line.scope_owner]}
                  </span>
                </TableCell>
                <TableCell>
                  <CorrectionDisplay line={line} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
    </Table>
  );
}

function CorrectionDisplay({ line }: { line: BOMLine }) {
  if (line.correction_factor === null && line.raw_estimated_cost === null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  return (
    <div className="space-y-1">
      {line.raw_estimated_cost !== null && (
        <div className="text-xs text-muted-foreground">
          Raw: {formatINR(line.raw_estimated_cost)}
        </div>
      )}
      {line.corrected_cost !== null && (
        <div className="text-xs font-medium">
          Corrected: {formatINR(line.corrected_cost)}
        </div>
      )}
      {line.correction_factor !== null && (
        <div className="text-xs text-muted-foreground">
          Factor: {line.correction_factor}x
        </div>
      )}
      {line.correction_overridden && (
        <Badge variant="warning" className="text-[10px]">
          Overridden
        </Badge>
      )}
      {line.correction_overridden && line.override_reason && (
        <div className="text-[10px] text-muted-foreground italic">
          {line.override_reason}
        </div>
      )}
    </div>
  );
}
