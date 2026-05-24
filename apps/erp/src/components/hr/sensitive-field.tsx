'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@repo/ui';

interface SensitiveFieldProps {
  value: string | null | undefined;
  /** If true, show the last 4 digits masked as ****1234 instead of hiding entirely */
  maskPartial?: boolean;
  label?: string;
  className?: string;
}

/**
 * Renders a sensitive field (bank account, Aadhar, PAN etc.) masked by default.
 * The user must explicitly click "Show" to reveal the value.
 * Value is never logged — this is a display-only component.
 */
export function SensitiveField({
  value,
  maskPartial = false,
  label,
  className = '',
}: SensitiveFieldProps) {
  const [revealed, setRevealed] = useState(false);

  const isEmpty = !value || value.length === 0;

  const maskedDisplay = isEmpty
    ? '—'
    : maskPartial && value && value.length >= 4
      ? `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`
      : '••••••••';

  const displayValue = revealed ? (value ?? '—') : maskedDisplay;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && <span className="text-xs text-gray-400 min-w-[80px]">{label}</span>}
      {/*
        select-none only when masked — revealing the value lets HR copy it
        into NEFT / IFSC tools, which is the whole reason for the reveal button.
      */}
      <span
        className={`font-mono text-sm text-[#1A1D24] ${revealed ? '' : 'select-none'}`}
      >
        {displayValue}
      </span>
      {!isEmpty && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-gray-400 hover:text-gray-700"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide sensitive value' : 'Show sensitive value'}
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  );
}
