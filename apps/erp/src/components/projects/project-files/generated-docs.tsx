'use client';

/**
 * Builders for auto-generated document rows shown inside the
 * Customer Documents / Delivery Challans / Documents boxes.
 *
 * These are pure functions — no state, just React.ReactNode output.
 * Extracted from index.tsx so the main shell stays under the 500-LOC
 * rule.
 */
import * as React from 'react';
import { Truck, ClipboardCheck, MapPin } from 'lucide-react';

import type { DeliveryChallanInfo, QcInspectionInfo, SurveyInfo } from './types';
import { GeneratedDocRow } from './parts-rows';

function formatIstDate(iso: string | undefined | null): string | undefined {
  if (!iso) return undefined;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Survey → "Customer Documents" box
// ═══════════════════════════════════════════════════════════════════════

export function buildSurveyGenerated(surveyData: SurveyInfo | null | undefined): React.ReactNode {
  if (!surveyData) return null;

  return (
    <GeneratedDocRow
      icon={MapPin}
      label="Site Survey Report"
      sublabel={formatIstDate(surveyData.survey_date)}
      badgeText={
        surveyData.survey_status === 'completed'
          ? 'Completed'
          : (surveyData.survey_status ?? 'Survey')
      }
      badgeVariant={surveyData.survey_status === 'completed' ? 'success' : 'info'}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Delivery Challans → "Delivery Challans" box
// ═══════════════════════════════════════════════════════════════════════

const DC_STATUS_MAP: Record<
  string,
  { text: string; variant: 'info' | 'success' | 'warning' | 'neutral' }
> = {
  draft: { text: 'Draft', variant: 'neutral' },
  dispatched: { text: 'Dispatched', variant: 'info' },
  delivered: { text: 'Delivered', variant: 'success' },
  partial_delivery: { text: 'Partial', variant: 'warning' },
};

export function buildDcGenerated(
  projectId: string,
  deliveryChallans: DeliveryChallanInfo[] | undefined,
): React.ReactNode {
  if (!deliveryChallans || deliveryChallans.length === 0) return null;

  return (
    <>
      {deliveryChallans.map((dc, idx) => {
        const dcLabel = dc.dc_number || `DC-${String(idx + 1).padStart(3, '0')}`;
        const itemCount = dc.delivery_challan_items?.length ?? 0;
        const st = DC_STATUS_MAP[dc.status] ?? { text: dc.status, variant: 'neutral' as const };
        return (
          <GeneratedDocRow
            key={dc.id}
            icon={Truck}
            label={`${dcLabel} (${itemCount} items)`}
            sublabel={formatIstDate(dc.dc_date)}
            badgeText={st.text}
            badgeVariant={st.variant}
            downloadUrl={`/api/projects/${projectId}/dc/${dc.id}`}
          />
        );
      })}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// QC Inspections → "Documents / Approvals" box
// ═══════════════════════════════════════════════════════════════════════

const QC_STATUS_MAP: Record<
  string,
  { text: string; variant: 'info' | 'success' | 'warning' | 'error' | 'neutral' }
> = {
  draft: { text: 'Draft', variant: 'neutral' },
  submitted: { text: 'Submitted', variant: 'info' },
  approved: { text: 'Approved', variant: 'success' },
  rework_required: { text: 'Rework', variant: 'warning' },
};

export function buildQcGenerated(
  projectId: string,
  qcInspections: QcInspectionInfo[] | undefined,
): React.ReactNode {
  if (!qcInspections || qcInspections.length === 0) return null;

  return (
    <>
      {qcInspections.map((qc) => {
        const inspectorName = qc.employees?.full_name;
        const st = QC_STATUS_MAP[qc.approval_status ?? ''] ?? {
          text: qc.approval_status ?? 'Draft',
          variant: 'neutral' as const,
        };
        const canDownload =
          qc.approval_status === 'approved' || qc.approval_status === 'submitted';
        return (
          <GeneratedDocRow
            key={qc.id}
            icon={ClipboardCheck}
            label={`QC Report${inspectorName ? ` — ${inspectorName}` : ''}`}
            sublabel={formatIstDate(qc.inspection_date)}
            badgeText={st.text}
            badgeVariant={st.variant}
            downloadUrl={canDownload ? `/api/projects/${projectId}/qc/${qc.id}` : undefined}
          />
        );
      })}
    </>
  );
}
