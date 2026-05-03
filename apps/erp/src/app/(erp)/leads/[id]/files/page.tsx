import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import { LeadFilesList } from '@/components/leads/lead-files-list';
import { DriveFolderButton } from '@/components/leads/drive-folder-button';
import { DocumentList } from '@/components/documents/document-list';
import {
  getDocumentsForLead,
  getLeadDriveFolder,
} from '@/lib/documents-queries';
import { getUserProfile } from '@/lib/auth';

interface FilesTabProps {
  params: Promise<{ id: string }>;
}

const DRIVE_CREATE_ROLES = new Set([
  'founder',
  'marketing_manager',
  'designer',
  'sales_engineer',
]);

export default async function FilesTab({ params }: FilesTabProps) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  const profile = await getUserProfile();
  const canCreateFolder = profile ? DRIVE_CREATE_ROLES.has(profile.role) : false;

  const supabase = await createClient();

  // Drive folder + indexed documents (mig 109) — single source of truth for the journey.
  const driveFolder = await getLeadDriveFolder(id);
  const docsResult = await getDocumentsForLead(id);
  const documents = docsResult.success ? docsResult.data : [];

  // Legacy: files from proposal-files bucket (kept until phase 2 backfill).
  const { data: proposalFiles } = await supabase.storage
    .from('proposal-files')
    .list(id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

  const legacyFiles = (proposalFiles ?? []).map((f) => ({
    name: f.name,
    id: f.id ?? f.name,
    created_at: f.created_at ?? '',
    size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
    mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined,
  }));

  return (
    <div className="space-y-4">
      {/* Drive folder section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Drive folder</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-n-500 max-w-md">
              One folder per customer journey, used for CAD/Sketchup/site photos.
              Indexed automatically as documents (phase 2).
            </p>
            <DriveFolderButton
              leadId={id}
              driveFolderUrl={driveFolder.url}
              canCreate={canCreateFolder}
            />
          </div>
        </CardContent>
      </Card>

      {/* Documents index (mig 109) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Documents{' '}
            <span className="text-xs font-normal text-n-500">
              ({documents.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!docsResult.success && (
            <div className="text-xs text-red-600 mb-2">
              Failed to load documents: {docsResult.error}
            </div>
          )}
          <DocumentList documents={documents} />
        </CardContent>
      </Card>

      {/* Legacy: proposal-files bucket */}
      {legacyFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Proposal files{' '}
              <span className="text-xs font-normal text-n-500">
                (legacy bucket — {legacyFiles.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LeadFilesList leadId={id} files={legacyFiles} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
