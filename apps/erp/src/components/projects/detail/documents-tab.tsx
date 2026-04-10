import { createClient } from '@repo/supabase/server';
import { ProjectFiles } from '@/components/projects/project-files';
import { getHandoverPack } from '@/lib/handover-actions';

interface DocumentsTabProps {
  projectId: string;
  leadId: string | null;
}

export async function DocumentsTab({ projectId, leadId }: DocumentsTabProps) {
  const handoverPack = await getHandoverPack(projectId);

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

  return (
    <ProjectFiles
      projectId={projectId}
      leadId={leadId}
      leadFiles={leadFiles}
      handoverPack={handoverPack as any}
    />
  );
}
