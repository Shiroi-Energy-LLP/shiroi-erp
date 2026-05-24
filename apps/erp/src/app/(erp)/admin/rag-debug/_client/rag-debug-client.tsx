'use client';

/**
 * rag-debug-client.tsx — client component for the RAG debug page.
 *
 * Renders:
 *   - Query form (text input + top_k slider + source_types multi-select)
 *   - Results list with similarity scores, source paths, heading breadcrumbs,
 *     content previews, and thumbs-up/down buttons
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, useCallback } from 'react';
import type { RagSearchResult } from '@/lib/rag-debug-actions';
import type { ActionResult } from '@/lib/types/actions';

const SOURCE_TYPE_OPTIONS = [
  { value: 'module_doc', label: 'Module docs' },
  { value: 'master_reference', label: 'Master reference' },
  { value: 'claude_md', label: 'CLAUDE.md' },
  { value: 'spec', label: 'Specs' },
  { value: 'plan', label: 'Plans' },
  { value: 'review', label: 'Reviews' },
  { value: 'changelog', label: 'Changelog' },
];

interface Props {
  initialQuery: string;
  initialTopK: number;
  initialSourceTypes: string;
  searchResult: ActionResult<RagSearchResult> | null;
  thumbsAction: (logId: string, direction: 'up' | 'down') => Promise<ActionResult<void>>;
}

export function RagDebugClient({
  initialQuery,
  initialTopK,
  initialSourceTypes,
  searchResult,
  thumbsAction,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(initialQuery);
  const [topK, setTopK] = useState(Math.min(Math.max(initialTopK, 1), 20));
  const [selectedTypes, setSelectedTypes] = useState<string[]>(
    initialSourceTypes ? initialSourceTypes.split(',').filter(Boolean) : [],
  );
  const [isPending, startTransition] = useTransition();
  const [thumbsState, setThumbsState] = useState<Record<string, 'up' | 'down' | null>>({});

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('q', query.trim());
    params.set('top_k', String(topK));
    if (selectedTypes.length > 0) {
      params.set('source_types', selectedTypes.join(','));
    } else {
      params.delete('source_types');
    }
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  }, [query, topK, selectedTypes, searchParams, router]);

  const handleTypeToggle = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const handleThumbs = async (logId: string, direction: 'up' | 'down') => {
    if (thumbsState[logId]) return; // already voted
    setThumbsState((prev) => ({ ...prev, [logId]: direction }));
    await thumbsAction(logId, direction);
  };

  const result = searchResult?.success ? searchResult.data : null;
  const resultError = searchResult && !searchResult.success ? searchResult.error : null;

  return (
    <div className="space-y-6">
      {/* Query form */}
      <div className="bg-white border border-n-200 rounded-lg p-4 space-y-4">
        <div>
          <label className="text-sm font-medium text-n-700 block mb-1">Query</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. what is our standard payment terms?"
              className="flex-1 border border-n-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={handleSearch}
              disabled={isPending || !query.trim()}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>

        <div className="flex gap-6 flex-wrap">
          {/* top_k slider */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-n-700 whitespace-nowrap">
              Top K: <span className="text-primary-600 font-bold">{topK}</span>
            </label>
            <input
              type="range"
              min={1}
              max={20}
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value, 10))}
              className="w-32"
            />
          </div>

          {/* Source type filter */}
          <div>
            <span className="text-sm font-medium text-n-700 block mb-1">Source types</span>
            <div className="flex flex-wrap gap-1">
              {SOURCE_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleTypeToggle(opt.value)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    selectedTypes.includes(opt.value)
                      ? 'bg-primary-100 border-primary-400 text-primary-700 font-medium'
                      : 'bg-white border-n-300 text-n-600 hover:bg-n-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {selectedTypes.length > 0 && (
                <button
                  onClick={() => setSelectedTypes([])}
                  className="px-2 py-0.5 text-xs rounded-full border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {resultError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {resultError}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-n-700">
              {result.chunks.length} result{result.chunks.length !== 1 ? 's' : ''} for &ldquo;{result.query}&rdquo;
            </h2>
            <div className="flex items-center gap-3 text-xs text-n-500">
              <span>{result.latencyMs}ms</span>
              {result.logId && (
                <div className="flex items-center gap-1">
                  <span>Helpful?</span>
                  <button
                    onClick={() => handleThumbs(result.logId, 'up')}
                    disabled={!!thumbsState[result.logId]}
                    className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                      thumbsState[result.logId] === 'up'
                        ? 'bg-green-100 border-green-400 text-green-700'
                        : 'border-n-300 hover:bg-n-50 disabled:opacity-50'
                    }`}
                    title="Good results"
                  >
                    Helpful
                  </button>
                  <button
                    onClick={() => handleThumbs(result.logId, 'down')}
                    disabled={!!thumbsState[result.logId]}
                    className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                      thumbsState[result.logId] === 'down'
                        ? 'bg-red-100 border-red-400 text-red-700'
                        : 'border-n-300 hover:bg-n-50 disabled:opacity-50'
                    }`}
                    title="Poor results"
                  >
                    Not helpful
                  </button>
                </div>
              )}
            </div>
          </div>

          {result.chunks.length === 0 ? (
            <div className="bg-n-50 border border-n-200 rounded-lg p-6 text-center text-sm text-n-500">
              No chunks found above the similarity threshold (0.40).
              <br />
              Try rephrasing the query or lowering the threshold.
            </div>
          ) : (
            <div className="space-y-3">
              {result.chunks.map((chunk, i) => (
                <div
                  key={chunk.id}
                  className="bg-white border border-n-200 rounded-lg p-4 space-y-2"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {/* Breadcrumb */}
                      <div className="flex items-center gap-1 flex-wrap text-xs text-n-500 mb-0.5">
                        <span className="font-mono bg-n-100 px-1 rounded text-n-600">
                          {chunk.source_type}
                        </span>
                        <span className="text-n-400">/</span>
                        <span className="font-mono text-n-600 truncate max-w-xs">{chunk.source_path}</span>
                        {chunk.heading_path && chunk.heading_path.length > 0 && (
                          <>
                            <span className="text-n-400">/</span>
                            <span className="text-n-500">{chunk.heading_path.join(' › ')}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded">
                        {chunk.similarity.toFixed(3)}
                      </span>
                      <span className="text-xs text-n-400">#{i + 1}</span>
                    </div>
                  </div>

                  {/* Content preview */}
                  <p className="text-sm text-n-700 leading-relaxed line-clamp-6 whitespace-pre-wrap font-mono text-xs bg-n-50 rounded p-2">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !resultError && !isPending && (
        <div className="text-center py-12 text-sm text-n-400">
          Enter a query above to test RAG retrieval.
        </div>
      )}
    </div>
  );
}
