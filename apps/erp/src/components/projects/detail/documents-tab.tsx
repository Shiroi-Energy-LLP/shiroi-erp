import { createClient } from '@repo/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import { ProjectFiles } from '@/components/projects/project-files';
import { getHandoverPack } from '@/lib/handover-actions';
import { DocumentDropZone } from '@/components/documents/document-drop-zone';
import { DocumentList } from '@/components/documents/document-list';
import { HandoverPdfButton } from '@/components/projects/handover-pdf-button';
import { getCurrentUserRoleForProject } from '@/lib/project-detail-actions';
import { attachOpenUrls, getDocumentsForProject } from '@/lib/documents-queries';
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
  //   + indexed documents (mig 109 — used by softDeleteDocument delete buttons).
  const [handoverPack, dcData, qcInspections, surveyData, viewerRole, projectRow, docsResult] = await Promise.all([
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
    getDocumentsForProject(projectId),
  ]);

  // Sign Supabase URLs / pass through Drive URLs so DocumentList can render
  // a working Open link per row.
  const indexedDocuments = docsResult.success ? await attachOpenUrls(docsResult.data) : [];
  const canDeleteDocuments = !!viewerRole && ['founder', 'project_manager'].includes(viewerRole);

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
    // list_bucket_objects RPC (mig 207) — avoids the expensive storage.search() path.
    const { data } = await supabase.rpc('list_bucket_objects', {
      p_bucket: 'proposal-files',
      p_prefixes: [leadId],
      p_limit: 500,
    });
    leadFiles = (data ?? [])
      .filter((f) => !f.name.endsWith('.emptyFolderPlaceholder'))
      .map((f) => {
        const meta = (f.metadata ?? {}) as Record<string, unknown>;
        const rel = f.name.slice(leadId.length + 1);
        return {
          name: rel,
          id: f.id ?? rel,
          created_at: f.created_at ?? '',
          size: meta.size as number | undefined,
          mimetype: meta.mimetype as string | undefined,
        };
      });
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

      {/* Indexed documents (mig 109) — soft-delete enabled for founder + PM */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Indexed Documents{' '}
            <span className="text-xs font-normal text-n-500">
              ({indexedDocuments.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!docsResult.success && (
            <div className="text-xs text-red-600 mb-2">
              Failed to load documents: {docsResult.error}
            </div>
          )}
          <DocumentList documents={indexedDocuments} canDelete={canDeleteDocuments} />
        </CardContent>
      </Card>

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
