'use client';

/**
 * ProposalWizard — main shell for the 4-step "Create Proposal" flow.
 *
 * Split per the April 14 audit (CLAUDE.md rule #14). Original was 1,024 LOC;
 * shell is now under 300. Step bodies live in sibling files; shared types
 * and the TotalLine currency helper live in ./shared.tsx.
 *
 *   ./shared.tsx            Types + constants + factories + TotalLine
 *   ./step-lead-system.tsx  Step 1 (Lead select + System config)
 *   ./step-bom.tsx          Step 2 (BOM lines + live totals)
 *   ./step-payment.tsx      Step 3 (Payment milestones)
 *   ./step-review.tsx       Step 4 (Full review + submit)
 */
import { useState, useCallback } from 'react';
import { Button } from '@repo/ui';
import { calcLineTotal, calcProposalTotals, validatePaymentSchedule } from '@/lib/proposal-calc';

import type { Lead, SystemType, BOMLineInput, MilestoneInput } from './shared';
import { STEPS, createBOMLine, createMilestone } from './shared';
import { StepLeadSystem } from './step-lead-system';
import { StepBOM } from './step-bom';
import { StepPayment } from './step-payment';
import { StepReview } from './step-review';

export type { Lead, SystemType, BOMLineInput, MilestoneInput } from './shared';

