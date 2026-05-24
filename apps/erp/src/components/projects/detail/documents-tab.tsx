import { createClient } from '@repo/supabase/server';
import { ProjectFiles } from '@/components/projects/project-files';
import { getHandoverPack } from '@/lib/handover-actions';
import { DocumentDropZone } from '@/components/documents/document-drop-zone';
import { HandoverPdfButton } from '@/components/projects/handover-pdf-button';
import { getCurrentUserRoleForProject } from '@/lib/project-detail-actions';
import {
  getStepDeliveryData,
  getStepQcData,
  getStepSurveyData,
} from '@/lib/project-stepper-queries';

interface DocumentsTabProps {
  projectId: string;
  leadId: string | null;
}

export async function DocumentsTab({ projectId, leadId }: DocumentsTabProps) {
  // Parallel fetch: handover pack + DC + QC + survey + viewer role + project handover_pdf_path
  const [handoverPack, dcData, qcInspections, surveyData, viewerRole, projectRow] = await Promise.all([
    getHandoverPack(projectId),
    getStepDeliveryData(projectId).catch(() => ({ outgoingChallans: [] as any[], vendorChallans: [] })),
    getStepQcData(projectId).catch(() => [] as any[]),
    getStepSurveyData(projectId).catch(() => null),
    getCurrentUserRoleForProject(),
    (async () => {
      const supabase = await createClient();
      const { data } = await supabase
        .from('projects')
        .select('handover_pdf_path')
        .eq('id', projectId)
        .maybeSingle();
      return data;
    })(),
  ]);

  // Fetch lead-era files from the proposal-files bucket
  let leadFiles: {
    name: string;
    id: string;
    created_at: string;
    size?: number;
    mimetype?: string;
  }[] = [];
  if (leadId) {
    const supabase = await createClient();
    const { data } = await supabase.storage
      .from('proposal-files')
      .list(leadId, { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });
    leadFiles = (data ?? [])
      .filter((f) => f.name !== '.emptyFolderPlaceholder')
      .map((f) => ({
        name: f.name,
        id: f.id ?? f.name,
        created_at: f.created_at ?? '',
        size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
        mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined,
      }));
  }

  const handoverPdfPath = (projectRow as any)?.handover_pdf_path ?? null;

  return (
    <div className="space-y-4">
      {/* C10: Drag-drop upload zone for indexed documents */}
      <div className="rounded-lg border border-n-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-n-800">Upload Documents</h3>
            <p className="text-xs text-n-500 mt-0.5">PDF, images, XLSX, DWG, SKP — max 20 MB each</p>
          </div>
          {/* C11: Handover PDF button */}
          <HandoverPdfButton
            projectId={projectId}
            existingPath={handoverPdfPath}
            viewerRole={viewerRole}
          />
        </div>
        <DocumentDropZone entityType="project" entityId={projectId} />
      </div>

      {/* Existing project files shell (buckets, drag-drop recategorize, generated docs) */}
      <ProjectFiles
        projectId={projectId}
        leadId={leadId}
        leadFiles={leadFiles}
        handoverPack={handoverPack as any}
        deliveryChallans={dcData.outgoingChallans}
        qcInspections={qcInspections}
        surveyData={surveyData}
      />
    </div>
  );
}
