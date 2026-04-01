'use client';

import { useState, useCallback } from 'react';
import Decimal from 'decimal.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { calcLineTotal, calcGST, calcProposalTotals, validatePaymentSchedule } from '@/lib/proposal-calc';
import type { Database } from '@repo/types/database';

type SystemType = Database['public']['Enums']['system_type'];
type GSTType = Database['public']['Enums']['gst_type'];
type ScopeOwner = Database['public']['Enums']['scope_owner'];

interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  city: string | null;
  segment: string;
  system_type: SystemType | null;
  estimated_size_kwp: number | null;
}

interface BOMLineInput {
  key: string;
  item_category: string;
  item_description: string;
  brand: string;
  model: string;
  hsn_code: string;
  quantity: number;
  unit: string;
  unit_price: number;
  gst_type: GSTType;
  scope_owner: ScopeOwner;
}

interface MilestoneInput {
  key: string;
  milestone_name: string;
  percentage: number;
  due_trigger: string;
  custom_trigger_description: string;
  invoice_type: string;
}

const STEPS = ['Lead & System', 'Bill of Materials', 'Payment Schedule', 'Review'] as const;

const SYSTEM_TYPES: { value: SystemType; label: string }[] = [
  { value: 'on_grid', label: 'On Grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'off_grid', label: 'Off Grid' },
];

const SCOPE_OWNERS: { value: ScopeOwner; label: string }[] = [
  { value: 'shiroi', label: 'Shiroi' },
  { value: 'client', label: 'Client' },
  { value: 'builder', label: 'Builder' },
  { value: 'excluded', label: 'Excluded' },
];

const CATEGORIES = [
  'Solar Panels',
  'Inverter',
  'Battery',
  'Mounting Structure',
  'Electrical',
  'Civil Works',
  'Labour',
  'Net Metering',
  'Safety Equipment',
  'Other',
];

const DEFAULT_TRIGGERS = [
  'On booking',
  'On material delivery',
  'On structure erection',
  'On panel mounting',
  'On commissioning',
  'On net metering approval',
];

function createBOMLine(): BOMLineInput {
  return {
    key: crypto.randomUUID(),
    item_category: 'Solar Panels',
    item_description: '',
    brand: '',
    model: '',
    hsn_code: '',
    quantity: 1,
    unit: 'Nos',
    unit_price: 0,
    gst_type: 'supply',
    scope_owner: 'shiroi',
  };
}

function createMilestone(order: number): MilestoneInput {
  return {
    key: crypto.randomUUID(),
    milestone_name: '',
    percentage: 0,
    due_trigger: DEFAULT_TRIGGERS[0] ?? 'On booking',
    custom_trigger_description: '',
    invoice_type: '',
  };
}

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
  const [milestones, setMilestones] = useState<MilestoneInput[]>([createMilestone(1)]);

  const [submitting, setSubmitting] = useState(false);

  // Selected lead info
  const selectedLead = leads.find(l => l.id === leadId);

  // Auto-populate from lead selection
  const handleLeadChange = useCallback((id: string) => {
    setLeadId(id);
    const lead = leads.find(l => l.id === id);
    if (lead) {
      if (lead.system_type) setSystemType(lead.system_type);
      if (lead.estimated_size_kwp) setSystemSizeKwp(String(lead.estimated_size_kwp));
    }
  }, [leads]);

  // BOM line helpers
  const addBOMLine = () => setBomLines(prev => [...prev, createBOMLine()]);
  const removeBOMLine = (key: string) => setBomLines(prev => prev.filter(l => l.key !== key));
  const updateBOMLine = (key: string, field: keyof BOMLineInput, value: string | number) => {
    setBomLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  };

  // Milestone helpers
  const addMilestone = () => setMilestones(prev => [...prev, createMilestone(prev.length + 1)]);
  const removeMilestone = (key: string) => setMilestones(prev => prev.filter(m => m.key !== key));
  const updateMilestone = (key: string, field: keyof MilestoneInput, value: string | number) => {
    setMilestones(prev => prev.map(m => m.key === key ? { ...m, [field]: value } : m));
  };

  // Compute totals from BOM lines
  const computedLines = bomLines.map(l => ({
    total_price: calcLineTotal(l.quantity, l.unit_price),
    gst_type: l.gst_type,
    scope_owner: l.scope_owner,
  }));
  const discountNum = Number(discount) || 0;
  const totals = calcProposalTotals(computedLines, discountNum);

  // Milestones total from percentage of totalAfterDiscount
  const milestonePercentages = milestones.map(m => m.percentage);
  const scheduleValidation = validatePaymentSchedule(milestonePercentages);

  // Step validation
  const canProceedFromStep = (s: number): boolean => {
    switch (s) {
      case 0:
        return Boolean(leadId && systemType && Number(systemSizeKwp) > 0);
      case 1:
        return bomLines.length > 0 && bomLines.every(l => l.item_description && l.quantity > 0 && l.unit_price > 0);
      case 2:
        return milestones.length > 0 && scheduleValidation.valid && milestones.every(m => m.milestone_name);
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
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
              i === step
                ? 'bg-[#00B050] text-white'
                : i < step
                  ? 'bg-[#ECFDF5] text-[#065F46]'
                  : 'bg-[#F3F4F6] text-[#6B7280]'
            }`}>
              {i < step ? '\u2713' : i + 1}
            </div>
            <span className={`text-sm ${i === step ? 'font-medium text-[#1A1D24]' : 'text-muted-foreground'}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${i < step ? 'bg-[#00B050]' : 'bg-[#E5E7EB]'}`} />
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

// ── Step 1: Lead & System ────────────────────────────────────────────────────

interface StepLeadSystemProps {
  leads: Lead[];
  leadId: string;
  onLeadChange: (id: string) => void;
  systemType: SystemType;
  onSystemTypeChange: (t: SystemType) => void;
  systemSizeKwp: string;
  onSystemSizeChange: (v: string) => void;
  panelBrand: string;
  onPanelBrandChange: (v: string) => void;
  panelModel: string;
  onPanelModelChange: (v: string) => void;
  panelWattage: string;
  onPanelWattageChange: (v: string) => void;
  panelCount: string;
  onPanelCountChange: (v: string) => void;
  inverterBrand: string;
  onInverterBrandChange: (v: string) => void;
  inverterModel: string;
  onInverterModelChange: (v: string) => void;
  inverterCapacity: string;
  onInverterCapacityChange: (v: string) => void;
  batteryBrand: string;
  onBatteryBrandChange: (v: string) => void;
  batteryModel: string;
  onBatteryModelChange: (v: string) => void;
  batteryCapacity: string;
  onBatteryCapacityChange: (v: string) => void;
  structureType: string;
  onStructureTypeChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
}

function StepLeadSystem(props: StepLeadSystemProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Lead</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label>Lead *</Label>
              <Select value={props.leadId} onChange={(e) => props.onLeadChange(e.target.value)} className="mt-1">
                <option value="">Select a lead...</option>
                {props.leads.map(lead => (
                  <option key={lead.id} value={lead.id}>
                    {lead.customer_name} — {lead.phone} ({lead.city ?? 'No city'})
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>System Type *</Label>
                <Select
                  value={props.systemType}
                  onChange={(e) => props.onSystemTypeChange(e.target.value as SystemType)}
                  className="mt-1"
                >
                  {SYSTEM_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>System Size (kWp) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={props.systemSizeKwp}
                  onChange={(e) => props.onSystemSizeChange(e.target.value)}
                  placeholder="e.g. 10.00"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">System Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Panels</h4>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <Label>Brand</Label>
                <Input value={props.panelBrand} onChange={(e) => props.onPanelBrandChange(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Model</Label>
                <Input value={props.panelModel} onChange={(e) => props.onPanelModelChange(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Wattage (W)</Label>
                <Input type="number" value={props.panelWattage} onChange={(e) => props.onPanelWattageChange(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Count</Label>
                <Input type="number" value={props.panelCount} onChange={(e) => props.onPanelCountChange(e.target.value)} className="mt-1" />
              </div>
            </div>

            <h4 className="text-sm font-medium text-muted-foreground">Inverter</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Brand</Label>
                <Input value={props.inverterBrand} onChange={(e) => props.onInverterBrandChange(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Model</Label>
                <Input value={props.inverterModel} onChange={(e) => props.onInverterModelChange(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Capacity (kW)</Label>
                <Input type="number" value={props.inverterCapacity} onChange={(e) => props.onInverterCapacityChange(e.target.value)} className="mt-1" />
              </div>
            </div>

            {props.systemType !== 'on_grid' && (
              <>
                <h4 className="text-sm font-medium text-muted-foreground">Battery</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Brand</Label>
                    <Input value={props.batteryBrand} onChange={(e) => props.onBatteryBrandChange(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>Model</Label>
                    <Input value={props.batteryModel} onChange={(e) => props.onBatteryModelChange(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>Capacity (kWh)</Label>
                    <Input type="number" value={props.batteryCapacity} onChange={(e) => props.onBatteryCapacityChange(e.target.value)} className="mt-1" />
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Structure Type</Label>
                <Input value={props.structureType} onChange={(e) => props.onStructureTypeChange(e.target.value)} placeholder="e.g. Elevated, Flush mount" className="mt-1" />
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <textarea
                className="mt-1 flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={props.notes}
                onChange={(e) => props.onNotesChange(e.target.value)}
                placeholder="Internal notes for this proposal..."
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Step 2: BOM ──────────────────────────────────────────────────────────────

interface StepBOMProps {
  lines: BOMLineInput[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, field: keyof BOMLineInput, value: string | number) => void;
  discount: string;
  onDiscountChange: (v: string) => void;
  totals: ReturnType<typeof calcProposalTotals>;
}

function StepBOM({ lines, onAdd, onRemove, onUpdate, discount, onDiscountChange, totals }: StepBOMProps) {
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
                  <Button variant="ghost" size="sm" onClick={() => onRemove(line.key)} className="text-[#991B1B] h-7 px-2 text-xs">
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
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
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
                    {SCOPE_OWNERS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
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

// ── Step 3: Payment Schedule ─────────────────────────────────────────────────

interface StepPaymentProps {
  milestones: MilestoneInput[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, field: keyof MilestoneInput, value: string | number) => void;
  totalAmount: number;
  validation: { valid: boolean; sum: number };
}

function StepPayment({ milestones, onAdd, onRemove, onUpdate, totalAmount, validation }: StepPaymentProps) {
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
                <span className="text-sm font-medium text-muted-foreground">Milestone {idx + 1}</span>
                {milestones.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => onRemove(m.key)} className="text-[#991B1B] h-7 px-2 text-xs">
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
                    {formatINR(new Decimal(totalAmount).mul(m.percentage).div(100).toNumber())}
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
                    {DEFAULT_TRIGGERS.map(t => (
                      <option key={t} value={t}>{t}</option>
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
          <div className={`flex items-center justify-between rounded-md px-4 py-3 ${
            validation.valid ? 'bg-[#ECFDF5] text-[#065F46]' : 'bg-[#FEF2F2] text-[#991B1B]'
          }`}>
            <span className="text-sm font-medium">Total percentage</span>
            <span className="font-mono font-medium">{validation.sum}%</span>
          </div>
          {!validation.valid && milestones.length > 0 && (
            <div className="text-sm text-[#991B1B]">
              Payment schedule must equal 100%. Current: {validation.sum}%
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Step 4: Review ───────────────────────────────────────────────────────────

interface StepReviewProps {
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

function StepReview(props: StepReviewProps) {
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
                  Panel: {props.panelBrand} {props.panelModel} {props.panelWattage ? `${props.panelWattage}W` : ''} {props.panelCount ? `x${props.panelCount}` : ''}
                </div>
              )}
              {props.inverterBrand && (
                <div className="text-sm">
                  Inverter: {props.inverterBrand} {props.inverterModel} {props.inverterCapacity ? `${props.inverterCapacity} kW` : ''}
                </div>
              )}
              {props.systemType !== 'on_grid' && props.batteryBrand && (
                <div className="text-sm">
                  Battery: {props.batteryBrand} {props.batteryModel} {props.batteryCapacity ? `${props.batteryCapacity} kWh` : ''}
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
                  <TableCell className="text-xs">{line.gst_type === 'supply' ? '5%' : '18%'}</TableCell>
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
          {props.discount > 0 && (
            <TotalLine label="Discount" value={-props.discount} muted />
          )}
          <div className="border-t pt-2">
            <TotalLine label="Total after discount" value={props.totals.totalAfterDiscount} bold />
          </div>
        </CardContent>
      </Card>

      {/* Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Schedule ({props.milestones.length} milestones)</CardTitle>
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
                    {formatINR(new Decimal(props.totalAmount).mul(m.percentage).div(100).toNumber())}
                  </TableCell>
                  <TableCell>{m.due_trigger === 'custom' ? m.custom_trigger_description : m.due_trigger}</TableCell>
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

// ── Shared UI ────────────────────────────────────────────────────────────────

function TotalLine({ label, value, bold, muted }: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold text-base' : ''}`}>
      <span className={muted ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={`font-mono ${bold ? 'text-[#1A1D24]' : ''}`}>
        {formatINR(value)}
      </span>
    </div>
  );
}
