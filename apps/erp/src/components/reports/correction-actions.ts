'use server';

import { createCorrectionRequest } from '@/lib/site-report-queries';
import { ok, err, type ActionResult } from '@/lib/types/actions';

interface SubmitCorrectionInput {
  originalReportId: string;
  projectId: string;
  requestedBy: string;
  fieldCorrected: string;
  originalValue: string;
  correctedValue: string;
  correctionReason: string;
}

export async function submitCorrectionAction(
  input: SubmitCorrectionInput,
): Promise<ActionResult<{ correctionId: string }>> {
  const op = '[submitCorrectionAction]';
  console.log(`${op} Starting for report: ${input.originalReportId}, field: ${input.fieldCorrected}`);

  try {
    if (!input.fieldCorrected) {
      return err('Field to correct is required.', 'MISSING_FIELD');
    }
    if (!input.correctedValue) {
      return err('Corrected value is required.', 'MISSING_VALUE');
    }
    if (!input.correctionReason) {
      return err('Correction reason is mandatory.', 'MISSING_REASON');
    }

    const result = await createCorrectionRequest({
      id: crypto.randomUUID(),
      original_report_id: input.originalReportId,
      project_id: input.projectId,
      requested_by: input.requestedBy,
      field_corrected: input.fieldCorrected,
      original_value: input.originalValue,
      corrected_value: input.correctedValue,
      correction_reason: input.correctionReason,
      status: 'pending',
    });

    return ok({ correctionId: result.id });
  } catch (e) {
    console.error(`${op} Failed:`, {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return err(e instanceof Error ? e.message : 'Failed to submit correction.', 'CORRECTION_FAILED');
  }
}
