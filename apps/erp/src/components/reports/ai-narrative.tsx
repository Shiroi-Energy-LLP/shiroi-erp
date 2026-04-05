'use client';

import * as React from 'react';
import { generateAINarrative } from '@/lib/report-ai-actions';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@repo/ui';
import { Sparkles, RefreshCw, Clock } from 'lucide-react';

interface AINarrativeProps {
  reportId: string;
  projectId: string;
  existingNarrative?: string | null;
  generatedAt?: string | null;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function AINarrative({ reportId, projectId, existingNarrative, generatedAt }: AINarrativeProps) {
  const [narrative, setNarrative] = React.useState(existingNarrative ?? '');
  const [lastGenerated, setLastGenerated] = React.useState(generatedAt ?? '');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);

    const res = await generateAINarrative(reportId, projectId);

    setLoading(false);
    if (res.success && res.narrative) {
      setNarrative(res.narrative);
      setLastGenerated(new Date().toISOString());
    } else {
      setError(res.error ?? 'Failed to generate narrative');
    }
  }

  return (
    <Card className="border-[#00B050]/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#00B050]" />
            AI Summary
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={loading}
            className="h-7 text-xs gap-1.5"
          >
            {loading ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" />
                Generating...
              </>
            ) : narrative ? (
              <>
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                Generate
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-[#991B1B] mb-2">{error}</p>
        )}

        {narrative ? (
          <div>
            <p className="text-sm text-[#3F424D] leading-relaxed whitespace-pre-wrap">
              {narrative}
            </p>
            {lastGenerated && (
              <p className="text-[11px] text-[#9CA0AB] mt-2 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Generated {formatDateTime(lastGenerated)}
              </p>
            )}
          </div>
        ) : !loading ? (
          <p className="text-sm text-[#9CA0AB] text-center py-3">
            Click &quot;Generate&quot; to create an AI summary of this report.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
