'use client';

/**
 * Step 3 of the Proposal Wizard — Payment milestones that must sum to 100%.
 */
import Decimal from 'decimal.js';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label, Select } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';

import type { MilestoneInput } from './shared';
import { DEFAULT_TRIGGERS } from './shared';

export interface StepPaymentProps {
  milestones: MilestoneInput[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, field: keyof MilestoneInput, value: string | number) => void;
  totalAmount: number;
  validation: { valid: boolean; sum: number };
}

export function StepPayment({
  milestones,
  onAdd,
  onRemove,
  onUpdate,
  totalAmount,
  validation,
}: StepPaymentProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Payment Milestones</CardTitle>
            <Button variant="outline" size="sm" onClick={onAdd}>
              Add Milestone
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {milestones.map((m, idx) => (
            <div key={m.key} className="border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Milestone {idx + 1}
                </span>
                {milestones.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(m.key)}
                    className="text-status-error-text h-7 px-2 text-xs"
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Milestone Name *</Label>
                  <Input
                    value={m.milestone_name}
                    onChange={(e) => onUpdate(m.key, 'milestone_name', e.target.value)}
                    placeholder="e.g. Advance payment"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Percentage *</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={m.percentage}
                    onChange={(e) => onUpdate(m.key, 'percentage', Number(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Amount</Label>
                  <div className="mt-1 py-2 text-sm font-mono font-medium">
                    {formatINR(
                      new Decimal(totalAmount).mul(m.percentage).div(100).toNumber(),
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Trigger</Label>
                  <Select
                    value={m.due_trigger}
                    onChange={(e) => onUpdate(m.key, 'due_trigger', e.target.value)}
                    className="mt-1"
                  >
                    {DEFAULT_TRIGGERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option value="custom">Custom</option>
                  </Select>
                </div>
                {m.due_trigger === 'custom' && (
                  <div className="col-span-2">
                    <Label className="text-xs">Custom Trigger</Label>
                    <Input
                      value={m.custom_trigger_description}
                      onChange={(e) => onUpdate(m.key, 'custom_trigger_description', e.target.value)}
                      placeholder="Describe the trigger condition..."
                      className="mt-1"
                    />
                  </div>
                )}
                <div>
                  <Label className="text-xs">Invoice Type</Label>
                  <Input
                    value={m.invoice_type}
                    onChange={(e) => onUpdate(m.key, 'invoice_type', e.target.value)}
                    placeholder="e.g. Proforma, Tax"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Sum display */}
          <div
            className={`flex items-center justify-between rounded-md px-4 py-3 ${
              validation.valid
                ? 'bg-status-success-bg text-status-success-text'
                : 'bg-status-error-bg text-status-error-text'
            }`}
          >
            <span className="text-sm font-medium">Total percentage</span>
            <span className="font-mono font-medium">{validation.sum}%</span>
          </div>
          {!validation.valid && milestones.length > 0 && (
            <div className="text-sm text-status-error-text">
              Payment schedule must equal 100%. Current: {validation.sum}%
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
