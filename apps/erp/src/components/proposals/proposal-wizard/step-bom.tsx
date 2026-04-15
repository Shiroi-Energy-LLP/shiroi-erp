'use client';

/**
 * Step 2 of the Proposal Wizard — Bill of Materials with live totals.
 */
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label, Select } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { calcLineTotal, calcProposalTotals } from '@/lib/proposal-calc';

import type { BOMLineInput } from './shared';
import { CATEGORIES, SCOPE_OWNERS, TotalLine } from './shared';

export interface StepBOMProps {
  lines: BOMLineInput[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, field: keyof BOMLineInput, value: string | number) => void;
  discount: string;
  onDiscountChange: (v: string) => void;
  totals: ReturnType<typeof calcProposalTotals>;
}

export function StepBOM({
  lines,
  onAdd,
  onRemove,
  onUpdate,
  discount,
  onDiscountChange,
  totals,
}: StepBOMProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">BOM Lines ({lines.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={onAdd}>
              Add Line
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {lines.map((line, idx) => (
            <div key={line.key} className="border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Line {idx + 1}</span>
                {lines.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(line.key)}
                    className="text-status-error-text h-7 px-2 text-xs"
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Category</Label>
                  <Select
                    value={line.item_category}
                    onChange={(e) => onUpdate(line.key, 'item_category', e.target.value)}
                    className="mt-1"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">Description *</Label>
                  <Input
                    value={line.item_description}
                    onChange={(e) => onUpdate(line.key, 'item_description', e.target.value)}
                    placeholder="Item description"
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div>
                  <Label className="text-xs">Brand</Label>
                  <Input
                    value={line.brand}
                    onChange={(e) => onUpdate(line.key, 'brand', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Model</Label>
                  <Input
                    value={line.model}
                    onChange={(e) => onUpdate(line.key, 'model', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Qty *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={line.quantity}
                    onChange={(e) => onUpdate(line.key, 'quantity', Number(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Unit</Label>
                  <Select
                    value={line.unit}
                    onChange={(e) => onUpdate(line.key, 'unit', e.target.value)}
                    className="mt-1"
                  >
                    <option value="Nos">Nos</option>
                    <option value="kW">kW</option>
                    <option value="kWh">kWh</option>
                    <option value="Mtr">Mtr</option>
                    <option value="Set">Set</option>
                    <option value="Lot">Lot</option>
                    <option value="Sqft">Sqft</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Unit Price *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={line.unit_price}
                    onChange={(e) => onUpdate(line.key, 'unit_price', Number(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Line Total</Label>
                  <div className="mt-1 py-2 text-sm font-mono font-medium">
                    {formatINR(calcLineTotal(line.quantity, line.unit_price))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">GST Type</Label>
                  <Select
                    value={line.gst_type}
                    onChange={(e) => onUpdate(line.key, 'gst_type', e.target.value)}
                    className="mt-1"
                  >
                    <option value="supply">Supply (5%)</option>
                    <option value="works_contract">Works Contract (18%)</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Scope Owner</Label>
                  <Select
                    value={line.scope_owner}
                    onChange={(e) => onUpdate(line.key, 'scope_owner', e.target.value)}
                    className="mt-1"
                  >
                    {SCOPE_OWNERS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">HSN Code</Label>
                  <Input
                    value={line.hsn_code}
                    onChange={(e) => onUpdate(line.key, 'hsn_code', e.target.value)}
                    placeholder="e.g. 85414011"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Live Totals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Totals (Live)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <TotalLine label="Subtotal — Supply (Shiroi)" value={totals.subtotalSupply} />
          <TotalLine label="Subtotal — Works (Shiroi)" value={totals.subtotalWorks} />
          <TotalLine label="GST on Supply (5%)" value={totals.gstSupply} muted />
          <TotalLine label="GST on Works (18%)" value={totals.gstWorks} muted />
          <div className="border-t border-dashed pt-2">
            <TotalLine label="Total before discount" value={totals.totalBeforeDiscount} />
          </div>
          <div className="flex items-center gap-4">
            <Label className="text-sm whitespace-nowrap">Discount</Label>
            <Input
              type="number"
              min={0}
              value={discount}
              onChange={(e) => onDiscountChange(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="border-t pt-2">
            <TotalLine label="Total after discount" value={totals.totalAfterDiscount} bold />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
