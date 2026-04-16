'use client';

import * as React from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

const AUTO_REMASK_MS = 30_000;

interface PlantMonitoringPasswordCellProps {
  password: string;
}

export function PlantMonitoringPasswordCell({ password }: PlantMonitoringPasswordCellProps) {
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto re-mask after 30s
  React.useEffect(() => {
    if (revealed) {
      timerRef.current = setTimeout(() => setRevealed(false), AUTO_REMASK_MS);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [revealed]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API failure (e.g. non-secure context) — silently ignore
    }
  }

  function handleToggle() {
    setRevealed((r) => !r);
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className={`font-mono text-[11px] ${revealed ? 'text-n-900' : 'text-n-500 tracking-widest'}`}>
        {revealed ? password : '••••••••'}
      </span>
      <button
        type="button"
        onClick={handleToggle}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        className="text-n-400 hover:text-n-700 transition-colors"
      >
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      {revealed && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy password"
          className="text-n-400 hover:text-n-700 transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}
