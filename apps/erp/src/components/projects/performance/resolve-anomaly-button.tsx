'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@repo/ui';
import { resolveAnomaly } from '@/lib/plant-anomaly-actions';

interface ResolveAnomalyButtonProps {
  anomalyId: string;
}

export function ResolveAnomalyButton({ anomalyId }: ResolveAnomalyButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleResolve() {
    setLoading(true);
    try {
      const result = await resolveAnomaly(anomalyId, '');
      if (result.success) {
        setDone(true);
        router.refresh();
      } else {
        console.error('[ResolveAnomalyButton] resolve failed:', result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-shiroi-green font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Resolved
      </span>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleResolve}
      disabled={loading}
      className="h-7 text-xs"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        'Resolve'
      )}
    </Button>
  );
}
