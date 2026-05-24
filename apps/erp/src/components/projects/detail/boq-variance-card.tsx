'use client';

/**
 * S5 — F7 BOQ Variance Narrative Card
 *
 * Displays the AI-generated BOQ variance post-mortem narrative for a project.
 * Rendered on the project details page, inside the Financial section.
 *
 * - If narrative exists: shows it with generated-at footer.
 * - If not: shows a "Generate" button for allowed roles.
 */

import * as React from 'react';
import { Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { generateBoqVarianceForProject } from '@/lib/boq-variance-actions';

const ALLOWED_ROLES = new Set(['founder', 'project_manager', 'finance']);

interface BoqVarianceCardProps {
  projectId: string;
  narrative: string | null;
  narrativeAt: string | null;
  narrativeModel: string | null;
  viewerRole: string | null;
}

function formatGeneratedAt(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export function BoqVarianceCard({
  projectId,
  narrative,
  narrativeAt,
  narrativeModel,
  viewerRole,
}: BoqVarianceCardProps) {
  const canGenerate = !!viewerRole && ALLOWED_ROLES.has(viewerRole);
  const [busy, setBusy] = React.useState(false);
  const [localNarrative, setLocalNarrative] = React.useState<string | null>(narrative);
  const [localAt, setLocalAt] = React.useState<string | null>(narrativeAt);
  const [localModel, setLocalModel] = React.useState<string | null>(narrativeModel);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function handleGenerate() {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);

    try {
      const result = await generateBoqVarianceForProject(projectId);
      if (!result.success) {
        setErrorMsg(result.error);
      } else {
        // Page will revalidate via revalidatePath — re-fetch is handled by Next.js.
        // Optimistically refresh by reloading the window after a brief delay.
        window.location.reload();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            BOQ Variance Analysis
          </CardTitle>
          {canGenerate && (
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="flex items-center gap-1 text-xs text-n-500 hover:text-n-900 disabled:opacity-50 transition-colors"
              title={localNarrative ? 'Re-generate narrative' : 'Generate narrative'}
            >
              <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
              {busy ? 'Generating…' : localNarrative ? 'Regenerate' : 'Generate'}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {errorMsg && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 mb-3">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">{errorMsg}</p>
          </div>
        )}

        {localNarrative ? (
          <div className="space-y-3">
            <p className="text-sm text-n-700 leading-relaxed whitespace-pre-wrap">
              {localNarrative}
            </p>
            {localAt && (
              <p className="text-[10px] text-n-400 border-t border-n-100 pt-2">
                Generated {formatGeneratedAt(localAt)}
                {localModel ? ` via ${localModel}` : ''}
              </p>
            )}
          </div>
        ) : (
          <div className="py-4 text-center">
            <p className="text-sm text-n-400">
              No variance narrative yet.
            </p>
            {canGenerate ? (
              <p className="text-xs text-n-400 mt-1">
                Click &ldquo;Generate&rdquo; above to run the AI analysis.
                Requires data in the BOQ variance table.
              </p>
            ) : (
              <p className="text-xs text-n-400 mt-1">
                Ask a project manager, finance officer, or the founder to generate one.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
