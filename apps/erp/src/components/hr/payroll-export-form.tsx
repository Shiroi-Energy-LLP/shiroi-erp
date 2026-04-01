'use client';

import { useState } from 'react';
import { Button, Input, Label, Select } from '@repo/ui';

interface PayrollExportFormProps {
  defaultYear: number;
  defaultMonth: number;
}

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

export function PayrollExportForm({ defaultYear, defaultMonth }: PayrollExportFormProps) {
  const [year, setYear] = useState(String(defaultYear));
  const [month, setMonth] = useState(String(defaultMonth));
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const op = '[PayrollExportForm.handleGenerate]';

    setIsGenerating(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/hr/payroll-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: Number(year),
          month: Number(month),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Unknown error' }));
        setError(body.error ?? `Failed to generate CSV (${response.status})`);
        return;
      }

      // Trigger download
      const blob = await response.blob();
      const paddedMonth = String(month).padStart(2, '0');
      const filename = `shiroi-payroll-${year}-${paddedMonth}.csv`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      setMessage(`Payroll CSV for ${MONTHS[Number(month) - 1]?.label} ${year} downloaded successfully.`);
    } catch (err) {
      console.error(`${op} Failed:`, {
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
      setError('An unexpected error occurred.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <form onSubmit={handleGenerate} className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}
      {message && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-600">{message}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="year">Year</Label>
          <Input
            id="year"
            type="number"
            min={2020}
            max={2040}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="month">Month</Label>
          <Select
            id="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            required
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Button type="submit" disabled={isGenerating}>
            {isGenerating ? 'Generating...' : 'Generate CSV'}
          </Button>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        No salary values are displayed on screen. The CSV is generated and downloaded directly.
      </p>
    </form>
  );
}