export function ProposalWizard({ leads }: { leads: Lead[] }) {
  const [step, setStep] = useState(0);

  // Step 1: Lead + System
  const [leadId, setLeadId] = useState('');
  const [systemType, setSystemType] = useState<SystemType>('on_grid');
  const [systemSizeKwp, setSystemSizeKwp] = useState('');
  const [panelBrand, setPanelBrand] = useState('');
  const [panelModel, setPanelModel] = useState('');
  const [panelWattage, setPanelWattage] = useState('');
  const [panelCount, setPanelCount] = useState('');
  const [inverterBrand, setInverterBrand] = useState('');
  const [inverterModel, setInverterModel] = useState('');
  const [inverterCapacity, setInverterCapacity] = useState('');
  const [batteryBrand, setBatteryBrand] = useState('');
  const [batteryModel, setBatteryModel] = useState('');
  const [batteryCapacity, setBatteryCapacity] = useState('');
  const [structureType, setStructureType] = useState('');
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');

  // Step 2: BOM
  const [bomLines, setBomLines] = useState<BOMLineInput[]>([createBOMLine()]);

  // Step 3: Payment
  const [milestones, setMilestones] = useState<MilestoneInput[]>([createMilestone()]);

  const [submitting] = useState(false);

  // Selected lead info
  const selectedLead = leads.find((l) => l.id === leadId);

  // Auto-populate from lead selection
  const handleLeadChange = useCallback(
    (id: string) => {
      setLeadId(id);
      const lead = leads.find((l) => l.id === id);
      if (lead) {
        if (lead.system_type) setSystemType(lead.system_type);
        if (lead.estimated_size_kwp) setSystemSizeKwp(String(lead.estimated_size_kwp));
      }
    },
    [leads],
  );

  // BOM line helpers
  const addBOMLine = () => setBomLines((prev) => [...prev, createBOMLine()]);
  const removeBOMLine = (key: string) =>
    setBomLines((prev) => prev.filter((l) => l.key !== key));
  const updateBOMLine = (
    key: string,
    field: keyof BOMLineInput,
    value: string | number,
  ) => {
    setBomLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  };

  // Milestone helpers
  const addMilestone = () => setMilestones((prev) => [...prev, createMilestone()]);
  const removeMilestone = (key: string) =>
    setMilestones((prev) => prev.filter((m) => m.key !== key));
  const updateMilestone = (
    key: string,
    field: keyof MilestoneInput,
    value: string | number,
  ) => {
    setMilestones((prev) => prev.map((m) => (m.key === key ? { ...m, [field]: value } : m)));
  };

  // Compute totals from BOM lines
  const computedLines = bomLines.map((l) => ({
    total_price: calcLineTotal(l.quantity, l.unit_price),
    gst_type: l.gst_type,
    scope_owner: l.scope_owner,
  }));
  const discountNum = Number(discount) || 0;
  const totals = calcProposalTotals(computedLines, discountNum);

  // Milestones total from percentage of totalAfterDiscount
  const milestonePercentages = milestones.map((m) => m.percentage);
  const scheduleValidation = validatePaymentSchedule(milestonePercentages);

  // Step validation
  const canProceedFromStep = (s: number): boolean => {
    switch (s) {
      case 0:
        return Boolean(leadId && systemType && Number(systemSizeKwp) > 0);
      case 1:
        return (
          bomLines.length > 0 &&
          bomLines.every(
            (l) => l.item_description && l.quantity > 0 && l.unit_price > 0,
          )
        );
      case 2:
        return (
          milestones.length > 0 &&
          scheduleValidation.valid &&
          milestones.every((m) => m.milestone_name)
        );
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (step < STEPS.length - 1 && canProceedFromStep(step)) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                i === step
                  ? 'bg-shiroi-green text-white'
                  : i < step
                    ? 'bg-status-success-bg text-status-success-text'
                    : 'bg-status-neutral-bg text-[#6B7280]'
              }`}
            >
              {i < step ? '\u2713' : i + 1}
            </div>
            <span
              className={`text-sm ${i === step ? 'font-medium text-n-900' : 'text-muted-foreground'}`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${i < step ? 'bg-shiroi-green' : 'bg-[#E5E7EB]'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      {step === 0 && (
        <StepLeadSystem
          leads={leads}
          leadId={leadId}
          onLeadChange={handleLeadChange}
          systemType={systemType}
          onSystemTypeChange={setSystemType}
          systemSizeKwp={systemSizeKwp}
          onSystemSizeChange={setSystemSizeKwp}
          panelBrand={panelBrand}
          onPanelBrandChange={setPanelBrand}
          panelModel={panelModel}
          onPanelModelChange={setPanelModel}
          panelWattage={panelWattage}
          onPanelWattageChange={setPanelWattage}
          panelCount={panelCount}
          onPanelCountChange={setPanelCount}
          inverterBrand={inverterBrand}
          onInverterBrandChange={setInverterBrand}
          inverterModel={inverterModel}
          onInverterModelChange={setInverterModel}
          inverterCapacity={inverterCapacity}
          onInverterCapacityChange={setInverterCapacity}
          batteryBrand={batteryBrand}
          onBatteryBrandChange={setBatteryBrand}
          batteryModel={batteryModel}
          onBatteryModelChange={setBatteryModel}
          batteryCapacity={batteryCapacity}
          onBatteryCapacityChange={setBatteryCapacity}
          structureType={structureType}
          onStructureTypeChange={setStructureType}
          notes={notes}
          onNotesChange={setNotes}
        />
      )}

      {step === 1 && (
        <StepBOM
          lines={bomLines}
          onAdd={addBOMLine}
          onRemove={removeBOMLine}
          onUpdate={updateBOMLine}
          discount={discount}
          onDiscountChange={setDiscount}
          totals={totals}
        />
      )}

      {step === 2 && (
        <StepPayment
          milestones={milestones}
          onAdd={addMilestone}
          onRemove={removeMilestone}
          onUpdate={updateMilestone}
          totalAmount={totals.totalAfterDiscount}
          validation={scheduleValidation}
        />
      )}

      {step === 3 && (
        <StepReview
          selectedLead={selectedLead ?? null}
          systemType={systemType}
          systemSizeKwp={systemSizeKwp}
          panelBrand={panelBrand}
          panelModel={panelModel}
          panelWattage={panelWattage}
          panelCount={panelCount}
          inverterBrand={inverterBrand}
          inverterModel={inverterModel}
          inverterCapacity={inverterCapacity}
          batteryBrand={batteryBrand}
          batteryModel={batteryModel}
          batteryCapacity={batteryCapacity}
          structureType={structureType}
          bomLines={bomLines}
          milestones={milestones}
          totals={totals}
          discount={discountNum}
          totalAmount={totals.totalAfterDiscount}
          notes={notes}
        />
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div>
          {step > 0 && (
            <Button variant="outline" onClick={handleBack}>
              Back
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={!canProceedFromStep(step)}>
              Continue
            </Button>
          ) : (
            <Button disabled={submitting || !scheduleValidation.valid}>
              {submitting ? 'Creating...' : 'Create Proposal'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
