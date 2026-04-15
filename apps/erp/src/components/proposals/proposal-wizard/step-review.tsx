'use client';

/**
 * Step 4 of the Proposal Wizard — Review + financial summary + payment schedule.
 */
import Decimal from 'decimal.js';
import {
  Card, CardHeader, CardTitle, CardContent,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { calcLineTotal, calcProposalTotals } from '@/lib/proposal-calc';

import type { Lead, BOMLineInput, MilestoneInput, SystemType } from './shared';
import { TotalLine } from './shared';

export interface StepReviewProps {
  selectedLead: Lead | null;
  systemType: SystemType;
  systemSizeKwp: string;
  panelBrand: string;
  panelModel: string;
  panelWattage: string;
  panelCount: string;
  inverterBrand: string;
  inverterModel: string;
  inverterCapacity: string;
  batteryBrand: string;
  batteryModel: string;
  batteryCapacity: string;
  structureType: string;
  bomLines: BOMLineInput[];
  milestones: MilestoneInput[];
  totals: ReturnType<typeof calcProposalTotals>;
  discount: number;
  totalAmount: number;
  notes: string;
}

export function StepReview(props: StepReviewProps) {
  return (
    <div className="space-y-6">
      {/* Customer & System */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Customer</h4>
              <div className="text-sm">{props.selectedLead?.customer_name ?? '—'}</div>
              <div className="text-sm font-mono">{props.selectedLead?.phone ?? '—'}</div>
              <div className="text-sm">{props.selectedLead?.city ?? '—'}</div>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">System</h4>
              <div className="text-sm capitalize">{props.systemType.replace(/_/g, ' ')}</div>
              <div className="text-sm">{props.systemSizeKwp} kWp</div>
              {props.panelBrand && (
                <div className="text-sm">
                  Panel: {props.panelBrand} {props.panelModel}{' '}
                  {props.panelWattage ? `${props.panelWattage}W` : ''}{' '}
                  {props.panelCount ? `x${props.panelCount}` : ''}
                </div>
              )}
              {props.inverterBrand && (
                <div className="text-sm">
                  Inverter: {props.inverterBrand} {props.inverterModel}{' '}
                  {props.inverterCapacity ? `${props.inverterCapacity} kW` : ''}
                </div>
              )}
              {props.systemType !== 'on_grid' && props.batteryBrand && (
                <div className="text-sm">
                  Battery: {props.batteryBrand} {props.batteryModel}{' '}
                  {props.batteryCapacity ? `${props.batteryCapacity} kWh` : ''}
                </div>
              )}
              {props.structureType && (
                <div className="text-sm">Structure: {props.structureType}</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BOM Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">BOM ({props.bomLines.length} lines)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>GST</TableHead>
                <TableHead>Scope</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.bomLines.map((line, idx) => (
                <TableRow key={line.key}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell>{line.item_category}</TableCell>
                  <TableCell>{line.item_description}</TableCell>
                  <TableCell className="text-right font-mono">{line.quantity}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(line.unit_price)}</TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {formatINR(calcLineTotal(line.quantity, line.unit_price))}
                  </TableCell>
                  <TableCell className="text-xs">
                    {line.gst_type === 'supply' ? '5%' : '18%'}
                  </TableCell>
                  <TableCell className="text-xs capitalize">{line.scope_owner}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Totals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Financials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <TotalLine label="Supply subtotal" value={props.totals.subtotalSupply} />
          <TotalLine label="Works subtotal" value={props.totals.subtotalWorks} />
          <TotalLine label="GST Supply (5%)" value={props.totals.gstSupply} muted />
          <TotalLine label="GST Works (18%)" value={props.totals.gstWorks} muted />
          <div className="border-t border-dashed pt-2">
            <TotalLine label="Total before discount" value={props.totals.totalBeforeDiscount} />
          </div>
          {props.discount > 0 && <TotalLine label="Discount" value={-props.discount} muted />}
          <div className="border-t pt-2">
            <TotalLine label="Total after discount" value={props.totals.totalAfterDiscount} bold />
          </div>
        </CardContent>
      </Card>

      {/* Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Payment Schedule ({props.milestones.length} milestones)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Milestone</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Trigger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.milestones.map((m, idx) => (
                <TableRow key={m.key}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell>{m.milestone_name}</TableCell>
                  <TableCell className="text-right font-mono">{m.percentage}%</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatINR(
                      new Decimal(props.totalAmount).mul(m.percentage).div(100).toNumber(),
                    )}
                  </TableCell>
                  <TableCell>
                    {m.due_trigger === 'custom' ? m.custom_trigger_description : m.due_trigger}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {props.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#3E3E3E] whitespace-pre-wrap">{props.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
