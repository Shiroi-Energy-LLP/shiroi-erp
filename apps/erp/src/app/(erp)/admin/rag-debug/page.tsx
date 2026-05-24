/**
 * /admin/rag-debug — RAG retrieval debug page (founder-only).
 *
 * Lets Vivek test the RAG index by entering queries and seeing the top-N
 * retrieved chunks with similarity scores. Thumbs-up/down buttons log
 * feedback to rag_query_log for quality tracking.
 *
 * Server component — query embedding + retrieval happen server-side.
 * Thumbs feedback is submitted via server actions.
 */

import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { RagDebugClient } from './_client/rag-debug-client';
import { searchRag, thumbsRagLog } from '@/lib/rag-debug-actions';
import { IngestStatusClient } from './_client/ingest-status-client';
import { getRagIngestStatus, triggerReIngest } from './ingest-state-actions';

export const dynamic = 'force-dynamic';

export default async function RagDebugPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; top_k?: string; source_types?: string }>;
}) {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'founder') redirect('/dashboard');

  const params = await searchParams;

  // Run search if query param present
  let searchResult: Awaited<ReturnType<typeof searchRag>> | null = null;
  if (params.q && params.q.trim().length > 0) {
    const topK = Math.min(parseInt(params.top_k ?? '5', 10), 20);
    const sourceTypes = params.source_types
      ? params.source_types.split(',').filter(Boolean)
      : undefined;
    searchResult = await searchRag(params.q.trim(), { top_k: topK, source_types: sourceTypes });
  }

  // Fetch ingest status (non-fatal — page still renders if this fails)
  const ingestStatusResult = await getRagIngestStatus();
  const ingestStatuses = ingestStatusResult.success ? ingestStatusResult.data : [];

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-8">
      <div className="mb-2">
        <h1 className="text-xl font-heading font-bold text-n-900">RAG Debug</h1>
        <p className="text-sm text-n-500 mt-1">
          Founder-only. Test retrieval quality and log feedback for tuning.
        </p>
      </div>

      {/* ── Ingest status section ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-n-700 mb-3">Ingest status</h2>
        <IngestStatusClient
          statuses={ingestStatuses}
          triggerReIngestAction={triggerReIngest}
        />
        {!ingestStatusResult.success && (
          <p className="text-xs text-red-500 mt-2">
            Could not load ingest status: {ingestStatusResult.error}
          </p>
        )}
      </section>

      {/* ── Query / retrieval section ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-n-700 mb-3">Retrieval test</h2>
        <RagDebugClient
          initialQuery={params.q ?? ''}
          initialTopK={parseInt(params.top_k ?? '5', 10)}
          initialSourceTypes={params.source_types ?? ''}
          searchResult={searchResult}
          thumbsAction={thumbsRagLog}
        />
      </section>
    </div>
  );
}
