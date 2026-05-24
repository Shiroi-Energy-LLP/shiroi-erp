'use client';

/**
 * ingest-status-client.tsx — client component for the RAG ingest status section.
 *
 * Shows per-source-type chunk counts and last ingest timestamps.
 * "Re-ingest now" button calls POST /api/rag/ingest-all (requires x-webhook-secret).
 * Since this runs in the browser, re-ingest is triggered via a server action that
 * calls the API route internally (so the secret never leaks to the client).
 */

import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/types/actions';

export interface IngestSourceStatus {
  source_type: string;
  chunk_count: number;
  last_ingested_at: string | null;
  last_run_status: string;
  chunks_indexed: number;
}

interface Props {
  statuses: IngestSourceStatus[];
  triggerReIngestAction: (sourceType: string) => Promise<ActionResult<void>>;
}

const STATUS_BADGE: Record<string, { label: string; class: string }> = {
  success: { label: 'OK', class: 'bg-green-100 text-green-700 border-green-300' },
  error:   { label: 'Error', class: 'bg-red-100 text-red-700 border-red-300' },
  running: { label: 'Running', class: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  idle:    { label: 'Idle', class: 'bg-n-100 text-n-500 border-n-200' },
  pending: { label: 'Pending', class: 'bg-n-100 text-n-500 border-n-200' },
};

function formatRelativeTime(isoStr: string | null): string {
  if (!isoStr) return 'Never';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return 'Unknown';
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 2) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function IngestStatusClient({ statuses, triggerReIngestAction }: Props) {
  const [isPending, startTransition] = useTransition();
  const [reIngestTarget, setReIngestTarget] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const handleReIngest = (sourceType: string) => {
    setReIngestTarget(sourceType);
    setMessages((prev) => ({ ...prev, [sourceType]: '' }));

    startTransition(async () => {
      const result = await triggerReIngestAction(sourceType);
      setReIngestTarget(null);
      if (result.success) {
        setMessages((prev) => ({ ...prev, [sourceType]: 'Queued — refresh in a minute to see updated counts.' }));
      } else {
        setMessages((prev) => ({ ...prev, [sourceType]: `Error: ${result.error}` }));
      }
    });
  };

  return (
    <div className="bg-white border border-n-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-n-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-n-800">Ingest status by source</h2>
        <span className="text-xs text-n-400">Nightly 02:00 IST via n8n</span>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-n-50 text-xs text-n-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Source type</th>
            <th className="px-4 py-2 text-right font-medium">Chunks</th>
            <th className="px-4 py-2 text-left font-medium">Last ingested</th>
            <th className="px-4 py-2 text-left font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-n-100">
          {statuses.map((row) => {
            const badge = (STATUS_BADGE[row.last_run_status] ?? STATUS_BADGE['idle'])!;
            const isThisLoading = isPending && reIngestTarget === row.source_type;
            const msg = messages[row.source_type];

            return (
              <tr key={row.source_type} className="hover:bg-n-50/50">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-n-700">{row.source_type}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-sm font-semibold text-n-800">
                    {row.chunk_count.toLocaleString('en-IN')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-n-500" title={row.last_ingested_at ?? 'Never'}>
                    {formatRelativeTime(row.last_ingested_at)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${badge.class}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {msg && (
                      <span
                        className={`text-xs ${msg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}
                      >
                        {msg}
                      </span>
                    )}
                    <button
                      onClick={() => handleReIngest(row.source_type)}
                      disabled={isPending}
                      className="px-3 py-1 text-xs font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {isThisLoading ? 'Queuing…' : 'Re-ingest now'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {statuses.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-sm text-n-400">
                No ingest state rows found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
