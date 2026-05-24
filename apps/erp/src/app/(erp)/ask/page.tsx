/**
 * /ask — Shiroi internal knowledge Q&A page.
 *
 * Open to all authenticated roles. Answers come from the Shiroi RAG index
 * (docs/modules, master reference, specs, plans, CHANGELOG, etc.).
 *
 * Rate limit: 30 questions/day for non-founders. Founder unlimited.
 */

import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { createAdminClient } from '@repo/supabase/admin';
import { Eyebrow, ToastProvider } from '@repo/ui';
import { AskForm } from './_client/ask-form';
import { askInternalQuestion, recordRagFeedback } from '@/lib/ai/ask-action';

export const dynamic = 'force-dynamic';

/** Pre-compute remaining count for the current session's first render. */
async function getInitialRemaining(
  userId: string,
  role: string,
): Promise<number | null> {
  if (role === 'founder') return null;

  // We use the same logic as checkAndIncrementRateLimit but read-only here.
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();
  const { count } = await admin
    .from('rag_query_log')
    .select('id', { count: 'exact', head: true })
    .eq('caller_id', userId)
    .gte('created_at', windowStart);

  const used = count ?? 0;
  const NON_FOUNDER_DAILY_LIMIT = 30;
  return Math.max(0, NON_FOUNDER_DAILY_LIMIT - used);
}

export default async function AskPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const initialRemaining = await getInitialRemaining(profile.id, profile.role);

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">KNOWLEDGE ASSISTANT</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-n-900">Ask Shiroi</h1>
        <p className="text-sm text-n-500 mt-1">
          Answers come from Shiroi&apos;s documentation. Always check the source for canonical detail.
        </p>
      </div>

      {/* Form + results */}
      <ToastProvider>
        <AskForm
          askAction={askInternalQuestion}
          feedbackAction={recordRagFeedback}
          initialRemaining={initialRemaining}
        />
      </ToastProvider>

      {/* Usage note */}
      <p className="text-xs text-n-400 border-t border-n-100 pt-4">
        If an answer is wrong or stale, mark it as not helpful and update the source doc —
        Q&amp;A quality is bounded by doc quality. The index re-ingests nightly.
      </p>
    </div>
  );
}
