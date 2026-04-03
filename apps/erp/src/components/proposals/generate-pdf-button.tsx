'use client';

import { useState } from 'react';
import { Button } from '@repo/ui';

interface GeneratePDFButtonProps {
  proposalId: string;
}

export function GeneratePDFButton({ proposalId }: GeneratePDFButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`/api/proposals/${proposalId}/generate-pdf`, {
        method: 'POST',
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to generate PDF');
      } else {
        setSuccess(true);
        // Auto-dismiss success after 3s
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerate}
        disabled={generating}
      >
        {generating ? 'Generating...' : 'Generate PDF'}
      </Button>
      {error && (
        <span className="text-xs text-[#991B1B]">{error}</span>
      )}
      {success && (
        <span className="text-xs text-[#065F46]">PDF generated!</span>
      )}
    </div>
  );
}
