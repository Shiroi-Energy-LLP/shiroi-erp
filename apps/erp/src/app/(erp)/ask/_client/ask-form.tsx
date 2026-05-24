'use client';

/**
 * ask-form.tsx — client island for the /ask page.
 *
 * Renders:
 *   - Textarea for the question
 *   - Submit button
 *   - Answer card with source citations (collapsible per source)
 *   - Thumbs-up / thumbs-down feedback buttons
 *   - Remaining questions counter
 */

import { useState, useTransition, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useToast,
} from '@repo/ui';
import type { ActionResult } from '@/lib/types/actions';
import type { AskResult, AskCitation } from '@/lib/ai/ask-action';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  askAction: (question: string) => Promise<ActionResult<AskResult>>;
  feedbackAction: (logId: string, helpful: boolean) => Promise<ActionResult<void>>;
  /** null = founder / unlimited */
  initialRemaining: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function CitationItem({ citation }: { citation: AskCitation }) {
  const [expanded, setExpanded] = useState(false);

  const breadcrumb = citation.heading_path && citation.heading_path.length > 0
    ? citation.heading_path.join(' › ')
    : null;

  return (
    <div className="border border-n-200 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start justify-between gap-2 px-3 py-2 text-left bg-n-50 hover:bg-n-100 transition-colors"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <span className="text-xs font-mono font-medium text-primary-700 truncate block">
            {citation.source_path}
          </span>
          {breadcrumb && (
            <span className="text-xs text-n-500 block mt-0.5">{breadcrumb}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <span className="text-xs font-mono text-n-400">
            {(citation.similarity * 100).toFixed(0)}%
          </span>
          <span className="text-xs text-n-400">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 py-2 bg-white border-t border-n-200">
          <p className="text-xs font-mono text-n-600 whitespace-pre-wrap leading-relaxed">
            {citation.content}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AskForm({ askAction, feedbackAction, initialRemaining }: Props) {
  const { addToast } = useToast();

  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [thumbsState, setThumbsState] = useState<'up' | 'down' | null>(null);
  const [remaining, setRemaining] = useState<number | null>(initialRemaining);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = question.trim();
      if (!trimmed || isPending) return;

      startTransition(async () => {
        setResult(null);
        setThumbsState(null);

        const res = await askAction(trimmed);

        if (!res.success) {
          addToast({
            variant: 'destructive',
            title: 'Could not answer',
            description: res.error,
          });
          return;
        }

        setResult(res.data);
        // Update remaining from server response (source of truth)
        setRemaining(res.data.remaining);
      });
    },
    [question, isPending, askAction, addToast],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  const handleThumbs = async (helpful: boolean) => {
    if (thumbsState !== null || !result?.query_log_id) return;
    setThumbsState(helpful ? 'up' : 'down');

    const res = await feedbackAction(result.query_log_id, helpful);
    if (!res.success) {
      addToast({ variant: 'warning', description: 'Could not save feedback.' });
      setThumbsState(null);
    } else {
      addToast({
        variant: 'success',
        description: helpful ? 'Thanks for the thumbs up!' : 'Feedback noted — check the source doc.',
      });
    }
  };

  const remainingLabel =
    remaining === null
      ? 'Unlimited questions (founder)'
      : `${remaining} question${remaining === 1 ? '' : 's'} remaining today`;

  return (
    <div className="space-y-6">
      {/* Question form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What's our standard payment terms for industrial? (Ctrl+Enter to submit)"
          rows={3}
          maxLength={1000}
          className="w-full border border-n-300 rounded-lg px-3 py-2 text-sm text-n-800 placeholder:text-n-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          disabled={isPending}
        />
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-n-400">{remainingLabel}</p>
          <button
            type="submit"
            disabled={isPending || !question.trim()}
            className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>

      {/* Loading state */}
      {isPending && (
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-n-200 rounded w-3/4" />
          <div className="h-4 bg-n-200 rounded w-1/2" />
          <div className="h-4 bg-n-200 rounded w-5/6" />
        </div>
      )}

      {/* Answer card */}
      {result && !isPending && (
        <div className="space-y-4">
          {/* Answer */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Answer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-n-800 leading-relaxed whitespace-pre-wrap">
                {result.answer}
              </p>

              {/* Feedback */}
              {result.query_log_id && (
                <div className="flex items-center gap-3 pt-2 border-t border-n-100">
                  <span className="text-xs text-n-500">Was this helpful?</span>
                  <button
                    type="button"
                    onClick={() => handleThumbs(true)}
                    disabled={thumbsState !== null}
                    aria-pressed={thumbsState === 'up'}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      thumbsState === 'up'
                        ? 'bg-green-100 border-green-400 text-green-700 font-medium'
                        : 'border-n-300 text-n-600 hover:bg-n-50 disabled:opacity-50'
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => handleThumbs(false)}
                    disabled={thumbsState !== null}
                    aria-pressed={thumbsState === 'down'}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      thumbsState === 'down'
                        ? 'bg-red-100 border-red-400 text-red-700 font-medium'
                        : 'border-n-300 text-n-600 hover:bg-n-50 disabled:opacity-50'
                    }`}
                  >
                    No
                  </button>
                  <span className="text-xs text-n-400 ml-auto">
                    {result.latency_ms}ms
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sources */}
          {result.citations.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-n-700 mb-2">
                Sources ({result.citations.length})
              </h2>
              <div className="space-y-2">
                {result.citations.map((c) => (
                  <CitationItem key={c.id} citation={c} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !isPending && (
        <div className="text-center py-10 text-sm text-n-400">
          Ask a question to get a grounded answer from Shiroi&apos;s documentation.
        </div>
      )}
    </div>
  );
}
