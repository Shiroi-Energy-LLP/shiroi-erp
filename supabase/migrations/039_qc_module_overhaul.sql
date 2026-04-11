-- Migration 039: QC Module overhaul — structured 7-section Solar System Quality Check Form
-- Per Manivel's spec: approval workflow (Submit → Pending → Approved → PDF), structured checklist

-- 1. Relax gate_number constraint (was limited to 1,2,3 — new QC is project-level)
ALTER TABLE qc_gate_inspections DROP CONSTRAINT IF EXISTS qc_gate_inspections_gate_number_check;
ALTER TABLE qc_gate_inspections ADD CONSTRAINT qc_gate_inspections_gate_number_check CHECK (gate_number >= 1);

-- 2. Make milestone_id nullable (new structured QC is project-level, not milestone-linked)
ALTER TABLE qc_gate_inspections ALTER COLUMN milestone_id DROP NOT NULL;

-- 3. Add approval workflow fields
ALTER TABLE qc_gate_inspections
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE qc_gate_inspections DROP CONSTRAINT IF EXISTS qc_gate_inspections_approval_status_check;
ALTER TABLE qc_gate_inspections ADD CONSTRAINT qc_gate_inspections_approval_status_check
  CHECK (approval_status IN ('draft', 'submitted', 'approved', 'rework_required'));

-- 4. Expand overall_result to include 'approved' and 'rework_required'
ALTER TABLE qc_gate_inspections DROP CONSTRAINT IF EXISTS qc_gate_inspections_overall_result_check;
ALTER TABLE qc_gate_inspections ADD CONSTRAINT qc_gate_inspections_overall_result_check
  CHECK (overall_result IN ('passed', 'failed', 'conditional_pass', 'approved', 'rework_required'));

-- 5. Backward compat: mark existing passed inspections as approved
UPDATE qc_gate_inspections SET approval_status = 'approved' WHERE overall_result = 'passed' AND approval_status = 'draft';

COMMENT ON COLUMN qc_gate_inspections.approval_status IS 'QC workflow: draft → submitted → approved/rework_required';
COMMENT ON COLUMN qc_gate_inspections.approved_by IS 'Employee who approved the QC inspection';
COMMENT ON COLUMN qc_gate_inspections.approved_at IS 'When the QC inspection was approved';
COMMENT ON COLUMN qc_gate_inspections.remarks IS 'Overall QC inspection remarks';
