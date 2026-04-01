'use server';

import { createCorrectionRequest } from '@/lib/site-report-queries';

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
): Promise<{ error?: string; correctionId?: string }> {
  const op = '[submitCorrectionAction]';
  console.log(`${op} Starting for report: ${input.originalReportId}, field: ${input.fieldCorrected}`);

  try {
    if (!input.fieldCorrected) {
      return { error: 'Field to correct is required.' };
    }
    if (!input.correctedValue) {
      return { error: 'Corrected value is required.' };
    }
    if (!input.correctionReason) {
      return { error: 'Correction reason is mandatory.' };
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

    return { correctionId: result.id };
  } catch (error) {
    console.error(`${op} Failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return { error: error instanceof Error ? error.message : 'Failed to submit correction.' };
  }
}
