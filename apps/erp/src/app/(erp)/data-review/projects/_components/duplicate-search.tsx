'use client';

// apps/erp/src/app/(erp)/data-review/projects/_components/duplicate-search.tsx
// Modal typeahead: search for the canonical project this one duplicates.
// Shows data-richness score for both projects, auto-suggests richer as canonical.

import { useState, useEffect, useTransition } from 'react';
import { Button, Input } from '@repo/ui';
import { Loader2, X, Trophy } from 'lucide-react';
import { searchProjectsForDuplicate, getProjectScoreForDuplicateConfirm } from '@/lib/data-review-queries';

interface SearchResult {
  id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
}

interface Props {
  currentProjectId: string;
  currentProjectNumber: string;
  onConfirm: (canonicalId: string, notes: string) => Promise<boolean>;
  onClose: () => void;
}

export function DuplicateSearch({
  currentProjectId,
  currentProjectNumber,
  onConfirm,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [notes, setNotes] = useState('');
  const [scoreA, setScoreA] = useState<number | null>(null);
  const [scoreB, setScoreB] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Fetch current project score on mount
  useEffect(() => {
    getProjectScoreForDuplicateConfirm(currentProjectId).then(setScoreA);
  }, [currentProjectId]);

  // Fetch selected project score when selection changes
  useEffect(() => {
    if (!selected) { setScoreB(null); return; }
    getProjectScoreForDuplicateConfirm(selected.id).then(setScoreB);
  }, [selected]);

  // Debounced search
  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelected(null);
    if (searchTimer) clearTimeout(searchTimer);
    if (!value.trim() || value.trim().length < 2) { setResults([]); return; }
    setSearchTimer(
      setTimeout(async () => {
        setSearching(true);
        try {
          const r = await searchProjectsForDuplicate(value.trim(), currentProjectId);
          setResults(r);
        } finally {
          setSearching(false);
        }
      }, 300),
    );
  };

  const handleConfirm = () => {
    if (!selected || !notes.trim()) return;
    startSubmit(async () => {
      await onConfirm(selected.id, notes.trim());
    });
  };

  // Determine which is suggested canonical (higher score or older — we show score hint)
  const canonicalHint =
    scoreA !== null && scoreB !== null
      ? scoreA >= scoreB
        ? currentProjectNumber
        : selected?.project_number
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#1A1D24]">Mark as Duplicate</h2>
            <p className="text-xs text-[#7C818E]">
              Searching for the canonical project that <span className="font-mono">{currentProjectNumber}</span> duplicates.
              The lower-scored project will be soft-deleted.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 text-[#7C818E] hover:text-[#1A1D24]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="relative mb-3">
          <Input
            placeholder="Search by customer name or project #…"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            className="pr-8"
          />
          {searching && (
            <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-[#7C818E]" />
          )}
        </div>

        {/* Results list */}
        {!selected && results.length > 0 && (
          <ul className="mb-4 max-h-48 overflow-y-auto rounded-md border border-[#E5E7EB]">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => { setSelected(r); setResults([]); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#F9FAFB] transition-colors"
                >
                  <span className="font-mono text-xs text-[#7C818E] shrink-0">{r.project_number}</span>
                  <span className="flex-1 truncate text-[#1A1D24]">{r.customer_name}</span>
                  <span className="text-xs text-[#7C818E]">{r.system_size_kwp} kWp</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Comparison panel */}
        {selected && (
          <div className="mb-4 rounded-md border border-[#E5E7EB] p-3 space-y-2">
            <h3 className="text-xs font-semibold text-[#7C818E] uppercase tracking-wide">Score comparison</h3>
            <div className="grid grid-cols-2 gap-3">
              <ScoreCard
                label={currentProjectNumber}
                subtitle="current (will be deleted if lower score)"
                score={scoreA}
                isCanonical={canonicalHint === currentProjectNumber}
              />
              <ScoreCard
                label={selected.project_number}
                subtitle={selected.customer_name}
                score={scoreB}
                isCanonical={canonicalHint === selected.project_number}
              />
            </div>
            {canonicalHint && (
              <p className="text-xs text-green-700">
                <Trophy className="inline h-3 w-3 mr-1" />
                Suggested canonical: <span className="font-mono font-semibold">{canonicalHint}</span>
              </p>
            )}
            <button
              type="button"
              onClick={() => { setSelected(null); setQuery(''); setScoreB(null); }}
              className="text-xs text-[#7C818E] underline"
            >
              Change selection
            </button>
          </div>
        )}

        {/* Notes */}
        {selected && (
          <div className="mb-4">
            <label className="text-xs font-medium text-[#7C818E] mb-1 block">
              Reason for merging (required)
            </label>
            <textarea
              className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1A1D24]"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Same customer, same site — HubSpot import created a duplicate of the Zoho-imported project"
            />
          </div>
        )}

        {/* Footer buttons */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!selected || !notes.trim() || submitting}
            onClick={handleConfirm}
          >
            {submitting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Confirm Merge
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  subtitle,
  score,
  isCanonical,
}: {
  label: string;
  subtitle: string;
  score: number | null;
  isCanonical: boolean;
}) {
  return (
    <div className={`rounded-md border p-2 ${isCanonical ? 'border-green-400 bg-green-50' : 'border-[#E5E7EB] bg-[#F9FAFB]'}`}>
      <p className="font-mono text-xs font-semibold text-[#1A1D24]">{label}</p>
      <p className="text-[10px] text-[#7C818E] truncate">{subtitle}</p>
      <p className="text-lg font-bold text-[#1A1D24] mt-1">
        {score === null ? <Loader2 className="h-4 w-4 animate-spin" /> : score}
      </p>
      <p className="text-[10px] text-[#7C818E]">data-richness score</p>
    </div>
  );
}
