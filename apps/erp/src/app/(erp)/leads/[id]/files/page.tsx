import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { Card, CardHeader, CardTitle, CardContent, EmptyState } from '@repo/ui';
import { LeadFilesList } from '@/components/leads/lead-files-list';

interface FilesTabProps {
  params: Promise<{ id: string }>;
}

export default async function FilesTab({ params }: FilesTabProps) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  const supabase = await createClient();

  // Files from proposal-files bucket (keyed by lead_id)
  const { data: proposalFiles } = await supabase.storage
    .from('proposal-files')
    .list(id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

  const files = (proposalFiles ?? []).map(f => ({
    name: f.name,
    id: f.id ?? f.name,
    created_at: f.created_at ?? '',
    size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
    mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined,
  }));

  if (files.length === 0) {
    return (
      <div className="py-12">
        <EmptyState
          title="No files yet"
          description="Upload proposal documents, site photos, or other files from the Proposal detail page."
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Files ({files.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <LeadFilesList leadId={id} files={files} />
      </CardContent>
    </Card>
  );
}
