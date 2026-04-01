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
  shiroi: 'bg-[#ECFDF5] text-[#065F46]',
  client: 'bg-[#EFF6FF] text-[#1E40AF]',
  builder: 'bg-[#FFFBEB] text-[#92400E]',
  excluded: 'bg-[#F3F4F6] text-[#6B7280]',
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

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Brand / Model</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Unit Price</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>GST Type</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Correction</TableHead>
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
                  <span className="text-xs">{GST_LABEL[line.gst_type]}</span>
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
    </div>
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
