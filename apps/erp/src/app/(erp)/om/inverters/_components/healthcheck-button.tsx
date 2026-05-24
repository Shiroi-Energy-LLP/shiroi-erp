'use client';

import { useState, useTransition } from 'react';
import { Button } from '@repo/ui';
import { healthCheckInverter } from '@/lib/inverters-actions';

interface HealthCheckButtonProps {
  inverterId: string;
}

export function HealthCheckButton({ inverterId }: HealthCheckButtonProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        className="h-6 text-[10px] px-2"
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const r = await healthCheckInverter(inverterId);
            setResult(r.success ? r.data : { ok: false, message: r.error });
          });
        }}
      >
        {pending ? 'Checking…' : 'Ping'}
      </Button>
      {result !== null && (
        <span
          className={`text-[10px] font-medium ${result.ok ? 'text-green-700' : 'text-red-700'}`}
          title={result.message}
        >
          {result.ok ? '✓' : '✗'}
        </span>
      )}
    </div>
  );
}
